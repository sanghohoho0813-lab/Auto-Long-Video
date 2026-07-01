"use client";

/**
 * 10. 적용된 편집 리스트
 *
 * 예: "12.3초~15.8초: 자막 강조", "31.0초~35.0초: B-roll 삽입"
 * 자막 이벤트는 강조 토큰을 실제 색상/크기로 미리보기한다.
 */

import type { EditEvent, EditPlan, EmphasisToken, SubtitlePayload } from "@/lib/types";
import { EVENT_META, formatTime } from "@/lib/eventMeta";

export default function EditList({ plan }: { plan: EditPlan }) {
  return (
    <div className="edit-list">
      {plan.events.map((e) => (
        <div key={e.id} className="edit-item">
          <span className="edit-time">
            {formatTime(e.start)} ~ {formatTime(e.end)}
          </span>
          <span
            className="edit-type-dot"
            style={{ background: EVENT_META[e.type].color }}
          />
          <span className="edit-label">{renderLabel(e, plan)}</span>
        </div>
      ))}
    </div>
  );
}

function renderLabel(e: EditEvent, plan: EditPlan): React.ReactNode {
  if (e.type === "subtitle") {
    const payload = e.payload as unknown as SubtitlePayload;
    return (
      <span className="sub-preview">
        <span style={{ color: "var(--text-mute)", marginRight: 6 }}>자막</span>
        {payload.tokens.map((t: EmphasisToken, i: number) =>
          t.emphasized ? (
            <span
              key={i}
              className="sub-em"
              style={{
                color: plan.settings.subtitle.emphasisColor,
                fontSize: `${plan.settings.subtitle.emphasisScale}em`,
              }}
            >
              {t.text}
            </span>
          ) : (
            <span key={i}>{t.text}</span>
          ),
        )}
      </span>
    );
  }
  return e.label;
}
