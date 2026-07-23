/**
 * CapCut(캡컷) 드래프트 생성기 — 무음이 잘린 타임라인을 곧바로 CapCut에서 열 수 있게.
 *
 * 렌더링(완성본 mp4)을 만드는 대신, CapCut 데스크톱이 읽는 프로젝트 폴더(draft)를
 * 직접 만들어 넣는다. 프로그램 실행 → CapCut을 켜면 "무음이 잘린 타임라인"이 프로젝트
 * 목록에 떠서, 사용자가 바로 이어서 손편집할 수 있다. (오래 걸리는 렌더링이 없음)
 *
 * 포맷 근거: JianYing/CapCut draft 구조(draft_content.json + draft_meta_info.json).
 * 검증된 오픈소스(pyJianYingDraft)의 필드 집합을 그대로 따랐다. 시간 단위는 마이크로초(1e6/초).
 *
 * 로컬(사용자 PC) 전용 — Next 서버가 사용자 컴퓨터에서 돌 때만 파일 시스템/CapCut에 접근 가능.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const SEC = 1_000_000; // 1초 = 1e6 마이크로초

/** 원본에서 "남길" 구간(초 단위). 무음을 뺀 말 구간들. */
export interface KeepSegment {
  start: number; // 원본에서의 시작(초)
  end: number; // 원본에서의 끝(초)
}

export interface DraftBuildInput {
  /** 원본 영상의 절대 경로(사용자 PC 기준) */
  sourceAbsPath: string;
  /** 원본 파일명(표시용) */
  sourceName: string;
  width: number;
  height: number;
  fps: number;
  /** 원본 전체 길이(초) */
  sourceDurationSec: number;
  /** 남길 구간들(무음 제외). 비어있으면 전체를 하나로. */
  keepSegments: KeepSegment[];
}

function us(sec: number): number {
  return Math.max(0, Math.round(sec * SEC));
}

function upperUuid(): string {
  return randomUUID().toUpperCase();
}

function hexUuid(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * CapCut/剪映이 쓰는 경로 표기로 변환: Windows에서도 구분자를 슬래시(/)로 기록한다.
 * (백슬래시 그대로 넣으면 "비정상 경로"로 거부됨)
 */
function toCapCutPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 하나의 원본 영상 소재(video material) JSON */
function videoMaterialJson(input: DraftBuildInput, materialId: string) {
  return {
    audio_fade: null,
    category_id: "",
    category_name: "local",
    check_flag: 63487,
    crop: {
      upper_left_x: 0.0,
      upper_left_y: 0.0,
      upper_right_x: 1.0,
      upper_right_y: 0.0,
      lower_left_x: 0.0,
      lower_left_y: 1.0,
      lower_right_x: 1.0,
      lower_right_y: 1.0,
    },
    crop_ratio: "free",
    crop_scale: 1.0,
    duration: us(input.sourceDurationSec),
    height: input.height,
    id: materialId,
    local_material_id: "",
    material_id: materialId,
    material_name: input.sourceName,
    media_path: "",
    path: toCapCutPath(input.sourceAbsPath),
    type: "video",
    width: input.width,
  };
}

/** 변速(speed) 소재 — 각 세그먼트가 1개씩 참조. 여기선 항상 1.0배속. */
function speedJson(id: string) {
  return { curve_speed: null, id, mode: 0, speed: 1.0, type: "speed" };
}

/** 타임라인 위의 한 조각(세그먼트) JSON. source=원본 구간, target=타임라인 위치. */
function segmentJson(params: {
  segId: string;
  materialId: string;
  speedId: string;
  sourceStartSec: number;
  durationSec: number;
  targetStartSec: number;
}) {
  return {
    enable_adjust: true,
    enable_color_correct_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: false,
    last_nonzero_volume: 1.0,
    reverse: false,
    track_attribute: 0,
    track_render_index: 0,
    visible: true,
    id: params.segId,
    material_id: params.materialId,
    target_timerange: { start: us(params.targetStartSec), duration: us(params.durationSec) },
    common_keyframes: [],
    keyframe_refs: [],
    source_timerange: { start: us(params.sourceStartSec), duration: us(params.durationSec) },
    speed: 1.0,
    volume: 1.0,
    extra_material_refs: [params.speedId],
    is_tone_modify: false,
    clip: {
      alpha: 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: 0.0,
      scale: { x: 1.0, y: 1.0 },
      transform: { x: 0.0, y: 0.0 },
    },
    uniform_scale: { on: true, value: 1.0 },
    hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
    render_index: 0,
  };
}

/** 남길 구간들을 정규화(정렬·경계 클램프·너무 짧은 조각 제거). */
export function normalizeKeeps(keeps: KeepSegment[], durationSec: number): KeepSegment[] {
  const out: KeepSegment[] = [];
  for (const k of [...keeps].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, Math.min(k.start, durationSec));
    const end = Math.max(0, Math.min(k.end, durationSec));
    if (end - start > 0.05) out.push({ start, end });
  }
  return out;
}

/** draft_content.json 내용 객체를 만든다(타임라인 본체). */
export function buildDraftContent(input: DraftBuildInput): Record<string, unknown> {
  const materialId = hexUuid();
  const keeps = normalizeKeeps(input.keepSegments, input.sourceDurationSec);
  // 남길 구간이 하나도 없으면 원본 전체를 한 조각으로(안전장치)
  const effectiveKeeps: KeepSegment[] =
    keeps.length > 0 ? keeps : [{ start: 0, end: input.sourceDurationSec }];

  const speeds: Array<ReturnType<typeof speedJson>> = [];
  const segments: Array<ReturnType<typeof segmentJson>> = [];
  let cursor = 0; // 타임라인 위 누적 위치(초)
  for (const k of effectiveKeeps) {
    const dur = k.end - k.start;
    const speedId = hexUuid();
    speeds.push(speedJson(speedId));
    segments.push(
      segmentJson({
        segId: hexUuid(),
        materialId,
        speedId,
        sourceStartSec: k.start,
        durationSec: dur,
        targetStartSec: cursor,
      }),
    );
    cursor += dur;
  }
  const totalUs = us(cursor);

  return {
    canvas_config: { height: input.height, ratio: "original", width: input.width },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      multi_language_current: "none",
      multi_language_list: [],
      multi_language_main: "none",
      multi_language_mode: "none",
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_keywords_config: null,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
      zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    duration: totalUs,
    extra_info: null,
    fps: input.fps || 30.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: upperUuid(),
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [],
      audios: [],
      effects: [],
      filters: [],
      handwrites: [],
      stickers: [],
      texts: [],
      videos: [],
    },
    last_modified_platform: { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: "windows" },
    platform: { app_id: 3704, app_source: "lv", app_version: "5.9.0", os: "windows" },
    materials: {
      ...emptyMaterialLists(),
      speeds,
      videos: [videoMaterialJson(input, materialId)],
    },
    mutable_config: null,
    name: "",
    new_version: "110.0.0",
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: "",
    time_marks: null,
    tracks: [
      {
        attribute: 0,
        flag: 0,
        id: hexUuid(),
        is_default_name: true,
        name: "",
        segments,
        type: "video",
      },
    ],
    update_time: 0,
    version: 360000,
  };
}

/** materials 안의 나머지(빈) 리스트들 — CapCut 스키마가 요구하는 키를 모두 채운다. */
function emptyMaterialLists(): Record<string, unknown[]> {
  const keys = [
    "ai_translates", "audio_balances", "audio_effects", "audio_fades", "audio_track_indexes",
    "audios", "beats", "canvases", "chromas", "color_curves", "digital_humans", "drafts",
    "effects", "flowers", "green_screens", "handwrites", "hsl", "images", "log_color_wheels",
    "loudnesses", "manual_deformations", "masks", "material_animations", "material_colors",
    "multi_language_refs", "placeholders", "plugin_effects", "primary_color_wheels",
    "realtime_denoises", "shapes", "smart_crops", "smart_relights", "sound_channel_mappings",
    "speeds", "stickers", "tail_leaders", "text_templates", "texts", "time_marks",
    "transitions", "video_effects", "video_trackings", "videos", "vocal_beautifys",
    "vocal_separations",
  ];
  const out: Record<string, unknown[]> = {};
  for (const k of keys) out[k] = [];
  return out;
}

/** 경로에서 드라이브 문자(예: "D:")를 뽑는다. 없으면 "". */
function driveLetter(p: string): string {
  const m = /^([A-Za-z]:)/.exec(p);
  return m ? m[1] : "";
}

/**
 * draft_meta_info.json 내용 — 실제 CapCut(국제판)이 쓰는 구조를 그대로 맞춘다.
 * 실물 샘플 기준 핵심:
 *  - draft_fold_path 는 슬래시(/), draft_root_path 는 백슬래시(\) — 둘의 표기가 다름.
 *  - draft_removable_storage_device 에 드라이브 문자(예: "D:")를 넣음.
 *  - 최신 버전이 확인하는 cloud/ae/web 관련 플래그 필드들을 모두 포함.
 */
export function buildDraftMeta(params: {
  draftId: string;
  draftName: string;
  draftFoldPath: string; // 네이티브(윈도우면 백슬래시) — 내부에서 슬래시로 변환
  draftRootPath: string; // 네이티브(윈도우면 백슬래시) — 그대로 사용
  durationUs: number;
  nowMs: number;
  materialsSize?: number; // 원본 크기(바이트) — 목록에 0.0B로 안 보이게
}): Record<string, unknown> {
  const nowUs = params.nowMs * 1000;
  return {
    // 로컬 전용 프로젝트: 클라우드 동기화 플래그를 켜면 CapCut이 "클라우드에서
    // 받아와야 할 프로젝트"로 보고 0.0B·클릭 불가로 막는다 → 반드시 false.
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: "",
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "",
    draft_deeplink_url: "",
    draft_enterprise_info: {
      draft_enterprise_extra: "",
      draft_enterprise_id: "",
      draft_enterprise_name: "",
      enterprise_material: [],
    },
    // fold_path 는 슬래시(/), root_path 는 백슬래시(\) — 실제 CapCut 표기 그대로.
    draft_fold_path: toCapCutPath(params.draftFoldPath),
    draft_id: params.draftId,
    draft_is_ae_produce: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: params.draftName,
    draft_need_rename_folder: false,
    draft_new_version: "",
    draft_removable_storage_device: driveLetter(params.draftRootPath),
    draft_root_path: params.draftRootPath,
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: params.materialsSize ?? 0,
    draft_type: "",
    draft_web_article_video_enter_from: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: params.durationUs,
  };
}

/** 파일명으로 쓸 수 없는 문자 제거(Windows 기준). */
export function safeDraftName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "draft";
}

export interface WriteDraftResult {
  draftDir: string;
  draftName: string;
  contentPath: string;
  metaPath: string;
  segmentCount: number;
  outputDurationSec: number;
  /** 기존 정상 프로젝트를 템플릿으로 복사했는지(권장) / 맨바닥 생성인지 */
  usedTemplate: boolean;
  templateName: string | null;
}

/**
 * 같은 drafts 폴더 안에서 "진짜 CapCut이 만든 정상 프로젝트"를 하나 찾아 템플릿으로 쓴다.
 * 판별: draft_content.json + draft_meta_info.json 에 더해, 우리가 만든 미니 프로젝트엔 없는
 * draft_virtual_store.json 이 있어야 진짜로 인정(=CapCut 정품 구조). 최근 수정 우선.
 */
async function findTemplateDraft(draftsDir: string, excludeName: string): Promise<string | null> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(draftsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates: Array<{ dir: string; mtime: number }> = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === excludeName) continue;
    const dir = path.join(draftsDir, e.name);
    try {
      await fs.access(path.join(dir, "draft_content.json"));
      await fs.access(path.join(dir, "draft_meta_info.json"));
      await fs.access(path.join(dir, "draft_virtual_store.json")); // 정품 마커
      candidates.push({ dir, mtime: (await fs.stat(dir)).mtimeMs });
    } catch {
      /* 정상 프로젝트 아님 → 스킵 */
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.dir ?? null;
}

/** 템플릿 프로젝트의 draft_meta_info.json 을 로드해, 우리 프로젝트용으로 필요한 값만 갈아끼운다. */
function patchTemplateMeta(
  templateMeta: Record<string, unknown>,
  p: { draftName: string; draftDir: string; draftsDir: string; durationUs: number; nowMs: number; materialsSize: number },
): Record<string, unknown> {
  const nowUs = p.nowMs * 1000;
  return {
    ...templateMeta, // 버전별 알 수 없는 필드까지 전부 보존
    cloud_draft_cover: false,
    cloud_draft_sync: false, // 로컬 전용(클라우드 대기 상태로 잠기는 것 방지)
    draft_cover: "",
    draft_fold_path: toCapCutPath(p.draftDir),
    draft_id: upperUuid(),
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_name: p.draftName,
    draft_removable_storage_device: driveLetter(p.draftsDir),
    draft_root_path: p.draftsDir,
    draft_timeline_materials_size_: p.materialsSize,
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_draft_removed: 0,
    tm_duration: p.durationUs,
  };
}

/**
 * CapCut 드래프트 폴더를 만든다.
 * 우선순위:
 *  1) 같은 폴더의 "정상 CapCut 프로젝트"를 통째로 복사(템플릿) → 타임라인만 우리 무음컷으로 교체.
 *     (draft_virtual_store.json 등 CapCut이 요구하는 부속 파일까지 진짜 그대로라 가장 안전)
 *  2) 템플릿이 없으면 맨바닥 생성(부속 파일 없이 3개 파일만 — 구버전/剪映에서 동작).
 */
export async function writeCapCutDraft(
  input: DraftBuildInput,
  draftName: string,
  draftsDir: string,
): Promise<WriteDraftResult> {
  const name = safeDraftName(draftName);
  const draftDir = path.join(draftsDir, name);

  const content = buildDraftContent(input);
  const contentJson = JSON.stringify(content, null, 4);
  const durationUs = (content.duration as number) ?? 0;
  const nowMs = Date.now();
  let materialsSize = 0;
  try {
    materialsSize = (await fs.stat(input.sourceAbsPath)).size;
  } catch {
    /* 원본 크기 못 구해도 진행 */
  }

  const template = await findTemplateDraft(draftsDir, name);

  // 재실행 대비: 같은 이름의 이전 결과가 있으면 지우고 새로 만든다.
  await fs.rm(draftDir, { recursive: true, force: true });
  await fs.mkdir(draftDir, { recursive: true });

  const contentPath = path.join(draftDir, "draft_content.json");
  const metaPath = path.join(draftDir, "draft_meta_info.json");
  let usedTemplate = false;
  let templateName: string | null = null;

  if (template) {
    usedTemplate = true;
    templateName = path.basename(template);
    // 1) 정상 프로젝트 통째 복사(부속 파일 구조 확보)
    await fs.cp(template, draftDir, { recursive: true });
    // 2) 예전 프로젝트에 종속된 흔적 제거 — 이게 없으면 "옛 영상 캐시 vs 새 타임라인"
    //    충돌로 프로젝트가 깨진다(재생 하양·삭제 불가·재열기 불가).
    //    - 썸네일/자동복구 tmp: 옛 화면·옛 타임라인 복원 방지
    //    - material 캐시 서브폴더: 옛 영상의 렌더/메타 데이터
    await removeIfExists(draftDir, [
      "draft_cover.jpg",
      "draft_cover",
      "template.tmp",
      "template-2.tmp",
      "Resources",
      "common_attachment",
      "matting",
      "smart_crop",
      "adjust_mask",
      "qr_upload",
      "subdraft",
    ]);
    // 옛 타임라인/소재 상태를 담은 파일은 최소 구조로 리셋 → CapCut이 우리 타임라인 기준으로 재생성
    await resetIfExists(path.join(draftDir, "draft_virtual_store.json"), MIN_VIRTUAL_STORE);
    await resetIfExists(path.join(draftDir, "key_value.json"), "{}");
    // 3) 타임라인을 우리 무음컷으로 교체(있는 이름 모두)
    await fs.writeFile(contentPath, contentJson, "utf-8");
    for (const alt of ["draft_info.json"]) {
      const altPath = path.join(draftDir, alt);
      if (await pathExists(altPath)) await fs.writeFile(altPath, contentJson, "utf-8");
    }
    // 4) 메타는 템플릿 것을 로드해 필요한 값만 교체(버전별 필드 보존)
    let tmeta: Record<string, unknown> = {};
    try {
      tmeta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    } catch {
      /* 손상 시 맨바닥 메타로 */
    }
    const meta =
      Object.keys(tmeta).length > 0
        ? patchTemplateMeta(tmeta, { draftName: name, draftDir, draftsDir, durationUs, nowMs, materialsSize })
        : buildDraftMeta({ draftId: upperUuid(), draftName: name, draftFoldPath: draftDir, draftRootPath: draftsDir, durationUs, nowMs, materialsSize });
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 4), "utf-8");
  } else {
    // 맨바닥 생성(부속 파일 없음)
    const meta = buildDraftMeta({
      draftId: upperUuid(),
      draftName: name,
      draftFoldPath: draftDir,
      draftRootPath: draftsDir,
      durationUs,
      nowMs,
      materialsSize,
    });
    await fs.writeFile(contentPath, contentJson, "utf-8");
    await fs.writeFile(path.join(draftDir, "draft_info.json"), contentJson, "utf-8");
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 4), "utf-8");
  }

  const tracks = content.tracks as Array<{ segments: unknown[] }>;
  return {
    draftDir,
    draftName: name,
    contentPath,
    metaPath,
    segmentCount: tracks[0]?.segments.length ?? 0,
    outputDurationSec: Math.round((durationUs / SEC) * 1000) / 1000,
    usedTemplate,
    templateName,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(dir: string, names: string[]): Promise<void> {
  for (const n of names) {
    await fs.rm(path.join(dir, n), { recursive: true, force: true }).catch(() => {});
  }
}

/** 빈/최소 CapCut virtual store — 소재 상태를 우리 타임라인 기준으로 재생성하게 한다. */
const MIN_VIRTUAL_STORE = JSON.stringify({
  draft_materials: [],
  draft_virtual_store: [
    { type: 0, value: [] },
    { type: 1, value: [] },
    { type: 2, value: [] },
  ],
});

/** 파일이 있으면 주어진 내용으로 덮어쓴다(없으면 아무 것도 안 함). */
async function resetIfExists(p: string, content: string): Promise<void> {
  if (await pathExists(p)) await fs.writeFile(p, content, "utf-8").catch(() => {});
}

/**
 * CapCut 프로젝트 루트 폴더(com.lveditor.draft)를 OS별 기본 위치에서 찾는다.
 * 없으면 null. 사용자가 직접 경로를 줄 수도 있음(override).
 */
export async function resolveCapCutDraftsDir(override?: string | null): Promise<string | null> {
  const candidates: string[] = [];
  if (override) candidates.push(override);
  // 사용자가 비표준 위치에 설치했거나 자동탐지가 실패할 때를 위한 환경변수 오버라이드
  if (process.env.CAPCUT_DRAFTS_DIR) candidates.push(process.env.CAPCUT_DRAFTS_DIR);

  const home = os.homedir();
  const platform = process.platform;
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    // CapCut(국제판) / 剪映(중국판) 둘 다 시도
    candidates.push(path.join(local, "CapCut", "User Data", "Projects", "com.lveditor.draft"));
    candidates.push(path.join(local, "JianyingPro", "User Data", "Projects", "com.lveditor.draft"));
  } else if (platform === "darwin") {
    candidates.push(
      path.join(home, "Movies", "CapCut", "User Data", "Projects", "com.lveditor.draft"),
    );
    candidates.push(
      path.join(
        home,
        "Library",
        "Application Support",
        "CapCut",
        "User Data",
        "Projects",
        "com.lveditor.draft",
      ),
    );
  }

  for (const c of candidates) {
    try {
      const st = await fs.stat(c);
      if (st.isDirectory()) return c;
    } catch {
      /* 없음 → 다음 후보 */
    }
  }
  return null;
}

/**
 * CapCut 앱을 실행(자동 오픈)한다. 특정 드래프트를 바로 여는 공식 방법은 없어서,
 * 앱을 띄우면 방금 만든 프로젝트가 목록 맨 위(최근 수정)에 떠서 클릭만 하면 됨.
 * 실패해도 드래프트 생성 자체는 성공이므로 best-effort로 처리한다.
 */
export async function launchCapCut(): Promise<{ launched: boolean; how: string | null }> {
  const platform = process.platform;
  const tryStart = (cmd: string, args: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
        child.on("error", () => resolve(false));
        child.unref();
        // 스폰 자체가 에러 없이 됐으면 성공으로 간주
        setTimeout(() => resolve(true), 250);
      } catch {
        resolve(false);
      }
    });

  if (platform === "win32") {
    // 1) URL 스킴(capcut://)으로 앱만 띄운다(설치 시 등록됨 — 가장 안정적).
    if (await tryStart("cmd", ["/c", "start", "", "capcut://"])) return { launched: true, how: "capcut://" };
    // 2) 실행 파일 직접 찾기: %LOCALAPPDATA%\CapCut\Apps\<version>\CapCut.exe 또는 그 상위.
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const exe = await findCapCutExe(local);
    if (exe && (await tryStart("cmd", ["/c", "start", "", exe]))) return { launched: true, how: exe };
  } else if (platform === "darwin") {
    if (await tryStart("open", ["-a", "CapCut"])) return { launched: true, how: "open -a CapCut" };
    if (await tryStart("open", ["capcut://"])) return { launched: true, how: "capcut://" };
  }
  return { launched: false, how: null };
}

/** Windows에서 CapCut.exe 를 흔한 위치들에서 찾는다(버전 폴더 포함). 없으면 null. */
async function findCapCutExe(localAppData: string): Promise<string | null> {
  const direct = [
    path.join(localAppData, "CapCut", "CapCut.exe"),
    path.join(localAppData, "Programs", "CapCut", "CapCut.exe"),
  ];
  for (const d of direct) {
    try {
      if ((await fs.stat(d)).isFile()) return d;
    } catch {
      /* 다음 */
    }
  }
  // Apps/<version>/CapCut.exe 형태
  const appsDir = path.join(localAppData, "CapCut", "Apps");
  try {
    const versions = await fs.readdir(appsDir);
    // 버전 문자열 내림차순(최신 우선)
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      const exe = path.join(appsDir, v, "CapCut.exe");
      try {
        if ((await fs.stat(exe)).isFile()) return exe;
      } catch {
        /* 다음 */
      }
    }
  } catch {
    /* Apps 폴더 없음 */
  }
  return null;
}
