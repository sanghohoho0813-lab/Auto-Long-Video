/**
 * POST /api/render  — 렌더 시작
 * GET  /api/render?jobId=... — 진행 상태 폴링
 *
 * - 로컬: ffmpeg 설치 시 잡을 만들어 백그라운드로 렌더, jobId 반환(폴링)
 *         ffmpeg 미설치/원본 없음 → 명령어만 동기 반환
 * - 서버리스(Vercel): 실행하지 않고 명령어만 반환
 *
 * POST body: { plan: EditPlan, inputPath?: "uploads/xxx.mp4" }
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { existsSync } from "node:fs";
import { access as accessP } from "node:fs/promises";
import {
  STORAGE_ROOT,
  OUTPUT_DIR,
  BROLL_DIR,
  ensureStorage,
  safeFileName,
} from "@/lib/storage";
import { renderPlan, buildFfmpegCommand } from "@/lib/render/ffmpeg";
import { createJob, updateJob, getJob } from "@/lib/render/jobs";
import { isServerless } from "@/lib/env";
import type { EditPlan } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { plan?: EditPlan; inputPath?: string };
    const { plan } = body;

    if (!plan) {
      return NextResponse.json({ error: "plan 이 필요합니다." }, { status: 400 });
    }

    // 서버리스 환경: 실제 렌더링을 절대 시도하지 않는다.
    if (isServerless()) {
      const inName = safeFileName(plan.source?.fileName || "input.mp4");
      const outName = `${path.basename(inName, path.extname(inName))}_edited.mp4`;
      const cmd = buildFfmpegCommand(plan, inName, outName);
      return NextResponse.json({
        ok: true,
        rendered: false,
        serverless: true,
        message:
          "Vercel(서버리스)에서는 실제 렌더링을 지원하지 않습니다. " +
          "edit-plan.json 을 내려받아 로컬 ffmpeg 또는 별도 렌더 워커에서 아래 명령으로 실행하세요.",
        command: cmd.command,
        applied: cmd.applied,
        note: cmd.note,
      });
    }

    const inputPath = body.inputPath;
    if (!inputPath) {
      return NextResponse.json({ error: "inputPath 가 필요합니다." }, { status: 400 });
    }

    await ensureStorage();

    // 경로 조작 방지: STORAGE_ROOT 밖으로 나가지 못하게 함
    const absInput = path.join(STORAGE_ROOT, inputPath);
    if (!absInput.startsWith(STORAGE_ROOT)) {
      return NextResponse.json({ error: "잘못된 inputPath 입니다." }, { status: 400 });
    }

    const baseName = safeFileName(path.basename(inputPath, path.extname(inputPath)));
    const outName = `${baseName}_edited.mp4`;
    const outPath = path.join(OUTPUT_DIR, outName);
    const downloadUrl = `/api/download?file=${encodeURIComponent(`output/${outName}`)}`;

    // 입력 파일 존재 확인. 없으면 명령어만 반환(잡 생성 안 함).
    if (!(await exists(absInput))) {
      const cmd = buildFfmpegCommand(plan, absInput, outPath);
      return NextResponse.json({
        ok: false,
        rendered: false,
        message: "원본 파일을 찾을 수 없어 렌더링을 건너뜁니다. 아래는 실행 예정 명령어입니다.",
        command: cmd.command,
        applied: cmd.applied,
        note: cmd.note,
      });
    }

    // B-roll 파일 해석: storage/broll/<category>/<file> 존재 시에만 사용
    const resolveBrollFile = (suggested: string): string | null => {
      const abs = path.join(BROLL_DIR, suggested);
      if (!abs.startsWith(BROLL_DIR)) return null;
      return existsSync(abs) ? abs : null;
    };

    // 잡 생성 후 백그라운드 렌더 시작(응답은 즉시 jobId 반환 → UI 폴링)
    const job = createJob();
    void (async () => {
      try {
        const result = await renderPlan(plan, absInput, outPath, {
          resolveBrollFile,
          onProgress: (p) =>
            updateJob(job.id, { status: p.stage, percent: p.percent }),
        });
        if (result.ok) {
          updateJob(job.id, {
            status: "done",
            percent: 100,
            message: result.message,
            command: result.command,
            applied: result.applied,
            outputPath: `output/${outName}`,
            downloadUrl,
          });
        } else {
          updateJob(job.id, {
            status: "error",
            message: result.message,
            command: result.command,
            applied: result.applied,
            error: result.message,
          });
        }
      } catch (err) {
        updateJob(job.id, {
          status: "error",
          message: `렌더링 실패: ${(err as Error).message}`,
          error: (err as Error).message,
        });
      }
    })();

    return NextResponse.json({
      ok: true,
      async: true,
      jobId: job.id,
      statusUrl: `/api/render?jobId=${job.id}`,
      message: "렌더링을 시작했습니다.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `렌더링 요청 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId 가 필요합니다." }, { status: 400 });
  }
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "잡을 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job }, { headers: { "Cache-Control": "no-store" } });
}

function exists(p: string): Promise<boolean> {
  return accessP(p).then(
    () => true,
    () => false,
  );
}
