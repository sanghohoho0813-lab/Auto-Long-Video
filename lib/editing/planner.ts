/**
 * 편집 계획(EditPlan) 오케스트레이터
 *
 * 모든 편집 모듈을 순서대로 실행해 EditEvent[] 를 모으고,
 * 통계를 계산해 최종 edit-plan.json 구조를 만든다.
 *
 * 이 함수는 순수 함수(부수효과 없음)라 서버/클라이언트 어디서든 호출 가능하고,
 * 새로운 편집 모듈을 추가할 때 이 파일에 한 줄만 더 붙이면 된다.
 */

import type {
  EditEvent,
  EditEventType,
  EditPlan,
  EditPlanStats,
  EditSettings,
  TranscriptSegment,
  VideoMeta,
} from "@/lib/types";
import { resetIds } from "@/lib/editing/ids";
import { buildCutEvents, totalCutSeconds } from "@/lib/editing/cuts";
import { buildSubtitleEvents } from "@/lib/editing/subtitles";
import { buildZoomEvents } from "@/lib/editing/zoom";
import { buildSpotlightEvents } from "@/lib/editing/spotlight";
import { buildBrollEvents, type BrollAsset } from "@/lib/editing/broll";
import { buildPopupEvents } from "@/lib/editing/popup";

export const PLAN_VERSION = "1.0.0";
export const PROGRAM_NAME = "김팀장의 롱폼 자동편집기";

/**
 * 무음 구간(silences)에서 직접 "컷만" 편집 계획을 만든다.
 * (말 구간→간격 우회 방식의 버그를 피하려고, 감지된 무음을 곧바로 컷으로 변환)
 * 각 무음은 앞뒤 padding 만큼만 남기고 잘라낸다.
 */
export function buildCutsOnlyPlan(params: {
  silences: Array<{ start: number; end: number }>;
  durationSec: number;
  source: VideoMeta | null;
  settings: EditSettings;
  padding?: number;
  now?: string;
}): EditPlan {
  resetIds();
  const pad = params.padding ?? 0.05;
  const total = params.durationSec || 0;

  const events: EditEvent[] = [];
  for (const s of [...params.silences].sort((a, b) => a.start - b.start)) {
    const start = round(Math.max(0, s.start + pad));
    const end = round(Math.min(total || s.end, s.end - pad));
    if (end - start <= 0.05) continue;
    events.push({
      id: makeCutId(),
      type: "cut",
      start,
      end,
      label: `무음 컷: ${start}s ~ ${end}s (${round(end - start)}s 제거)`,
      payload: { removedSec: round(end - start) },
    });
  }

  const cutDurationSec = round(events.reduce((sum, e) => sum + (e.end - e.start), 0));
  const byType = { cut: events.length, subtitle: 0, zoom: 0, spotlight: 0, broll: 0, popup: 0 } as Record<
    EditEventType,
    number
  >;

  return {
    version: PLAN_VERSION,
    createdAt: params.now ?? new Date().toISOString(),
    program: PROGRAM_NAME,
    source: params.source,
    settings: params.settings,
    events,
    stats: {
      totalEvents: events.length,
      byType,
      originalDurationSec: round(total),
      cutDurationSec,
      estimatedOutputDurationSec: round(Math.max(0, total - cutDurationSec)),
    },
  };
}

let cutCounter = 0;
function makeCutId(): string {
  cutCounter += 1;
  return `cut_${cutCounter}`;
}

export interface BuildPlanInput {
  segments: TranscriptSegment[];
  settings: EditSettings;
  source: VideoMeta | null;
  /** transcript 로 길이를 못 구할 때 대비한 총 길이(초). source 가 우선 */
  fallbackDurationSec?: number;
  /** broll 폴더에서 스캔된 사용 가능한 클립들 */
  availableBroll?: BrollAsset[];
  /** 결정적 결과를 위해 고정 타임스탬프 주입 가능 */
  now?: string;
}

export function buildEditPlan(input: BuildPlanInput): EditPlan {
  const { segments, settings, source, availableBroll = [] } = input;

  resetIds(); // 매 계획마다 ID 카운터 초기화 → 결정적 ID

  const durationSec =
    source?.durationSec ??
    input.fallbackDurationSec ??
    segments.reduce((max, s) => Math.max(max, s.end), 0);

  // 각 모듈 실행 (순서 = 계산 의존성 순서)
  const cutEvents = buildCutEvents(segments, settings);
  const subtitleEvents = buildSubtitleEvents(segments, settings);
  const zoomEvents = buildZoomEvents(durationSec, cutEvents, settings);
  const spotlightEvents = buildSpotlightEvents(segments, settings);
  const brollEvents = buildBrollEvents(segments, durationSec, settings, availableBroll);
  const popupEvents = buildPopupEvents(segments, settings);

  const events: EditEvent[] = [
    ...cutEvents,
    ...subtitleEvents,
    ...zoomEvents,
    ...spotlightEvents,
    ...brollEvents,
    ...popupEvents,
  ].sort((a, b) => a.start - b.start || a.type.localeCompare(b.type));

  const stats = computeStats(events, durationSec);

  return {
    version: PLAN_VERSION,
    createdAt: input.now ?? new Date().toISOString(),
    program: PROGRAM_NAME,
    source,
    settings,
    events,
    stats,
  };
}

function computeStats(events: EditEvent[], originalDurationSec: number): EditPlanStats {
  const byType = {
    cut: 0,
    subtitle: 0,
    zoom: 0,
    spotlight: 0,
    broll: 0,
    popup: 0,
  } as Record<EditEventType, number>;

  for (const e of events) byType[e.type]++;

  const cutDurationSec = totalCutSeconds(events);

  return {
    totalEvents: events.length,
    byType,
    originalDurationSec: round(originalDurationSec),
    cutDurationSec,
    estimatedOutputDurationSec: round(Math.max(0, originalDurationSec - cutDurationSec)),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
