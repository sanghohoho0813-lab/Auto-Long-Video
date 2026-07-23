/**
 * 9. 편집 강도 프리셋
 *
 * "얌전하게 / 기본 / 생동감 있게" 세 가지.
 * 각 프리셋은 EditSettings 전체 기본값을 정의한다.
 * UI 에서 프리셋을 고르면 이 값이 설정 패널에 채워지고,
 * 사용자가 개별 값을 다시 조정할 수 있다.
 */

import type { EditSettings, PresetName } from "@/lib/types";

export const PRESET_LABELS: Record<PresetName, string> = {
  kim: "김팀장 기본",
  calm: "얌전하게",
  default: "기본",
  vivid: "생동감 있게",
};

export const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  kim: "대표님/컨설턴트 대상 롱폼에 맞춘 절제된 기본값 (B-roll 45초·줌 10초·팝업 30초)",
  calm: "B-roll 45초 간격, 줌 약하게, 팝업 적게 — 차분한 강의 톤",
  default: "B-roll 30초 간격, 줌 기본, 팝업 보통 — 균형 잡힌 기본값",
  vivid: "B-roll 20초 간격, 줌 조금 더, 팝업 많게 — 생동감 있는 톤",
};

const BASE: Omit<EditSettings, "preset"> = {
  cut: {
    enabled: true,
    silenceThreshold: -30,
    minSilenceDuration: 0.6,
    paddingBefore: 0.15,
    paddingAfter: 0.15,
  },
  zoom: {
    enabled: true,
    intervalSec: 8,
    zoomScale: 1.05,
    durationSec: 3,
  },
  spotlight: {
    enabled: true,
    darkenAmount: 0.15,
    durationSec: 3,
  },
  broll: {
    enabled: true,
    intervalSec: 30,
    clipDurationSec: 4,
  },
  popup: {
    enabled: true,
    minGapSec: 20,
  },
  subtitle: {
    enabled: true,
    emphasisColor: "#FFD400", // 비즈니스 톤 노란색
    emphasisScale: 1.2,
  },
};

/** 프리셋별 오버라이드 값 */
const OVERRIDES: Record<PresetName, DeepPartial<Omit<EditSettings, "preset">>> = {
  // 김팀장 경영 노트: 절제된 롱폼 기본값
  kim: {
    zoom: { intervalSec: 10 },
    spotlight: { darkenAmount: 0.12 },
    broll: { intervalSec: 45 },
    popup: { minGapSec: 30 },
    subtitle: { emphasisScale: 1.15 },
  },
  calm: {
    zoom: { zoomScale: 1.03, intervalSec: 10, durationSec: 4 },
    spotlight: { darkenAmount: 0.1 },
    broll: { intervalSec: 45 },
    popup: { minGapSec: 30 },
    subtitle: { emphasisScale: 1.1 },
  },
  default: {
    // BASE 그대로 사용
  },
  vivid: {
    zoom: { zoomScale: 1.08, intervalSec: 6, durationSec: 2 },
    spotlight: { darkenAmount: 0.2 },
    broll: { intervalSec: 20 },
    popup: { minGapSec: 20 },
    subtitle: { emphasisScale: 1.3, emphasisColor: "#FF3B30" }, // 생동감: 빨강
  },
};

/** 프리셋 이름으로 완성된 EditSettings 를 만든다. */
export function buildSettings(preset: PresetName): EditSettings {
  const merged = deepMerge(BASE, OVERRIDES[preset]);
  return { preset, ...merged };
}

export const DEFAULT_SETTINGS: EditSettings = buildSettings("default");

/**
 * "컷만" 설정 — 무음 컷만 적용하고 자막/줌/스포트라이트/B-roll/팝업은 모두 끈다.
 * (캡컷 등에서 이어서 편집할 수 있게 무음만 제거한 깔끔한 영상용)
 * 기존 설정의 컷 파라미터(임계값/패딩 등)는 그대로 유지한다.
 */
export function cutsOnlySettings(base: EditSettings): EditSettings {
  return {
    ...base,
    cut: { ...base.cut, enabled: true },
    zoom: { ...base.zoom, enabled: false },
    spotlight: { ...base.spotlight, enabled: false },
    broll: { ...base.broll, enabled: false },
    popup: { ...base.popup, enabled: false },
    subtitle: { ...base.subtitle, enabled: false },
  };
}

/* ----------------------------- 유틸 ----------------------------- */

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  const out = Array.isArray(base) ? ([...(base as unknown[])] as T) : ({ ...base } as T);
  for (const key in override) {
    const ov = override[key];
    if (ov === undefined) continue;
    const bv = (base as Record<string, unknown>)[key];
    if (bv && typeof bv === "object" && !Array.isArray(bv) && typeof ov === "object") {
      (out as Record<string, unknown>)[key] = deepMerge(bv, ov as DeepPartial<typeof bv>);
    } else {
      (out as Record<string, unknown>)[key] = ov as unknown;
    }
  }
  return out;
}
