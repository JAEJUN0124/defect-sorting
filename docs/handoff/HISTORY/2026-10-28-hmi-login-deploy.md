---
date: 2026-10-28
type: checkpoint
branch: main
items: [hmi-login, hmi-web]
decisions: [D-017, D-023]
corrects: null
source: null
---
# 밖 주소 로그인 배포, 비밀번호 넣기, 검색 막기

## 요약
- 로그인 비밀번호를 Worker 비밀값으로 넣었다(`set-password.py`, 사용자가 터미널에서 직접 입력). 로그인 코드를 배포하기 전에 넣었다(그때 돌던 41b79c8 코드는 이 값을 쓰지 않음).
- 사용자 요청("검색 서치 되면 막아놓고")으로 검색에 걸리지 않게 했다: `hmi-web-mockup/react/public/robots.txt`(모든 경로 막기)와 조작 화면의 `<meta name="robots" content="noindex, nofollow">`. `feature/hmi-noindex`(64e0b6d, 29cafc0)를 main에 fast-forward로 합쳤다.
- main 29cafc0를 Cloudflare에 배포했다. 로그인(hmi-login)과 검색 막기가 함께 올라갔다. 화면 주소 Access 앱은 지우지 않아 지금도 이메일 확인을 거친다.
- 첫 배포에서 원점 KV(`defect-hmi-home`)가 자동으로 만들어졌고, 로그인 시도 제한(`LOGIN_LIMIT`, 5회/60초)이 무료 플랜에서 오류 없이 받아졌다. 10-27에 남긴 "무료 플랜에서 되는지" 공백은 이것으로 닫는다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-login | 완료 | 완료 | 완료 | 미실행 |
| hmi-web | 완료 | 완료 | 완료 | 부분 |

## 근거
- 직접: `set-password.py` 출력 "SESSION_KEY 넣음", "HMI_PASSWORD 넣음", 뒤이어 `wrangler secret list`에 `CF_ACCESS_CLIENT_ID`·`CF_ACCESS_CLIENT_SECRET`·`HMI_PASSWORD`·`SESSION_KEY` (2026-10-28). 비밀번호 값은 보지 않았다.
- 직접: 시험 147/147 (`node --test "hmi-web-mockup/tests/*.test.js"`, React 빌드 포함), `config.test.js`에 Cloudflare 폴더의 robots.txt·noindex 검사를 더함. robots.txt가 CRLF로 받아져도 맞게 29cafc0에서 고침 (2026-10-28)
- 직접: wrangler dev(`hmi-cloudflare-dev`)에서 `/robots.txt` 200 `text/plain`과 조작 화면 `noindex, nofollow`, 화면은 그대로 뜸 (2026-10-28)
- 직접: `npm --prefix hmi-web-mockup/cloudflare run deploy` 출력 — 바뀐 파일 6개(`/robots.txt` 포함) 올림, KV `defect-hmi-home` 만듦, 바인딩 `HOME`·`LOGIN_LIMIT (5 requests/60s)`·`ASSETS`·`ORIGIN`, Worker 버전 e54085ab-caea-4cbe-bd75-061d9e7545fa, 저장소 파일은 바뀌지 않음 (2026-10-28)
- 직접: 배포 뒤 curl — `https://hmi.hypefree.net/`·`/robots.txt`·`/auth/session`은 302로 Access 로그인, `https://hmi-origin.hypefree.net/`은 401 (2026-10-28)
- 사용자: "되면 막아놓고 ㅇㅇ", "커밋", "배포" (대화, 2026-10-28)

## 남은 공백·다음
- 실제 주소에서 로그인·원점 잡기·로그아웃 뒤 원점 복귀는 확인하지 않음. 서버 터널이 끊겨 있어(2026-10-28-server-move.md) 지금은 서버 쪽 동작도 볼 수 없음
- 다음: 터널이 붙은 뒤 docs/cloudflare.md "로그인으로 바꾸기" 3~6번(Access 있는 채로 확인 → 화면 주소 Access 앱만 지움 → 시크릿 창 확인)
- 검색 막기는 접속을 막지 않음(인증서 공개 기록으로 주소가 알려짐) — CURRENT 제한으로 둠
- 이전 기준값: 배포 소스 41b79c8, Worker 버전 9753c683-75e8-40fb-ae84-ad4badc6b4a6 (2026-10-19)

## 관련
- 결정: D-017, D-023 (바꾸지 않음)
