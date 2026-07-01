"use client";

/**
 * 테스트 리포트 + 효과 과다 경고
 *
 * edit-plan 요약(길이·효과 수·분당 효과 수)과 롱폼 기준 판정(적절/다소 많음/매우 많음)을
 * 보여주고, 임계값을 넘으면 경고를 표시한다.
 */

import type { EditPlan } from "@/lib/types";
import { buildReport, type Verdict } from "@/lib/analysis/report";

const VERDICT_CLASS: Record<Verdict, string> = {
  good: "verdict-good",
  many: "verdict-many",
  too_many: "verdict-too",
};

const VERDICT_EMOJI: Record<Verdict, string> = {
  good: "✅",
  many: "⚠️",
  too_many: "🚨",
};

export default function TestReport({ plan }: { plan: EditPlan }) {
  const r = buildReport(plan);
  const c = r.counts;

  return (
    <div className="report">
      <div className="report-head">
        <span className="report-title">🧪 테스트 리포트</span>
        <span className={`verdict ${VERDICT_CLASS[r.verdict]}`}>
          {VERDICT_EMOJI[r.verdict]} {r.verdictLabel}
        </span>
      </div>

      <div className="report-grid">
        <Item k="총 길이" v={fmtDur(r.durationSec)} />
        <Item k="자막 구간" v={`${c.subtitle}개`} />
        <Item k="컷" v={`${c.cut}개`} />
        <Item k="줌" v={`${c.zoom}개`} />
        <Item k="스포트라이트" v={`${c.spotlight}개`} />
        <Item k="B-roll" v={`${c.broll}개`} />
        <Item k="팝업" v={`${c.popup}개`} />
        <Item k="분당 효과" v={`${perMinTotal(r)}개/분`} />
      </div>

      {/* 분당 상세(임계 초과는 강조) */}
      <div className="permin-row">
        <PerMin label="B-roll" value={r.perMinute.broll} over={isOver(r, "broll")} />
        <PerMin label="팝업" value={r.perMinute.popup} over={isOver(r, "popup")} />
        <PerMin label="스포트" value={r.perMinute.spotlight} over={isOver(r, "spotlight")} />
        <PerMin label="줌" value={r.perMinute.zoom} over={isOver(r, "zoom")} />
      </div>

      {r.warnings.length > 0 && (
        <div className="notice warn" style={{ marginTop: 12 }}>
          {r.warnings.map((w, i) => (
            <div key={i} style={{ marginTop: i ? 4 : 0 }}>
              {i < r.warnings.length - 1 ? "• " : ""}
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="report-item">
      <div className="rk">{k}</div>
      <div className="rv">{v}</div>
    </div>
  );
}

function PerMin({ label, value, over }: { label: string; value: number; over: boolean }) {
  return (
    <span className={`permin ${over ? "over" : ""}`}>
      {label} <b>{value}</b>/분
    </span>
  );
}

function isOver(r: ReturnType<typeof buildReport>, key: string): boolean {
  return r.exceeded.some((e) => e.key === key);
}

function perMinTotal(r: ReturnType<typeof buildReport>): number {
  const p = r.perMinute;
  return Math.round((p.broll + p.popup + p.spotlight + p.zoom + p.subtitle) * 10) / 10;
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
