---
project_id: defect-sorting
handoff_spec: 1
timezone: Asia/Seoul
---
# CURRENT
마지막 갱신: main · 2026-10-16

## 기준 상태
- 서버: 다른 팀원 담당. 서버 담당의 HMI 통신 서버 v1.0(.NET 9)이 있으나 명령은 받음 확인만 하고 장비를 움직이지 않음. 서버 코드는 아직 받지 못해 HMI를 실제 서버에 붙여 보지 못함 (사용자 2026-10-14 · 서버 담당 README 전달, "그건 아직 힘들듯")
- HMI 서버 연결: 기본은 브라우저 안 가짜 서버(`useMock: true`, API v0.5 JSON). `useMock: false`면 XML 규약 v1.0으로 `wsUrl`(기본 `ws://localhost:5080/ws/hmi`)에 붙음, 주소 뒤 `?mock=0&ws=…`로도 바꿈 (직접 2026-10-14 · `hmi-web-mockup/js/config.js`)
- HMI↔서버 통신 방식: WebSocket 하나에 XML, 서버 담당의 규약 v1.0(docs/server-xml-v1.0.md). 상태는 접속 직후와 1초마다, 명령은 id를 붙여 보내고 서버가 같은 id의 Reply(지금은 받음 확인 `executed="false"`)로 답함. 라인 상태·긴급정지·운전 모드 등은 v1.0에 없고 서버 담당이 나중에 더하기로 함 (사용자 2026-10-14 · README 전달, "나중에 더해짐")
- 원점: HMI가 브라우저 저장소(`hmi.home`)에 저장하고 서버는 저장하지 않음 (D-014). 원점 잡기는 서버 명령 없이 지금 각도를 저장, 원점 복귀는 저장한 각도를 서버에 보냄(XML `Home` + `Motors`) (직접 2026-10-14 · `hmi-web-mockup/js/home.js`, docs/xml-protocol.md 3장)
- 서버 v1.0의 모터 각도(`RobotArm/Motors`): 리더암 각도 (사용자 2026-10-14 · "리더암임")
- 로봇팔 키트: Brain Us AI Robot ARM Edu Kit(SO-ARM101 기반), 팔로워 12V·리더암 7.4V급 서보 6개씩, USB 카메라 2대. 세부는 docs/robot-arm.md (사용자 2026-10-12 · 첨부한 키트 설명서 사진)
- 로봇팔 상태: 리더암·팔로워암 기계적 조립 완료, 배선과 설정(모터 ID·캘리브레이션 등)은 이제부터. 모터 ID가 이미 설정됐는지는 미확인 (사용자 2026-10-16 · 보낸 가이드 문서(다른 자료 전달)에 "기계적 조립이 완료되었습니다", 대화 "이젠 로봇팔 실제로 배선이랑 여러가지 설정 만지고")
- 공유용 사본: claude.ai 비공개 페이지 3개(조작 화면·첫 대시보드·탭 대시보드), 화면마다 따로 동작. 실제로 열리는지는 미확인. 주소와 저장소 파일과의 차이는 HISTORY/2026-10-12-dashboard-controls.md (직접 2026-10-12 · Artifact 올리기 결과)

## 진행 항목
| 항목 | 로컬 | main | 배포 | 운영검증 | 재개 지점 |
| --- | --- | --- | --- | --- | --- |
| hmi-web 불량 선별 HMI(웹) 조작 화면·대시보드 | 완료 (직접 2026-10-14 · 테스트 87/87, XML 규약 v1.0을 시험용 XML 서버(v1.0 흉내·요청안 흉내)로 세 화면 브라우저 확인, 원점 HMI 저장은 가짜 서버와 시험용 서버로 확인. 그 밖의 기능은 2026-10-13 확인 그대로) | 완료 (직접 2026-10-14 · 13ffc15) | 미실행 | 미실행 | 서버 담당의 답(docs/hmi-server-requests.md 1장)과 v1.0 다음 판을 받으면 HMI를 맞추고, 실제 서버에 세 화면을 붙여 확인 |
| api-spec HMI↔서버 규약 문서(API 초안 v0.5 · XML 사용법·서버 요청서) | 완료 (직접 2026-10-14 · docs/API.md v0.5(원점 HMI 저장), docs/xml-protocol.md(HMI 쪽 v1.0 사용법·요청안), docs/hmi-server-requests.md(서버 담당에게 보낼 요청서), docs/server-xml-v1.0.md(서버 README 사본)) | 완료 (직접 2026-10-14 · 13ffc15) | 해당 없음 | 해당 없음 | 서버 담당의 회신(보낸 파일에 대한 답)과 v1.0 다음 판을 받으면 docs/xml-protocol.md·docs/API.md를 고침 |
| device-protocol 서버↔컨베이어·로봇팔 규약 초안(컨베이어 시리얼 규약 v1·로봇팔 제어 약속·공정 순서) | 완료 (직접 2026-10-12 · docs/conveyor-protocol.md·docs/arm-control.md·docs/line-sequence.md 작성, 규약 견본 `hmi-web-mockup/js/conveyor.js` 시험 12/12) | 완료 (직접 2026-10-12 · 064f9b5) | 해당 없음 | 미실행 | 하드웨어 담당·서버 담당과 각 문서의 "정할 것" 합의 뒤, 아두이노 스케치를 `hmi-web-mockup/tools/devices.html`의 컨베이어 규약 점검으로 확인 |
| device-io HMI 쪽 장치 읽기(서보·PC 카메라) | 부분 (직접 2026-10-12 · 단위 테스트, 가짜 서보·가짜 카메라로만 확인. 자세 저장도 가짜 서보로만) | 완료 (직접 2026-10-12 · 064f9b5) | 미실행 | 미실행 | 로봇팔 배선·설정(docs/robot-arm.md 4장 1~6번, 팔 이름 `follower_01`·`leader_01`) 뒤 `hmi-web-mockup/tools/devices.html`로 서보 6개·전원·캘리브레이션·카메라 읽기와 자세 저장 확인. 배선 직후 ID 1~6이 잡혀 있는지부터 읽음 |

## 공백·차단·제한
- [열림] 차단: 서버 담당의 실제 서버(v1.0)에 HMI를 붙여 보지 못함(서버 코드 없음). README를 보고 흉내 낸 시험용 XML 서버(`hmi-web-mockup/tests/xml-server.py`)로만 확인 — 관련: hmi-web (사용자 2026-10-14 · "그건 아직 힘들듯")
- [열림] 차단: 서버 쪽 작업은 서버 담당이 우리가 보낸 파일을 보고 회신할 때까지 멈춤 — 관련: hmi-web, api-spec (사용자 2026-10-16 · "그쪽이 우리가 보낸 파일 보고 회신할때까지 멈춰두고")
- [열림] 공백: 카메라 영상 전달 방식 미정, 초안은 MJPEG 제안 — 관련: api-spec (사용자 2026-10-06 · "아직 모름")
- [열림] 공백: 원점은 브라우저(PC)마다 따로 저장되어 다른 PC·브라우저에서 열거나 사이트 데이터를 지우면 없음. 실제 키트 각도로 원점을 저장해 본 적 없음. 원점 잡기는 서버에 알리지 않아 긴급정지 뒤 원점 필요(`homeRequired`)를 풀지 않음(원점 복귀를 해야 풀림). 자동 작업이 원점을 쓰는지(쓰면 시작에도 각도 필요), 수동 뒤 자동 전환 때 원점 복귀를 꼭 거칠지 미정 — 관련: hmi-web, api-spec, D-007, D-014 (직접 2026-10-14 · `hmi-web-mockup/js/home.js`, docs/hmi-server-requests.md Q5)
- [열림] 공백: 서버 v1.0에 라인 상태·긴급정지·운전 모드·고장·이벤트·판정 하나하나·완료 알림과 긴급정지 해제·일반 정지·카메라 명령이 없음. 그동안 HMI는 "상태 미수신"으로 보이고 키를 막지 않으며, Reply가 받음 확인뿐이라 장비가 움직였는지 알 수 없음. HMI가 원하는 모양은 docs/hmi-server-requests.md 2~4장(HMI는 이미 읽음) — 관련: hmi-web, api-spec, D-002 (사용자 2026-10-14 · "나중에 더해짐")
- [열림] 공백: 서버 담당의 답을 받지 못함 — `ProgramStop`이 프로그램 종료인지(HMI는 종료로 가정), `Home`이 원점 복귀인지, `Home`에 원점 각도(`Motors`)를 받을지(v1.0은 `InvalidCommand`로 거절해 그동안 원점 복귀가 거절됨. `server.xml.homePose: false`면 이름만 보냄), 그리퍼 각도 단위, 서버 PC IP·포트 (docs/hmi-server-requests.md 1장) — 관련: hmi-web, api-spec, D-014 (사용자 2026-10-14 · "일단 종료로 가정하고 구현", README)
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
- [열림] 공백: docs/arm-control.md에 지금 사정과 안 맞는 곳 두 가지. ① 1장은 로봇팔 제어를 서버와 같은 파이썬 프로그램에 두라고 권하지만, 서버는 .NET 9이고 서버 README도 따로 있는 "로봇 팔 컴퓨터"와 잇는 구조(docs/server-xml-v1.0.md `RobotArm/@connected`, StatusSource). LeRobot(파이썬) 실행기와 .NET 서버 사이 약속이 필요하고, 6장 "서버가 멈춤·끊김"을 서버가 죽을 때와 실행기가 죽을 때로 나눠야 함. 서버 쪽이라 회신 뒤로 미룸. ② 3.1 정책 단계의 `until: done`은 정책이 끝을 알려야 하는데, LeRobot 공식 문서에는 그런 신호가 없고 실행은 `--duration`으로 끝남. 학습 정책을 쓰기로 하면 쥠·놓음 같은 조건이나 시간 제한으로 고침 — 관련: device-protocol (직접 2026-10-16 · docs/arm-control.md·docs/server-xml-v1.0.md 대조, LeRobot il_robots 문서)
- [열림] 공백: 장치 쪽 초안 규칙을 팀이 정하지 않음 — 화면 긴급정지 때 로봇팔 힘 빼기, 긴급정지·로봇팔 고장 뒤 원점 필요(`HOME_REQUIRED`), 고장이 풀리는 방법(`clear`) 세 가지, 수동 모드의 컨베이어 운전, 정지 때 하던 작업 마치기. 가짜 서버와 HMI는 초안대로 동작 — 관련: device-protocol, api-spec (직접 2026-10-12 · docs/arm-control.md 9장, docs/line-sequence.md 8장, docs/API.md 9장)
- [열림] 공백: 공유용 사본 3개는 API v0.3 이후 변경(공정 단계·기록 채우기·원점 필요, v0.4 원점 잡기·원점 복귀, XML 연결·원점 HMI 저장)을 담지 않음 — 관련: hmi-web, D-007, D-014 (직접 2026-10-14 · 사본을 다시 올리지 않음)
- [열림] 공백: 심플함 보고서(docs/simplicity-report.md)의 측정값은 원점 키를 둘로 나누기 전 값이고 다시 재지 않음 — 관련: hmi-web (직접 2026-10-13)
- [열림] 제한: 화면 긴급정지는 네트워크·서버를 거쳐 서버가 멈추면 효과 없음. 서버가 끊기면 HMI는 DC 전원 케이블 분리를 안내함(키트 설명서의 방법), 하드웨어 비상정지 버튼 필요 여부는 미정 — 관련: hmi-web (직접 2026-10-12 · docs/API.md §8, `hmi-web-mockup/config/robot.js` hardwareStop)
- [열림] 제한: 프로그램 종료(F-03) 뒤 HMI 창은 닫지 않고 종료 화면만 남김(브라우저는 스크립트가 연 창만 닫음) — 관련: hmi-web, D-001 (직접 2026-10-06 · js/app.js finishExit)
- [열림] 제한: HMI 원점과 로봇팔 자세(`arm.json`의 `poses`)는 저장할 때의 캘리브레이션 기준이라, 캘리브레이션을 다시 하거나 서보·혼을 바꾸면 다시 잡아야 함. HMI는 원점을 어느 캘리브레이션에서 잡았는지 몰라 화면이 막지 않음(규칙은 docs/robot-arm.md 6장) — 관련: hmi-web, device-io, D-014 (직접 2026-10-16 · LeRobot main `motors_bus.py`·`so_follower.py`, `hmi-web-mockup/js/home.js`)

## 다음 작업
- 로봇팔 배선·설정(docs/robot-arm.md 4장 1~6번), 끝나면 device-io 확인 (사용자 2026-10-16)

## 참고
- HMI 실행·구조: hmi-web-mockup/README.md · XML 규약: docs/server-xml-v1.0.md(서버 README 사본), docs/xml-protocol.md(HMI 쪽), docs/hmi-server-requests.md(서버 요청서) · API v0.5: docs/API.md · 장치 쪽 규약: docs/conveyor-protocol.md, docs/arm-control.md, docs/line-sequence.md · 서버 형식 대응표: docs/server-cases.md · 로봇팔 키트: docs/robot-arm.md · 심플함 비교: docs/simplicity-report.md(탭 시안·대시보드 조작은 11장) · 포스터: poster/README.md
- 결정: D-001~D-014 · HISTORY: 2026-10-16-robot-arm-lerobot-check.md, 2026-10-16-server-wait.md, 2026-10-14-server-xml-v1.md, 2026-10-14-home-in-hmi-decision.md, 2026-10-14-poster-v4-v6.md, 2026-10-13-comm-socket-xml.md, 2026-10-13-home-teach-decision.md, 2026-10-13-home-teach.md, 2026-10-13-poster.md, 2026-10-12-api-v03-devices.md, 2026-10-12-dashboard-controls.md, 2026-10-12-dashboard-tabs.md, 2026-10-12-standalone-screens.md, 2026-10-12-server-compat.md, 2026-10-12-dashboard.md, 2026-10-12-robot-arm-kit.md, 2026-10-12-hmi-web-light.md, 2026-10-12-hmi-web-dark.md, 2026-10-12-api-draft.md
