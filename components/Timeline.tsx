"use client";

/**
 * 10. 결과 미리보기 - 편집 타임라인
 *
 * 이벤트 타입별로 트랙을 나눠, 전체 영상 길이 대비 각 편집이
 * 어디에 위치하는지 시각적으로 보여준다.
 */

import type { EditPlan } from "@/lib/types";
import { EVENT_META, EVENT_ORDER } from "@/lib/eventMeta";

export default function Timeline({ plan }: { plan: EditPlan }) {
  const total = Math.max(plan.stats.originalDurationSec, 1);

  return (
    <div className="timeline">
      {EVENT_ORDER.map((type) => {
        const events = plan.events.filter((e) => e.type === type);
        const meta = EVENT_META[type];
        return (
          <div key={type} style={{ marginBottom: 10 }}>
            <div className="timeline-row-label">
              <span className="edit-type-dot" style={{ background: meta.color }} />
              {meta.emoji} {meta.label}
              <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>
                {events.length}개
              </span>
            </div>
            <div className="timeline-track">
              {events.map((e) => {
                const left = (e.start / total) * 100;
                const width = Math.max(((e.end - e.start) / total) * 100, 0.4);
                return (
                  <div
                    key={e.id}
                    className="timeline-seg"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: meta.color,
                    }}
                    title={e.label}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="timeline-axis">
        <span>0:00</span>
        <span>{fmt(total / 2)}</span>
        <span>{fmt(total)}</span>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
