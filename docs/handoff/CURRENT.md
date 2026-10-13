---
project_id: defect-sorting
handoff_spec: 1
timezone: Asia/Seoul
---
# CURRENT
마지막 갱신: feature/poster · 2026-10-13

## 기준 상태
- 서버: 다른 팀원 담당, HMI가 연결할 실제 서버는 아직 없음 (사용자 2026-10-06 · 역할 분담 설명)
- HMI 서버 연결: 브라우저 안 가짜 서버로 동작, `hmi-web-mockup/js/config.js`의 `useMock: true` (직접 2026-10-12 · 파일 확인)
- HMI↔서버 통신 방식: 소켓으로 통신하고 데이터는 XML, 명령 결과는 서버가 리플라이로 보냄. 서버 담당이 HMI가 요청한 데이터(라인 상태·heartbeat·경보·리더암·원점/종료 완료·긴급정지 해제 등)를 모두 주기로 함. 소켓 종류(WebSocket·TCP)와 XML 형식은 미정 (사용자 2026-10-13 · 서버 담당과 이야기한 결과)
- 원점: 서버가 저장하고 상태 `home`으로 알림. 수동 모드의 "원점 잡기"가 로봇팔의 지금 자세를 원점으로 저장, 자동 모드의 "원점 복귀"가 그 원점으로 옮김. 가짜 서버는 메모리에만 저장 (직접 2026-10-13 · `hmi-web-mockup/js/mock-server.js`, docs/API.md 4.2)
- 로봇팔 키트: Brain Us AI Robot ARM Edu Kit(SO-ARM101 기반), 팔로워 12V·리더암 7.4V급 서보 6개씩, USB 카메라 2대. 세부는 docs/robot-arm.md (사용자 2026-10-12 · 첨부한 키트 설명서 사진)
- 공유용 사본: claude.ai 비공개 페이지 3개(조작 화면·첫 대시보드·탭 대시보드), 화면마다 따로 동작. 실제로 열리는지는 미확인. 주소와 저장소 파일과의 차이는 HISTORY/2026-10-12-dashboard-controls.md (직접 2026-10-12 · Artifact 올리기 결과)

## 진행 항목
| 항목 | 로컬 | main | 배포 | 운영검증 | 재개 지점 |
| --- | --- | --- | --- | --- | --- |
| hmi-web 불량 선별 HMI(웹) 조작 화면·대시보드 | 완료 (직접 2026-10-13 · 테스트 67/67, 원점 잡기·원점 복귀를 가짜 서버로 세 화면 브라우저 확인(확인 창은 조작 화면·첫 대시보드), 폭 1100·1366·1440 배치 확인. 그 밖의 기능은 2026-10-12 확인 그대로) | 완료 (직접 2026-10-13 · 3bca3ed) | 미실행 | 미실행 | 서버 담당이 소켓 종류·XML 형식을 정하면 HMI에 XML 읽기·보내기를 붙이고, 실제 서버로 세 화면 연동 확인 |
| api-spec HMI↔서버 API 초안 v0.4 | 완료 (직접 2026-10-13 · docs/API.md v0.4: 원점 잡기 `POST /api/robot/home/set` 추가, 원점 복귀는 각도 없이, 상태 `home`. 아직 HTTP·JSON 기준이고 소켓·XML 판은 없음) | 완료 (직접 2026-10-13 · 3bca3ed) | 해당 없음 | 해당 없음 | 소켓 종류·XML 형식이 정해지면 그 형식으로 문서를 고치고, 서버 담당과 §9 항목 합의 (v0.4의 원점 저장 파일·자동 작업의 원점 쓰임 포함) |
| device-protocol 서버↔컨베이어·로봇팔 규약 초안(컨베이어 시리얼 규약 v1·로봇팔 제어 약속·공정 순서) | 완료 (직접 2026-10-12 · docs/conveyor-protocol.md·docs/arm-control.md·docs/line-sequence.md 작성, 규약 견본 `hmi-web-mockup/js/conveyor.js` 시험 12/12) | 완료 (직접 2026-10-12 · 064f9b5) | 해당 없음 | 미실행 | 하드웨어 담당·서버 담당과 각 문서의 "정할 것" 합의 뒤, 아두이노 스케치를 `hmi-web-mockup/tools/devices.html`의 컨베이어 규약 점검으로 확인 |
| poster 프로젝트 포스터(A1, 1~3안, `poster/build.py`) | 완료 (직접 2026-10-13 · 파일 확인: 지금 안(3안)과 1·2안 PDF·PNG·SVG, README. 다른 세션이 만들었고 이번 세션은 다시 만들거나 출력을 보지 않음) | 완료 (직접 2026-10-13 · 9177925) | 해당 없음 | 해당 없음 | 소켓 종류가 정해지면 `poster/build.py`의 `TEXT['links']`를 고치고 `python poster/build.py`로 다시 만들기 |
| device-io HMI 쪽 장치 읽기(서보·PC 카메라) | 부분 (직접 2026-10-12 · 단위 테스트, 가짜 서보·가짜 카메라로만 확인. 자세 저장도 가짜 서보로만) | 완료 (직접 2026-10-12 · 064f9b5) | 미실행 | 미실행 | 실제 키트를 연결해 `hmi-web-mockup/tools/devices.html`로 서보 6개·카메라 읽기와 자세 저장 확인 |

## 공백·차단·제한
- [열림] 차단: 실제 서버가 없어 실서버 연동 미확인 — 관련: hmi-web (사용자 2026-10-06 · 서버는 다른 팀원 담당)
- [열림] 공백: 카메라 영상 전달 방식 미정, 초안은 MJPEG 제안 — 관련: api-spec (사용자 2026-10-06 · "아직 모름")
- [열림] 공백: 실제 원점은 아직 저장한 적 없음(실제 서버 없음). 서버가 원점을 저장할 파일, 자동 작업이 원점을 어떻게 쓸지, 수동으로 움직인 뒤 자동으로 바꾸면 원점 복귀를 꼭 거칠지 미정. 가짜 서버는 원점을 메모리에만 두어 HMI 창을 모두 닫으면 처음 값(대기 자세)으로 돌아감 — 관련: hmi-web, api-spec, D-007 (직접 2026-10-13 · docs/API.md 9장, `hmi-web-mockup/js/mock-server.js`)
- [열림] 공백: 소켓 종류(WebSocket·TCP) 미확인. TCP면 브라우저가 직접 붙지 못해 WebSocket을 열거나 중간 다리 프로그램이 필요 — 관련: hmi-web, api-spec, D-002 (사용자 2026-10-13 · "소켓으로 통신")
- [열림] 공백: HMI는 서버 메시지를 JSON으로만 읽고 XML은 읽지 못함(JSON이 아니면 버림). XML 형식이 정해지면 읽기·보내기를 붙여야 함 — 관련: hmi-web, D-002 (직접 2026-10-13 · `hmi-web-mockup/js/adapter.js`)
- [열림] 공백: 포스터의 HMI↔서버 화살표 글자가 "HTTP·WebSocket"이라 소켓 + XML 결정과 맞지 않음 — 관련: poster, D-002 (직접 2026-10-13 · `poster/build.py` TEXT)
- [열림] 공백: 일반 정지(비긴급) 필요 여부 미확정, 시작 키가 가동 중 "정지"로 바뀌는 토글로 가정해 구현 — 관련: hmi-web (사용자 2026-10-06 · "중지가 있는지는 모르겠네")
- [열림] 공백: 배포 전 `devMode: false` 전환 필요 — 관련: hmi-web, D-008, D-012 (사용자 2026-10-06 · 장치 연결 표시는 추후 삭제)
- [열림] 공백: 실제 키트·USB 카메라·아두이노 컨베이어로는 시험하지 않음. 서보 읽기와 PC 카메라는 가짜 장치로만 확인했고, 서보 온도·전원 경고 기준(`hmi-web-mockup/config/robot.js`)은 실측 없이 정한 값 — 관련: device-io (직접 2026-10-12 · docs/robot-arm.md §7)
- [열림] 공백: 카메라 WebRTC(WHEP) 연결과 HMI의 카메라 영상 올려 보내기는 받아 줄 서버가 없어 미확인 — 관련: hmi-web (직접 2026-10-12 · 변형 서버에 없는 기능)
- [열림] 공백: 두 번째 카메라 위치 미정(키트에는 탑 뷰 마운트만 있음), HMI는 위(`top`)·근접(`close`) 두 대로 가정 — 관련: hmi-web (직접 2026-10-12 · docs/robot-arm.md §7)
- [열림] 공백: 대시보드가 첫 대시보드(`hmi-web-mockup/dashboard.html`)와 탭 시안(`hmi-web-mockup/dashboard-tabs.html`) 두 가지이고 어느 쪽을 쓸지 미정. 조작 화면의 "대시보드" 단추는 첫 대시보드로 감 — 관련: hmi-web, D-013 (직접 2026-10-12 · `hmi-web-mockup/js/app.js` 확인)
- [열림] 공백: 탭 시안도 장치 연결 표시를 `devMode`와 상관없이 늘 보이지만 D-012의 범위는 첫 대시보드뿐이라, 탭 시안에도 적용할지 미확인 — 관련: hmi-web, D-012 (직접 2026-10-12 · `hmi-web-mockup/js/dashboard-tabs.js` 확인)
- [열림] 공백: 컨베이어 하드웨어(모터·속도 조절·부품 센서·정지 단추·아두이노 보드) 미정. 규약은 아두이노가 `INFO`로 가진 기능을 알리는 일반형으로 설계 — 관련: device-protocol (사용자 2026-10-12 · "아직 모름")
- [열림] 공백: 컨베이어 운전 방식 미정. "부품마다 멈춤"일 가능성이 높아 공정 순서 초안과 가짜 서버의 기본으로 두고, 계속 도는 방식은 docs/line-sequence.md 4장의 다른 안으로 둠 — 관련: device-protocol (사용자 2026-10-12 · "아직 미정인데 아마 높은 확률로 멈추는 쪽")
- [열림] 공백: 자동 모드에서 로봇팔을 움직이는 방법 미정(정해 둔 자세와 학습 정책을 섞을 가능성). 작업을 단계 목록으로 적어 둘 다 되게 설계 — 관련: device-protocol (사용자 2026-10-12 · "아마 1,2번 섞일듯")
- [열림] 공백: 아두이노 스케치와 로봇팔 제어 코드는 하드웨어를 맡는 사람이 만들 것으로 예상하나 담당은 미확정 — 관련: device-protocol (사용자 2026-10-12 · "하드웨어 건드리는 사람이 할듯")
- [열림] 공백: 장치 쪽 초안 규칙을 팀이 정하지 않음 — 화면 긴급정지 때 로봇팔 힘 빼기, 긴급정지·로봇팔 고장 뒤 원점 필요(`HOME_REQUIRED`), 고장이 풀리는 방법(`clear`) 세 가지, 수동 모드의 컨베이어 운전, 정지 때 하던 작업 마치기. 가짜 서버와 HMI는 초안대로 동작 — 관련: device-protocol, api-spec (직접 2026-10-12 · docs/arm-control.md 9장, docs/line-sequence.md 8장, docs/API.md 9장)
- [열림] 공백: 공유용 사본 3개는 API v0.3 변경(공정 단계·기록 채우기·원점 필요 등)을 담지 않음 — 관련: hmi-web (직접 2026-10-12 · 사본을 다시 올리지 않음)
- [열림] 공백: 공유용 사본 3개는 v0.4 원점 잡기·원점 복귀도 담지 않음 — 관련: hmi-web, D-007 (직접 2026-10-13 · 사본을 다시 올리지 않음)
- [열림] 공백: 심플함 보고서(docs/simplicity-report.md)의 측정값은 원점 키를 둘로 나누기 전 값이고 다시 재지 않음 — 관련: hmi-web (직접 2026-10-13)
- [열림] 제한: 화면 긴급정지는 네트워크·서버를 거쳐 서버가 멈추면 효과 없음. 서버가 끊기면 HMI는 DC 전원 케이블 분리를 안내함(키트 설명서의 방법), 하드웨어 비상정지 버튼 필요 여부는 미정 — 관련: hmi-web (직접 2026-10-12 · docs/API.md §8, `hmi-web-mockup/config/robot.js` hardwareStop)
- [열림] 제한: 프로그램 종료(F-03) 뒤 HMI 창은 닫지 않고 종료 화면만 남김(브라우저는 스크립트가 연 창만 닫음) — 관련: hmi-web, D-001 (직접 2026-10-06 · js/app.js finishExit)

## 다음 작업
- 지정 없음

## 참고
- HMI 실행·구조: hmi-web-mockup/README.md · API v0.4: docs/API.md · 장치 쪽 규약: docs/conveyor-protocol.md, docs/arm-control.md, docs/line-sequence.md · 서버 형식 대응표: docs/server-cases.md · 로봇팔 키트: docs/robot-arm.md · 심플함 비교: docs/simplicity-report.md(탭 시안·대시보드 조작은 11장) · 포스터: poster/README.md
- 결정: D-001~D-013 · HISTORY: 2026-10-13-comm-socket-xml.md, 2026-10-13-home-teach-decision.md, 2026-10-13-home-teach.md, 2026-10-13-poster.md, 2026-10-12-api-v03-devices.md, 2026-10-12-dashboard-controls.md, 2026-10-12-dashboard-tabs.md, 2026-10-12-standalone-screens.md, 2026-10-12-server-compat.md, 2026-10-12-dashboard.md, 2026-10-12-robot-arm-kit.md, 2026-10-12-hmi-web-light.md, 2026-10-12-hmi-web-dark.md, 2026-10-12-api-draft.md
