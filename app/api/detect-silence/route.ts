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
import { checkFfmpeg, probeVideo, detectSilence } from "@/lib/render/ffmpeg";
import type { TranscriptSegment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      inputPath?: string;
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

    const noiseDb = body.silenceThreshold ?? -30;
    const minDur = body.minSilenceDuration ?? 0.6;

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

    return NextResponse.json({
      ok: true,
      durationSec: round(duration),
      silenceCount: silences.length,
      segments,
      // 컷 후보(silence 구간)도 참고용으로 반환
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
