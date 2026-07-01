/**
 * POST /api/transcribe
 *
 * mp4 원본에서 Whisper 로 자동 자막(transcript)을 생성한다.
 *
 * - 로컬: ffmpeg 로 오디오 추출 후 Whisper 실행 → segments 반환 + transcript.json 저장
 * - 서버리스(Vercel): 실행하지 않고 "로컬/워커에서 실행 예정" 안내만 반환
 *
 * body: { inputPath: "uploads/xxx.mp4", language?: "ko", model?: "base" }
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { writeFile, access } from "node:fs/promises";
import { STORAGE_ROOT, OUTPUT_DIR, ensureStorage, safeFileName } from "@/lib/storage";
import { isServerless } from "@/lib/env";
import { detectWhisper, transcribeFile, WHISPER_INSTALL_HINTS } from "@/lib/render/whisper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      inputPath?: string;
      language?: string;
      model?: string;
    };

    // 서버리스: 실행 금지, 안내만
    if (isServerless()) {
      return NextResponse.json({
        ok: false,
        serverless: true,
        message:
          "Whisper 자동 자막은 Vercel(서버리스)에서 실행하지 않습니다. " +
          "로컬 환경 또는 별도 워커에서 실행하거나, transcript.json 을 직접 업로드하세요.",
      });
    }

    const { inputPath } = body;
    if (!inputPath) {
      return NextResponse.json({ error: "inputPath 가 필요합니다." }, { status: 400 });
    }

    await ensureStorage();
    const absInput = path.join(STORAGE_ROOT, inputPath);
    if (!absInput.startsWith(STORAGE_ROOT)) {
      return NextResponse.json({ error: "잘못된 inputPath 입니다." }, { status: 400 });
    }
    if (!(await exists(absInput))) {
      return NextResponse.json(
        { error: "원본 파일을 찾을 수 없습니다. 먼저 영상을 업로드하세요." },
        { status: 404 },
      );
    }

    // Whisper 설치 확인
    const info = await detectWhisper();
    if (!info.available) {
      return NextResponse.json({
        ok: false,
        available: false,
        message:
          "사용 가능한 Whisper 백엔드가 없습니다. 아래 중 하나를 설치한 뒤 다시 시도하세요.",
        hints: WHISPER_INSTALL_HINTS,
        detail: info.detail,
      });
    }

    // 실행 (한국어 기본)
    const segments = await transcribeFile(absInput, {
      language: body.language || "ko",
      model: body.model,
    });

    // transcript.json 저장(다운로드용)
    const baseName = safeFileName(path.basename(inputPath, path.extname(inputPath)));
    const outName = `${baseName}_transcript.json`;
    await writeFile(
      path.join(OUTPUT_DIR, outName),
      JSON.stringify(segments, null, 2),
      "utf8",
    );

    return NextResponse.json({
      ok: true,
      backend: info.backend,
      count: segments.length,
      segments,
      downloadUrl: `/api/download?file=${encodeURIComponent(`output/${outName}`)}`,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `자동 자막 생성 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}
