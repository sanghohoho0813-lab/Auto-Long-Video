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
  onToast: (msg: string) => void;
}

export default function ResultsPanel({ plan, savedPath, onToast }: Props) {
  const [rendering, setRendering] = useState(false);
  const [renderMsg, setRenderMsg] = useState<{ text: string; cmd?: string } | null>(null);

  if (!plan) {
    return (
      <div className="card full-span">
        <div className="empty">
          <div className="empty-emoji">🎬</div>
          <div>영상과 transcript.json 을 올리면 편집 계획이 여기에 생성됩니다.</div>
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
    if (!savedPath) {
      onToast("서버에 저장된 원본이 없어 렌더링할 수 없습니다");
      return;
    }
    setRendering(true);
    setRenderMsg(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, inputPath: savedPath }),
      });
      const data = await res.json();
      setRenderMsg({ text: data.message || "완료", cmd: data.command });
      if (data.outputPath) onToast(`렌더링 완료: ${data.outputPath}`);
      else onToast(data.message || "렌더링 요청 처리됨");
    } catch (err) {
      setRenderMsg({ text: `렌더링 실패: ${(err as Error).message}` });
    } finally {
      setRendering(false);
    }
  }

  const s = plan.stats;

  return (
    <div className="card full-span">
      <div className="card-head">
        <span className="card-step">3</span>
        <span className="card-title">편집 결과 미리보기</span>
      </div>

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

      {/* 최종 출력 */}
      <div className="btn-row">
        <button className="btn btn-ghost" onClick={downloadPlan}>
          ⬇️ edit-plan.json 다운로드
        </button>
        <button
          className="btn btn-primary"
          onClick={render}
          disabled={rendering || !savedPath}
        >
          {rendering ? "렌더링 중…" : "🎬 1080p 렌더링"}
        </button>
      </div>

      {!savedPath && (
        <div className="notice warn">
          렌더링은 서버에 저장된 원본이 필요합니다. (ffprobe/ffmpeg 미설치 환경에서는
          edit-plan.json 다운로드 후 별도 렌더 파이프라인에서 사용하세요.)
        </div>
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
