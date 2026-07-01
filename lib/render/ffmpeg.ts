/**
 * ffmpeg 렌더링 기본 구조 (2단계에서 실제 렌더링을 붙일 자리)
 *
 * 현재는 EditPlan → ffmpeg 필터그래프/명령어로 "번역"하는 뼈대를 제공한다.
 * MVP 에서는 아래를 구현한다:
 *   - 영상 메타데이터 추출 (ffprobe)
 *   - 무음 감지 (silencedetect)
 *   - EditPlan 을 바탕으로 한 filter_complex 초안 생성
 *   - 실제 렌더 실행 (renderPlan) — ffmpeg 미설치 시 명령어만 반환
 *
 * 자막/줌/스포트라이트/B-roll/팝업을 완전한 필터그래프로 변환하는 것은
 * 2단계 작업이며, 여기서는 확장 포인트를 명확히 남겨둔다.
 */

import { spawn } from "node:child_process";
import type { EditPlan, VideoMeta } from "@/lib/types";

export interface FfmpegAvailability {
  ffmpeg: boolean;
  ffprobe: boolean;
}

/** ffmpeg / ffprobe 설치 여부 확인 */
export async function checkFfmpeg(): Promise<FfmpegAvailability> {
  const [ffmpeg, ffprobe] = await Promise.all([
    hasBinary("ffmpeg"),
    hasBinary("ffprobe"),
  ]);
  return { ffmpeg, ffprobe };
}

/** ffprobe 로 영상 메타데이터를 추출한다. */
export async function probeVideo(filePath: string): Promise<VideoMeta> {
  const args = [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate:format=duration,size",
    "-of",
    "json",
    filePath,
  ];
  const { stdout } = await run("ffprobe", args);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; r_frame_rate?: string }>;
    format?: { duration?: string; size?: string };
  };
  const stream = parsed.streams?.[0] ?? {};
  const fps = parseFps(stream.r_frame_rate);

  return {
    fileName: filePath.split("/").pop() ?? filePath,
    sizeBytes: Number(parsed.format?.size ?? 0),
    durationSec: Number(parsed.format?.duration ?? 0),
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    fps,
  };
}

/** silencedetect 로 무음 구간을 감지한다(정확한 컷 편집용). */
export async function detectSilence(
  filePath: string,
  noiseDb: number,
  minDurationSec: number,
): Promise<Array<{ start: number; end: number }>> {
  const args = [
    "-i",
    filePath,
    "-af",
    `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
    "-f",
    "null",
    "-",
  ];
  const { stderr } = await run("ffmpeg", args);
  return parseSilenceLog(stderr);
}

/**
 * EditPlan → ffmpeg 명령어(초안).
 * 11. 최종 출력: 1080p, 원본 비율 유지, 유튜브 롱폼 품질.
 *
 * 지금은 컷 편집 + 1080p 스케일 + 인코딩 설정까지 실제로 구성하고,
 * 오버레이(자막/줌/스포트라이트/B-roll/팝업)는 필터 자리표시자로 남긴다.
 */
export function buildFfmpegCommand(
  plan: EditPlan,
  inputPath: string,
  outputPath: string,
): { bin: string; args: string[]; note: string } {
  const args: string[] = ["-y", "-i", inputPath];

  // 컷 편집: 무음 구간을 제외한 나머지를 이어붙이는 select 필터
  const keepRanges = cutToKeepRanges(plan);
  const vf: string[] = [];

  if (keepRanges.length > 0 && plan.settings.cut.enabled) {
    const sel = keepRanges
      .map((r) => `between(t,${r.start},${r.end})`)
      .join("+");
    vf.push(`select='${sel}',setpts=N/FRAME_RATE/TB`);
  }

  // 1080p 스케일 (원본 비율 유지: 세로 1080 기준, 폭은 비율 유지 후 짝수 보정)
  vf.push("scale=-2:1080:flags=lanczos");

  args.push("-vf", vf.join(","));
  // 유튜브 롱폼 업로드용 품질 프리셋
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    outputPath,
  );

  return {
    bin: "ffmpeg",
    args,
    note:
      "MVP 렌더: 무음 컷 + 1080p 인코딩까지 반영. 자막/줌/스포트라이트/B-roll/팝업 " +
      "오버레이는 2단계에서 filter_complex 로 확장 예정.",
  };
}

export interface RenderResult {
  ok: boolean;
  command: string;
  outputPath: string;
  message: string;
}

/** 실제 렌더 실행. ffmpeg 미설치면 명령어만 돌려준다(계획 검증용). */
export async function renderPlan(
  plan: EditPlan,
  inputPath: string,
  outputPath: string,
): Promise<RenderResult> {
  const { bin, args } = buildFfmpegCommand(plan, inputPath, outputPath);
  const command = `${bin} ${args.join(" ")}`;

  const { ffmpeg } = await checkFfmpeg();
  if (!ffmpeg) {
    return {
      ok: false,
      command,
      outputPath,
      message:
        "ffmpeg 가 설치되어 있지 않아 실제 렌더링을 건너뜁니다. 아래 명령어로 수동 실행할 수 있습니다.",
    };
  }

  try {
    await run(bin, args, { timeoutMs: 1000 * 60 * 30 });
    return { ok: true, command, outputPath, message: "렌더링 완료" };
  } catch (err) {
    return {
      ok: false,
      command,
      outputPath,
      message: `렌더링 실패: ${(err as Error).message}`,
    };
  }
}

/* --------------------------- 내부 유틸 --------------------------- */

/** 컷 이벤트를 "남길 구간"으로 변환 */
function cutToKeepRanges(plan: EditPlan): Array<{ start: number; end: number }> {
  const total = plan.stats.originalDurationSec;
  const cuts = plan.events
    .filter((e) => e.type === "cut")
    .sort((a, b) => a.start - b.start);
  if (cuts.length === 0) return [{ start: 0, end: total }];

  const keep: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start > cursor) keep.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < total) keep.push({ start: cursor, end: total });
  return keep;
}

function parseFps(r?: string): number | undefined {
  if (!r) return undefined;
  const [num, den] = r.split("/").map(Number);
  if (!den) return num || undefined;
  return Math.round((num / den) * 100) / 100;
}

function parseSilenceLog(log: string): Array<{ start: number; end: number }> {
  const starts: number[] = [];
  const result: Array<{ start: number; end: number }> = [];
  const re = /silence_(start|end): (-?[0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) {
    if (m[1] === "start") starts.push(Number(m[2]));
    else {
      const start = starts.shift() ?? 0;
      result.push({ start, end: Number(m[2]) });
    }
  }
  return result;
}

function hasBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(bin, ["-version"]);
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

function run(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          p.kill("SIGKILL");
          reject(new Error(`${bin} 타임아웃`));
        }, opts.timeoutMs)
      : null;

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      // ffmpeg 는 정보 출력을 stderr 로 내보내므로 code 만 본다.
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} 종료 코드 ${code}: ${stderr.slice(-500)}`));
    });
  });
}
