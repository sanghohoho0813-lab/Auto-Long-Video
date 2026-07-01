/**
 * ASS 자막 파일 생성 (subtitle 강조 + popup)
 *
 * libass(subtitles 필터)는 인라인 태그로 단어별 색상/굵기/크기를 지원하므로,
 * 4. 핵심 키워드 강조(노랑/빨강, bold, 110~130%)와 8. 팝업 텍스트를
 * 하나의 ASS 파일로 정확히 렌더링할 수 있다.
 *
 * 입력 이벤트의 시각은 반드시 "출력 타임라인"(컷 반영 후) 기준이어야 한다.
 */

import type {
  EditEvent,
  EditSettings,
  SubtitlePayload,
  PopupPayload,
  EmphasisToken,
} from "@/lib/types";

export interface AssBuildResult {
  content: string;
  hasEvents: boolean;
}

export function buildAss(
  events: EditEvent[],
  settings: EditSettings,
  width: number,
  height: number,
): AssBuildResult {
  const subs = events.filter((e) => e.type === "subtitle");
  const popups = events.filter((e) => e.type === "popup");

  const emColor = hexToAss(settings.subtitle.emphasisColor);
  const emScale = Math.round((settings.subtitle.emphasisScale || 1.2) * 100);

  // 해상도에 비례한 폰트 크기(1080 기준 54px)
  const base = height || 1080;
  const subFont = Math.round(base * 0.05);
  const popupFont = Math.round(base * 0.058);

  const dialogues: string[] = [];

  // --- 자막 ---
  if (settings.subtitle.enabled) {
    for (const e of subs) {
      const payload = e.payload as unknown as SubtitlePayload;
      const text = renderSubtitleText(payload?.tokens ?? [], emColor, emScale);
      if (!text) continue;
      dialogues.push(
        `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Sub,,0,0,0,,${text}`,
      );
    }
  }

  // --- 팝업 (상단 중앙, 스타일별 색상) ---
  if (settings.popup.enabled) {
    for (const e of popups) {
      const payload = e.payload as unknown as PopupPayload;
      const raw = payload?.text ?? "";
      if (!raw) continue;
      const color = popupColor(payload?.style);
      const text = `{\\c${color}\\b1}${escapeAss(raw)}{\\r}`;
      dialogues.push(
        `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},Popup,,0,0,0,,${text}`,
      );
    }
  }

  const header = [
    "[Script Info]",
    "; 김팀장의 롱폼 자동편집기 - 자동 생성 자막",
    "ScriptType: v4.00+",
    `PlayResX: ${width || 1920}`,
    `PlayResY: ${height || 1080}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Sub: 하단 중앙, 흰색, 검은 외곽선(비즈니스 톤, 과하지 않게)
    `Style: Sub,NanumGothic,${subFont},&H00FFFFFF,&H000000FF,&H00202020,&H90000000,0,0,0,0,100,100,0,0,1,3,1,2,80,80,${Math.round(base * 0.06)},1`,
    // Popup: 상단 중앙, bold, 반투명 박스
    `Style: Popup,NanumGothic,${popupFont},&H00FFFFFF,&H000000FF,&H00303030,&HA0000000,1,0,0,0,100,100,0,0,3,2,0,8,60,60,${Math.round(base * 0.05)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const content = header + "\n" + dialogues.join("\n") + "\n";
  return { content, hasEvents: dialogues.length > 0 };
}

/** 토큰들을 ASS 인라인 강조 태그가 포함된 한 줄로 만든다. */
function renderSubtitleText(
  tokens: EmphasisToken[],
  emColor: string,
  emScale: number,
): string {
  if (tokens.length === 0) return "";
  return tokens
    .map((t) => {
      const text = escapeAss(t.text);
      if (!t.emphasized) return text;
      // 강조: 색상 + bold + 크기 확대, 이후 \r 로 스타일 복귀
      return `{\\c${emColor}\\b1\\fscx${emScale}\\fscy${emScale}}${text}{\\r}`;
    })
    .join("");
}

function popupColor(style?: string): string {
  switch (style) {
    case "warning":
      return "&H003B30FF"; // 빨강 (RGB FF3B30)
    case "amount":
      return "&H0000D4FF"; // 노랑 (RGB FFD400)
    case "check":
    default:
      return "&H00F68231"; // 파랑 (RGB 3182F6)
  }
}

/** #RRGGBB → ASS &H00BBGGRR */
function hexToAss(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "&H0000D4FF"; // 기본 노랑
  const r = m[1].slice(0, 2);
  const g = m[1].slice(2, 4);
  const b = m[1].slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/** 초 → ASS 시간 H:MM:SS.cc */
function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cc = Math.round((s - Math.floor(s)) * 100);
  const cc2 = cc === 100 ? 99 : cc;
  return `${h}:${pad(m)}:${pad(ss)}.${pad(cc2)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ASS 텍스트 이스케이프(중괄호/역슬래시/개행) */
function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "\\​") // 역슬래시 무력화
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, "\\N");
}
