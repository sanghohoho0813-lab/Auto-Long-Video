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
 * "얼마나 자를지" 3단계 → "최소 몇 %의 말을 남길지(keepFloor)".
 * 앱이 여러 기준(dB)을 스캔해서, 말을 keepFloor 이상 남기면서 가장 많이 자르는 기준을
 * 자동으로 고른다. (고정 dB로 찍지 않으므로 영상마다 잡음 위치가 달라도 알아서 맞춤)
 * 값이 작을수록 더 과감(말을 덜 남기고 더 자름).
 */
const MODE_KEEP_FLOOR: Record<string, { keep: number; minDur: number; mergeGap: number }> = {
  gentle: { keep: 0.6, minDur: 0.45, mergeGap: 0.25 }, // 조금
  normal: { keep: 0.45, minDur: 0.35, mergeGap: 0.3 }, // 보통
  aggressive: { keep: 0.25, minDur: 0.3, mergeGap: 0.45 }, // 많이 (과감)
};

// 스캔할 기준들: 최대음량(max) 대비 아래로 이만큼(dB). 잡음 바닥이 어디든 걸리게 넓게.
// 위쪽(4)은 말소리 근처라 과감 모드가 더 자를 수 있게 포함(가드가 과다컷은 거름).
// (병렬 실행하므로 개수를 적당히 유지)
const SCAN_BELOW_MAX = [28, 22, 17, 13, 10, 7, 4];

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

    const profile = MODE_KEEP_FLOOR[body.mode ?? "normal"] ?? MODE_KEEP_FLOOR.normal;
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

    // "말을 keep 이상 남기면서 가장 많이 자르는" 기준 선택.
    // (기준이 높을수록 무음↑ → 오름차순 total. keep 조건을 만족하는 가장 공격적인 것)
    const cap = duration * (1 - profile.keep); // 제거 상한(초)
    const minCut = Math.max(0.3, duration * 0.002); // 최소한 이 정도는 잘려야 "찾음"
    let chosen: Scan | null = null;
    for (const s of scans) {
      if (s.total > minCut && s.total <= cap) chosen = s; // 조건 만족 중 가장 높은 기준(=가장 많이)
    }
    // 조건 만족이 없으면: 뭐라도 자른 것 중 가장 적게 자른 것(과다컷 방지), 그것도 없으면 최상위
    if (!chosen) {
      chosen =
        scans.filter((s) => s.total > minCut).sort((a, b) => a.total - b.total)[0] ??
        scans[scans.length - 1];
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
      // 참고: 스캔 곡선(디버그/튜닝용)
      scan: scans.map((s) => ({ th: s.th, sec: round(s.total) })),
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
