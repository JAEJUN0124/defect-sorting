---
date: 2026-10-12
type: checkpoint
branch: feature/so101-kit-dashboard
items: [hmi-web, api-spec]
decisions: [D-002]
corrects: null
source: null
---
# 서버 형식 대응층과 API v0.2 — 서버가 어떻게 만들어지든 바로 붙게

## 요약
- 사용자 요청: 서버가 필요로 하고 줄 데이터의 모든 경우에 대응. 서버는 다른 팀원이 만들고 아직 없어서, 어떤 모양으로 만들어져도 HMI가 바로 붙도록 세 단계로 준비했다.
  - 이름·묶음·시각·단위 차이는 HMI가 알아서 맞춘다 (`hmi-web-mockup/js/adapter.js`).
  - 자동으로 안 되는 것은 `hmi-web-mockup/js/config.js` 설정 한 줄로 바꾼다. 사례별 대응표는 docs/server-cases.md.
  - 실제 서버가 생기면 `hmi-web-mockup/tools/server-check.html`이 서버 정보·상태를 묻고 실시간 메시지를 들은 뒤 넣을 설정을 알려 준다. 명령은 보내지 않는다.
- 통신 방식: 실시간은 WebSocket·Socket.IO(Engine.IO 4)·SSE·폴링, 명령은 HTTP·WebSocket 중에서 고른다 (`hmi-web-mockup/js/transport.js`). 기본값은 D-002대로 HTTP 명령 + WebSocket이다.
- 공유 상태(`hmi-web-mockup/js/store.js`): 조작 화면과 대시보드가 같은 상태·통계·분당 집계·경보를 쓴다. heartbeat는 서버가 한 번이라도 보낸 뒤부터만 끊김을 잰다 (`heartbeatRequired: 'auto'`).
- API 초안을 v0.2로 올렸다 (docs/API.md). 모두 더한 것이라 v0.1대로 만든 서버도 동작한다: 서버 정보 `GET /api/info`, 카메라 여러 대, 서보 상태 `telemetry`, 판정 성능 `metrics`, 고장 코드, 이벤트 추가, 원점 각도 단위. 서버 담당과 정할 것은 §9에 모았다.
- 가짜 서버도 v0.2로 바꿨다: 팔 두 개의 서보 값, 카메라 두 대, 판정 상자, 과열·전압 이상·판정 지연·불량 흉내. 조작 화면과 대시보드를 두 창에 띄워도 가짜 서버 하나를 나눠 쓴다 (`hmi-web-mockup/js/mock-hub.js`).
- 시험 고정물: 단위 시험 37개(`hmi-web-mockup/tests/`)와, 일부러 형식을 다르게 만든 시험용 서버(`hmi-web-mockup/tests/variant-server.py`). 시험용 서버는 실제 서버가 아니다.
- 작업 브랜치에서 구현하고 사용자 승인 뒤 main에 fast-forward로 합쳤다 (4358be4).

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-web | 완료 | 완료 | 미실행 | 미실행 |
| api-spec | 완료 | 완료 | 해당 없음 | 해당 없음 |

## 근거
- 직접: 단위 시험 37/37 통과 — 형식 맞추기 14, 통신 9, 가짜 서버 8, 서보 패킷 6 (node --test, 2026-10-12)
- 직접: 변형 서버에 붙여 조작 화면·대시보드·서버 점검이 동작함. 실시간은 WebSocket·Socket.IO·SSE, 영상은 MJPEG·스냅샷·웹소켓으로 확인 (미리보기 브라우저, 2026-10-12)
- 직접: 운전 모드를 대문자로만 받는 서버의 거절(422)을 `server.modeValues`로 해결, LeRobot 모양 관절 값(`shoulder_pan.pos`)과 통계 없는 판정에서 HMI가 직접 센 통계 확인 (미리보기 브라우저, 2026-10-12)
- 직접: main 단계는 4358be4 (git log, 2026-10-12)

## 경위
- 확인하면서 고친 것: 가짜 서버 나눠 쓰기에서 같은 탭이 두 번 연결되던 것, 가짜 서버가 시작하자마자 없는 회복 이벤트(`servo_recovered`)를 내던 것, 닫은 뒤에도 다시 연결하던 WebSocket.
- 서보 부하는 서버가 %로 줄지 서보 원시값(0.1%, 10번 비트가 방향)으로 줄지 몰라, 100을 넘는 값을 한 번 보면 그 뒤로는 원시값으로 읽는다. 처음부터 정하려면 `loadUnit`.

## 시도했다가 버린 방법
- `python -m http.server`로 화면 확인 → 브라우저가 고치기 전 스크립트를 캐시해 바뀐 코드가 안 보임 (직접 2026-10-12 · 미리보기 브라우저) → 캐시를 끄는 `hmi-web-mockup/tools/dev-server.py`, `.claude/launch.json`도 이것으로 바꿈
- 가짜 서버를 타이머 한 번마다 정해진 시간만큼 진행 → 숨은 탭은 브라우저가 타이머를 크게 줄여 가짜 서버가 느려짐 (직접 2026-10-12 · 미리보기 브라우저) → 실제로 지난 시간으로 계산하고, 화면에 보이는 탭이 가짜 서버를 맡음
- 서버 점검에서 연결 직후 첫 메시지가 상태가 아니면 실패로 판정 → HMI는 연결하면 상태를 따로 묻기 때문에 지나치게 엄격함 (직접 2026-10-12 · 변형 서버 점검) → 1초 안에 오면 통과, 아니면 참고로만 표시

## 남은 공백·다음
- 실제 서버가 없어 실서버 연동 미확인. WebRTC(WHEP)와 카메라 영상 올려 보내기는 받아 줄 서버가 없어 미확인
- 다음: 실제 서버가 준비되면 `hmi-web-mockup/tools/server-check.html`로 점검하고 제안 설정을 `hmi-web-mockup/js/config.js`에 넣은 뒤 `useMock: false`로 연동 확인. 서버 담당과 docs/API.md §9 합의

## 관련
- 결정: D-002
- 문서: docs/API.md, docs/server-cases.md, hmi-web-mockup/README.md
