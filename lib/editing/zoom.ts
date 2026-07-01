/**
 * 5. 자동 줌 효과
 *
 * 정적인 화면 녹화가 지루해 보이지 않도록,
 * intervalSec 마다 아주 약한 줌인/줌아웃을 번갈아 넣는다.
 * 컷으로 제거될 구간과는 겹치지 않게 피한다.
 */

import type { EditEvent, EditSettings } from "@/lib/types";
import { makeId } from "@/lib/editing/ids";

export function buildZoomEvents(
  durationSec: number,
  cutEvents: EditEvent[],
  settings: EditSettings,
): EditEvent[] {
  if (!settings.zoom.enabled || durationSec <= 0) return [];

  const { intervalSec, zoomScale, durationSec: zoomDur } = settings.zoom;
  const events: EditEvent[] = [];

  let t = intervalSec; // 맨 처음 몇 초는 그대로 두고 시작
  let i = 0;
  while (t + zoomDur < durationSec) {
    const start = t;
    const end = t + zoomDur;

    if (!overlapsCut(start, end, cutEvents)) {
      const direction: "in" | "out" = i % 2 === 0 ? "in" : "out";
      events.push({
        id: makeId("zoom"),
        type: "zoom",
        start: round(start),
        end: round(end),
        label: `${direction === "in" ? "줌인" : "줌아웃"}: ${round(start)}s ~ ${round(end)}s (x${zoomScale})`,
        payload:
          direction === "in"
            ? { direction, fromScale: 1.0, toScale: zoomScale }
            : { direction, fromScale: zoomScale, toScale: 1.0 },
      });
      i++;
    }
    t += intervalSec;
  }
  return events;
}

function overlapsCut(start: number, end: number, cutEvents: EditEvent[]): boolean {
  return cutEvents.some((c) => start < c.end && end > c.start);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
