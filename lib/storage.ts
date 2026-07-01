/**
 * 로컬 파일 저장소 유틸 (서버 전용)
 *
 * 업로드 영상 / 렌더 결과 / B-roll 소스를 프로젝트 내 storage 폴더에 둔다.
 * 로컬 웹앱이므로 별도 DB 없이 파일 시스템만 사용한다.
 */

import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { BrollCategory } from "@/lib/types";
import type { BrollAsset } from "@/lib/editing/broll";
import { isServerless } from "@/lib/env";

export const STORAGE_ROOT = path.join(process.cwd(), "storage");
export const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
export const OUTPUT_DIR = path.join(STORAGE_ROOT, "output");
export const BROLL_DIR = path.join(STORAGE_ROOT, "broll");

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);

/**
 * 필요한 storage 하위 폴더를 보장한다.
 * 서버리스(Vercel) 환경은 파일 시스템이 읽기 전용이라 폴더 생성을 건너뛴다.
 */
export async function ensureStorage(): Promise<void> {
  if (isServerless()) return;
  await Promise.all([
    mkdir(UPLOAD_DIR, { recursive: true }),
    mkdir(OUTPUT_DIR, { recursive: true }),
    mkdir(BROLL_DIR, { recursive: true }),
  ]);
}

/**
 * broll 폴더를 스캔해 사용 가능한 클립 목록을 만든다.
 * 폴더 구조: storage/broll/<category>/*.mp4
 * 카테고리 폴더 밖에 있는 파일은 무시한다.
 */
export async function scanBroll(): Promise<BrollAsset[]> {
  // 서버리스에서는 B-roll 소스 폴더를 영구 보관할 수 없으므로 항상 빈 목록.
  if (isServerless()) return [];

  await ensureStorage();
  const assets: BrollAsset[] = [];

  let categories: string[] = [];
  try {
    const entries = await readdir(BROLL_DIR, { withFileTypes: true });
    categories = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return assets;
  }

  for (const cat of categories) {
    if (!isBrollCategory(cat)) continue;
    try {
      const files = await readdir(path.join(BROLL_DIR, cat));
      for (const f of files) {
        if (VIDEO_EXTS.has(path.extname(f).toLowerCase())) {
          assets.push({ fileName: `${cat}/${f}`, category: cat });
        }
      }
    } catch {
      // 폴더 접근 실패는 무시
    }
  }
  return assets;
}

const VALID_CATEGORIES: BrollCategory[] = [
  "office",
  "money",
  "meeting",
  "document",
  "tax",
  "government",
  "business_owner",
];

function isBrollCategory(v: string): v is BrollCategory {
  return (VALID_CATEGORIES as string[]).includes(v);
}

/** 안전한 파일명(경로 조작 방지) */
export function safeFileName(name: string): string {
  return path.basename(name).replace(/[^\w.\-가-힣 ]/g, "_");
}
