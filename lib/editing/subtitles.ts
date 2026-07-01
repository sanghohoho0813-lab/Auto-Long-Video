/**
 * 4. 자동 자막 + 핵심 키워드 강조
 *
 * transcript 각 구간을 자막 이벤트로 만들고,
 * 문장 안의 핵심 키워드를 토큰 단위로 강조 표시한다.
 */

import type { EditEvent, EditSettings, TranscriptSegment, EmphasisToken } from "@/lib/types";
import { EMPHASIS_KEYWORDS } from "@/lib/config/keywords";
import { makeId } from "@/lib/editing/ids";

/**
 * 문장을 강조/비강조 토큰으로 쪼갠다.
 * 키워드는 긴 것부터 매칭해서 부분 겹침을 방지한다.
 */
export function tokenizeEmphasis(text: string): EmphasisToken[] {
  const keywords = [...EMPHASIS_KEYWORDS].sort((a, b) => b.length - a.length);
  if (keywords.length === 0) return [{ text, emphasized: false }];

  const escaped = keywords.map(escapeRegExp).join("|");
  const re = new RegExp(`(${escaped})`, "g");

  const tokens: EmphasisToken[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, m.index), emphasized: false });
    }
    tokens.push({ text: m[0], emphasized: true });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), emphasized: false });
  }
  return tokens.length > 0 ? tokens : [{ text, emphasized: false }];
}

/** 자막 이벤트 생성 */
export function buildSubtitleEvents(
  segments: TranscriptSegment[],
  settings: EditSettings,
): EditEvent[] {
  if (!settings.subtitle.enabled) return [];

  return segments.map((seg) => {
    const tokens = tokenizeEmphasis(seg.text);
    const hasEmphasis = tokens.some((t) => t.emphasized);
    return {
      id: makeId("subtitle"),
      type: "subtitle",
      start: seg.start,
      end: seg.end,
      label: hasEmphasis
        ? `자막 강조: "${truncate(seg.text)}"`
        : `자막: "${truncate(seg.text)}"`,
      payload: { tokens, rawText: seg.text },
    };
  });
}

function truncate(text: string, max = 24): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
