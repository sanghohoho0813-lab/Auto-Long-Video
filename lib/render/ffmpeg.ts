/**
 * ffmpeg 렌더링 (2단계: 실제 렌더 구현)
 *
 * EditPlan → ffmpeg filter_complex 로 번역해 실제 1080p mp4 를 렌더링한다.
 *   - 영상 메타데이터 추출 (ffprobe)
 *   - 무음 감지 (silencedetect) — 향후 정밀 컷용
 *   - EditPlan → filter_complex (컷/줌/스포트라이트/B-roll/자막·팝업)
 *   - 실제 렌더 실행 (renderPlan) — ffmpeg 미설치/서버리스면 명령어만 반환
 *
 * ⚠️ 실제 실행 여부는 호출부(/api/render)가 환경(로컬/서버리스)으로 판단한다.
 *    이 모듈은 "명령 생성"과 "실행"을 분리해 제공한다.
 */

import { spawn } from "node:child_process";
import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import type { EditPlan, VideoMeta } from "@/lib/types";
import { computeKeepRanges, buildRemapper, remapEvents } from "@/lib/render/timeline";
import { buildAss } from "@/lib/render/ass";
import { buildFilterComplex, type BrollInput } from "@/lib/render/filtergraph";

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

/** 오디오 스트림 존재 여부 */
export async function probeHasAudio(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=index",
      "-of",
      "json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as { streams?: unknown[] };
    return (parsed.streams?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** silencedetect 로 무음 구간을 감지한다(정밀 컷용, 향후 연동). */
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

/* -------------------------- 렌더 구성(순수) -------------------------- */

export interface ComposeOptions {
  hasAudio?: boolean;
  /** broll suggestedFile → 실제 파일 절대경로(없으면 null). 미지정 시 B-roll 생략 */
  resolveBrollFile?: (suggestedFile: string) => string | null;
}

export interface RenderComposition {
  extraInputs: string[]; // broll 입력 파일(순서대로 -i)
  filterComplex: string;
  videoLabel: string;
  audioLabel: string | null;
  assFileName: string; // ffmpeg cwd(출력폴더) 기준 상대 파일명
  assContent: string;
  hasSubtitles: boolean;
  outW: number;
  outH: number;
  fps: number;
  outputDurationSec: number; // 컷 반영 후 예상 결과 길이(진행률 계산용)
  brollCount: number; // 실제 파일이 매칭된 B-roll 오버레이 수
  applied: string[];
}

/** EditPlan → 렌더 구성요소(필터/자막/입력)로 번역한다(파일 시스템 접근 없음). */
export function composeRender(plan: EditPlan, baseName: string, opts: ComposeOptions = {}): RenderComposition {
  const hasAudio = opts.hasAudio ?? true;
  const total = plan.stats.originalDurationSec || durationFromEvents(plan);

  // 출력 해상도(원본 비율 유지, 세로 1080 기준)
  const srcW = plan.source?.width || 1920;
  const srcH = plan.source?.height || 1080;
  const outH = 1080;
  const outW = evenize(Math.round((srcW / srcH) * outH)) || 1920;
  const fps = Math.round(plan.source?.fps || 30);

  // 컷 → keep 구간 → 리맵
  const keep = computeKeepRanges(plan.events, total);
  const remap = buildRemapper(keep);
  const remapped = remapEvents(plan.events, remap, keep);
  const outputDurationSec = plan.settings.cut.enabled ? remap.outputDuration : total;

  // B-roll 입력 해석
  const extraInputs: string[] = [];
  const brollInputs: BrollInput[] = [];
  if (opts.resolveBrollFile) {
    for (const e of remapped.filter((x) => x.type === "broll")) {
      const suggested = (e.payload as { suggestedFile?: string })?.suggestedFile;
      if (!suggested) continue;
      const file = opts.resolveBrollFile(suggested);
      if (!file) continue;
      brollInputs.push({ inputIndex: 1 + extraInputs.length, start: e.start, end: e.end });
      extraInputs.push(file);
    }
  }

  // 자막(ASS) — 필터 파싱 안전을 위해 파일명은 ASCII 로 정규화
  const ass = buildAss(remapped, plan.settings, outW, outH);
  const assFileName = baseName.replace(/[^A-Za-z0-9._-]/g, "_") + ".ass";

  const filter = buildFilterComplex({
    keepRanges: keep,
    doCut: plan.settings.cut.enabled,
    totalDuration: total,
    remappedEvents: remapped,
    settings: plan.settings,
    outW,
    outH,
    fps,
    hasAudio,
    assFile: ass.hasEvents ? assFileName : null,
    broll: brollInputs,
  });

  return {
    extraInputs,
    filterComplex: filter.filterComplex,
    videoLabel: filter.videoLabel,
    audioLabel: filter.audioLabel,
    assFileName,
    assContent: ass.content,
    hasSubtitles: ass.hasEvents,
    outW,
    outH,
    fps,
    outputDurationSec,
    brollCount: brollInputs.length,
    applied: filter.applied,
  };
}

/** 렌더 구성 → ffmpeg 인자 배열 */
export function buildFfmpegArgs(
  comp: RenderComposition,
  inputPath: string,
  outputPath: string,
  opts: { progress?: boolean; clip?: { start: number; duration: number } } = {},
): string[] {
  const args = ["-y"];
  // 진행률 파싱용(stderr 로 기계가 읽기 좋은 key=value 출력)
  if (opts.progress) args.push("-progress", "pipe:2");
  // 테스트 구간(preview): 메인 입력만 [start, start+duration] 으로 잘라 읽는다.
  if (opts.clip) {
    args.push("-ss", String(opts.clip.start), "-t", String(opts.clip.duration));
  }
  args.push("-i", inputPath);
  for (const f of comp.extraInputs) args.push("-i", f);

  args.push("-filter_complex", comp.filterComplex);
  args.push("-map", comp.videoLabel);
  if (comp.audioLabel) args.push("-map", comp.audioLabel);

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(comp.fps),
  );
  if (comp.audioLabel) args.push("-c:a", "aac", "-b:a", "192k");
  args.push("-movflags", "+faststart", outputPath);
  return args;
}

/**
 * EditPlan → ffmpeg 명령어(표시용).
 * 11. 최종 출력: 1080p, 원본 비율 유지, 유튜브 롱폼 품질.
 * (실행하지 않고 명령만 확인할 때 사용 — 서버리스/미설치)
 */
export function buildFfmpegCommand(
  plan: EditPlan,
  inputPath: string,
  outputPath: string,
  opts: { clip?: { start: number; duration: number } } = {},
): { bin: string; args: string[]; command: string; applied: string[]; note: string } {
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const comp = composeRender(plan, baseName, { hasAudio: true });
  const args = buildFfmpegArgs(comp, inputPath, outputPath, { clip: opts.clip });
  return {
    bin: "ffmpeg",
    args,
    command: `ffmpeg ${args.map(shellQuote).join(" ")}`,
    applied: comp.applied,
    note:
      comp.hasSubtitles
        ? `자막은 렌더 시 '${comp.assFileName}' (ASS) 파일로 함께 생성됩니다. 출력 폴더에서 실행하세요.`
        : "자막 이벤트가 없어 ASS 파일은 생성되지 않습니다.",
  };
}

/* -------------------------- 실제 렌더 실행 -------------------------- */

export interface RenderResult {
  ok: boolean;
  command: string;
  outputPath: string;
  applied: string[];
  message: string;
}

export type RenderStageName = "preparing" | "extracting" | "running" | "finalizing";
export interface RenderProgress {
  stage: RenderStageName;
  percent: number; // 0~100
}

export interface RenderOptions {
  resolveBrollFile?: (f: string) => string | null;
  onProgress?: (p: RenderProgress) => void;
  /** 테스트 구간 렌더: 메인 입력을 [start, start+duration] 로 잘라 읽는다(이벤트는 이미 shift됨). */
  clip?: { start: number; duration: number };
}

/**
 * 실제 렌더 실행(로컬 전용).
 * outputDir 에 ASS 사이드카를 쓰고, 그 폴더를 cwd 로 ffmpeg 를 실행한다.
 * onProgress 로 단계/진행률을 보고한다.
 */
export async function renderPlan(
  plan: EditPlan,
  inputPath: string,
  outputPath: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const outputDir = path.dirname(outputPath);
  const baseName = path.basename(outputPath, path.extname(outputPath));
  const report = options.onProgress ?? (() => {});

  report({ stage: "preparing", percent: 0 });

  const { ffmpeg } = await checkFfmpeg();
  if (!ffmpeg) {
    const cmd = buildFfmpegCommand(plan, inputPath, outputPath);
    return {
      ok: false,
      command: cmd.command,
      outputPath,
      applied: cmd.applied,
      message:
        "ffmpeg 가 설치되어 있지 않아 실제 렌더링을 건너뜁니다. 아래 명령어로 수동 실행할 수 있습니다.",
    };
  }

  report({ stage: "extracting", percent: 0 });
  const hasAudio = await probeHasAudio(inputPath);
  const comp = composeRender(plan, baseName, {
    hasAudio,
    resolveBrollFile: options.resolveBrollFile,
  });

  // ASS 사이드카 작성 (cwd = outputDir 이므로 상대 파일명으로 참조됨)
  if (comp.hasSubtitles) {
    await writeFile(path.join(outputDir, comp.assFileName), comp.assContent, "utf8");
  }

  // ffmpeg 는 진행률 파싱을 위해 -progress pipe:2(=stderr) 를 추가한다.
  const args = buildFfmpegArgs(comp, inputPath, outputPath, {
    progress: true,
    clip: options.clip,
  });
  const command = `ffmpeg ${args.map(shellQuote).join(" ")}`;
  const outDur = comp.outputDurationSec || plan.stats.originalDurationSec || 1;

  report({ stage: "running", percent: 1 });
  try {
    await run("ffmpeg", args, {
      timeoutMs: 1000 * 60 * 60,
      cwd: outputDir,
      onStderr: (line) => {
        // -progress 출력: out_time_us=..., 또는 일반 로그의 time=HH:MM:SS.xx
        const sec = parseProgressSeconds(line);
        if (sec !== null) {
          const percent = Math.max(1, Math.min(99, Math.round((sec / outDur) * 100)));
          report({ stage: "running", percent });
        }
      },
    });
    report({ stage: "finalizing", percent: 99 });
    return { ok: true, command, outputPath, applied: comp.applied, message: "렌더링 완료" };
  } catch (err) {
    return {
      ok: false,
      command,
      outputPath,
      applied: comp.applied,
      message: `렌더링 실패: ${(err as Error).message}`,
    };
  }
}

/** ffmpeg 진행 로그 한 줄에서 처리된 초를 뽑는다(-progress 또는 일반 로그). */
function parseProgressSeconds(line: string): number | null {
  // -progress: out_time_us=1234567  또는 out_time_ms=  (ffmpeg 버전차)
  const us = line.match(/out_time_us=(\d+)/);
  if (us) return Number(us[1]) / 1_000_000;
  const ms = line.match(/out_time_ms=(\d+)/);
  if (ms) return Number(ms[1]) / 1_000_000; // ffmpeg 의 out_time_ms 는 사실 마이크로초 단위
  // 일반 로그: time=00:00:03.20
  const t = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (t) return Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
  return null;
}

/* --------------------------- 내부 유틸 --------------------------- */

function durationFromEvents(plan: EditPlan): number {
  return plan.events.reduce((max, e) => Math.max(max, e.end), 0);
}

function evenize(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}

/** 표시용 안전 인용(실행은 spawn 배열로 하므로 셸 이스케이프 불필요) */
function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:=-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
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
  opts: {
    timeoutMs?: number;
    cwd?: string;
    onStderr?: (line: string) => void;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let lineBuf = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          p.kill("SIGKILL");
          reject(new Error(`${bin} 타임아웃`));
        }, opts.timeoutMs)
      : null;

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      // 마지막 800자만 유지(메모리 절약)
      if (stderr.length > 4000) stderr = stderr.slice(-2000);
      if (opts.onStderr) {
        lineBuf += s;
        const parts = lineBuf.split(/[\r\n]+/);
        lineBuf = parts.pop() ?? "";
        for (const line of parts) if (line.trim()) opts.onStderr(line.trim());
      }
    });
    p.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} 종료 코드 ${code}: ${stderr.slice(-800)}`));
    });
  });
}
