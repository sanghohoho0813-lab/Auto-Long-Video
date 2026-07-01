/**
 * Whisper 연동 인터페이스 (3단계에서 실제 연동)
 *
 * whisper.cpp / faster-whisper 를 붙일 자리.
 * 지금은 공통 인터페이스만 정의하고, 실제 구현은 어댑터로 주입한다.
 * 이렇게 하면 UI/planner 는 "어떻게 자막을 얻는가"와 무관하게 동작한다.
 */

import type { TranscriptSegment } from "@/lib/types";

export interface TranscribeOptions {
  language?: string; // 예: "ko"
  model?: string; // 예: "base", "small", "medium"
}

/** 오디오/영상 파일 → transcript. 구현체가 이 시그니처를 만족하면 된다. */
export interface Transcriber {
  name: string;
  isAvailable(): Promise<boolean>;
  transcribe(filePath: string, opts?: TranscribeOptions): Promise<TranscriptSegment[]>;
}

/**
 * 아직 Whisper 가 붙지 않은 기본 어댑터.
 * isAvailable() = false 를 반환해, UI 가 "transcript.json 업로드" 경로로 안내하게 한다.
 */
export const NotImplementedTranscriber: Transcriber = {
  name: "whisper (미연동)",
  async isAvailable() {
    return false;
  },
  async transcribe() {
    throw new Error(
      "Whisper 연동은 3단계에서 추가됩니다. 현재는 transcript.json 을 업로드해 주세요.",
    );
  },
};

// 실제 구현 예시(주석):
//
// export const WhisperCppTranscriber: Transcriber = {
//   name: "whisper.cpp",
//   async isAvailable() { return hasBinary("whisper-cli"); },
//   async transcribe(filePath, opts) {
//     // 1) ffmpeg 로 16kHz wav 추출
//     // 2) whisper-cli 실행 → json/srt
//     // 3) TranscriptSegment[] 로 파싱
//   },
// };
