/**
 * GET /api/download?file=output/xxx.mp4
 *
 * 렌더링 결과(및 storage 내부 파일)를 다운로드로 스트리밍한다.
 * 경로 조작을 막기 위해 STORAGE_ROOT 하위만 허용한다.
 * 서버리스에서는 영구 저장 파일이 없으므로 사실상 사용되지 않는다.
 */

import { NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "@/lib/storage";
import type { ReadableStream as NodeWebReadable } from "node:stream/web";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = url.searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "file 파라미터가 필요합니다." }, { status: 400 });
  }

  const abs = path.join(STORAGE_ROOT, file);
  if (!abs.startsWith(STORAGE_ROOT)) {
    return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });
  }

  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }

  const nodeStream = createReadStream(abs);
  const webStream = Readable.toWeb(nodeStream) as unknown as NodeWebReadable<Uint8Array>;
  const fileName = path.basename(abs);

  return new NextResponse(webStream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      "Cache-Control": "no-store",
    },
  });
}
