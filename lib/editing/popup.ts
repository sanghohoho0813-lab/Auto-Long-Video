/**
 * 8. 팝업 텍스트
 *
 * 금액/숫자/위험 단어가 나오면 짧은 팝업을 띄운다.
 * 너무 자주 나오지 않도록 settings.popup.minGapSec 간격을 강제한다.
 */

import type { EditEvent, EditSettings, TranscriptSegment } from "@/lib/types";
import { POPUP_RULES } from "@/lib/config/keywords";
import { makeId } from "@/lib/editing/ids";

const POPUP_SHOW_SEC = 2.5; // 팝업 표시 길이

export function buildPopupEvents(
  segments: TranscriptSegment[],
  settings: EditSettings,
): EditEvent[] {
  if (!settings.popup.enabled) return [];

  const { minGapSec } = settings.popup;
  const events: EditEvent[] = [];
  let lastPopupTime = -Infinity;

  for (const seg of segments) {
    if (seg.start - lastPopupTime < minGapSec) continue;

    const hit = firstPopupMatch(seg.text);
    if (!hit) continue;

    const start = seg.start;
    const end = Math.min(seg.end, start + POPUP_SHOW_SEC);

    events.push({
      id: makeId("popup"),
      type: "popup",
      start: round(start),
      end: round(end),
      label: `팝업: "${hit.text}" (${round(start)}s)`,
      payload: { text: hit.text, style: hit.style },
    });
    lastPopupTime = seg.start;
  }
  return events;
}

/** 우선순위(POPUP_RULES 순서)대로 첫 매칭을 반환한다. */
function firstPopupMatch(
  text: string,
): { text: string; style: "amount" | "warning" | "check" } | null {
  for (const rule of POPUP_RULES) {
    const m = text.match(rule.pattern);
    if (m) {
      return { text: rule.render(m), style: rule.style };
    }
  }
  return null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
