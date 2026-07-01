"use client";

/**
 * 10~11. 결과 미리보기 + 최종 출력
 *
 * - 편집 요약 통계 (전/후 길이, 이벤트 수)
 * - 타입 범례
 * - 타임라인
 * - 적용된 편집 리스트
 * - edit-plan.json 다운로드
 * - ffmpeg 렌더 요청 (MVP: 명령어 확인 / 실제 렌더)
 */

import { useState } from "react";
import type { EditPlan } from "@/lib/types";
import { EVENT_META, EVENT_ORDER } from "@/lib/eventMeta";
import Timeline from "./Timeline";
import EditList from "./EditList";

interface Props {
  plan: EditPlan | null;
  savedPath: string | null;
  serverless: boolean;
  /** 로컬 환경에서 ffmpeg 설치 여부 */
  ffmpegAvailable: boolean;
  /** 영상 없이 transcript(샘플 포함)만으로 만든 계획인지 */
  sampleMode: boolean;
  onToast: (msg: string) => void;
}

interface RenderState {
  status: "idle" | "running" | "done" | "error";
  message?: string;
  command?: string;
  applied?: string[];
  downloadUrl?: string;
  outputPath?: string;
}

const EMPTY_STEPS = [
  "왼쪽에서 transcript.json 업로드 또는 “샘플로 편집 계획 생성” 클릭",
  "가운데에서 편집 강도 프리셋 · 세부 설정 선택",
  "여기에 편집 계획(타임라인 · 편집 리스트)이 자동 생성",
  "edit-plan.json 다운로드 → 로컬/워커에서 실제 렌더링",
];

export default function ResultsPanel({
  plan,
  savedPath,
  serverless,
  ffmpegAvailable,
  sampleMode,
  onToast,
}: Props) {
  const [render, setRender] = useState<RenderState>({ status: "idle" });

  if (!plan) {
    return (
      <div className="card full-span" id="results">
        <div className="card-head">
          <span className="card-step">3</span>
          <span className="card-title">편집 결과 미리보기</span>
        </div>
        <div className="empty">
          <div className="empty-emoji">🎬</div>
          <div style={{ marginBottom: 16, fontWeight: 600 }}>
            아직 편집 계획이 없습니다. 영상 없이 <b>transcript 만으로도</b> 바로
            미리볼 수 있어요.
          </div>
          <ol className="workflow" style={{ maxWidth: 520, margin: "0 auto", textAlign: "left" }}>
            {EMPTY_STEPS.map((t, i) => (
              <li key={i} className="workflow-step">
                <span className="workflow-num">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  function downloadPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "edit-plan.json";
    a.click();
    URL.revokeObjectURL(url);
    onToast("edit-plan.json 다운로드 완료");
  }

  async function runRender() {
    if (!plan) return;
    // 로컬 실제 렌더링은 서버 저장 원본이 필요. 서버리스는 명령어만 받으므로 savedPath 불필요.
    if (!serverless && !savedPath) {
      onToast("서버에 저장된 원본이 없어 렌더링할 수 없습니다");
      return;
    }
    setRender({ status: "running" });
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, inputPath: savedPath ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "렌더링 요청 실패");
      setRender({
        status: data.rendered ? "done" : "error",
        message: data.message,
        command: data.command,
        applied: data.applied,
        downloadUrl: data.downloadUrl,
        outputPath: data.outputPath,
      });
      onToast(data.rendered ? "렌더링 완료 🎉" : data.message || "요청 처리됨");
    } catch (err) {
      setRender({ status: "error", message: `요청 실패: ${(err as Error).message}` });
    }
  }

  const rendering = render.status === "running";
  // 로컬인데 ffmpeg 미설치 → 실제 렌더 불가(명령/다운로드만 안내)
  const canRenderLocally = !serverless && ffmpegAvailable;
  const s = plan.stats;

  return (
    <div className="card full-span" id="results">
      <div className="card-head">
        <span className="card-step">3</span>
        <span className="card-title">편집 결과 미리보기</span>
        {sampleMode && <span className="sample-badge">🧪 샘플 모드 · 영상 메타 없음</span>}
      </div>

      {sampleMode && (
        <div className="notice" style={{ marginTop: -4, marginBottom: 14 }}>
          영상 없이 transcript 만으로 만든 미리보기입니다. 길이·해상도 등 영상 메타는
          비어 있으며, 실제 영상 기반 메타 분석과 렌더 명령을 쓰려면 왼쪽에서 mp4 를
          업로드하세요.
        </div>
      )}

      {/* 요약 통계 */}
      <div className="stat-row">
        <Stat num={s.totalEvents} lbl="편집 이벤트" />
        <Stat num={fmtDur(s.originalDurationSec)} lbl="원본 길이" />
        <Stat num={fmtDur(s.estimatedOutputDurationSec)} lbl="예상 결과 길이" />
        <Stat num={`-${fmtDur(s.cutDurationSec)}`} lbl="컷으로 제거" />
      </div>

      {/* 범례 */}
      <div className="type-legend">
        {EVENT_ORDER.map((t) => (
          <span className="badge" key={t}>
            <span className="dot" style={{ background: EVENT_META[t].color }} />
            {EVENT_META[t].label} {s.byType[t]}
          </span>
        ))}
      </div>

      {/* 타임라인 */}
      <Timeline plan={plan} />

      {/* 적용된 편집 리스트 */}
      <div style={{ marginTop: 20, fontWeight: 700, fontSize: 14 }}>
        적용된 편집 ({plan.events.length})
      </div>
      <EditList plan={plan} />

      {/* 최종 출력 — CTA 구분:
          · 다운로드: transcript(샘플)만 있어도 항상 가능
          · 렌더/명령: 영상(로컬 저장) 또는 서버리스 명령 생성 */}
      <div className="btn-row">
        <div className="cta">
          <button className="btn btn-ghost" onClick={downloadPlan}>
            ⬇️ edit-plan.json 다운로드
          </button>
          <span className="cta-hint">transcript만 있어도 가능</span>
        </div>
        <div className="cta">
          <button
            className="btn btn-primary"
            onClick={runRender}
            disabled={rendering || (!serverless && !savedPath)}
          >
            {rendering
              ? "⏳ 렌더링 중…"
              : serverless
                ? "🧾 ffmpeg 명령 보기"
                : canRenderLocally
                  ? "🎬 실제 렌더링 시작"
                  : "🧾 ffmpeg 명령 보기"}
          </button>
          <span className="cta-hint">
            {serverless
              ? "edit-plan 기반 명령 — 실제 렌더는 로컬/워커"
              : !savedPath
                ? "영상 서버 저장이 필요"
                : canRenderLocally
                  ? "1080p mp4 로 실제 렌더링"
                  : "ffmpeg 미설치 — 명령만 확인"}
          </span>
        </div>
      </div>

      {/* 렌더링 진행 중 안내 */}
      {rendering && (
        <div className="notice">
          <b>⏳ 렌더링 중…</b> ffmpeg 로 1080p mp4 를 생성하고 있습니다. 긴 영상은 수 분
          이상 걸릴 수 있어요. 창을 닫지 말고 잠시 기다려 주세요.
        </div>
      )}

      {/* 환경/상태별 안내 */}
      {serverless ? (
        <div className="notice warn">
          ☁️ Vercel 환경에서는 실제 영상 렌더링을 지원하지 않습니다. 버튼은 로컬/워커에서
          실행할 <b>ffmpeg 명령어</b>만 보여줍니다. edit-plan.json 을 내려받아 로컬
          ffmpeg 로 렌더링하세요.
        </div>
      ) : !ffmpegAvailable ? (
        <div className="notice warn">
          🛠 이 서버에 <b>ffmpeg 가 설치되어 있지 않습니다.</b> 실제 렌더링 대신
          명령어만 확인할 수 있어요. <code style={{ display: "inline", padding: "2px 6px" }}>brew install ffmpeg</code>{" "}
          또는 <code style={{ display: "inline", padding: "2px 6px" }}>apt install ffmpeg</code> 설치 후 다시 시도하세요.
        </div>
      ) : (
        !savedPath && (
          <div className="notice warn">
            실제 렌더링은 서버에 저장된 원본이 필요합니다. 왼쪽에서 mp4 를 업로드하세요.
          </div>
        )
      )}

      {/* 렌더 결과 */}
      {render.status === "done" && (
        <div className="notice ok">
          <b>✅ {render.message || "렌더링 완료"}</b>
          {render.applied && render.applied.length > 0 && (
            <div style={{ marginTop: 6, color: "var(--text-sub)" }}>
              적용: {render.applied.join(" · ")}
            </div>
          )}
          {render.downloadUrl && (
            <a
              className="btn btn-primary"
              style={{ marginTop: 12, textDecoration: "none" }}
              href={render.downloadUrl}
            >
              ⬇️ 결과 mp4 다운로드
            </a>
          )}
        </div>
      )}

      {render.status === "error" && (
        <div className="notice warn">
          <b>{render.message || "요청 처리됨"}</b>
          {render.command && <code>{render.command}</code>}
        </div>
      )}
    </div>
  );
}

function Stat({ num, lbl }: { num: string | number; lbl: string }) {
  return (
    <div className="stat">
      <div className="num">{num}</div>
      <div className="lbl">{lbl}</div>
    </div>
  );
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
