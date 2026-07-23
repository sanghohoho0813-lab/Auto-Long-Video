"use client";

/**
 * 1. 영상 업로드 + 3. transcript.json 업로드
 *
 * - mp4 를 서버에 업로드하고 메타데이터(길이/해상도/용량)를 받아온다.
 * - ffprobe 가 없으면 브라우저의 <video> 로 길이/해상도를 보완한다.
 * - transcript.json 을 읽어 파싱한다.
 */

import { useRef, useState } from "react";
import type { EditSettings, TranscriptSegment, VideoMeta } from "@/lib/types";
import { parseTranscript } from "@/lib/analysis/transcript";

interface Props {
  meta: VideoMeta | null;
  savedPath: string | null;
  segments: TranscriptSegment[];
  serverless: boolean;
  whisperAvailable: boolean;
  whisperBackend: string | null;
  ffmpegAvailable: boolean;
  /** 무음 감지 컷에 사용할 현재 컷 설정(임계값/최소 무음 길이) */
  cutSettings: EditSettings["cut"];
  onVideo: (meta: VideoMeta, savedPath: string | null) => void;
  onTranscript: (segments: TranscriptSegment[]) => void;
  /** 무음 감지 컷: speech 구간을 세그먼트로 넘겨 "컷만" 모드로 전환 */
  onCutsOnly: (segments: TranscriptSegment[]) => void;
  onToast: (msg: string) => void;
}

export default function Uploader({
  meta,
  savedPath,
  segments,
  serverless,
  whisperAvailable,
  whisperBackend,
  ffmpegAvailable,
  cutSettings,
  onVideo,
  onTranscript,
  onCutsOnly,
  onToast,
}: Props) {
  const videoInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [cutting, setCutting] = useState(false);
  const [whisperMsg, setWhisperMsg] = useState<{ text: string; hints?: string[] } | null>(
    null,
  );

  async function handleVideo(file: File) {
    setUploading(true);
    // 브라우저에서 먼저 길이/해상도 추출 (ffprobe 미설치 / 서버리스 대비)
    const local = await readLocalVideoMeta(file).catch(() => null);

    // 서버리스(Vercel): 서버 업로드를 시도하지 않고 브라우저 분석만 사용한다.
    // (영구 저장 불가 + 요청 바디 제한 회피)
    if (serverless) {
      if (local) {
        onVideo({ ...local, fileName: file.name, sizeBytes: file.size }, null);
        onToast("영상 분석 완료 (브라우저 메모리)");
      } else {
        onToast("영상 메타데이터를 읽을 수 없습니다");
      }
      setUploading(false);
      return;
    }

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "업로드 실패");

      const merged: VideoMeta = {
        ...data.meta,
        // 서버가 0 이면 브라우저 값으로 보완
        durationSec: data.meta.durationSec || local?.durationSec || 0,
        width: data.meta.width || local?.width || 0,
        height: data.meta.height || local?.height || 0,
      };
      onVideo(merged, data.savedPath ?? null);
      onToast("영상 업로드 완료");
    } catch (err) {
      // 서버 업로드 실패해도 로컬 메타로 계속 진행 가능
      if (local) {
        onVideo({ ...local, fileName: file.name, sizeBytes: file.size }, null);
        onToast("서버 저장 없이 로컬 분석으로 진행합니다");
      } else {
        onToast((err as Error).message);
      }
    } finally {
      setUploading(false);
    }
  }

  /**
   * public/sample-transcript.json 을 불러와 바로 편집 계획을 생성한다.
   * (segments 가 설정되면 상위에서 edit-plan 이 자동 생성됨)
   * 생성 직후 결과 영역으로 부드럽게 스크롤해 다음 행동을 명확히 안내한다.
   */
  async function loadSample() {
    try {
      const res = await fetch("/sample-transcript.json");
      if (!res.ok) throw new Error("샘플을 찾을 수 없습니다");
      const json = await res.json();
      const parsed = parseTranscript(json);
      onTranscript(parsed.segments);
      onToast(`샘플로 편집 계획 생성 (${parsed.segments.length}개 구간)`);
      // 결과가 렌더된 뒤 스크롤
      setTimeout(() => {
        document
          .getElementById("results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      onToast(`샘플 로드 실패: ${(err as Error).message}`);
    }
  }

  async function handleTranscript(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const parsed = parseTranscript(json);
      onTranscript(parsed.segments);
      onToast(`자막 ${parsed.segments.length}개 구간 로드 완료`);
    } catch (err) {
      onToast(`transcript 파싱 실패: ${(err as Error).message}`);
    }
  }

  /** 🎙️ 영상에서 Whisper 로 자동 자막 생성 (로컬 전용) */
  async function autoTranscribe() {
    if (!savedPath) {
      onToast("먼저 영상을 업로드하세요");
      return;
    }
    setTranscribing(true);
    setWhisperMsg(null);
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputPath: savedPath, language: "ko" }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setWhisperMsg({
          text: data.message || data.error || "자동 자막 생성 실패",
          hints: data.hints,
        });
        onToast(data.message || data.error || "자동 자막 생성 실패");
        return;
      }
      const parsed = parseTranscript(data.segments);
      onTranscript(parsed.segments);
      onToast(`자동 자막 완료 (${parsed.segments.length}개 · ${data.backend})`);
      setTimeout(() => {
        document
          .getElementById("results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setWhisperMsg({ text: `자동 자막 생성 실패: ${(err as Error).message}` });
    } finally {
      setTranscribing(false);
    }
  }

  /** ✂️ 무음 자동 컷 (ffmpeg silencedetect) — Whisper 불필요, "컷만" 결과용 */
  async function autoCut() {
    if (!savedPath) {
      onToast("먼저 영상을 업로드하세요");
      return;
    }
    setCutting(true);
    try {
      const res = await fetch("/api/detect-silence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputPath: savedPath,
          // 설정 패널의 무음 임계값 / 최소 무음 길이를 실제로 반영
          silenceThreshold: cutSettings.silenceThreshold,
          minSilenceDuration: cutSettings.minSilenceDuration,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        onToast(data.message || data.error || "무음 감지 실패");
        return;
      }
      if (!data.segments || data.segments.length === 0) {
        onToast("말이 있는 구간을 찾지 못했습니다(오디오 확인)");
        return;
      }
      onCutsOnly(data.segments);
      onToast(`무음 ${data.silenceCount}구간 감지 → 컷만 편집 계획 생성`);
      setTimeout(() => {
        document
          .getElementById("results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      onToast(`무음 감지 실패: ${(err as Error).message}`);
    } finally {
      setCutting(false);
    }
  }

  const cutDisabled = cutting || serverless || !ffmpegAvailable || !savedPath;

  /** 현재 segments 를 transcript.json 으로 다운로드 */
  function downloadTranscript() {
    if (segments.length === 0) return;
    const blob = new Blob([JSON.stringify(segments, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transcript.json";
    a.click();
    URL.revokeObjectURL(url);
    onToast("transcript.json 다운로드 완료");
  }

  // 자동 자막 버튼 활성 조건
  const whisperReady = !serverless && whisperAvailable;
  const whisperDisabled = transcribing || !whisperReady || !savedPath;

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-step">1</span>
        <span className="card-title">영상 · 자막 업로드</span>
      </div>

      {/* 영상 업로드 */}
      <div
        className={`dropzone ${meta ? "filled" : ""}`}
        onClick={() => videoInput.current?.click()}
      >
        {meta ? (
          <>
            <div className="dropzone-label">🎞 {meta.fileName}</div>
            <div className="meta-grid">
              <MetaItem k="길이" v={formatDuration(meta.durationSec)} />
              <MetaItem
                k="해상도"
                v={meta.width ? `${meta.width}×${meta.height}` : "-"}
              />
              <MetaItem k="용량" v={formatSize(meta.sizeBytes)} />
              <MetaItem k="FPS" v={meta.fps ? String(meta.fps) : "-"} />
            </div>
            {savedPath ? (
              <div className="dropzone-hint">서버 저장됨 · {savedPath}</div>
            ) : (
              <div className="dropzone-hint">
                로컬 분석 모드 (렌더링하려면 서버 저장 필요)
              </div>
            )}
          </>
        ) : (
          <>
            <div className="dropzone-icon">⬆️</div>
            <div className="dropzone-label">
              {uploading ? "업로드 중…" : "mp4 영상 업로드 (선택)"}
            </div>
            <div className="dropzone-hint">
              영상 메타 분석 · 렌더 명령용 · 없어도 편집 계획 미리보기 가능
            </div>
          </>
        )}
      </div>
      <input
        ref={videoInput}
        type="file"
        accept="video/mp4,video/*"
        className="hidden-input"
        onChange={(e) => e.target.files?.[0] && handleVideo(e.target.files[0])}
      />

      {/* transcript 업로드 */}
      <div style={{ marginTop: 12 }}>
        <div
          className={`dropzone ${segments.length ? "filled" : ""}`}
          onClick={() => transcriptInput.current?.click()}
        >
          {segments.length ? (
            <div className="dropzone-label">
              💬 자막 {segments.length}개 구간 로드됨
              <span className="dropzone-hint" style={{ display: "inline", marginLeft: 8 }}>
                (마지막 {formatDuration(segments[segments.length - 1].end)})
              </span>
            </div>
          ) : (
            <>
              <div className="dropzone-icon">📝</div>
              <div className="dropzone-label">transcript.json 업로드</div>
              <div className="dropzone-hint">
                [{"{ start, end, text }"}] 형식 · 직접 업로드
              </div>
            </>
          )}
        </div>
        <input
          ref={transcriptInput}
          type="file"
          accept="application/json,.json"
          className="hidden-input"
          onChange={(e) => e.target.files?.[0] && handleTranscript(e.target.files[0])}
        />

        {/* 🎙️ Whisper 자동 자막 */}
        <button
          className="btn btn-ghost"
          style={{ marginTop: 10 }}
          onClick={autoTranscribe}
          disabled={whisperDisabled}
          title={
            serverless
              ? "Vercel에서는 로컬/워커에서 실행 예정"
              : !whisperAvailable
                ? "이 서버에 Whisper 가 설치되어 있지 않습니다"
                : !savedPath
                  ? "먼저 영상을 업로드하세요"
                  : "Whisper 로 음성을 인식해 자막을 만듭니다"
          }
        >
          {transcribing ? "🎙️ 자막 인식 중…" : "🎙️ 영상에서 자동 자막 생성"}
        </button>

        <div className="dropzone-hint" style={{ textAlign: "center", marginTop: 6 }}>
          {serverless
            ? "Whisper 자동 자막은 로컬/워커에서 실행 예정"
            : !whisperAvailable
              ? "Whisper 미설치 — transcript.json 업로드 또는 샘플을 사용하세요"
              : whisperBackend
                ? `백엔드: ${whisperBackend} · 한국어(ko) 기본`
                : "영상 업로드 후 자동 자막 생성 가능"}
        </div>

        {/* ✂️ 무음 자동 컷 — Whisper 없이 컷만 뽑기(캡컷용) */}
        <button
          className="btn btn-primary"
          style={{ marginTop: 10, background: cutDisabled ? undefined : "#1b64da" }}
          onClick={autoCut}
          disabled={cutDisabled}
          title={
            serverless
              ? "무음 컷은 로컬(ffmpeg)에서만 동작"
              : !ffmpegAvailable
                ? "ffmpeg 가 설치되어 있지 않습니다"
                : !savedPath
                  ? "먼저 영상을 업로드하세요"
                  : "오디오 무음을 감지해 컷만 적용합니다(Whisper 불필요)"
          }
        >
          {cutting ? "✂️ 무음 감지 중…" : "✂️ 컷만 뽑기 (무음 자동 컷)"}
        </button>
        <div className="dropzone-hint" style={{ textAlign: "center", marginTop: 6 }}>
          {serverless
            ? "무음 컷은 로컬에서만 실행됩니다"
            : !ffmpegAvailable
              ? "ffmpeg 미설치 — 무음 컷 사용 불가"
              : !savedPath
                ? "영상 업로드 후 사용 가능 · Whisper 불필요"
                : "자막·효과 없이 무음만 제거 → 캡컷에 바로 넣기 좋아요"}
        </div>

        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={loadSample}>
          ⚡ 샘플로 편집 계획 생성
        </button>
        <div className="dropzone-hint" style={{ textAlign: "center", marginTop: 6 }}>
          영상 없이도 바로 편집 계획을 미리볼 수 있어요
        </div>

        {segments.length > 0 && (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 10 }}
            onClick={downloadTranscript}
          >
            ⬇️ transcript.json 다운로드
          </button>
        )}
      </div>

      {/* 자막 인식 진행 / 오류 안내 */}
      {transcribing && (
        <div className="notice">
          <b>🎙️ 음성 인식 중…</b> Whisper 로 오디오를 분석하고 있습니다. 긴 영상은 수 분
          이상 걸릴 수 있어요(모델 최초 실행 시 다운로드로 더 걸릴 수 있음).
        </div>
      )}
      {whisperMsg && (
        <div className="notice warn">
          {whisperMsg.text}
          {whisperMsg.hints && (
            <code>{whisperMsg.hints.map((h) => `• ${h}`).join("\n")}</code>
          )}
        </div>
      )}

      <div className="notice">
        mp4 만 업로드하면 <b>🎙️ 자동 자막</b>으로 transcript 를 만들고, 그 자막으로
        모든 편집(강조/스포트라이트/팝업/B-roll)이 자동 생성됩니다.
        {serverless
          ? " (Vercel에서는 Whisper 미실행 · 영상은 브라우저 분석)"
          : " transcript.json 직접 업로드도 가능합니다."}
      </div>
    </div>
  );
}

function MetaItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="meta-item">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

/** 브라우저 <video> 로 로컬에서 길이/해상도 추출 */
function readLocalVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        fileName: file.name,
        sizeBytes: file.size,
        durationSec: Math.round(v.duration * 100) / 100,
        width: v.videoWidth,
        height: v.videoHeight,
      });
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("영상 메타데이터를 읽을 수 없습니다"));
    };
    v.src = url;
  });
}

function formatDuration(sec: number): string {
  if (!sec) return "-";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}분 ${s}초`;
}

function formatSize(bytes: number): string {
  if (!bytes) return "-";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}
