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
    ├── env/route.ts        # 로컬/서버리스 · ffmpeg/whisper 감지 (UI 활성화 판단)
    ├── upload/route.ts     # mp4 업로드 + 메타 추출 (서버리스는 브라우저 분석)
    ├── broll/route.ts      # B-roll 폴더 스캔 (서버리스는 빈 목록)
    ├── transcribe/route.ts # Whisper 자동 자막 (로컬 전용, 서버리스는 안내)
    ├── render/route.ts     # ffmpeg 렌더링 (서버리스/미설치 시 명령어 반환)
    └── download/route.ts   # 렌더 결과/transcript 파일 다운로드

public/
└── sample-transcript.json  # "샘플 자막으로 바로 체험하기" 데이터

components/
├── Uploader.tsx            # 영상 · transcript 업로드
├── SettingsPanel.tsx       # 프리셋 + 세부 설정
├── ResultsPanel.tsx        # 통계 · 다운로드 · 실제 렌더/명령 · 결과 다운로드
├── HelpPanel.tsx           # 워크플로우 + 환경(가능/제한) 안내
├── Timeline.tsx            # 타입별 편집 타임라인
└── EditList.tsx            # 적용된 편집 리스트 (자막 강조 미리보기)
```

### 렌더 파이프라인 (lib/render)

```
render/
├── timeline.ts             # 컷 반영 후 이벤트 시각 리맵(오버레이 어긋남 방지)
├── ass.ts                  # 자막(키워드 강조) + 팝업 → ASS 자막 파일 생성
├── filtergraph.ts          # EditPlan → ffmpeg filter_complex
├── ffmpeg.ts               # 구성/실행(probe·compose·args·renderPlan·진행률)
├── jobs.ts                 # 렌더 잡 상태 저장(단계·진행률·소요시간)
└── whisper.ts              # Whisper 자동 자막(멀티 백엔드 CLI 어댑터)
```

비디오 필터 체인: **컷 → 1080p 스케일 → 줌 → 스포트라이트 → B-roll → 자막(ASS)**

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

## 🎬 실제 ffmpeg 렌더링 (로컬)

로컬 환경(ffmpeg 설치됨)에서는 edit-plan 을 실제 1080p mp4 로 렌더링합니다.
`filter_complex` 로 아래 효과를 합성합니다.

| 효과 | 구현 방식 |
|------|-----------|
| 컷 편집 | `trim` + `concat` 후 나머지 이벤트 시각을 출력 타임라인으로 **리맵** |
| 1080p 스케일 | 원본 비율 유지(세로 1080 기준, 짝수 폭 보정) |
| 줌 | `zoompan` — 구간마다 raised-cosine 로 1.0→Z→1.0 부드럽게 |
| 스포트라이트 | `drawbox` 반투명 검정으로 전체 화면 살짝 어둡게(자막은 위에 밝게) |
| 자막 + 키워드 강조 | **ASS** 자막 — 단어별 색상/굵기/크기(110~130%) 인라인 태그 |
| 팝업 | ASS 상단 중앙 스타일(금액/경고/체크별 색상) |
| B-roll | 클립을 입력으로 추가 → `overlay`(원본 오디오 유지) *(구조 준비, 파일 있으면 동작)* |

**요구사항**: 로컬에 `ffmpeg` / `ffprobe` 설치. 한글 자막을 위해 한글 폰트(예:
`fonts-nanum`, Noto Sans CJK) 권장. 미설치 시 UI 는 실제 렌더 대신 **ffmpeg 명령어만**
보여줍니다.

**흐름**: `실제 렌더링 시작` → `/api/render`(POST, 잡 생성 후 백그라운드 렌더 · `jobId` 반환)
→ UI 가 `GET /api/render?jobId=...` 를 **1초마다 폴링**해 단계·진행률(%)·소요시간 표시
→ 완료 시 `storage/output/<name>_edited.mp4` → **결과 mp4 다운로드**(`/api/download`).

진행 단계: `렌더링 준비 → 입력·자막 준비 → ffmpeg 실행(효과·자막, %) → 마무리 → 완료`.
10분 이상 영상은 오래 걸릴 수 있다는 안내를 표시하며, 창을 닫아도 서버에서 렌더는 계속됩니다.

> ⚠️ Vercel(서버리스)에서는 실제 렌더링을 실행하지 않고 명령어만 반환합니다.
> 긴 영상은 렌더링에 수 분 이상 걸릴 수 있습니다.

---

## 🧪 베타 테스트 & 튜닝 모드

실제 김팀장의 경영 노트 롱폼 영상으로 결과가 과하지 않은지 빠르게 확인·튜닝합니다.

**베타 테스트 순서** (앱 하단 안내에도 표시)
1. mp4 업로드
2. 🎙️ 자동 자막 생성 (또는 transcript.json 업로드)
3. edit-plan 확인 (타임라인 · 편집 리스트)
4. 효과 빈도 확인 (테스트 리포트 · 과다 경고)
5. **1~2분 구간만 먼저** “테스트 구간 렌더”
6. 결과 확인 후 “전체 렌더링”

> ⏱ 처음부터 20~40분 전체를 렌더하지 마세요. 짧은 구간으로 먼저 확인하세요.

**테스트 구간 렌더** — `start`/`end` 초를 입력하거나 “0~60초 미리 렌더” 버튼으로
해당 구간만 렌더합니다. 구간에 포함된 edit-plan 이벤트만 잘라 시각을 0초 기준으로
당겨 적용하고(`lib/render/preview.ts`), 입력은 `-ss start -t dur` 로 잘라 읽습니다.
결과 파일명에 `_preview_<start>-<end>s` 가 붙습니다. (서버리스는 명령만 반환)

**테스트 리포트 & 효과 과다 경고** — edit-plan 생성 즉시 요약 리포트를 보여줍니다.
총 길이 · 자막/컷/줌/스포트라이트/B-roll/팝업 수 · **분당 효과 수** · 판정(적절/다소
많음/매우 많음). 분당 임계값(B-roll 3 · 팝업 4 · 스포트라이트 5 · 줌 10)을 넘으면
경고와 함께 “얌전하게/김팀장 기본” 프리셋을 권장합니다.

**프리셋** — `김팀장 기본`(B-roll 45초·줌 10초·팝업 30초·스포트 0.12·강조 1.15,
대표님/컨설턴트 롱폼용 절제된 값) · `얌전하게` · `기본` · `생동감 있게`.

---

## 🎙️ Whisper 자동 자막 (로컬)

mp4 만 업로드하면 음성을 인식해 transcript 를 자동 생성합니다.
UI 의 **"🎙️ 영상에서 자동 자막 생성"** → `/api/transcribe`(로컬 실행) → segments 반환
→ 그 자막으로 edit-plan 이 자동 생성되고, `transcript.json` 도 내려받을 수 있습니다.

**흐름**: mp4 → (ffmpeg 로 16kHz mono wav 추출) → Whisper CLI → SRT → `TranscriptSegment[]`

**지원 백엔드**(설치된 것을 자동 감지, 한국어 `ko` 기본):

| 백엔드 | 설치 | 감지 조건 |
|--------|------|-----------|
| faster-whisper | `pip install whisper-ctranslate2` | `whisper-ctranslate2` CLI |
| openai-whisper | `pip install -U openai-whisper` | `whisper` CLI |
| whisper.cpp | 빌드 후 `WHISPER_CPP_MODEL=<ggml 모델>` | `whisper-cli`/`main` + 모델 |
| custom | `WHISPER_CUSTOM_CMD` 환경변수 | 언제나(임의 whisper 연결) |

`WHISPER_CUSTOM_CMD` 는 `{{audio}}`, `{{srt}}`, `{{outdir}}`, `{{lang}}`, `{{model}}`
토큰을 치환하는 명령 템플릿으로, 어떤 whisper 든 연결할 수 있습니다.
기본 모델은 `WHISPER_MODEL`(기본 `base`)로 바꿀 수 있습니다.

**안전장치**: 미설치 시 UI 에 설치 안내 표시 · 긴 영상/최초 모델 다운로드 지연 안내 ·
실패 시 에러 메시지 · 한국어 인식 기본.

> ⚠️ Vercel(서버리스)에서는 Whisper 를 실행하지 않고 "로컬/워커에서 실행 예정" 안내만
> 반환합니다. 이때는 transcript.json 을 직접 업로드하거나 샘플을 사용하세요.

---

## ✨ 구현된 기능 (MVP)

| # | 기능 | 상태 |
|---|------|------|
| 1 | 영상 업로드 + 메타(길이/해상도/용량/FPS) 표시 | ✅ |
| 2 | 자동 컷 편집 (무음 구간, 설정 4종) | ✅ (transcript 기반, ffmpeg silencedetect 연동 준비) |
| 3 | 자동 자막 (transcript.json 업로드 + **Whisper 자동 인식**) | ✅ (로컬 전용) |
| 4 | 핵심 키워드 자동 강조 (색상/크기/bold) | ✅ |
| 5 | 자동 줌 (약한 줌인/줌아웃, 부드럽게) | ✅ |
| 6 | 스포트라이트 (중요 문장 감지) | ✅ |
| 7 | B-roll 자동 삽입 후보 + 카테고리 추천 | ✅ |
| 8 | 팝업 텍스트 (금액/위험, 최소 간격 제한) | ✅ |
| 9 | 편집 강도 프리셋 3종 | ✅ |
| 10 | 결과 미리보기 (타임라인 + 편집 리스트) | ✅ |
| 11 | edit-plan.json 다운로드 + **실제 1080p 렌더링(로컬)** | ✅ |

---

## 🗺 로드맵

- **1단계**: 구조 · UI · 편집 계획 생성 · edit-plan.json · ffmpeg 렌더 기본 골격 ✅
- **2단계 (현재)**: ffmpeg `filter_complex` 로 컷/자막·강조/줌/스포트라이트/팝업 **실제 렌더링** ✅
  (B-roll 오버레이 구조 준비 · 로컬 전용 · Vercel 은 명령만 반환)
- **3단계 (현재)**: Whisper 자동 자막 ✅ — faster-whisper / openai-whisper / whisper.cpp /
  custom CLI 백엔드 자동 감지, mp4 → transcript 자동 생성 (로컬 전용, Vercel 은 안내만)
- **4단계 (현재)**: B-roll 추천 고도화(warning/checklist 카테고리 · 키워드 사전 확장 ·
  최근 카테고리 회피 · 최소 간격) + 실제 overlay 렌더 + **렌더 진행률 표시(잡 폴링)** ✅
- **다음**: 임베딩 기반 B-roll 문맥 매칭, 렌더 워커 분리(진행률 스트리밍/큐)

---

## 📁 B-roll 폴더 구조

`storage/broll/<category>/` 아래에 짧은 클립(3~5초 권장)을 넣어두면,
transcript 키워드에 맞춰 자동으로 골라 삽입됩니다.
지원 확장자: **mp4 · mov · webm** (그 외 mkv·m4v 도 스캔).

| 폴더 | 이럴 때 삽입 | 어떤 영상을 넣으면 좋은지 (예시) |
|------|-------------|-------------------------------|
| `tax` | 법인세·세액공제·절세·감면 | 세금 계산서, 세무 서류, 계산기 두드리는 손, 세무서 |
| `document` | 서류·신고·요건·절차 | 서류 넘기는 장면, 계약서, 결재판, 도장 찍기 |
| `government` | 정책자금·지원금·정부·소상공인 | 정부청사, 관공서 간판, 정책 안내 포스터, 태극기 |
| `money` | 매출·자금·현금·지원금 | 지폐/동전, 통장, 카드 결제, 그래프 상승 |
| `business_owner` | 대표님·사업자·사장님·법인 | 대표 인터뷰컷, 사무실의 대표, 명함, 악수 |
| `office` | 회사·직원·창업 | 사무실 전경, 노트북 작업, 회의실, 협업 장면 |
| `meeting` | 계약·상담·미팅·컨설팅 | 미팅 테이블, 상담 장면, 화상회의, 서류 검토 |
| `warning` | 위험·놓치면·불이익·주의·손해 | 경고 아이콘, 빨간불, 하락 그래프, 마감 시계 |
| `checklist` | 체크·확인·준비물·요건·단계 | 체크리스트 표시, 리스트 항목, 도장/확인 마크 |

```
storage/broll/
├── tax/            ├── government/     ├── business_owner/   ├── meeting/
├── document/       ├── money/          ├── office/           ├── warning/
└── checklist/
```

> 파일이 없어도 편집 계획은 정상 생성되며, 해당 B-roll 은 "추천 카테고리만 생성 /
> 파일 없음"으로 표시됩니다. 렌더 시에도 파일이 있는 B-roll 만 실제로 오버레이됩니다
> (없으면 안전하게 건너뜀 · 원본 오디오 유지).
