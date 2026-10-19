---
date: 2026-10-19
type: checkpoint
branch: main
items: [hmi-web]
decisions: [D-021]
corrects: null
source: null
---
# 컨베이어를 장치 연결 줄에 늘 켜짐으로 보이기, main 통합·Cloudflare 배포

## 요약
- D-021에 따라 조작 화면의 장치 연결 줄에서 컨베이어를 서버 값과 상관없이 "항상 켜짐"(초록 불)으로 보인다. 설정은 `hmi-web-mockup/js/config.js`의 `alwaysOn: ['conveyor']`이고, 주소 뒤 `?alwaysOn=`(쉼표로 여럿, 비우면 없음)이 설정보다 우선한다. 문구는 `devices.alwaysOn`("항상 켜짐", `hmi-web-mockup/js/i18n/ko.js`), 화면은 `hmi-web-mockup/react/src/App.jsx`의 장치 연결 줄이다.
- 기술 판단: 보이는 것만 바꿨다. 서버가 보낸 값(store의 `status.devices`)은 그대로 두고, 장치가 끊겨 거절된 안내를 지우는 것도 서버 값으로 한다 — 서버가 컨베이어 때문에 거절한 이유가 다음 상태에서 바로 지워지지 않게 하려는 것이다. 가짜 서버에서는 늘 켜짐 장치의 끊김 흉내 버튼을 잠갔다(눌러도 화면이 바뀌지 않아 헷갈리므로).
- HMI는 원래 컨베이어 값으로 키를 막지 않았다(장치 연결 줄의 불과 거절 안내 지우기에만 씀). 가짜 서버(`hmi-web-mockup/js/mock-server.js`)는 바꾸지 않았다 — 가짜 컨베이어는 처음부터 연결이다.
- 문서: hmi-web-mockup/README.md(주소 뒤 설정 표·장치 연결 상태), docs/xml-protocol.md 2.3(`Conveyor/@connected` 줄).
- 작업 브랜치 `feature/conveyor-always-on`에서 커밋 41b79c8로 묶어 main에 fast-forward로 합치고, Cloudflare에 다시 배포했다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-web | 완료 | 완료 (41b79c8) | 완료 (Cloudflare, 소스 41b79c8) | 부분 |

## 근거
- 직접: 시험 127/127 — config.js `alwaysOn` 기본값·주소 덮어쓰기 시험 추가 (node --test, 2026-10-19). React 패키지를 받기(`npm ci`) 전에는 빌드가 필요한 시험 4개가 건너뛰어 123 통과·4 건너뜀이었다
- 직접: 가짜 서버(개발 서버 5174)에서 "컨베이어 항상 켜짐"·흉내 버튼 잠김, 다른 장치 버튼은 그대로 (브라우저, 2026-10-19)
- 직접: 시험용 XML 서버(`xml-server-plain`, 컨베이어·로봇팔 끊김을 보냄)에서 "서버 · 컨베이어 항상 켜짐 · 로봇팔 끊김", store의 서버 값은 컨베이어 `disconnected` 그대로. `?alwaysOn=`이면 "컨베이어 끊김". 콘솔 오류 없음 (브라우저, 2026-10-19)
- 직접: 커밋 41b79c8, main fast-forward (git, 2026-10-19)
- 직접: Worker 버전 9753c683-75e8-40fb-ae84-ad4badc6b4a6, 소스 41b79c8, `hmi.hypefree.net`(사용자 지정 도메인). 바뀐 파일 5개를 올림 — index.html, js/config.js, js/i18n/ko.js, React 묶음, js/xml-protocol.js(git상 0275acf와 내용이 같음) (`npm --prefix hmi-web-mockup/cloudflare run deploy` 출력, 2026-10-19)
- 사용자: Access 로그인 뒤 배포 화면 "확인 완료" (대화, 2026-10-19)

## 경위
- 이전 배포는 소스 0275acf, Worker 버전 5d9533ea-1e95-4ea5-b7fd-19dfa2e79cae(2026-10-17)였다. 0275acf 뒤 화면 파일을 바꾼 커밋은 41b79c8 하나다.
- 이 PC에는 배포 도구가 없어 `npm ci --prefix hmi-web-mockup/cloudflare`로 wrangler 4.147.0을 받았다. wrangler 로그인도 없어(`wrangler whoami` → not authenticated) 사용자가 로그인했고(안내: PowerShell에서 `hmi-web-mockup/cloudflare`로 가서 `npx.cmd wrangler login`), `wrangler whoami`로 로그인을 확인한 뒤 배포했다. 배포 전에 `wrangler deploy --dry-run`으로 화면 파일 27개와 터널 주소 설정을 확인했다.
- 배포 화면(`hmi.hypefree.net`)은 Cloudflare Access 로그인(이메일 일회용 코드)이 먼저 나와 앱 브라우저에서 바로 볼 수 없었고, 사용자가 로그인해 확인했다.

## 남은 공백·다음
- 컨베이어가 실제로 끊겨도 화면은 켜짐으로 보인다. 컨베이어를 붙여 실제 값을 볼 때는 `alwaysOn`을 `[]`로 바꾸거나 주소 뒤 `?alwaysOn=`을 붙인다.
- 서버에 보낼 문서의 `DevicesNotReady`(컨베이어 포함) 요청은 그대로다 (HISTORY/2026-10-19-conveyor-always-on-decision.md).

## 관련
- 결정: D-021
- 이전 기록: HISTORY/2026-10-17-texts-percent-angle.md
