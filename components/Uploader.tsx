"use client";

/**
 * 1. 영상 업로드 + 3. transcript.json 업로드
 *
 * - mp4 를 서버에 업로드하고 메타데이터(길이/해상도/용량)를 받아온다.
 * - ffprobe 가 없으면 브라우저의 <video> 로 길이/해상도를 보완한다.
 * - transcript.json 을 읽어 파싱한다.
 */

import { useRef, useState } from "react";
import type { TranscriptSegment, VideoMeta } from "@/lib/types";
import { parseTranscript } from "@/lib/analysis/transcript";

interface Props {
  meta: VideoMeta | null;
  savedPath: string | null;
  segments: TranscriptSegment[];
  serverless: boolean;
  onVideo: (meta: VideoMeta, savedPath: string | null) => void;
  onTranscript: (segments: TranscriptSegment[]) => void;
  onToast: (msg: string) => void;
}

export default function Uploader({
  meta,
  savedPath,
  segments,
  serverless,
  onVideo,
  onTranscript,
  onToast,
}: Props) {
  const videoInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
                [{"{ start, end, text }"}] 형식 · Whisper 연동 전까지 직접 업로드
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
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={loadSample}>
          ⚡ 샘플로 편집 계획 생성
        </button>
        <div className="dropzone-hint" style={{ textAlign: "center", marginTop: 6 }}>
          영상 없이도 바로 편집 계획을 미리볼 수 있어요
        </div>
      </div>

      <div className="notice">
        Whisper 자동 자막은 3단계에서 붙습니다. 지금은 transcript.json 을 올리면
        모든 편집(자막/강조/스포트라이트/팝업/B-roll)이 자동 생성됩니다.
        {serverless && " (Vercel에서는 영상은 브라우저에서만 분석됩니다.)"}
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
