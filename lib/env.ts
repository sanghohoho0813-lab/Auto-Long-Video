/**
 * 실행 환경 구분 유틸 (단일 판단 지점)
 *
 * Vercel 같은 서버리스 환경에서는
 *  - 로컬 파일 시스템 영구 저장이 불가능하고(/tmp 외 읽기 전용)
 *  - ffmpeg / whisper 같은 장시간 · 외부 바이너리 실행이 제한된다.
 *
 * 따라서 파일 쓰기 / 렌더링 코드는 이 플래그로 분기해서
 * 서버리스에서는 "안내 + 명령어 반환"만 하도록 만든다.
 *
 * ⚠️ 환경 판단은 반드시 이 파일의 isServerless() 한 곳에서만 한다.
 *    (VERCEL / VERCEL_ENV / NEXT_RUNTIME 등을 여기저기서 섞어 쓰지 않는다.)
 */

/**
 * 서버리스(Vercel 등) 환경인지 여부 — 유일한 판단 함수.
 *
 * - Vercel 은 빌드/런타임에서 VERCEL="1" 을 설정한다.
 * - 다른 서버리스 플랫폼은 SERVERLESS="1" 로 명시적으로 강제할 수 있다.
 */
export function isServerless(): boolean {
  return process.env.VERCEL === "1" || process.env.SERVERLESS === "1";
}

/** 로컬 개발/자체 호스팅 환경인지 여부 */
export function isLocalRuntime(): boolean {
  return !isServerless();
}

/** UI/응답에 내려줄 환경 요약 */
export interface RuntimeInfo {
  serverless: boolean;
  /** 서버 파일 저장(업로드 영구 보관) 가능 여부 */
  canPersistFiles: boolean;
  /** 서버에서 실제 ffmpeg 렌더링 시도 가능 여부 */
  canRender: boolean;
  platform: "vercel" | "local";
}

export function getRuntimeInfo(): RuntimeInfo {
  const serverless = isServerless();
  return {
    serverless,
    canPersistFiles: !serverless,
    canRender: !serverless,
    platform: serverless ? "vercel" : "local",
  };
}

/**
 * 디버그용 환경 스냅샷.
 * /api/env 가 그대로 내려주어 로컬/배포에서 감지가 맞는지 눈으로 확인할 수 있게 한다.
 * timestamp 가 매 요청 바뀌면 응답이 정적으로 박제되지 않았다는 증거도 된다.
 */
export interface RuntimeDebug extends RuntimeInfo {
  isServerless: boolean;
  nodeEnv: string | undefined;
  vercel: string | undefined;
  vercelEnv: string | undefined;
  nextRuntime: string | undefined;
  timestamp: string;
}

export function getRuntimeDebug(): RuntimeDebug {
  return {
    ...getRuntimeInfo(),
    isServerless: isServerless(),
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    nextRuntime: process.env.NEXT_RUNTIME,
    timestamp: new Date().toISOString(),
  };
}
