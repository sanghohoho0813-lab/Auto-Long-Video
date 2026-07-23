/**
 * POST /api/detect-silence
 *
 * ffmpeg silencedetect 로 실제 오디오 무음 구간을 감지해서,
 * "말이 있는 구간(speech regions)"을 segments 로 돌려준다.
 * → 클라이언트가 이 segments + "컷만" 설정으로 무음 컷 편집 계획을 만든다.
 *
 * Whisper 가 없어도 동작한다(ffmpeg 만 있으면 됨). 로컬 전용.
 * body: { inputPath, silenceThreshold?, minSilenceDuration? }
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { access } from "node:fs/promises";
import { STORAGE_ROOT, ensureStorage } from "@/lib/storage";
import { isServerless } from "@/lib/env";
import {
  checkFfmpeg,
  probeVideo,
  detectSilence,
  probeMeanVolume,
} from "@/lib/render/ffmpeg";
import type { TranscriptSegment } from "@/lib/types";

/**
 * "얼마나 자를지" 3단계 → 무음으로 인정할 "최소 길이(minDur)"와 "병합 간격(mergeGap)".
 * 앱이 여러 기준(dB)을 스캔한 뒤, 아래의 "폭주(runaway) 감지"로 조용한 '말'을 무음으로
 * 잘못 먹는 지점을 잘라내고, 그 이전의 안전한 후보 중 가장 많이 자르는 기준을 고른다.
 * 조금→긴 침묵만, 많이→짧은 침묵까지. (기준 dB는 영상마다 자동 계산)
 */
const MODE_PROFILE: Record<string, { minDur: number; mergeGap: number }> = {
  gentle: { minDur: 0.6, mergeGap: 0.2 }, // 조금 (긴 침묵만)
  normal: { minDur: 0.4, mergeGap: 0.25 }, // 보통
  aggressive: { minDur: 0.25, mergeGap: 0.3 }, // 많이 (짧은 침묵까지)
};

// 스캔할 기준들: 최대음량(max) 대비 아래로 이만큼(dB). 잡음 바닥이 어디든 걸리게 넓게.
// 위쪽(4)은 말소리 근처라 과감 모드가 더 자를 수 있게 포함(폭주 감지가 과다컷은 거름).
// (병렬 실행하므로 개수를 적당히 유지)
const SCAN_BELOW_MAX = [28, 22, 17, 13, 10, 7, 4];

// 폭주(runaway) 감지 상수: 기준을 한 칸 올렸을 때 무음이 이 배수 이상 튀고(=조용한 말을
// 통째로 먹기 시작) 그 증가분이 전체의 이 비율을 넘으면, 거기서부터는 "말을 먹는" 구간으로
// 보고 버린다. 이게 뒷부분 통짜 컷(사용자가 겪은 12분 오컷)을 막는 핵심 가드.
const RUNAWAY_FACTOR = 2.2;
const RUNAWAY_MIN_DELTA_FRAC = 0.15;
// 폭주 감지가 놓쳐도 절대 이 비율 이상은 제거하지 않는 안전 상한.
const HARDCAP_FRAC = 0.6;

// 컷 경계에 남길 아주 짧은 여유(초). 예전 0.15는 짧은 컷을 다 먹어버려 문제였음.
const CUT_PADDING = 0.05;

// 감지 전용 사전 필터: 에어컨/선풍기의 낮은 "웅~" 소리를 걷어내 무음 감지를 도움.
// (출력 영상 오디오에는 영향 없음 — 오직 "어디를 자를지" 찾는 용도)
const DETECT_PREFILTER = "highpass=f=120";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      inputPath?: string;
      // 자동 모드(권장): 볼륨 분석 후 기준 자동 결정
      mode?: "gentle" | "normal" | "aggressive";
      // 수동 모드(고급): 직접 dB/초 지정
      silenceThreshold?: number;
      minSilenceDuration?: number;
    };

    if (isServerless()) {
      return NextResponse.json({
        ok: false,
        serverless: true,
        message:
          "무음 감지 컷은 로컬(ffmpeg)에서만 동작합니다. 로컬에서 실행하거나 transcript 를 업로드하세요.",
      });
    }

    const { inputPath } = body;
    if (!inputPath) {
      return NextResponse.json({ error: "inputPath 가 필요합니다." }, { status: 400 });
    }

    await ensureStorage();
    const abs = path.join(STORAGE_ROOT, inputPath);
    if (!abs.startsWith(STORAGE_ROOT)) {
      return NextResponse.json({ error: "잘못된 inputPath 입니다." }, { status: 400 });
    }
    if (!(await exists(abs))) {
      return NextResponse.json(
        { error: "원본 파일을 찾을 수 없습니다. 먼저 영상을 업로드하세요." },
        { status: 404 },
      );
    }

    const { ffmpeg, ffprobe } = await checkFfmpeg();
    if (!ffmpeg) {
      return NextResponse.json({
        ok: false,
        message: "ffmpeg 가 설치되어 있지 않습니다. 무음 감지 컷을 사용할 수 없습니다.",
      });
    }

    // 길이 파악
    let duration = 0;
    if (ffprobe) {
      try {
        duration = (await probeVideo(abs)).durationSec;
      } catch {
        /* 무시 */
      }
    }

    const profile = MODE_PROFILE[body.mode ?? "normal"] ?? MODE_PROFILE.normal;
    const minDur = profile.minDur;
    const mergeGap = profile.mergeGap;

    // 저주파(에어컨/선풍기) 제거 후 볼륨 측정 → 스캔 기준점
    const { mean, max } = await probeMeanVolume(abs, DETECT_PREFILTER);
    const base = max ?? (mean !== null ? mean + 10 : -10);

    // 여러 기준(dB)을 병렬로 스캔: 각각 감지→병합→총 무음 계산 (오디오만 디코딩해 빠름)
    type Scan = { th: number; silences: Array<{ start: number; end: number }>; total: number };
    const scans: Scan[] = await Promise.all(
      SCAN_BELOW_MAX.map(async (below) => {
        const th = Math.round(base - below);
        const raw = await detectSilence(abs, th, minDur, DETECT_PREFILTER);
        const merged = mergeSilences(raw, mergeGap);
        const total = merged.reduce((s, r) => s + (r.end - r.start), 0);
        return { th, silences: merged, total };
      }),
    );
    // 기준(th) 오름차순 정렬(선택 로직이 순서에 의존)
    scans.sort((a, b) => a.th - b.th);
    if (!duration) {
      duration = Math.max(...scans.map((s) => s.silences.reduce((m, r) => Math.max(m, r.end), 0)), 1) + 1;
    }

    // 1) 폭주(runaway) 지점 찾기: 기준을 한 칸 올렸을 때 무음이 급증(배수↑ + 증가분이
    //    전체의 큰 비율)하는 첫 지점. 그 지점부터는 "조용한 말"을 먹기 시작한 것으로 보고 버린다.
    //    (scans 는 th 오름차순 = 무음 오름차순이라, 이 급증이 곧 speech-eating 신호)
    let taintFrom = scans.length;
    for (let i = 1; i < scans.length; i++) {
      const prev = scans[i - 1];
      const cur = scans[i];
      const delta = cur.total - prev.total;
      if (cur.total > prev.total * RUNAWAY_FACTOR && delta > duration * RUNAWAY_MIN_DELTA_FRAC) {
        taintFrom = i;
        break;
      }
    }
    const safe = scans.slice(0, taintFrom); // 폭주 이전의 안전한 후보들(최소 1개)

    // 2) 안전 후보 중에서 "가장 많이 자르는" 것 선택(상한/최소컷 조건 내).
    const hardcap = duration * HARDCAP_FRAC; // 절대 제거 상한
    const minCut = Math.max(0.3, duration * 0.002); // 최소한 이 정도는 잘려야 "찾음"
    const eligible = safe.filter((s) => s.total > minCut && s.total <= hardcap);
    let chosen: Scan | null = eligible.length
      ? eligible.reduce((a, b) => (b.total >= a.total ? b : a))
      : null;
    // 조건 만족이 없으면: 안전 후보 중 뭐라도 자른 것(과다컷 방지 위해 가장 적게), 그것도 없으면
    // 전체에서 가장 적게 자른 것, 최후엔 안전 후보 최상위.
    if (!chosen) {
      chosen =
        safe.filter((s) => s.total > minCut).sort((a, b) => a.total - b.total)[0] ??
        scans.filter((s) => s.total > minCut).sort((a, b) => a.total - b.total)[0] ??
        safe[safe.length - 1] ??
        scans[0];
    }

    const silences = chosen.silences;
    const speech = complement(silences, duration);
    const segments: TranscriptSegment[] = speech.map((r) => ({
      start: round(r.start),
      end: round(r.end),
      text: "",
    }));

    // 실제 제거량 = 각 무음 - 앞뒤 여유(패딩)
    const removedSec = silences.reduce(
      (sum, s) => sum + Math.max(0, s.end - s.start - 2 * CUT_PADDING),
      0,
    );

    return NextResponse.json({
      ok: true,
      durationSec: round(duration),
      silenceCount: silences.length,
      removedSec: round(removedSec),
      usedThreshold: chosen.th,
      usedMinDuration: minDur,
      usedPadding: CUT_PADDING,
      meanVolume: mean,
      maxVolume: max,
      // 참고: 스캔 곡선(디버그/튜닝용)과 폭주 컷오프 지점
      scan: scans.map((s, i) => ({ th: s.th, sec: round(s.total), tainted: i >= taintFrom })),
      runawayThreshold: taintFrom < scans.length ? scans[taintFrom].th : null,
      // 감지된 무음 구간(=컷 대상). 클라이언트가 이걸로 곧바로 컷 생성.
      cuts: silences.map((s) => ({ start: round(s.start), end: round(s.end) })),
      segments,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `무음 감지 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

/** 서로 mergeGap 초 이내로 붙어있는 무음들을 하나로 합친다(짧은 말 조각 흡수). */
function mergeSilences(
  silences: Array<{ start: number; end: number }>,
  mergeGap: number,
): Array<{ start: number; end: number }> {
  const sorted = [...silences]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end <= mergeGap) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ start: s.start, end: s.end });
    }
  }
  return merged;
}

/** 무음 구간의 여집합(=말 구간)을 [0, duration] 안에서 구한다. */
function complement(
  silences: Array<{ start: number; end: number }>,
  duration: number,
): Array<{ start: number; end: number }> {
  const sorted = [...silences].sort((a, b) => a.start - b.start);
  const speech: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const s of sorted) {
    const start = Math.max(0, Math.min(s.start, duration));
    if (start > cursor) speech.push({ start: cursor, end: start });
    cursor = Math.max(cursor, Math.min(s.end, duration));
  }
  if (cursor < duration) speech.push({ start: cursor, end: duration });
  return speech.filter((r) => r.end - r.start > 0.05);
}

function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
