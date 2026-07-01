/**
 * 6. 스포트라이트 효과
 *
 * "중요합니다", "여기 보세요" 같은 트리거 문구가 나오는 구간에
 * 화면 전체를 10~20% 어둡게 하고 자막 영역을 상대적으로 밝게 만든다.
 * 2~4초만 지속.
 */

import type { EditEvent, EditSettings, TranscriptSegment } from "@/lib/types";
import { SPOTLIGHT_TRIGGERS } from "@/lib/config/keywords";
import { makeId } from "@/lib/editing/ids";

export function buildSpotlightEvents(
  segments: TranscriptSegment[],
  settings: EditSettings,
): EditEvent[] {
  if (!settings.spotlight.enabled) return [];

  const { darkenAmount, durationSec } = settings.spotlight;
  const events: EditEvent[] = [];

  for (const seg of segments) {
    const trigger = SPOTLIGHT_TRIGGERS.find((t) => seg.text.includes(t));
    if (!trigger) continue;

    const start = seg.start;
    // 문장 길이와 설정값 중 짧은 쪽을 택하되, 최소 2초는 보장
    const segLen = seg.end - seg.start;
    const len = Math.max(2, Math.min(durationSec, segLen || durationSec));
    const end = start + len;

    events.push({
      id: makeId("spotlight"),
      type: "spotlight",
      start: round(start),
      end: round(end),
      label: `스포트라이트: ${round(start)}s ~ ${round(end)}s ("${trigger}")`,
      payload: { darkenAmount, trigger },
    });
  }
  return events;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
