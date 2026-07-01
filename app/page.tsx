"use client";

/**
 * 김팀장의 롱폼 자동편집기 - 메인 페이지
 *
 * 전체 상태(영상 메타 / transcript / 설정 / B-roll)를 보관하고,
 * 이들이 바뀔 때마다 buildEditPlan 으로 편집 계획을 즉시 재생성한다.
 * 계획 생성은 순수 함수라 클라이언트에서 바로 실행된다.
 */

import { useEffect, useMemo, useState } from "react";
import type { EditSettings, TranscriptSegment, VideoMeta } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/config/presets";
import { buildEditPlan } from "@/lib/editing/planner";
import type { BrollAsset } from "@/lib/editing/broll";
import Uploader from "@/components/Uploader";
import SettingsPanel from "@/components/SettingsPanel";
import ResultsPanel from "@/components/ResultsPanel";

export default function Home() {
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [settings, setSettings] = useState<EditSettings>(DEFAULT_SETTINGS);
  const [broll, setBroll] = useState<BrollAsset[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // 서버의 B-roll 폴더 스캔 결과를 한 번 불러온다.
  useEffect(() => {
    fetch("/api/broll")
      .then((r) => r.json())
      .then((d) => setBroll(d.assets ?? []))
      .catch(() => setBroll([]));
  }, []);

  // 토스트 자동 사라짐
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // transcript 가 있을 때만 편집 계획 생성
  const plan = useMemo(() => {
    if (segments.length === 0) return null;
    return buildEditPlan({
      segments,
      settings,
      source: meta,
      availableBroll: broll,
      // 결정적 미리보기를 위해 고정 타임스탬프
      now: "preview",
    });
  }, [segments, settings, meta, broll]);

  return (
    <main className="page">
      <div className="header">
        <div className="logo">🎬</div>
        <div>
          <div className="title">김팀장의 롱폼 자동편집기</div>
        </div>
      </div>
      <div className="subtitle">
        정적인 강의/해설 영상을 컷 편집 · 자막 강조 · 줌 · 스포트라이트 · B-roll ·
        팝업까지 자동으로 세련되게.
      </div>

      <div className="grid">
        <Uploader
          meta={meta}
          savedPath={savedPath}
          segments={segments}
          onVideo={(m, p) => {
            setMeta(m);
            setSavedPath(p);
          }}
          onTranscript={setSegments}
          onToast={setToast}
        />
        <SettingsPanel settings={settings} onChange={setSettings} />
        <ResultsPanel plan={plan} savedPath={savedPath} onToast={setToast} />
      </div>

      {broll.length > 0 && (
        <div className="notice" style={{ maxWidth: 1120 }}>
          🎞 B-roll {broll.length}개 감지됨 · 카테고리별로 자동 매칭됩니다.
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
