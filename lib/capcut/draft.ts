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
    path: input.sourceAbsPath,
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

/** draft_meta_info.json 내용 — CapCut 프로젝트 목록에 뜨는 메타데이터. */
export function buildDraftMeta(params: {
  draftId: string;
  draftName: string;
  draftFoldPath: string;
  draftRootPath: string;
  durationUs: number;
  nowMs: number;
}): Record<string, unknown> {
  return {
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
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
    // 경로 칸은 비워둔다: CapCut이 프로젝트를 발견한 "실제 위치"를 스스로 채우게 해서
    // 경로 형식 불일치(백슬래시/슬래시/정규화 차이)로 인한 "비정상 경로" 거부를 피한다.
    // (검증된 참조 구현이 실제로 동작하는 방식 — 경로를 직접 써넣지 않음)
    draft_fold_path: "",
    draft_id: params.draftId,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
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
    draft_new_version: "",
    draft_removable_storage_device: "",
    draft_root_path: "",
    draft_segment_extra_info: [],
    draft_type: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_modified: 0,
    tm_draft_create: params.nowMs * 1000, // 마이크로초
    tm_draft_modified: params.nowMs * 1000,
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
}

/**
 * CapCut 드래프트 폴더를 실제로 생성한다.
 * 타임라인 파일은 버전에 따라 읽는 이름이 달라서 두 이름으로 모두 쓴다:
 *  - draft_content.json … 剪映(중국판)·구버전 CapCut
 *  - draft_info.json    … 국제판 CapCut 다수 버전
 * @param draftsDir CapCut 프로젝트 루트(com.lveditor.draft). 없으면 resolveCapCutDraftsDir()로 자동.
 */
export async function writeCapCutDraft(
  input: DraftBuildInput,
  draftName: string,
  draftsDir: string,
): Promise<WriteDraftResult> {
  const name = safeDraftName(draftName);
  const draftDir = path.join(draftsDir, name);
  await fs.mkdir(draftDir, { recursive: true });

  const content = buildDraftContent(input);
  const durationUs = (content.duration as number) ?? 0;
  const nowMs = Date.now();
  const meta = buildDraftMeta({
    draftId: upperUuid(),
    draftName: name,
    draftFoldPath: draftDir,
    draftRootPath: draftsDir,
    durationUs,
    nowMs,
  });

  const contentJson = JSON.stringify(content, null, 4);
  const contentPath = path.join(draftDir, "draft_content.json");
  const infoPath = path.join(draftDir, "draft_info.json");
  const metaPath = path.join(draftDir, "draft_meta_info.json");
  await fs.writeFile(contentPath, contentJson, "utf-8");
  await fs.writeFile(infoPath, contentJson, "utf-8");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 4), "utf-8");

  const tracks = content.tracks as Array<{ segments: unknown[] }>;
  return {
    draftDir,
    draftName: name,
    contentPath,
    metaPath,
    segmentCount: tracks[0]?.segments.length ?? 0,
    outputDurationSec: Math.round((durationUs / SEC) * 1000) / 1000,
  };
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
