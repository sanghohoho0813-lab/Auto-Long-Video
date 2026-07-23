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
 * "얼마나 자를지" 모드 → 내 최대 음량(max) 대비 몇 dB 아래를 무음으로 볼지 + 최소 무음 길이.
 * 평균이 아니라 "가장 크게 말한 소리" 기준이라, 배경 잡음이 깔려도 큰 목소리만 남긴다.
 * belowMax 가 작을수록(=기준이 높을수록) 더 공격적으로 잘림.
 */
const MODE_PROFILE: Record<
  string,
  { belowMax: number; minDur: number }
> = {
  gentle: { belowMax: 18, minDur: 0.6 }, // 조금
  normal: { belowMax: 14, minDur: 0.45 }, // 보통
  aggressive: { belowMax: 10, minDur: 0.35 }, // 많이
  max: { belowMax: 6, minDur: 0.3 }, // 아주 많이: 큰 목소리 외엔 다 컷
};

// 감지 전용 사전 필터: 에어컨/선풍기의 낮은 "웅~" 소리를 걷어내 무음 감지를 도움.
// (출력 영상 오디오에는 영향 없음 — 오직 "어디를 자를지" 찾는 용도)
const DETECT_PREFILTER = "highpass=f=120";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      inputPath?: string;
      // 자동 모드(권장): 볼륨 분석 후 기준 자동 결정
      mode?: "gentle" | "normal" | "aggressive" | "max";
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

    // 자동 모드: 영상 볼륨을 분석해 기준을 스스로 정한다(사용자가 dB 몰라도 됨)
    let noiseDb: number;
    let minDur: number;
    let meanVolume: number | null = null;
    let maxVolume: number | null = null;
    const usePrefilter = !!body.mode; // 자동 모드에서만 저주파 제거로 감지 도움
    if (body.mode) {
      const profile = MODE_PROFILE[body.mode] ?? MODE_PROFILE.normal;
      // 저주파(하울/팬음)를 걷어낸 뒤의 볼륨으로 기준을 잡는다(감지 신호와 일치)
      const { mean, max } = await probeMeanVolume(abs, DETECT_PREFILTER);
      meanVolume = mean;
      maxVolume = max;
      const base = max ?? (mean !== null ? mean + 10 : -10);
      noiseDb = clamp(Math.round(base - profile.belowMax), -45, -8);
      minDur = profile.minDur;
    } else {
      noiseDb = body.silenceThreshold ?? -30;
      minDur = body.minSilenceDuration ?? 0.6;
    }

    // 길이 파악(ffprobe 없으면 무음 마지막 지점으로 근사)
    let duration = 0;
    if (ffprobe) {
      try {
        duration = (await probeVideo(abs)).durationSec;
      } catch {
        /* 무시 */
      }
    }

    const silences = await detectSilence(
      abs,
      noiseDb,
      minDur,
      usePrefilter ? DETECT_PREFILTER : undefined,
    );
    if (!duration) {
      duration = silences.reduce((m, s) => Math.max(m, s.end), 0) + 1;
    }

    // 무음의 여집합 = 말이 있는 구간(speech regions)
    const speech = complement(silences, duration);
    // 각 speech 구간을 세그먼트로(텍스트는 비움 — 컷 편집에만 사용)
    const segments: TranscriptSegment[] = speech.map((r) => ({
      start: round(r.start),
      end: round(r.end),
      text: "",
    }));

    // 제거 예상 총량(패딩 고려 전 대략치)
    const removedSec = silences.reduce((sum, s) => sum + (s.end - s.start), 0);

    return NextResponse.json({
      ok: true,
      durationSec: round(duration),
      silenceCount: silences.length,
      removedSec: round(removedSec),
      // 클라이언트가 편집 계획에 동일하게 반영하도록 사용된 기준을 함께 반환
      usedThreshold: noiseDb,
      usedMinDuration: minDur,
      meanVolume,
      maxVolume,
      segments,
      silences: silences.map((s) => ({ start: round(s.start), end: round(s.end) })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `무음 감지 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
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
