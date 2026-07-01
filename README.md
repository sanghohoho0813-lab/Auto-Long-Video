# 🎬 김팀장의 롱폼 자동편집기

유튜브 롱폼 강의/해설 영상을 올리기 전에, 원본 영상을 넣으면 자동으로
**컷 편집 · 자막 강조 · 키워드 강조 · 줌 효과 · 스포트라이트 · B-roll 삽입 · 팝업 텍스트**를
적용해주는 **로컬 웹앱**입니다.

감마 AI PDF 강의처럼 정적인 화면 녹화 영상을 더 세련되게 만드는 것이 목표입니다.

---

## 🚀 로컬 실행 방법

```bash
npm install
npm run dev
# http://localhost:3000
```

> Node.js 18.18+ 필요. 실제 렌더링을 하려면 `ffmpeg` / `ffprobe` 설치가 필요합니다.
> (미설치 상태에서도 편집 계획 생성 · 미리보기 · `edit-plan.json` 다운로드는 모두 동작합니다.)

### 빠른 체험

1. `npm run dev` 실행 후 브라우저 접속
2. mp4 영상 업로드 (없어도 됨 — transcript 만으로 편집 계획 생성 가능)
3. **"⚡ 샘플 자막으로 바로 체험하기"** 클릭 (또는 직접 transcript.json 업로드)
4. 프리셋 선택 → 편집 계획 자동 생성 → `edit-plan.json` 다운로드

---

## ☁️ Vercel 배포

이 앱은 Vercel에 그대로 배포할 수 있습니다. 단, **서버리스 환경에서는 ffmpeg 렌더링과
파일 영구 저장이 불가능**하므로, 배포 환경에서는 편집 계획 생성까지만 동작하고
실제 렌더링은 로컬/별도 워커로 분리합니다. 앱은 `process.env.VERCEL` 로 환경을
자동 감지해(`lib/env.ts`) 해당 기능을 안전하게 비활성화합니다.

### 배포 체크리스트

1. GitHub에 push
2. [Vercel](https://vercel.com/new) → **Import Git Repository** 로 이 repo import
3. 설정값 (대부분 자동 감지됨)
   - **Framework Preset**: `Next.js`
   - **Build Command**: `npm run build`
   - **Install Command**: `npm install`
   - **Output Directory**: 기본값 (`.next` — 그대로 두기)
   - **Node.js Version**: 18.x 이상 (`.nvmrc` / `engines` 로 지정됨)
4. **환경변수**: 필요 없음 (없이도 정상 동작).
   `VERCEL` 은 Vercel이 자동 주입하므로 별도 설정 불필요.
   다른 서버리스에서 강제하려면 `SERVERLESS=1` 을 설정.
5. **Deploy** 클릭

### Vercel에서 가능한 기능 ✅

- 메인 페이지 로딩
- transcript.json 업로드 / 샘플 자막 불러오기
- 편집 설정(프리셋·세부값) 조정
- 편집 계획(EditPlan) 생성 및 미리보기(타임라인·편집 리스트)
- B-roll 삽입 후보 / 줌 / 스포트라이트 / 팝업 / 자막 강조 이벤트 생성
- **edit-plan.json 다운로드**
- `/api/render`: 실제 렌더링 대신 **ffmpeg 명령어 + 안내** 반환

### Vercel에서 제한되는 기능 ⚠️

| 기능 | 이유 | 대안 |
|------|------|------|
| 영상 서버 업로드/저장 | 파일 시스템 읽기전용 + 요청 바디 4.5MB 제한 | 브라우저 메모리에서 분석(길이/해상도) |
| ffmpeg 실제 렌더링 | 서버리스 실행/시간 제한, 바이너리 부재 | 로컬 ffmpeg 또는 별도 렌더 워커 |
| B-roll 폴더 스캔 | 소스 파일 영구 보관 불가 | 로컬에서 `storage/broll/` 사용 |

### ⚠️ API Route 주의사항 (중요)

- Next.js App Router는 **API route를 빌드 시 정적(Static)으로 최적화**할 수 있습니다.
  이 경우 응답이 빌드 시점 값으로 박제되어, 런타임 환경 감지(`/api/env`)나
  파일 스캔(`/api/broll`)이 실제와 다르게 동작합니다.
- 그래서 이 프로젝트의 **모든** `app/api/*` route에는 다음을 명시합니다.
  ```ts
  export const runtime = "nodejs";        // edge 아님 (fs / child_process 사용)
  export const dynamic = "force-dynamic"; // 정적 최적화·빌드타임 박제 방지
  ```
  `npm run build` 출력에서 모든 API route가 `○ Static` 이 아니라 **`ƒ Dynamic`** 으로
  찍혀야 정상입니다.
- 환경 감지는 오직 **`lib/env.ts` 한 곳**에서만 판단합니다
  (`process.env.VERCEL === "1"` 또는 `SERVERLESS === "1"`). 여러 파일에서
  `VERCEL` / `VERCEL_ENV` / `NEXT_RUNTIME` 을 섞어 쓰지 않습니다.
- `/api/env` 는 디버그용으로 `isServerless / platform / nodeEnv / vercel / vercelEnv /
  nextRuntime / timestamp` 를 함께 반환합니다. `timestamp` 가 요청마다 바뀌면
  응답이 정적으로 박제되지 않았다는 증거입니다.
- **Vercel에서 `/api/render` 는 실제 ffmpeg를 실행하지 않고** command/edit-plan 정보만
  안전하게 반환합니다(로컬에서는 ffmpeg가 있으면 실제 렌더).

> 로컬에서 환경 감지를 테스트할 때는 이전에 `VERCEL=1` 로 띄운 서버가 포트에 남아있지
> 않도록 반드시 종료하고(예: `fuser -k 3000/tcp`), 로컬 테스트는 `env -u VERCEL` 로
> 실행하세요. stale 서버가 남아 있으면 로컬인데도 serverless로 보일 수 있습니다.

### 실제 렌더링 분리 계획

Vercel은 **편집 계획 생성기**로 사용하고, 렌더링은 아래처럼 분리합니다.

```
[Vercel: 계획 생성] → edit-plan.json → [로컬 ffmpeg | 워커(예: Render/Fly/EC2/큐)] → 1080p mp4
```

- 단기: `edit-plan.json` 다운로드 → 로컬에서 `ffmpeg` 로 렌더 (명령어는 `/api/render` 가 제공)
- 중기: 렌더 전용 워커(장시간 작업 허용)에 `edit-plan.json` 을 전달해 큐 기반 렌더
- 렌더 로직은 이미 `lib/render/ffmpeg.ts` 에 모듈화되어 있어 워커에서 그대로 재사용 가능

---

## 🧩 아키텍처

영상 처리 로직은 **순수 함수 모듈**로 분리해 서버/클라이언트 어디서든 재사용하고,
새 편집 효과를 쉽게 추가할 수 있게 설계했습니다.

```
lib/
├── types.ts                # 공통 타입 (EditPlan, EditEvent, EditSettings ...)
├── env.ts                  # 로컬/서버리스(Vercel) 환경 구분
├── config/
│   ├── keywords.ts         # 강조/스포트라이트/팝업/B-roll 키워드 사전
│   └── presets.ts          # 얌전하게 / 기본 / 생동감 있게 프리셋
├── analysis/
│   └── transcript.ts       # transcript.json 파싱·검증, 무음 간격 탐지
├── editing/                # 편집 이벤트 생성 모듈 (효과별 1파일)
│   ├── cuts.ts             # 2. 무음 컷
│   ├── subtitles.ts        # 4. 자막 + 키워드 강조 토큰화
│   ├── zoom.ts             # 5. 자동 줌
│   ├── spotlight.ts        # 6. 스포트라이트
│   ├── broll.ts            # 7. B-roll 후보 + 카테고리 추천
│   ├── popup.ts            # 8. 팝업 텍스트
│   ├── ids.ts              # 결정적 이벤트 ID
│   └── planner.ts          # 모든 모듈을 모아 EditPlan 생성 (오케스트레이터)
├── render/
│   ├── ffmpeg.ts           # ffprobe 메타추출 · silencedetect · 렌더 명령 생성
│   └── whisper.ts          # Whisper 연동 인터페이스 (3단계)
└── storage.ts              # 업로드/출력/B-roll 폴더 관리

app/
├── page.tsx                # 상태 오케스트레이션 (실시간 편집 계획 재생성)
├── globals.css             # 토스풍 흰색/파랑 디자인 시스템
└── api/
    ├── env/route.ts        # 로컬/서버리스 환경 정보 (UI 활성화 판단)
    ├── upload/route.ts     # mp4 업로드 + 메타 추출 (서버리스는 브라우저 분석)
    ├── broll/route.ts      # B-roll 폴더 스캔 (서버리스는 빈 목록)
    └── render/route.ts     # ffmpeg 렌더링 (서버리스/미설치 시 명령어 반환)

public/
└── sample-transcript.json  # "샘플 자막으로 바로 체험하기" 데이터

components/
├── Uploader.tsx            # 영상 · transcript 업로드
├── SettingsPanel.tsx       # 프리셋 + 세부 설정
├── ResultsPanel.tsx        # 통계 · 다운로드 · 렌더
├── Timeline.tsx            # 타입별 편집 타임라인
└── EditList.tsx            # 적용된 편집 리스트 (자막 강조 미리보기)
```

### 편집 파이프라인

```
transcript + settings + videoMeta
        │
        ▼
  buildEditPlan()  ──►  각 편집 모듈이 EditEvent[] 생성
        │                 (cut / subtitle / zoom / spotlight / broll / popup)
        ▼
     EditPlan  ──►  edit-plan.json (다운로드) ──► ffmpeg 렌더 (1080p mp4)
```

`edit-plan.json` 하나만 있으면 어떤 렌더러든 결과 영상을 재현할 수 있습니다.

---

## ✨ 구현된 기능 (MVP)

| # | 기능 | 상태 |
|---|------|------|
| 1 | 영상 업로드 + 메타(길이/해상도/용량/FPS) 표시 | ✅ |
| 2 | 자동 컷 편집 (무음 구간, 설정 4종) | ✅ (transcript 기반, ffmpeg silencedetect 연동 준비) |
| 3 | 자동 자막 (transcript.json 업로드) | ✅ (Whisper 연동 인터페이스 준비) |
| 4 | 핵심 키워드 자동 강조 (색상/크기/bold) | ✅ |
| 5 | 자동 줌 (약한 줌인/줌아웃, 부드럽게) | ✅ |
| 6 | 스포트라이트 (중요 문장 감지) | ✅ |
| 7 | B-roll 자동 삽입 후보 + 카테고리 추천 | ✅ |
| 8 | 팝업 텍스트 (금액/위험, 최소 간격 제한) | ✅ |
| 9 | 편집 강도 프리셋 3종 | ✅ |
| 10 | 결과 미리보기 (타임라인 + 편집 리스트) | ✅ |
| 11 | edit-plan.json 다운로드 + 1080p 렌더 구조 | ✅ |

---

## 🗺 로드맵

- **1단계 (현재)**: 구조 · UI · 편집 계획 생성 · edit-plan.json · ffmpeg 렌더 기본 골격
- **2단계**: ffmpeg `filter_complex` 로 자막/줌/스포트라이트/B-roll/팝업 실제 렌더링
- **3단계**: whisper.cpp / faster-whisper 자동 자막 (`lib/render/whisper.ts` 어댑터 구현)
- **4단계**: B-roll 추천 알고리즘 고도화 (임베딩 기반 문맥 매칭)

---

## 📁 B-roll 폴더 구조

`storage/broll/<category>/` 아래에 짧은 클립을 넣어두면 자동 매칭됩니다.

```
storage/broll/
├── government/   # 정책자금·지원금
├── tax/          # 법인세·절세
├── money/        # 금액·자금
├── document/     # 서류·신고
├── business_owner/
├── office/
└── meeting/      # 상담·계약
```

카테고리: `office`, `money`, `meeting`, `document`, `tax`, `government`, `business_owner`
