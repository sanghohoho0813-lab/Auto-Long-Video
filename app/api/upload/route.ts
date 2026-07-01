/**
 * POST /api/upload
 *
 * mp4 영상을 업로드받아 storage/uploads 에 저장하고,
 * ffprobe 가 있으면 메타데이터(길이/해상도/용량/fps)를 추출해 반환한다.
 * ffprobe 가 없으면 파일 크기만 채워서 반환한다(길이/해상도는 클라이언트가 보완).
 */

import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureStorage, UPLOAD_DIR, safeFileName } from "@/lib/storage";
import { checkFfmpeg, probeVideo } from "@/lib/render/ffmpeg";
import type { VideoMeta } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file 필드가 필요합니다." }, { status: 400 });
    }

    await ensureStorage();
    const fileName = safeFileName(file.name || "upload.mp4");
    const savePath = path.join(UPLOAD_DIR, fileName);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(savePath, bytes);

    let meta: VideoMeta = {
      fileName,
      sizeBytes: bytes.byteLength,
      durationSec: 0,
      width: 0,
      height: 0,
    };

    const { ffprobe } = await checkFfmpeg();
    if (ffprobe) {
      try {
        const probed = await probeVideo(savePath);
        meta = { ...probed, fileName, sizeBytes: bytes.byteLength };
      } catch {
        // 실패 시 기본 메타 유지
      }
    }

    return NextResponse.json({
      ok: true,
      meta,
      savedPath: `uploads/${fileName}`,
      probed: ffprobe,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `업로드 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
