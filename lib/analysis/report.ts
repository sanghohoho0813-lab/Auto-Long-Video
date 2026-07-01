/**
 * 테스트 리포트 / 효과 과다 판정
 *
 * edit-plan 을 요약해 "분당 효과 수"를 계산하고,
 * 롱폼 강의 영상 기준으로 과하지 않은지 판정한다.
 */

import type { EditEventType, EditPlan } from "@/lib/types";

/** 분당 임계값(이 값을 초과하면 "다소 많음") */
export const PER_MINUTE_THRESHOLDS = {
  broll: 3,
  popup: 4,
  spotlight: 5,
  zoom: 10,
} as const;

export type Verdict = "good" | "many" | "too_many";

export interface TestReport {
  durationSec: number;
  durationMin: number;
  counts: Record<EditEventType, number>;
  perMinute: Record<"broll" | "popup" | "spotlight" | "zoom" | "subtitle", number>;
  exceeded: Array<{ key: keyof typeof PER_MINUTE_THRESHOLDS; value: number; limit: number }>;
  warnings: string[];
  verdict: Verdict;
  verdictLabel: string;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  good: "적절",
  many: "다소 많음",
  too_many: "매우 많음",
};

export function buildReport(plan: EditPlan): TestReport {
  const durationSec = plan.stats.originalDurationSec || 1;
  const durationMin = Math.max(durationSec / 60, 1 / 60);
  const c = plan.stats.byType;

  const perMinute = {
    broll: round(c.broll / durationMin),
    popup: round(c.popup / durationMin),
    spotlight: round(c.spotlight / durationMin),
    zoom: round(c.zoom / durationMin),
    subtitle: round(c.subtitle / durationMin),
  };

  const exceeded: TestReport["exceeded"] = [];
  (Object.keys(PER_MINUTE_THRESHOLDS) as Array<keyof typeof PER_MINUTE_THRESHOLDS>).forEach(
    (key) => {
      const value = perMinute[key];
      const limit = PER_MINUTE_THRESHOLDS[key];
      if (value > limit) exceeded.push({ key, value, limit });
    },
  );

  const warnings: string[] = [];
  const LABEL: Record<string, string> = {
    broll: "B-roll",
    popup: "팝업",
    spotlight: "스포트라이트",
    zoom: "줌",
  };
  for (const e of exceeded) {
    warnings.push(
      `${LABEL[e.key]}이(가) 분당 ${e.value}개로 권장(${e.limit}개)을 초과합니다.`,
    );
  }
  if (exceeded.length > 0) {
    warnings.push(
      "효과가 다소 많을 수 있습니다. 롱폼 강의 영상에서는 “얌전하게” 또는 “김팀장 기본” 프리셋을 권장합니다.",
    );
  }

  // 판정: 초과 없음 → 적절 / 크게 초과(2배)거나 3종 이상 → 매우 많음 / 그 외 → 다소 많음
  let verdict: Verdict = "good";
  if (exceeded.length > 0) {
    const severe = exceeded.some((e) => e.value > e.limit * 2);
    verdict = severe || exceeded.length >= 3 ? "too_many" : "many";
  }

  return {
    durationSec,
    durationMin: round(durationMin),
    counts: c,
    perMinute,
    exceeded,
    warnings,
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
