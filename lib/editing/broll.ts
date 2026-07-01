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
  // 너무 짧은 간격으로 몰리지 않게 최소 간격을 강제(클립 길이 + 여유, 최소 15초)
  const minGap = Math.max(15, clipDurationSec + 8);
  const step = Math.max(intervalSec, minGap);

  const events: EditEvent[] = [];

  // 카테고리별로 사용 가능한 클립을 묶어두고 라운드로빈으로 소진
  const pool = groupByCategory(availableBroll);
  const usageCursor: Partial<Record<BrollCategory, number>> = {};

  // 최근 사용한 대표 카테고리(같은 게 반복되지 않게 회피)
  const recent: BrollCategory[] = [];
  const RECENT_WINDOW = 2;

  let t = step;
  while (t + clipDurationSec < durationSec) {
    const seg = segmentAt(segments, t);
    const text = seg?.text ?? "";
    const { categories, matchedKeyword } = matchBrollCategories(text);

    // 최근 사용 카테고리를 뒤로 미뤄 다양성 확보(가능하면 회피)
    const ordered = reorderAvoidingRecent(categories, recent);
    const chosenCategory = ordered[0];
    recent.push(chosenCategory);
    if (recent.length > RECENT_WINDOW) recent.shift();

    const suggestedFile = pickFile(pool, usageCursor, ordered);

    const reason = matchedKeyword
      ? `"${matchedKeyword}" 언급 → ${ordered.join(", ")}`
      : `기본 카테고리 → ${ordered.join(", ")}`;

    events.push({
      id: makeId("broll"),
      type: "broll",
      start: round(t),
      end: round(t + clipDurationSec),
      label: suggestedFile
        ? `B-roll 삽입: ${round(t)}s (${suggestedFile})`
        : `B-roll 후보: ${round(t)}s (${ordered.join("/")})`,
      payload: {
        categories: ordered,
        suggestedFile,
        matchedKeyword,
        reason,
      },
    });

    t += step;
  }
  return events;
}

/**
 * 최근 사용한 카테고리를 뒤로 미뤄 연속 반복을 피한다.
 * 후보가 모두 최근에 쓰였으면(잠금 상태) 가장 오래전에 쓴 것부터 배치해 회전시킨다.
 * (recent 는 oldest→newest 순서)
 */
function reorderAvoidingRecent(
  categories: BrollCategory[],
  recent: BrollCategory[],
): BrollCategory[] {
  if (categories.length <= 1) return categories;
  const fresh = categories.filter((c) => !recent.includes(c));
  const used = categories
    .filter((c) => recent.includes(c))
    // 가장 오래전에 사용한 카테고리를 앞으로(least-recently-used 우선)
    .sort((a, b) => recent.indexOf(a) - recent.indexOf(b));
  return [...fresh, ...used];
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

/**
 * 특정 시각 t 에 재생 중인 transcript 구간을 찾는다.
 * 경계(앞 구간 end == 뒤 구간 start)에서는 "지금 말하고 있는" 뒤 구간을 택하도록
 * 반열림 구간[start, end) 으로 매칭한다.
 */
function segmentAt(
  segments: TranscriptSegment[],
  t: number,
): TranscriptSegment | undefined {
  return (
    segments.find((s) => t >= s.start && t < s.end) ??
    // 마지막 구간의 끝점 등은 <= 로 한 번 더 확인
    segments.find((s) => t >= s.start && t <= s.end) ??
    // 그래도 없으면 가장 가까운 이전 구간
    [...segments].reverse().find((s) => s.start <= t)
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
