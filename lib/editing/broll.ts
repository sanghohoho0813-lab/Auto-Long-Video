/**
 * 7. B-roll 자동 삽입 후보 생성
 *
 * intervalSec 마다 1개씩 B-roll 삽입 지점을 잡고,
 * 그 시점의 transcript 문장 내용에 따라 카테고리를 추천한다.
 * 원본 오디오는 유지하고 화면 위에 clipDurationSec 만큼 덮어씌우는 방식.
 *
 * 실제 파일 매칭(broll 폴더 스캔)은 availableBroll 로 주입받아
 * 서버/클라이언트 어디서든 동작하게 만든다.
 */

import type {
  EditEvent,
  EditSettings,
  TranscriptSegment,
  BrollCategory,
} from "@/lib/types";
import { matchBrollCategories } from "@/lib/config/keywords";
import { makeId } from "@/lib/editing/ids";

/** broll 폴더에서 스캔된 사용 가능한 클립 정보 */
export interface BrollAsset {
  fileName: string;
  category: BrollCategory;
}

export function buildBrollEvents(
  segments: TranscriptSegment[],
  durationSec: number,
  settings: EditSettings,
  availableBroll: BrollAsset[] = [],
): EditEvent[] {
  if (!settings.broll.enabled || durationSec <= 0) return [];

  const { intervalSec, clipDurationSec } = settings.broll;
  const events: EditEvent[] = [];

  // 카테고리별로 사용 가능한 클립을 묶어두고 라운드로빈으로 소진
  const pool = groupByCategory(availableBroll);
  const usageCursor: Partial<Record<BrollCategory, number>> = {};

  let t = intervalSec;
  while (t + clipDurationSec < durationSec) {
    const seg = segmentAt(segments, t);
    const text = seg?.text ?? "";
    const { categories, matchedKeyword } = matchBrollCategories(text);

    const suggestedFile = pickFile(pool, usageCursor, categories);

    const reason = matchedKeyword
      ? `"${matchedKeyword}" 언급 → ${categories.join(", ")}`
      : `기본 카테고리 → ${categories.join(", ")}`;

    events.push({
      id: makeId("broll"),
      type: "broll",
      start: round(t),
      end: round(t + clipDurationSec),
      label: suggestedFile
        ? `B-roll 삽입: ${round(t)}s (${suggestedFile})`
        : `B-roll 후보: ${round(t)}s (${categories.join("/")})`,
      payload: { categories, suggestedFile, reason },
    });

    t += intervalSec;
  }
  return events;
}

function groupByCategory(assets: BrollAsset[]): Partial<Record<BrollCategory, string[]>> {
  const pool: Partial<Record<BrollCategory, string[]>> = {};
  for (const a of assets) {
    (pool[a.category] ??= []).push(a.fileName);
  }
  return pool;
}

/** 추천 카테고리 우선순위대로 클립을 하나 고른다(라운드로빈). */
function pickFile(
  pool: Partial<Record<BrollCategory, string[]>>,
  cursor: Partial<Record<BrollCategory, number>>,
  categories: BrollCategory[],
): string | undefined {
  for (const cat of categories) {
    const files = pool[cat];
    if (files && files.length > 0) {
      const idx = (cursor[cat] ?? 0) % files.length;
      cursor[cat] = idx + 1;
      return files[idx];
    }
  }
  return undefined;
}

/** 특정 시각 t 에 재생 중인 transcript 구간을 찾는다. */
function segmentAt(
  segments: TranscriptSegment[],
  t: number,
): TranscriptSegment | undefined {
  return (
    segments.find((s) => t >= s.start && t <= s.end) ??
    // 정확히 걸치는 게 없으면 가장 가까운 이전 구간
    [...segments].reverse().find((s) => s.start <= t)
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
