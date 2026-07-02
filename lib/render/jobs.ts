/**
 * 렌더 잡(Job) 상태 저장소 (로컬 전용, 인메모리)
 *
 * ffmpeg 렌더는 오래 걸릴 수 있어 요청-응답 한 번으로 끝내지 않고,
 * 잡을 만들어 백그라운드로 실행하며 상태를 저장한다.
 * UI 는 /api/render?jobId=... 를 폴링해 단계/진행률/소요시간을 표시한다.
 *
 * (자체 호스팅 단일 프로세스 기준. 서버리스에서는 렌더를 실행하지 않으므로 사용 안 함.)
 */

import { randomUUID } from "node:crypto";

export type RenderStage =
  | "preparing" // 렌더링 준비 중
  | "extracting" // 입력/자막 준비
  | "running" // ffmpeg 실행 중(효과·자막 적용)
  | "finalizing" // 마무리 인코딩
  | "done" // 완료
  | "error"; // 실패

export const STAGE_LABEL: Record<RenderStage, string> = {
  preparing: "렌더링 준비 중",
  extracting: "입력·자막 준비 중",
  running: "ffmpeg 실행 중 (효과·자막 적용)",
  finalizing: "마무리 인코딩 중",
  done: "완료",
  error: "실패",
};

export interface RenderJob {
  id: string;
  status: RenderStage;
  stageLabel: string;
  percent: number; // 0~100
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  message?: string;
  command?: string;
  applied?: string[];
  outputPath?: string;
  downloadUrl?: string;
  error?: string;
}

// 잡 저장소는 globalThis 에 둬서, next dev 의 모듈 재컴파일(HMR)이나
// 여러 모듈 인스턴스 사이에서도 같은 Map 을 공유하도록 한다.
// (이게 없으면 POST 로 만든 잡을 GET 폴링이 다른 인스턴스에서 못 찾아 "잡을 찾을 수 없습니다"
//  로 UI 가 멈출 수 있다.)
const globalStore = globalThis as unknown as { __renderJobs?: Map<string, RenderJob> };
const jobs: Map<string, RenderJob> = (globalStore.__renderJobs ??= new Map());

// 오래된 잡 정리(메모리 누수 방지): 1시간 지난 잡 제거
const MAX_AGE_MS = 60 * 60 * 1000;
function gc() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.updatedAt > MAX_AGE_MS) jobs.delete(id);
  }
}

export function createJob(): RenderJob {
  gc();
  const now = Date.now();
  const job: RenderJob = {
    id: randomUUID(),
    status: "preparing",
    stageLabel: STAGE_LABEL.preparing,
    percent: 0,
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
  };
  jobs.set(job.id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<RenderJob>): RenderJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  const now = Date.now();
  Object.assign(job, patch);
  if (patch.status && !patch.stageLabel) {
    job.stageLabel = STAGE_LABEL[patch.status];
  }
  job.updatedAt = now;
  job.elapsedMs = now - job.startedAt;
  return job;
}

export function getJob(id: string): RenderJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  // 진행 중이면 경과 시간 갱신
  if (job.status !== "done" && job.status !== "error") {
    job.elapsedMs = Date.now() - job.startedAt;
  }
  return job;
}
