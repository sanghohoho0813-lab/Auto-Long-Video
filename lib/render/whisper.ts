/**
 * Whisper 자동 자막 (3단계)
 *
 * mp4 → (ffmpeg 로 16kHz mono wav 추출) → Whisper CLI → SRT → TranscriptSegment[]
 *
 * CLI 기반으로 여러 백엔드를 지원한다(설치된 것을 자동 감지):
 *   1) custom       : WHISPER_CUSTOM_CMD 환경변수(임의 명령 템플릿) — 어떤 whisper든 연결
 *   2) faster-whisper: whisper-ctranslate2 CLI
 *   3) openai-whisper: whisper CLI
 *   4) whisper.cpp  : whisper-cli / main (WHISPER_CPP_MODEL 필요)
 *
 * ⚠️ 로컬 전용. 서버리스(Vercel)에서는 호출부(/api/transcribe)가 실행을 막는다.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TranscriptSegment } from "@/lib/types";

export interface WhisperOptions {
  language?: string; // 기본 "ko"
  model?: string; // 기본 env WHISPER_MODEL 또는 "base"
}

export type WhisperBackend =
  | "custom"
  | "faster-whisper"
  | "openai-whisper"
  | "whisper.cpp";

export interface WhisperInfo {
  available: boolean;
  backend: WhisperBackend | null;
  bin?: string;
  detail?: string;
}

const DEFAULT_LANG = "ko";
const DEFAULT_MODEL = process.env.WHISPER_MODEL || "base";

/** 설치된 Whisper 백엔드를 감지한다(모델 다운로드 없이 빠르게). */
export async function detectWhisper(): Promise<WhisperInfo> {
  // 1) 사용자 지정 명령(가장 우선)
  if (process.env.WHISPER_CUSTOM_CMD) {
    return { backend: "custom", available: true, detail: "WHISPER_CUSTOM_CMD" };
  }

  // 2) faster-whisper CLI
  if (await hasBinary("whisper-ctranslate2")) {
    return { backend: "faster-whisper", available: true, bin: "whisper-ctranslate2" };
  }

  // 3) openai-whisper CLI
  if (await hasBinary("whisper")) {
    return { backend: "openai-whisper", available: true, bin: "whisper" };
  }

  // 4) whisper.cpp (모델 파일이 있어야 실제 실행 가능)
  const cppBin = (await hasBinary("whisper-cli"))
    ? "whisper-cli"
    : (await hasBinary("main"))
      ? "main"
      : null;
  if (cppBin) {
    const model = process.env.WHISPER_CPP_MODEL;
    if (model && existsSync(model)) {
      return { backend: "whisper.cpp", available: true, bin: cppBin, detail: model };
    }
    return {
      backend: "whisper.cpp",
      available: false,
      bin: cppBin,
      detail: "WHISPER_CPP_MODEL 환경변수에 ggml 모델 경로를 지정하세요.",
    };
  }

  return { available: false, backend: null };
}

/** 설치 안내(백엔드 미검출 시 UI 표시용) */
export const WHISPER_INSTALL_HINTS = [
  "faster-whisper: pip install whisper-ctranslate2",
  "openai-whisper: pip install -U openai-whisper",
  "whisper.cpp: 빌드 후 WHISPER_CPP_MODEL 에 ggml 모델 경로 지정",
  "또는 WHISPER_CUSTOM_CMD 로 임의 whisper 명령 연결",
];

/**
 * 영상/오디오 파일을 받아 transcript segments 로 변환한다(로컬 전용).
 * 임시 폴더에 wav 추출 → whisper 실행 → SRT 파싱 → 정리.
 */
export async function transcribeFile(
  filePath: string,
  opts: WhisperOptions = {},
): Promise<TranscriptSegment[]> {
  const info = await detectWhisper();
  if (!info.available || !info.backend) {
    throw new Error("사용 가능한 Whisper 백엔드가 없습니다.");
  }

  const language = opts.language || DEFAULT_LANG;
  const model = opts.model || DEFAULT_MODEL;
  const workDir = await mkdtemp(path.join(os.tmpdir(), "whisper-"));

  try {
    // 1) 오디오 추출 (16kHz mono PCM wav — whisper 계열 표준 입력)
    const wav = path.join(workDir, "audio.wav");
    await run("ffmpeg", ["-y", "-i", filePath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);

    // 2) 백엔드별 실행 → SRT 생성
    const srtPath = await runBackend(info, wav, workDir, language, model);

    // 3) SRT → segments
    const srt = await readFile(srtPath, "utf8");
    const segments = parseSrt(srt);
    if (segments.length === 0) {
      throw new Error("자막을 인식하지 못했습니다(빈 결과).");
    }
    return segments;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* --------------------------- 백엔드 실행 --------------------------- */

async function runBackend(
  info: WhisperInfo,
  wav: string,
  workDir: string,
  language: string,
  model: string,
): Promise<string> {
  switch (info.backend) {
    case "custom": {
      const srt = path.join(workDir, "whisper.srt");
      const cmd = (process.env.WHISPER_CUSTOM_CMD as string)
        .replaceAll("{{audio}}", wav)
        .replaceAll("{{outdir}}", workDir)
        .replaceAll("{{srt}}", srt)
        .replaceAll("{{lang}}", language)
        .replaceAll("{{model}}", model);
      await run("sh", ["-c", cmd]);
      return await findSrt(workDir, srt);
    }

    case "faster-whisper":
    case "openai-whisper": {
      // 두 CLI 는 플래그가 호환된다.
      await run(info.bin as string, [
        wav,
        "--model",
        model,
        "--language",
        language,
        "--task",
        "transcribe",
        "--output_format",
        "srt",
        "--output_dir",
        workDir,
      ]);
      // 출력 파일명은 입력 basename 기준: audio.srt
      return await findSrt(workDir, path.join(workDir, "audio.srt"));
    }

    case "whisper.cpp": {
      const of = path.join(workDir, "whisper"); // → whisper.srt
      await run(info.bin as string, [
        "-m",
        process.env.WHISPER_CPP_MODEL as string,
        "-f",
        wav,
        "-l",
        language,
        "-osrt",
        "-of",
        of,
      ]);
      return await findSrt(workDir, of + ".srt");
    }

    default:
      throw new Error("알 수 없는 Whisper 백엔드");
  }
}

/** 우선 예상 경로를 확인하고, 없으면 workDir 에서 첫 .srt 를 찾는다. */
async function findSrt(workDir: string, preferred: string): Promise<string> {
  if (existsSync(preferred)) return preferred;
  const files = await readdir(workDir);
  const srt = files.find((f) => f.toLowerCase().endsWith(".srt"));
  if (srt) return path.join(workDir, srt);
  throw new Error("Whisper SRT 출력 파일을 찾을 수 없습니다.");
}

/* --------------------------- SRT 파싱 --------------------------- */

/** SRT 텍스트 → TranscriptSegment[] */
export function parseSrt(srt: string): TranscriptSegment[] {
  const blocks = srt.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;
    // 첫 줄이 인덱스(숫자)면 건너뛴다
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    const timeLine = lines[i];
    const m = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!m) continue;
    const start = hms(m[1], m[2], m[3], m[4]);
    const end = hms(m[5], m[6], m[7], m[8]);
    const text = lines
      .slice(i + 1)
      .join(" ")
      .trim();
    if (!text || end <= start) continue;
    segments.push({ start, end, text });
  }
  return segments;
}

function hms(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/* --------------------------- 프로세스 유틸 --------------------------- */

function hasBinary(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(bin, ["--help"]);
    p.on("error", () => resolve(false));
    // --help 는 0 또는 1 을 반환할 수 있으므로 실행 자체 성공을 본다.
    p.on("close", () => resolve(true));
  });
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (err) => reject(err));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} 종료 코드 ${code}: ${stderr.slice(-600)}`));
    });
  });
}
