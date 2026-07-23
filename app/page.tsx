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
import type { RuntimeInfo } from "@/lib/env";
import { DEFAULT_SETTINGS, cutsOnlySettings } from "@/lib/config/presets";
import { buildEditPlan } from "@/lib/editing/planner";
import type { BrollAsset } from "@/lib/editing/broll";
import Uploader from "@/components/Uploader";
import SettingsPanel from "@/components/SettingsPanel";
import ResultsPanel from "@/components/ResultsPanel";
import HelpPanel from "@/components/HelpPanel";

interface RuntimeState extends RuntimeInfo {
  ffmpeg: boolean;
  ffprobe: boolean;
  whisper: boolean;
  whisperBackend: string | null;
}

export default function Home() {
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [settings, setSettings] = useState<EditSettings>(DEFAULT_SETTINGS);
  const [broll, setBroll] = useState<BrollAsset[]>([]);
  const [env, setEnv] = useState<RuntimeState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 런타임 환경(로컬/서버리스) 확인 → UI 활성/비활성 결정
  useEffect(() => {
    fetch("/api/env")
      .then((r) => r.json())
      .then((d: RuntimeState) => setEnv(d))
      .catch(() => setEnv(null));
  }, []);

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

  // 영상 없이 transcript(샘플 포함)만으로 만든 계획인지
  const sampleMode = segments.length > 0 && !meta;

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

      {env?.serverless && (
        <div className="notice" style={{ maxWidth: 1120, marginBottom: 16 }}>
          ☁️ <b>Vercel 배포 환경</b>입니다. 편집 계획 생성 · 미리보기 ·
          <b> edit-plan.json 다운로드</b>는 정상 동작하며, 실제 영상 렌더링은
          로컬 ffmpeg 또는 별도 렌더 워커에서 실행하세요.
        </div>
      )}

      <div className="grid">
        <Uploader
          meta={meta}
          savedPath={savedPath}
          segments={segments}
          serverless={env?.serverless ?? false}
          whisperAvailable={env?.whisper ?? false}
          whisperBackend={env?.whisperBackend ?? null}
          ffmpegAvailable={env?.ffmpeg ?? false}
          cutSettings={settings.cut}
          onVideo={(m, p) => {
            setMeta(m);
            setSavedPath(p);
          }}
          onTranscript={setSegments}
          onCutsOnly={(segs, cutParams) => {
            // 무음 감지 결과(speech 구간)를 세그먼트로 넣고 "컷만" 설정으로 전환.
            // 감지에 실제로 쓰인 기준(임계값/최소 무음 길이)을 편집 계획에도 그대로 반영해야
            // findGaps 가 감지된 무음을 동일하게 컷으로 만든다.
            setSegments(segs);
            setSettings((prev) => {
              const co = cutsOnlySettings(prev);
              // 감지에 쓰인 임계값/최소무음/여유(패딩)를 편집 계획에 그대로 반영
              return { ...co, cut: { ...co.cut, ...cutParams } };
            });
          }}
          onToast={setToast}
        />
        <SettingsPanel settings={settings} onChange={setSettings} />
        <ResultsPanel
          plan={plan}
          savedPath={savedPath}
          serverless={env?.serverless ?? false}
          ffmpegAvailable={env?.ffmpeg ?? false}
          whisperAvailable={env?.whisper ?? false}
          hasVideo={!!savedPath}
          sampleMode={sampleMode}
          onToast={setToast}
        />
      </div>

      {broll.length > 0 && (
        <div className="notice" style={{ maxWidth: 1120, marginTop: 16 }}>
          🎞 B-roll {broll.length}개 감지됨 · 카테고리별로 자동 매칭됩니다.
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <HelpPanel
          serverless={env?.serverless ?? false}
          ffmpegAvailable={env?.ffmpeg ?? false}
          whisperAvailable={env?.whisper ?? false}
        />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
