# 🎬 김팀장의 롱폼 자동편집기

유튜브 롱폼 강의/해설 영상을 올리기 전에, 원본 영상을 넣으면 자동으로
**컷 편집 · 자막 강조 · 키워드 강조 · 줌 효과 · 스포트라이트 · B-roll 삽입 · 팝업 텍스트**를
적용해주는 **로컬 웹앱**입니다.

감마 AI PDF 강의처럼 정적인 화면 녹화 영상을 더 세련되게 만드는 것이 목표입니다.

---

## 🚀 실행 방법

```bash
npm install
npm run dev
# http://localhost:3000
```

> Node.js 18+ 필요. 실제 렌더링을 하려면 `ffmpeg` / `ffprobe` 설치가 필요합니다.
> (미설치 상태에서도 편집 계획 생성 · 미리보기 · `edit-plan.json` 다운로드는 모두 동작합니다.)

### 빠른 체험

1. `npm run dev` 실행 후 브라우저 접속
2. mp4 영상 업로드 (없으면 transcript 만으로도 편집 계획 생성 가능)
3. `storage/sample-transcript.json` 을 transcript 로 업로드
4. 프리셋 선택 → 편집 계획 자동 생성 → `edit-plan.json` 다운로드

---

## 🧩 아키텍처

영상 처리 로직은 **순수 함수 모듈**로 분리해 서버/클라이언트 어디서든 재사용하고,
새 편집 효과를 쉽게 추가할 수 있게 설계했습니다.

```
lib/
├── types.ts                # 공통 타입 (EditPlan, EditEvent, EditSettings ...)
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
    ├── upload/route.ts     # mp4 업로드 + 메타 추출
    ├── broll/route.ts      # B-roll 폴더 스캔
    └── render/route.ts     # ffmpeg 렌더링 (미설치 시 명령어 반환)

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
