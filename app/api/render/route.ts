/**
 * POST /api/render
 *
 * EditPlan + 업로드된 원본 경로를 받아 ffmpeg 렌더링을 시도한다.
 * ffmpeg 가 없으면 실행할 명령어(초안)를 반환한다.
 *
 * body: { plan: EditPlan, inputPath: "uploads/xxx.mp4" }
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { access } from "node:fs/promises";
import { STORAGE_ROOT, OUTPUT_DIR, ensureStorage, safeFileName } from "@/lib/storage";
import { renderPlan, buildFfmpegCommand } from "@/lib/render/ffmpeg";
import type { EditPlan } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { plan?: EditPlan; inputPath?: string };
    const { plan, inputPath } = body;

    if (!plan || !inputPath) {
      return NextResponse.json(
        { error: "plan 과 inputPath 가 필요합니다." },
        { status: 400 },
      );
    }

    await ensureStorage();

    // 경로 조작 방지: STORAGE_ROOT 밖으로 나가지 못하게 함
    const absInput = path.join(STORAGE_ROOT, inputPath);
    if (!absInput.startsWith(STORAGE_ROOT)) {
      return NextResponse.json({ error: "잘못된 inputPath 입니다." }, { status: 400 });
    }

    const baseName = safeFileName(path.basename(inputPath, path.extname(inputPath)));
    const outName = `${baseName}_edited.mp4`;
    const outPath = path.join(OUTPUT_DIR, outName);

    // 입력 파일 존재 확인. 없으면 명령어 초안만 반환.
    const inputExists = await exists(absInput);
    if (!inputExists) {
      const cmd = buildFfmpegCommand(plan, absInput, outPath);
      return NextResponse.json({
        ok: false,
        rendered: false,
        message:
          "원본 파일을 찾을 수 없어 렌더링을 건너뜁니다. 아래는 실행 예정 명령어입니다.",
        command: `${cmd.bin} ${cmd.args.join(" ")}`,
        note: cmd.note,
      });
    }

    const result = await renderPlan(plan, absInput, outPath);
    return NextResponse.json({
      ok: result.ok,
      rendered: result.ok,
      message: result.message,
      command: result.command,
      outputPath: result.ok ? `output/${outName}` : undefined,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `렌더링 요청 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
