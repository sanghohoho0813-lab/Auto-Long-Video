"use client";

/**
 * 도움말 / 배포 환경 안내 패널
 *
 * - 예시 워크플로우 6단계
 * - 현재(Vercel) 환경에서 "가능한 기능"과 "제한되는 기능"을 체크리스트로 표시
 *
 * 처음 들어온 사용자가 "무엇을, 어떤 순서로" 해야 하는지 한눈에 파악하게 한다.
 */

interface Props {
  serverless: boolean;
  ffmpegAvailable: boolean;
  whisperAvailable: boolean;
}

const WORKFLOW: Array<{ n: number; text: string; optional?: boolean }> = [
  { n: 1, text: "mp4 영상 업로드", optional: true },
  { n: 2, text: "🎬 무음 자르고 CapCut에서 열기 — 렌더링 없이 바로 이어 편집(로컬)" },
  { n: 3, text: "🎙️ 영상에서 자동 자막 생성(로컬) · transcript.json 업로드 · 샘플" },
  { n: 4, text: "편집 강도 프리셋 · 세부 설정 선택" },
  { n: 5, text: "편집 계획 자동 생성 (타임라인 · 편집 리스트 미리보기)" },
  { n: 6, text: "edit-plan.json 다운로드 · 로컬 ffmpeg 로 실제 1080p 렌더링" },
];

const CAN_BASE: string[] = [
  "transcript 기반 편집 계획 생성",
  "핵심 키워드 강조 이벤트 생성",
  "줌 · 스포트라이트 · 팝업 · B-roll 후보 생성",
  "edit-plan.json 다운로드",
];

const BETA_STEPS: string[] = [
  "mp4 업로드",
  "🎙️ 자동 자막 생성 (또는 transcript.json 업로드)",
  "edit-plan 확인 (타임라인 · 편집 리스트)",
  "효과 빈도 확인 (테스트 리포트 · 과다 경고)",
  "1~2분 구간만 먼저 “테스트 구간 렌더”",
  "결과 확인 후 “전체 렌더링”",
];

export default function HelpPanel({ serverless, ffmpegAvailable, whisperAvailable }: Props) {
  // 로컬에서 실제 사용 가능한 기능을 동적으로 구성
  const can = [...CAN_BASE];
  const cannot: Array<{ text: string; plan: string }> = [];

  if (serverless) {
    cannot.push(
      { text: "실제 ffmpeg 렌더링", plan: "로컬 ffmpeg 또는 별도 렌더 워커에서 실행" },
      { text: "Whisper 자동 자막 생성", plan: "로컬 또는 별도 워커에서 실행" },
      { text: "서버에 B-roll 파일 영구 저장", plan: "로컬/워커 스토리지에서 사용" },
    );
  } else {
    // 로컬: 설치 여부에 따라 가능/제한 배치
    if (ffmpegAvailable)
      can.push("🎬 무음 자르고 CapCut 프로젝트로 바로 열기(렌더링 없이 이어 편집)");
    if (ffmpegAvailable) can.push("실제 1080p ffmpeg 렌더링 + 결과 mp4 다운로드");
    else cannot.push({ text: "실제 ffmpeg 렌더링", plan: "ffmpeg 설치 후 사용 가능(명령은 확인 가능)" });

    if (whisperAvailable) can.push("🎙️ Whisper 자동 자막(음성 인식 → transcript)");
    else
      cannot.push({
        text: "Whisper 자동 자막 생성",
        plan: "whisper-ctranslate2 / openai-whisper 설치 후 사용",
      });
  }

  return (
    <div className="card full-span">
      <div className="card-head">
        <span className="card-step">?</span>
        <span className="card-title">사용 방법 &amp; 환경 안내</span>
      </div>

      {/* 실제 영상 베타 테스트 순서 */}
      <div className="help-subtitle">🧪 실제 영상 베타 테스트 순서</div>
      <ol className="beta-steps">
        {BETA_STEPS.map((t, i) => (
          <li key={i} className="beta-step">
            <span className="beta-check" />
            <span>
              <b>{i + 1}.</b> {t}
            </span>
          </li>
        ))}
      </ol>
      <div className="notice warn" style={{ marginTop: 12 }}>
        ⏱ 처음부터 전체 20~40분 영상을 렌더링하지 마세요. <b>짧은 구간(1~2분) 테스트</b>로
        효과가 과하지 않은지 먼저 확인한 뒤 전체 렌더링을 진행하세요.
      </div>

      {/* 워크플로우 */}
      <div className="help-subtitle" style={{ marginTop: 20 }}>
        예시 워크플로우
      </div>
      <ol className="workflow">
        {WORKFLOW.map((w) => (
          <li key={w.n} className="workflow-step">
            <span className="workflow-num">{w.n}</span>
            <span>
              {w.text}
              {w.optional && <span className="chip-optional">선택</span>}
            </span>
          </li>
        ))}
      </ol>

      {/* 가능 / 제한 기능 */}
      <div className="help-cols">
        <div className="help-col">
          <div className="help-subtitle">
            ✅ {serverless ? "Vercel에서 가능한 기능" : "지금 가능한 기능"}
          </div>
          <ul className="check-list">
            {can.map((c) => (
              <li key={c} className="check ok">
                <span className="check-mark">✓</span>
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div className="help-col">
          <div className="help-subtitle">
            ⛔ {serverless ? "Vercel에서 제한되는 기능" : "설치하면 켜지는 기능"}
          </div>
          <ul className="check-list">
            {cannot.length === 0 ? (
              <li className="check ok">
                <span className="check-mark">✓</span>
                모든 기능 사용 가능(로컬 · ffmpeg · Whisper 설치됨)
              </li>
            ) : (
              cannot.map((c) => (
                <li key={c.text} className="check no">
                  <span className="check-mark">–</span>
                  <span>
                    {c.text}
                    <span className="check-plan">{c.plan}</span>
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
