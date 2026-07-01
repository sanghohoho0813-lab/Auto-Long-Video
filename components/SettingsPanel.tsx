"use client";

/**
 * 편집 설정 패널
 *
 * 9. 프리셋 선택 + 각 편집 모듈의 세부 파라미터 조정.
 * 프리셋을 바꾸면 세부값이 프리셋 기본값으로 리셋되고,
 * 이후 개별 값은 자유롭게 조정할 수 있다.
 */

import type { EditSettings, PresetName } from "@/lib/types";
import { PRESET_LABELS, PRESET_DESCRIPTIONS, buildSettings } from "@/lib/config/presets";

interface Props {
  settings: EditSettings;
  onChange: (s: EditSettings) => void;
}

const PRESET_EMOJI: Record<PresetName, string> = {
  kim: "🧑‍💼",
  calm: "🌿",
  default: "⚖️",
  vivid: "🔥",
};

export default function SettingsPanel({ settings, onChange }: Props) {
  function setPreset(preset: PresetName) {
    onChange(buildSettings(preset));
  }

  // 중첩 필드 업데이트 헬퍼
  function update<K extends keyof EditSettings>(
    section: K,
    patch: Partial<EditSettings[K]>,
  ) {
    const current = settings[section] as object;
    onChange({ ...settings, [section]: { ...current, ...patch } });
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-step">2</span>
        <span className="card-title">편집 설정</span>
      </div>

      {/* 프리셋 */}
      <div className="preset-row">
        {(Object.keys(PRESET_LABELS) as PresetName[]).map((p) => (
          <button
            key={p}
            className={`preset ${settings.preset === p ? "active" : ""}`}
            onClick={() => setPreset(p)}
            title={PRESET_DESCRIPTIONS[p]}
          >
            <div className="preset-emoji">{PRESET_EMOJI[p]}</div>
            <div className="preset-name">{PRESET_LABELS[p]}</div>
          </button>
        ))}
      </div>
      <div className="card-desc">{PRESET_DESCRIPTIONS[settings.preset]}</div>

      {/* 2. 컷 편집 */}
      <Group
        title="✂️ 자동 컷 편집"
        enabled={settings.cut.enabled}
        onToggle={(v) => update("cut", { enabled: v })}
      >
        <NumField
          label="무음 임계값 (dB)"
          value={settings.cut.silenceThreshold}
          step={1}
          onChange={(v) => update("cut", { silenceThreshold: v })}
        />
        <NumField
          label="최소 무음 길이 (초)"
          value={settings.cut.minSilenceDuration}
          step={0.1}
          onChange={(v) => update("cut", { minSilenceDuration: v })}
        />
        <NumField
          label="앞 여유 (초)"
          value={settings.cut.paddingBefore}
          step={0.05}
          onChange={(v) => update("cut", { paddingBefore: v })}
        />
        <NumField
          label="뒤 여유 (초)"
          value={settings.cut.paddingAfter}
          step={0.05}
          onChange={(v) => update("cut", { paddingAfter: v })}
        />
      </Group>

      {/* 5. 줌 */}
      <Group
        title="🔍 자동 줌"
        enabled={settings.zoom.enabled}
        onToggle={(v) => update("zoom", { enabled: v })}
      >
        <NumField
          label="줌 간격 (초)"
          value={settings.zoom.intervalSec}
          step={1}
          onChange={(v) => update("zoom", { intervalSec: v })}
        />
        <NumField
          label="줌 배율"
          value={settings.zoom.zoomScale}
          step={0.01}
          onChange={(v) => update("zoom", { zoomScale: v })}
        />
        <NumField
          label="줌 지속 (초)"
          value={settings.zoom.durationSec}
          step={0.5}
          onChange={(v) => update("zoom", { durationSec: v })}
        />
      </Group>

      {/* 6. 스포트라이트 */}
      <Group
        title="🔦 스포트라이트"
        enabled={settings.spotlight.enabled}
        onToggle={(v) => update("spotlight", { enabled: v })}
      >
        <NumField
          label="어둡기 (0~1)"
          value={settings.spotlight.darkenAmount}
          step={0.05}
          onChange={(v) => update("spotlight", { darkenAmount: v })}
        />
        <NumField
          label="지속 (초)"
          value={settings.spotlight.durationSec}
          step={0.5}
          onChange={(v) => update("spotlight", { durationSec: v })}
        />
      </Group>

      {/* 7. B-roll */}
      <Group
        title="🎬 B-roll 삽입"
        enabled={settings.broll.enabled}
        onToggle={(v) => update("broll", { enabled: v })}
      >
        <NumField
          label="삽입 간격 (초)"
          value={settings.broll.intervalSec}
          step={1}
          onChange={(v) => update("broll", { intervalSec: v })}
        />
        <NumField
          label="클립 길이 (초)"
          value={settings.broll.clipDurationSec}
          step={0.5}
          onChange={(v) => update("broll", { clipDurationSec: v })}
        />
      </Group>

      {/* 8. 팝업 */}
      <Group
        title="💡 팝업 텍스트"
        enabled={settings.popup.enabled}
        onToggle={(v) => update("popup", { enabled: v })}
      >
        <NumField
          label="최소 간격 (초)"
          value={settings.popup.minGapSec}
          step={1}
          onChange={(v) => update("popup", { minGapSec: v })}
        />
      </Group>

      {/* 4. 자막 강조 */}
      <Group
        title="💬 자막 강조"
        enabled={settings.subtitle.enabled}
        onToggle={(v) => update("subtitle", { enabled: v })}
      >
        <div className="field">
          <label>강조 색상</label>
          <input
            type="color"
            value={settings.subtitle.emphasisColor}
            onChange={(e) => update("subtitle", { emphasisColor: e.target.value })}
          />
        </div>
        <NumField
          label="강조 크기 배율"
          value={settings.subtitle.emphasisScale}
          step={0.05}
          onChange={(v) => update("subtitle", { emphasisScale: v })}
        />
      </Group>
    </div>
  );
}

function Group({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="field-group">
      <div className="field-group-title">
        <span>{title}</span>
        <button
          className={`switch ${enabled ? "on" : ""}`}
          onClick={() => onToggle(!enabled)}
          aria-label="toggle"
        />
      </div>
      {enabled && children}
    </div>
  );
}

function NumField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}
