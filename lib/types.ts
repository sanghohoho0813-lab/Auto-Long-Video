/**
 * 김팀장의 롱폼 자동편집기 - 공통 타입 정의
 *
 * 편집 파이프라인 전체가 이 타입들을 공유한다.
 * 각 편집 모듈(cuts / zoom / spotlight / broll / popup / subtitles)은
 * transcript + settings 를 입력으로 받아 EditEvent[] 를 생성하고,
 * planner 가 이를 모아 EditPlan 으로 합친다.
 */

/** transcript.json 한 줄(한 문장/구간) */
export interface TranscriptSegment {
  start: number; // 초 단위 시작 시간
  end: number; // 초 단위 종료 시간
  text: string; // 해당 구간의 대사 텍스트
}

/** 업로드된 영상의 메타데이터 */
export interface VideoMeta {
  fileName: string;
  sizeBytes: number;
  durationSec: number; // 영상 길이(초)
  width: number;
  height: number;
  fps?: number;
}

/** 편집 강도 프리셋 종류 */
export type PresetName = "calm" | "default" | "vivid" | "kim";

/**
 * 편집 설정.
 * UI 의 설정 패널과 1:1로 대응된다.
 */
export interface EditSettings {
  preset: PresetName;

  // 2. 자동 컷 편집
  cut: {
    enabled: boolean;
    silenceThreshold: number; // dB (예: -30). 이 값보다 조용하면 무음으로 간주
    minSilenceDuration: number; // 초. 이보다 긴 무음만 컷
    paddingBefore: number; // 초. 컷 시작 앞 여유
    paddingAfter: number; // 초. 컷 끝 뒤 여유
  };

  // 5. 자동 줌 효과
  zoom: {
    enabled: boolean;
    intervalSec: number; // 몇 초마다 줌 이벤트를 넣을지
    zoomScale: number; // 1.03 ~ 1.08
    durationSec: number; // 2 ~ 4초
  };

  // 6. 스포트라이트
  spotlight: {
    enabled: boolean;
    darkenAmount: number; // 0.1 ~ 0.2 (10~20% 어둡게)
    durationSec: number; // 2 ~ 4초
  };

  // 7. B-roll 자동 삽입
  broll: {
    enabled: boolean;
    intervalSec: number; // 30 ~ 45초마다 1개
    clipDurationSec: number; // 3 ~ 5초
  };

  // 8. 팝업 텍스트
  popup: {
    enabled: boolean;
    minGapSec: number; // 최소 간격(기본 20초)
  };

  // 4. 자막 / 키워드 강조
  subtitle: {
    enabled: boolean;
    emphasisColor: string; // 강조 색상(노랑/빨강)
    emphasisScale: number; // 1.1 ~ 1.3
  };
}

/** 편집 이벤트 종류 */
export type EditEventType =
  | "cut" // 무음 구간 컷(제거)
  | "subtitle" // 자막 표시
  | "zoom" // 줌 인/아웃
  | "spotlight" // 스포트라이트
  | "broll" // B-roll 오버레이
  | "popup"; // 팝업 텍스트

/** 자막 강조 토큰(문장 안에서 강조할 단어 위치) */
export interface EmphasisToken {
  text: string;
  emphasized: boolean;
}

/** B-roll 카테고리 */
export type BrollCategory =
  | "office"
  | "money"
  | "meeting"
  | "document"
  | "tax"
  | "government"
  | "business_owner"
  | "warning"
  | "checklist";

/**
 * 하나의 편집 이벤트.
 * 타입별 추가 정보는 payload 에 담는다(유연한 확장을 위해).
 */
export interface EditEvent {
  id: string;
  type: EditEventType;
  start: number; // 초
  end: number; // 초
  label: string; // 미리보기 리스트에 표시할 한국어 설명
  payload?: Record<string, unknown>;
}

/** 자막 이벤트 payload */
export interface SubtitlePayload {
  tokens: EmphasisToken[];
  rawText: string;
}

/** 줌 이벤트 payload */
export interface ZoomPayload {
  direction: "in" | "out";
  fromScale: number;
  toScale: number;
}

/** 스포트라이트 이벤트 payload */
export interface SpotlightPayload {
  darkenAmount: number;
  trigger: string; // 어떤 문구 때문에 발동했는지
}

/** B-roll 이벤트 payload */
export interface BrollPayload {
  categories: BrollCategory[]; // 추천 카테고리(우선순위 순)
  suggestedFile?: string; // broll 폴더에서 매칭된 파일(있으면)
  reason: string; // 왜 이 카테고리인지
}

/** 팝업 이벤트 payload */
export interface PopupPayload {
  text: string;
  style: "amount" | "warning" | "check";
}

/**
 * 최종 편집 계획(edit-plan.json).
 * 이 JSON 하나만 있으면 어떤 렌더러(ffmpeg 등)든 영상을 재현할 수 있다.
 */
export interface EditPlan {
  version: string;
  createdAt: string;
  program: string;
  source: VideoMeta | null;
  settings: EditSettings;
  events: EditEvent[];
  stats: EditPlanStats;
}

/** 편집 계획 요약 통계 */
export interface EditPlanStats {
  totalEvents: number;
  byType: Record<EditEventType, number>;
  originalDurationSec: number;
  cutDurationSec: number; // 컷으로 제거되는 총 길이
  estimatedOutputDurationSec: number;
}
