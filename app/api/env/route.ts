/**
 * GET /api/env
 *
 * 클라이언트가 로컬/서버리스 환경을 구분해
 * UI(업로드/렌더 버튼)를 적절히 활성/비활성화할 수 있도록
 * 런타임 정보를 내려준다.
 *
 * ⚠️ 이 라우트는 반드시 런타임에 평가되어야 한다(빌드 시 정적 박제 금지).
 *    dynamic = "force-dynamic" 로 정적 최적화를 차단한다.
 */

import { NextResponse } from "next/server";
import { getRuntimeDebug } from "@/lib/env";
import { checkFfmpeg } from "@/lib/render/ffmpeg";
import { detectWhisper } from "@/lib/render/whisper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const debug = getRuntimeDebug();

  // 로컬에서만 ffmpeg / whisper 설치 여부를 확인한다(서버리스에서는 spawn 안 함).
  let ffmpeg = false;
  let ffprobe = false;
  let whisper = false;
  let whisperBackend: string | null = null;
  if (!debug.serverless) {
    try {
      const avail = await checkFfmpeg();
      ffmpeg = avail.ffmpeg;
      ffprobe = avail.ffprobe;
    } catch {
      // 무시: 확인 실패는 미설치로 간주
    }
    try {
      const w = await detectWhisper();
      whisper = w.available;
      whisperBackend = w.backend;
    } catch {
      // 무시
    }
  }

  return NextResponse.json(
    { ...debug, ffmpeg, ffprobe, whisper, whisperBackend },
    { headers: { "Cache-Control": "no-store" } },
  );
}
