/**
 * 컷 기반 타임라인 리맵
 *
 * cut 이벤트로 무음 구간을 제거하면 그 뒤의 모든 시간이 앞으로 당겨진다.
 * subtitle/zoom/spotlight/popup/broll 이벤트의 시각은 "원본 타임라인" 기준이므로,
 * 컷을 반영한 "출력 타임라인" 기준으로 다시 계산해야 오버레이가 어긋나지 않는다.
 */

import type { EditEvent } from "@/lib/types";

export interface KeepRange {
  start: number;
  end: number;
}

/** cut 이벤트를 "남길 구간"으로 변환한다. */
export function computeKeepRanges(
  cutEvents: EditEvent[],
  totalDuration: number,
): KeepRange[] {
  const cuts = cutEvents
    .filter((e) => e.type === "cut")
    .map((e) => ({ start: e.start, end: e.end }))
    .sort((a, b) => a.start - b.start);

  if (cuts.length === 0) return [{ start: 0, end: totalDuration }];

  const keep: KeepRange[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start > cursor) keep.push({ start: cursor, end: Math.min(c.start, totalDuration) });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < totalDuration) keep.push({ start: cursor, end: totalDuration });
  return keep.filter((r) => r.end - r.start > 0.01);
}

export interface Remapper {
  /** 원본 시각 → 출력 시각. 컷으로 사라진 구간이면 null. */
  map(orig: number): number | null;
  /** 컷 반영 후 총 길이(초) */
  outputDuration: number;
}

/** 남길 구간 목록으로부터 원본→출력 시각 매핑 함수를 만든다. */
export function buildRemapper(keep: KeepRange[]): Remapper {
  // 각 keep 구간의 출력 시작 오프셋을 누적한다.
  const offsets: number[] = [];
  let acc = 0;
  for (const r of keep) {
    offsets.push(acc);
    acc += r.end - r.start;
  }
  const outputDuration = acc;

  function map(orig: number): number | null {
    for (let i = 0; i < keep.length; i++) {
      const r = keep[i];
      if (orig >= r.start && orig <= r.end) {
        return round(offsets[i] + (orig - r.start));
      }
    }
    return null;
  }

  return { map, outputDuration: round(outputDuration) };
}

/**
 * 이벤트들의 시각을 출력 타임라인으로 리맵한다.
 * - 완전히 컷 안에 있으면 제거
 * - 경계에 걸치면 가장 가까운 남는 지점으로 클램프
 */
export function remapEvents(events: EditEvent[], remap: Remapper, keep: KeepRange[]): EditEvent[] {
  const out: EditEvent[] = [];
  for (const e of events) {
    if (e.type === "cut") continue; // 컷 자체는 이미 반영됨
    const ns = clampToKeep(e.start, keep);
    const ne = clampToKeep(e.end, keep);
    const ms = remap.map(ns);
    const me = remap.map(ne);
    if (ms === null || me === null) continue;
    if (me <= ms) continue;
    out.push({ ...e, start: ms, end: me });
  }
  return out;
}

/** 값이 컷 안이면 가장 가까운 keep 경계로 이동시킨다. */
function clampToKeep(t: number, keep: KeepRange[]): number {
  for (const r of keep) {
    if (t >= r.start && t <= r.end) return t;
  }
  // 어느 구간 안에도 없으면(컷 내부) 가장 가까운 경계로
  let best = t;
  let bestDist = Infinity;
  for (const r of keep) {
    for (const edge of [r.start, r.end]) {
      const d = Math.abs(edge - t);
      if (d < bestDist) {
        bestDist = d;
        best = edge;
      }
    }
  }
  return best;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
