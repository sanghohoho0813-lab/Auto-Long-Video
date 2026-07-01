/**
 * EditPlan → ffmpeg filter_complex 생성
 *
 * 파이프라인(비디오): 컷 → 1080p 스케일 → 줌 → 스포트라이트 → B-roll → 자막(ASS)
 * 모든 오버레이 시각은 "출력 타임라인"(컷 반영 후) 기준으로 넘겨받는다.
 *
 * 각 효과는 이벤트가 없으면 자동으로 건너뛴다(체인이 유연하게 축약됨).
 */

import type { EditEvent, EditSettings, ZoomPayload } from "@/lib/types";
import type { KeepRange } from "@/lib/render/timeline";

export interface BrollInput {
  inputIndex: number; // ffmpeg -i 입력 인덱스(0은 원본, 1부터 broll)
  start: number; // 출력 타임라인 시작(초)
  end: number;
}

export interface FilterParams {
  keepRanges: KeepRange[]; // 원본 타임라인 기준(컷용)
  doCut: boolean;
  totalDuration: number; // 원본 길이
  remappedEvents: EditEvent[]; // 출력 타임라인 기준(zoom/spotlight)
  settings: EditSettings;
  outW: number;
  outH: number;
  fps: number;
  hasAudio: boolean;
  assFile: string | null; // ffmpeg cwd 기준 상대 파일명(있으면 자막 합성)
  broll: BrollInput[];
}

export interface FilterResult {
  filterComplex: string;
  videoLabel: string; // -map 대상 (예: "[vout]")
  audioLabel: string | null; // -map 대상 (예: "[acut]" / "0:a")
  applied: string[]; // 적용된 효과 요약(한국어)
}

export function buildFilterComplex(p: FilterParams): FilterResult {
  const chains: string[] = [];
  const applied: string[] = [];
  let vLabel = "0:v";
  let aLabel: string | null = p.hasAudio ? "0:a" : null;

  // 1) 컷: split → trim → concat
  const realCut =
    p.doCut &&
    p.keepRanges.length > 0 &&
    !(
      p.keepRanges.length === 1 &&
      p.keepRanges[0].start <= 0.01 &&
      p.keepRanges[0].end >= p.totalDuration - 0.01
    );

  if (realCut) {
    const n = p.keepRanges.length;
    chains.push(`[0:v]split=${n}${labels("cv", n)}`);
    p.keepRanges.forEach((r, i) =>
      chains.push(`[cv${i}]trim=start=${r.start}:end=${r.end},setpts=PTS-STARTPTS[tv${i}]`),
    );
    if (p.hasAudio) {
      chains.push(`[0:a]asplit=${n}${labels("ca", n)}`);
      p.keepRanges.forEach((r, i) =>
        chains.push(`[ca${i}]atrim=start=${r.start}:end=${r.end},asetpts=PTS-STARTPTS[ta${i}]`),
      );
      const cin = p.keepRanges.map((_, i) => `[tv${i}][ta${i}]`).join("");
      chains.push(`${cin}concat=n=${n}:v=1:a=1[vcut][acut]`);
      vLabel = "vcut";
      aLabel = "acut";
    } else {
      const cin = p.keepRanges.map((_, i) => `[tv${i}]`).join("");
      chains.push(`${cin}concat=n=${n}:v=1:a=0[vcut]`);
      vLabel = "vcut";
    }
    applied.push(`무음 컷 ${n - 1}개 반영`);
  }

  // 2) 1080p 스케일 (원본 비율 유지된 outW×outH)
  chains.push(`[${vLabel}]scale=${p.outW}:${p.outH}:flags=lanczos,setsar=1[vscaled]`);
  vLabel = "vscaled";

  // 3) 줌 (zoompan, 부드러운 raised-cosine)
  const zoomEvents = p.remappedEvents.filter((e) => e.type === "zoom");
  if (p.settings.zoom.enabled && zoomEvents.length > 0) {
    const z = buildZoomExpr(zoomEvents, p.fps);
    chains.push(
      `[${vLabel}]zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${p.outW}x${p.outH}:fps=${p.fps}[vzoom]`,
    );
    vLabel = "vzoom";
    applied.push(`줌 ${zoomEvents.length}회`);
  }

  // 4) 스포트라이트 (전체 화면 살짝 어둡게)
  const spotEvents = p.remappedEvents.filter((e) => e.type === "spotlight");
  if (p.settings.spotlight.enabled && spotEvents.length > 0) {
    const enable = spotEvents.map((e) => `between(t,${e.start},${e.end})`).join("+");
    const alpha = clamp(p.settings.spotlight.darkenAmount, 0.05, 0.9);
    chains.push(
      `[${vLabel}]drawbox=x=0:y=0:w=iw:h=ih:color=black@${alpha}:t=fill:enable='${enable}'[vspot]`,
    );
    vLabel = "vspot";
    applied.push(`스포트라이트 ${spotEvents.length}회`);
  }

  // 5) B-roll 오버레이 (원본 오디오 유지, 화면 위에 덮어씌움)
  p.broll.forEach((b, i) => {
    chains.push(
      `[${b.inputIndex}:v]scale=${p.outW}:${p.outH}:force_original_aspect_ratio=increase,` +
        `crop=${p.outW}:${p.outH},setpts=PTS-STARTPTS+${b.start}/TB[bl${i}]`,
    );
    chains.push(
      `[${vLabel}][bl${i}]overlay=x=0:y=0:enable='between(t,${b.start},${b.end})'[vbr${i}]`,
    );
    vLabel = `vbr${i}`;
  });
  if (p.broll.length > 0) applied.push(`B-roll ${p.broll.length}개 오버레이`);

  // 6) 자막 + 팝업 (ASS)
  if (p.assFile) {
    chains.push(`[${vLabel}]subtitles=${p.assFile}[vout]`);
    vLabel = "vout";
    applied.push("자막·강조·팝업 합성");
  } else {
    chains.push(`[${vLabel}]null[vout]`);
    vLabel = "vout";
  }

  return {
    filterComplex: chains.join(";"),
    videoLabel: "[vout]",
    audioLabel: aLabel ? (aLabel.includes(":") ? aLabel : `[${aLabel}]`) : null,
    applied,
  };
}

/**
 * zoompan z 표현식.
 * 각 줌 구간에서 1.0 → Z → 1.0 으로 부드럽게(raised-cosine) 왕복 → 경계에서 튀지 않음.
 * t = on/fps (출력 프레임 시각).
 */
function buildZoomExpr(zoomEvents: EditEvent[], fps: number): string {
  const t = `(on/${fps})`;
  let expr = "1";
  // 뒤에서부터 감싸며 중첩 if 구성
  for (let i = zoomEvents.length - 1; i >= 0; i--) {
    const e = zoomEvents[i];
    const pl = (e.payload ?? {}) as Partial<ZoomPayload>;
    const peak = clamp(Math.max(pl.toScale ?? 1.05, pl.fromScale ?? 1.05), 1.0, 1.2);
    const s = e.start;
    const dur = Math.max(0.3, e.end - e.start);
    const bump = `1+(${(peak - 1).toFixed(4)})*0.5*(1-cos(2*PI*(${t}-${s})/${dur.toFixed(3)}))`;
    expr = `if(between(${t},${s},${e.end}),${bump},${expr})`;
  }
  return expr;
}

function labels(prefix: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `[${prefix}${i}]`).join("");
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
