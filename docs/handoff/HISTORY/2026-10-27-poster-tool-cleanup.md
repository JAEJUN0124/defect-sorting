---
date: 2026-10-27
type: completion
branch: main
items: [poster]
decisions: []
corrects: null
source: null
---
# 포스터 작업 때 깐 플러그인·런타임을 지움

## 요약
- 사용자 요청으로 포스터 작업(HISTORY/2026-10-27-poster-v7-v8.md) 때 새로 깐 것을 지웠다.
  - Make Poster 플러그인: 이 폴더(local) 설치를 해제하고, 플러그인이 내려받은 파일(`~/.claude/plugins/cache/anthropic-plugin-directory/make-poster`, 약 70KB)도 지웠다.
  - 렌더 런타임: 세션 임시 폴더에 받은 Playwright·Chromium·qrcode·pdf-lib(약 765MB)를 지웠다.
  - `%TEMP%\mp-browsers` 정션: 링크만 지웠다.
  - 세션 임시 폴더의 작업 파일(확대·흑백 미리보기, 시험용 PDF, 실행 스크립트)을 지웠다.
- CURRENT 기준 상태의 "포스터 도구" 줄은 이전 값 "Make Poster 플러그인을 이 PC의 이 폴더에만 켜 둠(local)"에서 지금 값(플러그인·런타임 지움, `python poster/build.py v8`이 Edge로 뽑음)으로 고쳤다. 공백 "렌더 런타임과 정션을 지울지 미정"은 닫아 CURRENT에서 뺐다.
- 저장소의 포스터 결과물(`poster/v7/`, `poster/v8/`)과 `poster/build.py`는 그대로다.

## 근거
- 사용자: "포스터 만든다고 추가로 깔았던것들은 지우자" (대화, 2026-10-27)
- 직접: `claude plugin uninstall make-poster@anthropic-plugin-directory --scope local` 성공, `claude plugin list` "No plugins installed", `installed_plugins.json`의 플러그인 목록이 빔 (2026-10-27)
- 직접: 설치 해제 뒤에도 플러그인 캐시 폴더가 실행 중인 Claude 프로세스 두 개의 사용 중 표시와 함께 남아 있어 직접 지움 (tasklist, 2026-10-27)
- 직접: 정션은 `rmdir`로 링크만 지운 뒤 대상 폴더가 그대로인 것을 확인하고, 런타임과 작업 파일을 지운 뒤 남지 않은 것을 확인 (2026-10-27)
- 직접: `%TEMP%`의 playwright 폴더 두 개는 2026-09-15·2026-09-25에 생긴 것 (ls, 2026-10-27)

## 조치
- 이번 정리는 일회성이며 다시 실행하지 않는다.
- 그대로 둔 것
  - `%TEMP%`의 playwright 폴더 두 개: 이번 작업 전부터 있던 것이라 이번 작업과 무관
  - `.claude/settings.local.json`: 빈 `enabledPlugins`만 남음(git 밖)
  - Claude Code의 플러그인 목록 파일(`installed_plugins.json` 등): 빈 목록
  - npm 공용 다운로드 캐시: 런타임 패키지 사본이 있을 수 있으나, 비우면 다른 프로젝트 캐시까지 지워짐

## 남은 제한
- 플러그인 스크립트로 포스터를 다시 뽑으려면 플러그인 설치와 런타임(약 765MB) 받기가 다시 필요하고, Windows 경로 길이 제한 때문에 브라우저 경로를 짧게 둬야 한다(HISTORY/2026-10-27-poster-v7-v8.md). `python poster/build.py v8`은 플러그인 없이 Edge로 뽑는다.

## 남은 공백·다음
- 다음: 지정 없음

## 관련
- 결정: 없음
- 이전 기록: HISTORY/2026-10-27-poster-v7-v8.md
