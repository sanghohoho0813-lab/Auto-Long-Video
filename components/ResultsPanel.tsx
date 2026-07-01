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
  /** 영상 없이 transcript(샘플 포함)만으로 만든 계획인지 */
  sampleMode: boolean;
  onToast: (msg: string) => void;
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
  sampleMode,
  onToast,
}: Props) {
  const [rendering, setRendering] = useState(false);
  const [renderMsg, setRenderMsg] = useState<{ text: string; cmd?: string } | null>(null);

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

  async function render() {
    if (!plan) return;
    // 로컬에서 실제 렌더링은 서버 저장 원본이 필요하지만,
    // 서버리스에서는 명령어 안내만 받으므로 savedPath 없이도 호출한다.
    if (!serverless && !savedPath) {
      onToast("서버에 저장된 원본이 없어 렌더링할 수 없습니다");
      return;
    }
    setRendering(true);
    setRenderMsg(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, inputPath: savedPath ?? undefined }),
      });
      const data = await res.json();
      setRenderMsg({ text: data.message || "완료", cmd: data.command });
      if (data.outputPath) onToast(`렌더링 완료: ${data.outputPath}`);
      else onToast(data.message || "요청 처리됨");
    } catch (err) {
      setRenderMsg({ text: `요청 실패: ${(err as Error).message}` });
    } finally {
      setRendering(false);
    }
  }

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
            onClick={render}
            disabled={rendering || (!serverless && !savedPath)}
          >
            {rendering
              ? "처리 중…"
              : serverless
                ? "🧾 렌더 명령(ffmpeg) 생성"
                : "🎬 1080p 렌더링"}
          </button>
          <span className="cta-hint">
            {serverless
              ? "edit-plan 기반 명령 — 실제 렌더는 로컬/워커"
              : savedPath
                ? "서버 저장된 영상으로 렌더"
                : "영상 서버 저장이 필요"}
          </span>
        </div>
      </div>

      {serverless ? (
        <div className="notice warn">
          ☁️ Vercel 환경에서는 실제 영상 렌더링을 지원하지 않습니다. 위 버튼은
          로컬/워커에서 실행할 <b>ffmpeg 명령어</b>만 보여줍니다. edit-plan.json 을
          내려받아 로컬 ffmpeg 로 렌더링하세요.
        </div>
      ) : (
        !savedPath && (
          <div className="notice warn">
            렌더링은 서버에 저장된 원본이 필요합니다. (ffprobe/ffmpeg 미설치 환경에서는
            edit-plan.json 다운로드 후 별도 렌더 파이프라인에서 사용하세요.)
          </div>
        )
      )}

      {renderMsg && (
        <div className="notice">
          {renderMsg.text}
          {renderMsg.cmd && <code>{renderMsg.cmd}</code>}
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
