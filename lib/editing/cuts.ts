/**
 * 2. 자동 컷 편집 (무음 구간 제거)
 *
 * 실제 무음 감지는 ffmpeg 의 silencedetect 필터로 수행하는 것이 정확하지만
 * (2단계에서 render 모듈이 담당), MVP 단계에서는 transcript 의 말 없는 간격을
 * 무음 구간으로 근사해서 컷 후보를 만든다.
 *
 * settings.cut.minSilenceDuration 보다 긴 간격만 컷 대상으로 삼고,
 * paddingBefore/After 만큼 여유를 남겨 자연스럽게 이어지게 한다.
 */

import type { EditEvent, EditSettings, TranscriptSegment } from "@/lib/types";
import { findGaps } from "@/lib/analysis/transcript";
import { makeId } from "@/lib/editing/ids";

export function buildCutEvents(
  segments: TranscriptSegment[],
  settings: EditSettings,
): EditEvent[] {
  if (!settings.cut.enabled) return [];

  const { minSilenceDuration, paddingBefore, paddingAfter } = settings.cut;
  const gaps = findGaps(segments, minSilenceDuration);

  const events: EditEvent[] = [];
  for (const gap of gaps) {
    // padding 만큼 안쪽으로 좁혀서 컷(앞뒤 말이 잘리지 않게)
    const cutStart = gap.start + paddingAfter;
    const cutEnd = gap.end - paddingBefore;
    const cutLen = cutEnd - cutStart;
    if (cutLen <= 0) continue;

    events.push({
      id: makeId("cut"),
      type: "cut",
      start: round(cutStart),
      end: round(cutEnd),
      label: `무음 컷: ${round(cutStart)}s ~ ${round(cutEnd)}s (${round(cutLen)}s 제거)`,
      payload: { removedSec: round(cutLen) },
    });
  }
  return events;
}

/** 컷으로 제거되는 총 길이(초) */
export function totalCutSeconds(events: EditEvent[]): number {
  return round(
    events
      .filter((e) => e.type === "cut")
      .reduce((sum, e) => sum + (e.end - e.start), 0),
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
