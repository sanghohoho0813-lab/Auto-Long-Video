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
}

const WORKFLOW: Array<{ n: number; text: string; optional?: boolean }> = [
  { n: 1, text: "mp4 영상 업로드", optional: true },
  { n: 2, text: "transcript.json 업로드 또는 “샘플로 편집 계획 생성”" },
  { n: 3, text: "편집 강도 프리셋 · 세부 설정 선택" },
  { n: 4, text: "편집 계획 자동 생성 (타임라인 · 편집 리스트 미리보기)" },
  { n: 5, text: "edit-plan.json 다운로드" },
  { n: 6, text: "로컬 ffmpeg 또는 별도 렌더 워커에서 실제 1080p 렌더링" },
];

const CAN: string[] = [
  "transcript 기반 편집 계획 생성",
  "핵심 키워드 강조 이벤트 생성",
  "줌 · 스포트라이트 · 팝업 · B-roll 후보 생성",
  "edit-plan.json 다운로드",
];

const CANNOT: Array<{ text: string; plan: string }> = [
  { text: "실제 ffmpeg 렌더링", plan: "2단계에서 로컬 렌더러/워커로 연결 예정" },
  { text: "Whisper 자동 자막 생성", plan: "2단계에서 whisper.cpp/faster-whisper 연동 예정" },
  { text: "서버에 B-roll 파일 영구 저장", plan: "2단계에서 로컬/워커 스토리지로 연결 예정" },
];

export default function HelpPanel({ serverless }: Props) {
  return (
    <div className="card full-span">
      <div className="card-head">
        <span className="card-step">?</span>
        <span className="card-title">사용 방법 &amp; 환경 안내</span>
      </div>

      {/* 워크플로우 */}
      <div className="help-subtitle">예시 워크플로우</div>
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
            {CAN.map((c) => (
              <li key={c} className="check ok">
                <span className="check-mark">✓</span>
                {c}
              </li>
            ))}
          </ul>
        </div>

        <div className="help-col">
          <div className="help-subtitle">
            ⛔ {serverless ? "Vercel에서 제한되는 기능" : "이 단계에서 제한되는 기능"}
          </div>
          <ul className="check-list">
            {CANNOT.map((c) => (
              <li key={c.text} className="check no">
                <span className="check-mark">–</span>
                <span>
                  {c.text}
                  <span className="check-plan">{c.plan}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
