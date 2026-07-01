/**
 * transcript 파싱 / 검증 유틸
 *
 * 3단계에서 Whisper 자동 자막이 붙기 전까지는
 * 사용자가 transcript.json 을 직접 업로드한다.
 * 이 모듈은 그 JSON 을 안전하게 파싱/정규화한다.
 */

import type { TranscriptSegment } from "@/lib/types";

export interface ParsedTranscript {
  segments: TranscriptSegment[];
  durationSec: number; // 마지막 구간의 end
}

/** 알 수 없는 입력에서 TranscriptSegment[] 를 안전하게 뽑아낸다. */
export function parseTranscript(input: unknown): ParsedTranscript {
  if (!Array.isArray(input)) {
    throw new Error(
      "transcript 형식이 올바르지 않습니다. [{ start, end, text }] 배열이어야 합니다.",
    );
  }

  const segments: TranscriptSegment[] = [];
  input.forEach((raw, i) => {
    if (raw == null || typeof raw !== "object") return;
    const obj = raw as Record<string, unknown>;
    const start = toNumber(obj.start);
    const end = toNumber(obj.end);
    const text = typeof obj.text === "string" ? obj.text.trim() : "";

    if (start === null || end === null) return;
    if (end < start) return;
    if (!text) return;

    segments.push({ start, end, text });
  });

  if (segments.length === 0) {
    throw new Error("유효한 자막 구간이 하나도 없습니다.");
  }

  // 시작 시간 기준 정렬
  segments.sort((a, b) => a.start - b.start);

  const durationSec = segments.reduce((max, s) => Math.max(max, s.end), 0);
  return { segments, durationSec };
}

/** transcript 사이의 "말이 없는 간격"을 찾는다(무음 컷 후보의 근사값). */
export function findGaps(
  segments: TranscriptSegment[],
  minGapSec: number,
): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const cur = segments[i];
    const gap = cur.start - prev.end;
    if (gap >= minGapSec) {
      gaps.push({ start: prev.end, end: cur.start });
    }
  }
  return gaps;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}
