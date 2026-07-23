/**
 * POST /api/capcut-draft
 *
 * 무음이 잘린 타임라인을 CapCut(캡컷) 프로젝트(draft)로 곧바로 만들어 넣는다.
 * → 렌더링(완성본 mp4) 없이, CapCut을 켜면 무음이 잘린 상태로 이어서 편집 가능.
 *
 * 로컬(사용자 PC) 전용. body:
 *   {
 *     inputPath: "uploads/xxx.mp4",     // 원본(스토리지 상대경로)
 *     keepSegments: [{start,end}, ...],  // 남길 구간(무음 제외). detect-silence의 segments 그대로.
 *     durationSec?, width?, height?, fps?,  // 없으면 ffprobe로 보완
 *     draftName?, draftsDir?, launch?    // launch=true면 CapCut 자동 실행
 *   }
 */

import { NextResponse } from "next/server";
import path from "node:path";
import { access, stat } from "node:fs/promises";
import { STORAGE_ROOT, ensureStorage } from "@/lib/storage";
import { isServerless } from "@/lib/env";
import { checkFfmpeg, probeVideo } from "@/lib/render/ffmpeg";
import {
  writeCapCutDraft,
  resolveCapCutDraftsDir,
  launchCapCut,
  type KeepSegment,
  type DraftBuildInput,
} from "@/lib/capcut/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Body {
  inputPath?: string;
  keepSegments?: KeepSegment[];
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  draftName?: string;
  draftsDir?: string;
  launch?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (isServerless()) {
      return NextResponse.json({
        ok: false,
        serverless: true,
        message:
          "CapCut 드래프트 생성은 로컬(내 PC)에서만 동작합니다. 로컬에서 앱을 실행한 뒤 사용하세요.",
      });
    }

    const { inputPath } = body;
    if (!inputPath) {
      return NextResponse.json({ error: "inputPath 가 필요합니다." }, { status: 400 });
    }

    await ensureStorage();
    const abs = path.join(STORAGE_ROOT, inputPath);
    if (!abs.startsWith(STORAGE_ROOT)) {
      return NextResponse.json({ error: "잘못된 inputPath 입니다." }, { status: 400 });
    }
    if (!(await exists(abs))) {
      return NextResponse.json(
        { error: "원본 파일을 찾을 수 없습니다. 먼저 영상을 업로드하세요." },
        { status: 404 },
      );
    }

    // 치수/길이 보완: 클라이언트가 안 줬으면 ffprobe로 채운다.
    let { width, height, fps, durationSec } = body;
    if (!width || !height || !fps || !durationSec) {
      const { ffprobe } = await checkFfmpeg();
      if (ffprobe) {
        try {
          const p = await probeVideo(abs);
          width = width || p.width;
          height = height || p.height;
          fps = fps || p.fps;
          durationSec = durationSec || p.durationSec;
        } catch {
          /* 무시 — 아래 기본값으로 */
        }
      }
    }
    width = width || 1920;
    height = height || 1080;
    fps = fps || 30;
    durationSec = durationSec || 0;

    if (!durationSec) {
      return NextResponse.json(
        { error: "영상 길이를 알 수 없습니다. ffprobe 설치를 확인하세요." },
        { status: 400 },
      );
    }

    // CapCut 프로젝트 폴더 찾기.
    // 사용자가 폴더를 직접 지정했으면 그 폴더가 실제로 존재하는지 확인하고 그대로 사용한다
    // (저장 위치를 옮긴 경우 — 예: D:\CapCut Drafts — 자동 탐지로는 못 찾으므로 이게 권위).
    let draftsDir: string | null;
    if (body.draftsDir && body.draftsDir.trim()) {
      const wanted = body.draftsDir.trim();
      try {
        if (!(await stat(wanted)).isDirectory()) throw new Error("not dir");
        draftsDir = wanted;
      } catch {
        return NextResponse.json({
          ok: false,
          needDraftsDir: true,
          message: `지정한 CapCut 폴더를 찾을 수 없습니다: ${wanted} — 경로를 다시 확인하세요(폴더가 실제로 존재해야 합니다).`,
        });
      }
    } else {
      draftsDir = await resolveCapCutDraftsDir(null);
    }
    if (!draftsDir) {
      return NextResponse.json({
        ok: false,
        needDraftsDir: true,
        message:
          "CapCut 프로젝트 폴더를 자동으로 찾지 못했습니다. 아래 입력칸에 CapCut 저장 폴더 경로를 직접 넣어주세요.",
        hint:
          process.platform === "win32"
            ? "기본은 %LOCALAPPDATA%\\CapCut\\User Data\\Projects\\com.lveditor.draft 이고, 저장 위치를 옮겼다면 그 폴더(예: D:\\CapCut Drafts)를 넣으세요."
            : "CapCut 데스크톱 저장 폴더 경로를 넣으세요.",
      });
    }

    const sourceName = path.basename(inputPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const draftName = body.draftName || `${baseName}_무음컷`;

    const input: DraftBuildInput = {
      sourceAbsPath: abs,
      sourceName,
      width,
      height,
      fps,
      sourceDurationSec: durationSec,
      keepSegments: body.keepSegments ?? [],
    };

    const result = await writeCapCutDraft(input, draftName, draftsDir);

    // 자동 실행(선택)
    let launched: { launched: boolean; how: string | null } = { launched: false, how: null };
    if (body.launch) {
      launched = await launchCapCut();
    }

    const removedSec = Math.max(0, Math.round((durationSec - result.outputDurationSec) * 1000) / 1000);

    return NextResponse.json({
      ok: true,
      draftName: result.draftName,
      draftDir: result.draftDir,
      draftsDir,
      segmentCount: result.segmentCount,
      outputDurationSec: result.outputDurationSec,
      originalDurationSec: Math.round(durationSec * 1000) / 1000,
      removedSec,
      launched: launched.launched,
      launchHow: launched.how,
      message: `CapCut 프로젝트 "${result.draftName}" 생성 완료 (무음 ${fmt(removedSec)} 제거, ${result.segmentCount}조각).`,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `CapCut 드래프트 생성 실패: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}
