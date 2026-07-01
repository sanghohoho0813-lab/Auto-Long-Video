/**
 * 이벤트 타입별 표시 메타데이터 (UI 공용)
 * 색상은 globals.css 의 --ev-* 변수와 일치시킨다.
 */

import type { EditEventType } from "@/lib/types";

export const EVENT_META: Record<
  EditEventType,
  { label: string; color: string; emoji: string }
> = {
  cut: { label: "무음 컷", color: "var(--ev-cut)", emoji: "✂️" },
  subtitle: { label: "자막 강조", color: "var(--ev-subtitle)", emoji: "💬" },
  zoom: { label: "줌", color: "var(--ev-zoom)", emoji: "🔍" },
  spotlight: { label: "스포트라이트", color: "var(--ev-spotlight)", emoji: "🔦" },
  broll: { label: "B-roll", color: "var(--ev-broll)", emoji: "🎬" },
  popup: { label: "팝업", color: "var(--ev-popup)", emoji: "💡" },
};

export const EVENT_ORDER: EditEventType[] = [
  "cut",
  "subtitle",
  "zoom",
  "spotlight",
  "broll",
  "popup",
];

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
