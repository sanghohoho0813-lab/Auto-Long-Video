# 🖥️ 로컬에서 실제 렌더링 테스트하기 (비개발자용 단계별 안내)

Vercel에서는 분석 · edit-plan 생성까지만 되고, **실제 mp4 렌더링과 Whisper 자동 자막은
내 PC(로컬)에서만** 동작합니다. 아래 순서대로 터미널에 명령어를 복사해서 붙여넣으세요.

> 터미널 열기 — **Mac**: `응용 프로그램 > 유틸리티 > 터미널` · **Windows**: 시작 메뉴에서
> `PowerShell` 검색 후 실행

---

## 0. 준비물 설치 (처음 한 번만)

### Node.js (필수)
- https://nodejs.org 에서 **LTS 버전** 설치 (18.18 이상)
- 설치 확인:
  ```bash
  node -v
  npm -v
  ```
  버전 숫자가 나오면 OK.

### Git (필수)
- **Mac**: 터미널에 `git --version` 입력 → 없으면 설치 안내가 뜸(설치 진행)
- **Windows**: https://git-scm.com/download/win 에서 설치

---

## 1. GitHub에서 코드 받기

```bash
git clone https://github.com/sanghohoho0813-lab/Auto-Long-Video.git
cd Auto-Long-Video
git checkout claude/longform-video-auto-editor-po8uyu
```

> 나중에 최신 코드로 업데이트할 때는 `Auto-Long-Video` 폴더 안에서:
> ```bash
> git pull
> ```
> (PR #1을 `main`에 병합한 뒤라면 `git checkout main` 후 `git pull` 로 받아도 됩니다.)

---

## 2. 설치 & 실행

```bash
npm install
npm run dev
```

- `npm install` 은 처음 한 번만 하면 됩니다(몇 분 걸릴 수 있음).
- `npm run dev` 실행 후 이런 줄이 보이면 성공:
  ```
  ▲ Next.js  ...
  - Local: http://localhost:3000
  ```
- 브라우저에서 **http://localhost:3000** 접속.
- 이 터미널 창은 **끄지 마세요**(서버가 계속 돌아갑니다). 나중에 종료는 `Ctrl + C`.

---

## 3. ffmpeg 설치 확인 (실제 렌더링에 필수)

먼저 확인:
```bash
ffmpeg -version
ffprobe -version
```
버전이 나오면 OK. **"command not found" 나오면 설치**하세요.

- **Mac** (Homebrew):
  ```bash
  brew install ffmpeg
  ```
  (Homebrew가 없으면 https://brew.sh 참고)
- **Windows**:
  ```powershell
  winget install --id Gyan.FFmpeg -e
  ```
  설치 후 **터미널을 껐다 다시 열고** `ffmpeg -version` 재확인.

---

## 4. Whisper 설치 확인 (자동 자막에 필요)

> 자동 자막이 필요 없으면 이 단계는 건너뛰고, 대신 `transcript.json` 을 직접 업로드하거나
> 화면의 “⚡ 샘플로 편집 계획 생성”을 쓰면 됩니다.

먼저 확인:
```bash
whisper-ctranslate2 --help
```
도움말이 나오면 OK. 없으면 설치(파이썬 필요):

- **Mac**:
  ```bash
  pip3 install whisper-ctranslate2
  ```
- **Windows**:
  ```powershell
  pip install whisper-ctranslate2
  ```
  (파이썬이 없으면 https://www.python.org/downloads 에서 설치 — 설치 시
  “Add Python to PATH” 체크)

> ⚠️ **자동 자막을 처음 실행하면** 인식 모델을 자동으로 내려받습니다(수백 MB, 몇 분 소요).
> 한국어는 조금 더 정확한 모델을 쓰려면 `npm run dev` 대신 아래처럼 실행하세요:
> - Mac/Linux: `WHISPER_MODEL=small npm run dev`
> - Windows(PowerShell): `$env:WHISPER_MODEL="small"; npm run dev`

### 설치가 잘 됐는지 한눈에 확인
브라우저에서 **http://localhost:3000/api/env** 접속 → 다음이 보이면 준비 완료:
```json
{ "ffmpeg": true, "whisper": true, "whisperBackend": "faster-whisper", ... }
```
`false` 면 해당 항목(3번/4번)을 다시 설치하세요.

---

## 5. mp4 업로드

1. http://localhost:3000 접속
2. 왼쪽 **“mp4 영상 업로드”** 영역 클릭 → 편집할 영상 선택
3. 업로드되면 길이 · 해상도 · 용량이 표시됩니다.

---

## 6. 자동 자막 생성

1. **“🎙️ 영상에서 자동 자막 생성”** 버튼 클릭
2. “음성 인식 중…” 이 뜨면 기다립니다(처음엔 모델 다운로드로 더 걸림)
3. 완료되면 자막 구간 수가 표시되고, 편집 계획이 자동 생성됩니다.

> 버튼이 비활성(회색)이면: 영상을 먼저 업로드했는지 / Whisper가 설치됐는지(4번) 확인.

---

## 7. “김팀장 기본” 프리셋 선택

가운데 **편집 설정** 패널에서 **🧑‍💼 김팀장 기본** 버튼 클릭.
(대표님/컨설턴트 롱폼에 맞춘 절제된 값 — B-roll 45초·줌 10초·팝업 30초)

아래 **테스트 리포트**에서 판정이 **적절 / 다소 많음 / 매우 많음** 중 무엇인지 확인하세요.
“다소 많음” 이상이면 프리셋을 “얌전하게”로 바꿔도 됩니다.

---

## 8. 0~60초 미리 렌더 (짧게 먼저!)

> ⏱ 20~40분 전체를 처음부터 렌더하지 마세요. 먼저 1분만 확인합니다.

1. 결과 영역의 **“🔎 테스트 구간 먼저 렌더”** 에서 **“0~60초 미리 렌더”** 클릭
2. 진행바가 **0% → 100%** 로 올라갑니다(단계·소요시간 표시).
3. 완료되면 **“⬇️ 결과 mp4 다운로드”** 버튼이 나타납니다.

특정 구간을 보고 싶으면 `start`/`end` 초를 입력하고 **“선택 구간 미리 렌더”**.

---

## 9. 결과 mp4 위치

- **화면에서**: “⬇️ 결과 mp4 다운로드” 버튼 클릭 → 브라우저 다운로드 폴더에 저장
- **PC 폴더에서 직접**: 프로젝트 폴더 안
  ```
  Auto-Long-Video/storage/output/
  ```
  예: `main_preview_0-60s_edited.mp4` (미리 렌더), `main_edited.mp4` (전체 렌더)

결과가 만족스러우면 마지막에 **“🎬 전체 렌더링 시작”** 으로 전체 영상을 렌더하세요.

---

## 10. 오류가 나면 — 이 로그들을 복사해서 보내주세요

문제가 생기면 아래 3가지를 복사해 주시면 원인을 빠르게 찾을 수 있습니다.

1. **서버 로그** — `npm run dev` 를 실행한 터미널 창의 **빨간 에러 메시지 전체**
   (특히 `ffmpeg`, `종료 코드`, `Error` 가 들어간 줄)
2. **화면 안내 문구** — 앱 결과 영역에 뜬 **빨간 경고/에러 박스의 글자**
3. **환경 확인 값** — 브라우저에서 http://localhost:3000/api/env 접속 후 나오는
   내용 전체 (특히 `ffmpeg`, `whisper`, `whisperBackend` 값)

추가로 도움이 되는 것:
- 브라우저 개발자도구 콘솔: **F12 → Console 탭**의 빨간 줄
- 어떤 단계에서 멈췄는지(예: “6번 자동 자막에서 멈춤”)

---

### 자주 겪는 문제 빠른 해결
| 증상 | 확인/해결 |
|------|-----------|
| “전체 렌더링/미리 렌더” 버튼이 회색 | 영상 업로드했는지 · `/api/env` 의 `ffmpeg:true` 확인 |
| 자동 자막 버튼 회색 | `/api/env` 의 `whisper:true` 확인, 4번 재설치 |
| `ffmpeg: command not found` | 3번 설치 후 터미널 껐다 다시 열기 |
| 자동 자막이 매우 느림 | 최초 1회 모델 다운로드 때문 — 잠시 기다리기 |
| 렌더가 오래 걸림 | 긴 영상은 정상. 먼저 0~60초 미리 렌더로 확인 |
| 한국어 자막 정확도 아쉬움 | `WHISPER_MODEL=small` 로 재실행(위 4번 참고) |
