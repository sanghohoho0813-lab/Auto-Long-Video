/**
 * GET /api/broll
 *
 * storage/broll/<category>/ 폴더를 스캔해
 * 사용 가능한 B-roll 클립 목록을 반환한다.
 */

import { NextResponse } from "next/server";
import { scanBroll } from "@/lib/storage";

export const runtime = "nodejs";
// B-roll 폴더는 런타임에 스캔해야 하므로 정적 캐시하지 않는다.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const assets = await scanBroll();
    return NextResponse.json({ ok: true, assets });
  } catch (err) {
    return NextResponse.json(
      { error: `B-roll 스캔 실패: ${(err as Error).message}`, assets: [] },
      { status: 500 },
    );
  }
}
