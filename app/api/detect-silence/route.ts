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

/** "얼마나 자를지" 모드 → 평균볼륨 대비 오프셋(dB) + 최소 무음 길이(초) */
const MODE_PROFILE: Record<
  string,
  { below: number; minDur: number }
> = {
  gentle: { below: 10, minDur: 0.7 }, // 조금: 확실히 조용할 때만
  normal: { below: 6, minDur: 0.5 }, // 보통
  aggressive: { below: 3, minDur: 0.35 }, // 많이: 짧은 쉼까지
};

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

    // 자동 모드: 영상 볼륨을 분석해 기준을 스스로 정한다(사용자가 dB 몰라도 됨)
    let noiseDb: number;
    let minDur: number;
    let meanVolume: number | null = null;
    if (body.mode) {
      const profile = MODE_PROFILE[body.mode] ?? MODE_PROFILE.normal;
      const { mean } = await probeMeanVolume(abs);
      meanVolume = mean;
      const base = mean ?? -20; // 측정 실패 시 무난한 기본
      // 평균볼륨보다 profile.below dB 아래를 "무음"으로 (조용한 말은 안 자르게 범위 제한)
      noiseDb = clamp(Math.round(base - profile.below), -45, -14);
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

    const silences = await detectSilence(abs, noiseDb, minDur);
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
