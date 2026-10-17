---
date: 2026-10-17
type: checkpoint
branch: feature/cloudflare-hmi
items: [hmi-web, api-spec]
decisions: [D-017]
corrects: null
source: null
---
# 장비망 밖에서 여는 HMI — Cloudflare Worker·Tunnel·Access

## 요약
- `hmi-web-mockup/cloudflare/`를 만들었다. `worker.js`는 화면 파일(Cloudflare 정적 파일, `site/`)을 내주고 `/ws/hmi` 웹소켓만 서비스 토큰을 붙여 터널 주소(`https://hmi-origin.hypefree.net`)로 넘긴다. 사람의 Access 쿠키와 서버의 다른 경로는 넘기지 않는다.
- `wrangler.jsonc`는 사용자 지정 도메인 `hmi.hypefree.net`이고 `*.workers.dev`·미리 보기 주소는 끈다(Access가 화면 주소에만 있어서). `package.json`은 wrangler 4.147.0으로 고정하고 `npm run deploy`가 React 빌드 → `site/`(메인 서버 묶음의 `wwwroot/`와 같은 파일, `make-server-bundle.py --dir`) → `wrangler deploy`를 한 번에 한다.
- `set-token.py`는 서비스 토큰 두 값을 화면에 보이지 않게 받아 터널 주소의 Access에 먼저 시험한 뒤 Worker 비밀값으로 넣는다. 글자 그대로("Client ID"), 터널 설치 토큰(`eyJ…`), 머리말까지 복사한 값은 거절한다.
- 대시보드 설정(도메인, Zero Trust, 터널과 HMI 담당 PC의 `cloudflared` 서비스, 서비스 토큰 `defect-hmi-worker` 1년, Access 앱 두 개)은 로그인이 필요해 사용자가 했다. 순서와 안 될 때는 docs/cloudflare.md에 적었다.
- 기술 판단: Access는 Worker 설정이 아니라 주소(호스트 이름) 기반 앱 두 개로 둔다 — 화면 주소는 허락한 이메일(일회용 코드), 터널 주소는 서비스 토큰만(실패하면 401). Worker 쪽 Access는 웹소켓을 막는다고 보아 쓰지 않았다 (docs/cloudflare.md).
- 서버 답장(docs/hmi-server-answer-1.md) 0.1을 "HMI 화면은 Cloudflare에서 띄우므로 서버 쪽 할 일 없음"으로 고쳤다.
- 커밋 6953ad4(Cloudflare), 1a52676(답장), bcfa6e9(Worker 중계 방식). 뒤에 카메라 작업을 시작하며 main을 bcfa6e9로 fast-forward 했다(사용자가 "main에 먼저 합치기"를 고름).

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-web | 완료 | 완료 (bcfa6e9) | 완료 (Cloudflare) | 부분 |

## 근거
- 직접: 시험 111/111 (node --test, 2026-10-17) — Worker가 `/ws/hmi`만 토큰을 붙여 넘기는지, 양쪽 웹소켓 사이에서 메시지·닫힘을 옮기는지, 토큰이 비면 500, `*.workers.dev`·미리 보기 주소를 열지 않는지, `set-token.py`의 거절
- 직접: 배포 뒤 로그인 없이 `hmi.hypefree.net`은 Access 로그인으로 넘어가고, `hmi-origin.hypefree.net`은 토큰 없이 401 (curl, 2026-10-17)
- 직접: 배포 뒤 앱 브라우저에서 `https://hmi.hypefree.net/`이 서버 연결 초록, "상태 미수신", "서버에 연결된 장비가 없습니다"(그때 `source="unavailable"`) (2026-10-17)
- 사용자: 대시보드 설정 0~5단계를 마침, 로그인 확인, 서비스 토큰 두 값을 넣음 (대화, 2026-10-17)
- 사용자: 허락할 이메일을 하나 더 넣었는데 그 사람의 일회용 코드 메일이 늦게 왔을 뿐 들어가짐 — "해결됬다 그냥 늦게 온거였어." (대화, 2026-10-17)

## 경위
- 비밀값이 비어 500: `wrangler secret put`을 다른 폴더에서 실행했고, 터미널 탭의 입력 창에 값이 들어가지 않았다. 대시보드(변수 및 비밀, 유형 비밀)로 넣게 했다.
- 401: 값 칸에 글자 그대로 "Client ID"/"Client Secret"이 들어갔고(제 안내 "값: Client ID"가 헷갈리게 쓰였음), 다음에는 터널 설치 토큰이 비밀값으로 들어갔다. 값의 모양(길이·앞부분 종류)만 찍는 임시 기록을 Worker에 넣어 원인을 찾았고, 찾은 뒤 지웠다. 비밀을 회전(Rotate secret)하고 `set-token.py`로 다시 넣었다.
- 502: 토큰은 통과했지만 그때 메인 서버(`10.108.108.98:5080`)가 꺼져 있었다. 이 PC의 cloudflared 상태와 설정은 정상이었고, 서버에 직접 붙는 TCP 시험이 실패했다.
- 서버가 켜진 뒤에도 브라우저 웹소켓이 열리지 않았다: 서버의 답(101)을 브라우저에 그대로 돌려주는 방식이 Cloudflare에서는 안 됐다. Worker가 서버 쪽 웹소켓을 열고 브라우저 쪽은 WebSocketPair로 받아 둘 사이에서 메시지와 닫힘을 옮기게 바꿨다(bcfa6e9). 보낼 수 없는 닫힘 코드(1005·1006·1015)는 1000으로, 오류는 1011로 바꾼다.

## 시도했다가 버린 방법
- 서버의 101 답을 그대로 돌려주는 웹소켓 넘기기 → 이 PC(`wrangler dev`)에서는 됐지만 Cloudflare에서는 브라우저 쪽이 열리지 않음 (직접 2026-10-17 · Worker 기록은 답 없이 canceled, 터널은 서버의 101을 받음) → 양쪽 웹소켓을 따로 받아 메시지를 옮기는 방식
- `set-token.py`에서 Client Secret을 64자 16진수로 검사 → 2026-10에 받은 실제 값은 54글자라 맞는 값을 거절함 (사용자 2026-10-17 · "내가 발급 받은게 64가 안되는데?") → 길이는 보지 않고 터널 주소의 Access에 실제로 시험해 판정

## 남은 제한
- HMI 담당 PC의 `cloudflared`가 꺼지면 밖에서는 화면은 뜨지만 서버 끊김으로 나온다. 화면 긴급정지가 인터넷을 한 번 더 거친다.
- 서비스 토큰은 1년이다. 끝나기 전에 연장하거나 새로 만들어 `set-token.py`로 넣는다.
- 원점은 브라우저 저장소에 주소별로 저장되어 `hmi.hypefree.net`에서 잡은 원점과 8080 주소의 원점은 따로다 (D-014).
- 임시 원인 찾기 기록(값 모양 찍기)은 일회성이었고 지웠다. 다시 넣지 않는다.

## 관련
- 결정: D-017
- 다음 기록: HISTORY/2026-10-17-camera-sort-target.md (영상 경로 중계 추가)
