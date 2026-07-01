/**
 * 테스트 구간(preview) 렌더용 EditPlan 클리핑
 *
 * 전체 20~40분 영상을 처음부터 렌더하지 않도록, [start, end] 구간만 잘라
 * 그 구간의 이벤트만 남기고 시각을 start 기준(0초)으로 당긴 새 plan 을 만든다.
 *
 * 실제 ffmpeg 는 입력을 `-ss start -t (end-start)` 로 잘라 읽으므로,
 * 여기서 시각을 -start 만큼 shift 하면 필터/자막 타이밍이 정확히 맞는다.
 */

import type { EditEvent, EditEventType, EditPlan } from "@/lib/types";

export interface ClipResult {
  plan: EditPlan;
  clipStart: number;
  clipDuration: number;
}

export function clipPlanToRange(plan: EditPlan, startSec: number, endSec: number): ClipResult {
  const total = plan.stats.originalDurationSec || 0;
  const start = clamp(startSec, 0, Math.max(0, total - 0.1));
  const end = clamp(endSec, start + 0.5, total || endSec);
  const duration = round(end - start);

  const events: EditEvent[] = [];
  for (const e of plan.events) {
    // 구간과 겹치는 이벤트만
    if (e.end <= start || e.start >= end) continue;
    const ns = round(Math.max(e.start, start) - start);
    const ne = round(Math.min(e.end, end) - start);
    if (ne <= ns) continue;
    events.push({ ...e, start: ns, end: ne });
  }

  const byType = countByType(events);
  const cutDurationSec = round(
    events.filter((e) => e.type === "cut").reduce((s, e) => s + (e.end - e.start), 0),
  );

  const clippedPlan: EditPlan = {
    ...plan,
    source: plan.source
      ? { ...plan.source, durationSec: duration }
      : null,
    events,
    stats: {
      totalEvents: events.length,
      byType,
      originalDurationSec: duration,
      cutDurationSec,
      estimatedOutputDurationSec: round(Math.max(0, duration - cutDurationSec)),
    },
  };

  return { plan: clippedPlan, clipStart: round(start), clipDuration: duration };
}

function countByType(events: EditEvent[]): Record<EditEventType, number> {
  const byType = {
    cut: 0,
    subtitle: 0,
    zoom: 0,
    spotlight: 0,
    broll: 0,
    popup: 0,
  } as Record<EditEventType, number>;
  for (const e of events) byType[e.type]++;
  return byType;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
