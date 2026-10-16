---
project_id: defect-sorting
handoff_spec: 1
timezone: Asia/Seoul
---
# CURRENT
마지막 갱신: main · 2026-10-17

## 기준 상태
- 서버: 다른 팀원 담당. 서버 담당의 HMI 통신 서버(.NET 9, XML 규약 v1.0과 회신 1차 반영)는 장비와 연결되지 않아 명령에 받음 확인(`Received`·`ReceiptOnly`, `executed="false"`)만 하고 장비를 움직이지 않음 (직접 2026-10-17 · 실제 서버에 요청을 보내 본 결과, docs/hmi-server-answer-1.md 6장)
- 서버 주소: 내부 `ws://10.108.108.98:5080/ws/hmi`. 외부 접속(공인 주소·포트포워딩)과 HTTPS/WSS는 미정 (사용자 2026-10-16 · 서버 주소 전달)
- HMI 화면: 조작 화면 하나를 React(`hmi-web-mockup/react/`, React 19 + Vite 8)로 만들고, 통신·상태 코드(`hmi-web-mockup/js/`)는 그대로 불러 씀. 대시보드 두 개와 React 전 조작 화면, 가짜 카메라 영상은 지움 (D-016) (직접 2026-10-17 · 0e283d8)
- HMI 서버 연결: 개발 서버(`npm --prefix hmi-web-mockup/react run dev`, 5174)는 브라우저 안 가짜 서버(`useMock: true`, API v0.5 JSON)가 기본. 빌드한 화면(`hmi-web-mockup/react/dist`)은 자기를 내준 서버의 `/ws/hmi`에 XML로 붙는 것이 기본. 주소 뒤 `?mock=0&ws=…`·`?mock=1`로 바꿈 (직접 2026-10-17 · `hmi-web-mockup/react/src/server-defaults.js`, `hmi-web-mockup/js/config.js`)
- HMI↔서버 통신 방식: WebSocket 하나에 XML, 서버 담당의 규약 v1.0(docs/server-xml-v1.0.md)에 회신 1차 반영(`Home`에 원점 각도 `Motors`, `EmergencyStopRelease` 받음, `ProgramStop`은 장비 정지 요청). 명령은 id를 붙여 보내고 서버가 같은 id의 Reply로 답함. 상태 전송 간격은 서버 설정(`PushIntervalMs`)이라 바뀔 수 있음(지금 60초). 라인 상태·긴급정지 여부·운전 모드·이벤트는 서버 담당이 2차에 시뮬레이션부터 더하기로 함 (사용자 2026-10-16 · 서버 회신 docs/hmi-server-reply-1.md, "60초로 바꿨어")
- HMI 연결 확인: 60초마다 `Ping`, 65초 넘게 아무 메시지가 없으면 끊김. 상태는 60초 넘게 오지 않을 때만 `GetStatus`로 묻고, 원점 잡기 때 각도가 3초보다 오래됐으면 한 번 물음 (사용자 2026-10-16 · "상태 체크 이거 60초 마다 하라니까", 설정 `server.xml.pingMs`·`statusTimeoutMs`·`statusPollMs`)
- 메인 서버에 HMI 올리기: 서버 담당의 메인 서버가 HMI 화면 파일(`wwwroot/`)도 내주게 할 계획. 묶음 도구(`hmi-web-mockup/tools/make-server-bundle.py`)와 서버 쪽 할 일(docs/hmi-server-answer-1.md 0.1)을 준비함 (사용자 2026-10-17 · "hmi를 메인서버에 올려서 작업하게")
- 다른 PC에서 HMI 열기: HMI 담당 PC에서 `python hmi-web-mockup/tools/dev-server.py 8080 --host 0.0.0.0`(미리보기 설정 `hmi-web-mockup-lan`)으로 빌드한 조작 화면을 내주고, 다른 PC는 `http://<그 PC 주소>:8080/?mock=0&ws=ws://10.108.108.98:5080/ws/hmi`로 엶. React 전 화면으로 다른 PC에서 실제 서버에 붙는 것을 확인 (사용자 2026-10-17 · "다른 PC에서 열어 보니 서버에 잘 붙어.")
- 원점: HMI가 브라우저 저장소(`hmi.home`)에 저장하고 서버는 저장하지 않음 (D-014). 원점 잡기는 서버 명령 없이 지금 각도를 저장, 원점 복귀는 저장한 각도를 서버에 보냄(XML `Home` + `Motors`) (직접 2026-10-14 · `hmi-web-mockup/js/home.js`, docs/xml-protocol.md 3장)
- 서버 v1.0의 모터 각도(`RobotArm/Motors`): 리더암 각도 (사용자 2026-10-14 · "리더암임")
- 로봇팔 키트: Brain Us AI Robot ARM Edu Kit(SO-ARM101 기반), 팔로워 12V·리더암 7.4V급 서보 6개씩, USB 카메라 2대. 세부는 docs/robot-arm.md (사용자 2026-10-12 · 첨부한 키트 설명서 사진)
- 로봇팔 상태: 리더암·팔로워암 기계적 조립 완료, 배선과 설정(모터 ID·캘리브레이션 등)은 이제부터. 모터 ID가 이미 설정됐는지는 미확인 (사용자 2026-10-16 · 보낸 가이드 문서(다른 자료 전달)에 "기계적 조립이 완료되었습니다", 대화 "이젠 로봇팔 실제로 배선이랑 여러가지 설정 만지고")
- 공유용 사본: claude.ai 비공개 페이지 3개(조작 화면·첫 대시보드·탭 대시보드), 화면마다 따로 동작. 실제로 열리는지는 미확인. 주소와 저장소 파일과의 차이는 HISTORY/2026-10-12-dashboard-controls.md (직접 2026-10-12 · Artifact 올리기 결과)

## 진행 항목
| 항목 | 로컬 | main | 배포 | 운영검증 | 재개 지점 |
| --- | --- | --- | --- | --- | --- |
| hmi-web 불량 선별 HMI(웹) 조작 화면 (React) | 완료 (직접 2026-10-17 · 테스트 102/102, React 화면을 가짜 서버·시험용 XML 서버(회신 반영·요청안 흉내)·메인 서버 흉내에서 버튼별로 브라우저 확인, 실제 서버에서는 상태 표시만, 좁은 화면 360·446px) | 완료 (직접 2026-10-17 · 0e283d8) | 미실행 | 미실행 | 사용자가 보내라고 하면 묶음(`make-server-bundle.py`)을 새로 만들어 답장과 함께 서버 담당에게 전하고, 메인 서버에 올린 화면과 서버 2차(`Line`·이벤트)로 확인 |
| api-spec HMI↔서버 규약 문서(API 초안 v0.5 · XML 사용법·서버 요청서·회신과 답장) | 완료 (직접 2026-10-17 · docs/xml-protocol.md(회신 반영), docs/hmi-server-reply-1.md(서버 회신 사본), docs/hmi-server-answer-1.md(답장 — 0장에 서버 쪽 할 일, React 기준), docs/API.md v0.5, docs/hmi-server-requests.md(보낸 요청서), docs/server-xml-v1.0.md(서버 README 사본)) | 완료 (직접 2026-10-17 · 12b2b33) | 해당 없음 | 해당 없음 | 사용자가 보내라고 하면 답장을 보내고, 서버 담당의 다음 답(답장 0.2·0.3)과 2차 판을 받으면 docs/xml-protocol.md를 고침 |
| device-protocol 서버↔컨베이어·로봇팔 규약 초안(컨베이어 시리얼 규약 v1·로봇팔 제어 약속·공정 순서) | 완료 (직접 2026-10-12 · docs/conveyor-protocol.md·docs/arm-control.md·docs/line-sequence.md 작성, 규약 견본 `hmi-web-mockup/js/conveyor.js` 시험 12/12) | 완료 (직접 2026-10-12 · 064f9b5) | 해당 없음 | 미실행 | 하드웨어 담당·서버 담당과 각 문서의 "정할 것" 합의 뒤, 아두이노 스케치를 `hmi-web-mockup/tools/devices.html`의 컨베이어 규약 점검으로 확인 |
| device-io HMI 쪽 장치 읽기(서보·PC 카메라) | 부분 (직접 2026-10-12 · 단위 테스트, 가짜 서보·가짜 카메라로만 확인. 자세 저장도 가짜 서보로만) | 완료 (직접 2026-10-12 · 064f9b5) | 미실행 | 미실행 | 로봇팔 배선·설정(docs/robot-arm.md 4장 1~6번, 팔 이름 `follower_01`·`leader_01`) 뒤 `hmi-web-mockup/tools/devices.html`로 서보 6개·전원·캘리브레이션·카메라 읽기와 자세 저장 확인. 배선 직후 ID 1~6이 잡혀 있는지부터 읽음 |

## 공백·차단·제한
- [열림] 공백: 서버 답장(docs/hmi-server-answer-1.md)과 메인 서버용 묶음을 아직 보내지 않음. 보낼 때 묶음을 새로 만듦(`python hmi-web-mockup/tools/make-server-bundle.py <zip 경로>`) — 관련: hmi-web, api-spec (사용자 2026-10-17 · "지금 보낼껀 잠깐 멈추고")
- [열림] 공백: 카메라 영상 전달 방식 미정, 초안은 MJPEG 제안 — 관련: api-spec (사용자 2026-10-06 · "아직 모름")
- [열림] 공백: 원점은 브라우저(PC)마다 따로 저장되어 다른 PC·브라우저에서 열거나 사이트 데이터를 지우면 없음. 실제 키트 각도로 원점을 저장해 본 적 없음. 원점 잡기는 서버에 알리지 않아 긴급정지 뒤 원점 필요(`homeRequired`)를 풀지 않음(원점 복귀를 해야 풀림). 자동 작업이 원점을 쓰는지(쓰면 시작에도 각도 필요), 수동 뒤 자동 전환 때 원점 복귀를 꼭 거칠지 미정 — 관련: hmi-web, api-spec, D-007, D-014 (직접 2026-10-14 · `hmi-web-mockup/js/home.js`, docs/hmi-server-requests.md Q5)
- [열림] 공백: 서버에 라인 상태·긴급정지 여부·운전 모드·고장·이벤트·판정 하나하나·완료 알림·카메라 명령이 아직 없음 (서버 담당이 2차에 라인 상태·이벤트를 시뮬레이션부터, 3차에 실제 장비를 연결하기로 함). 그동안 HMI는 "상태 미수신"으로 보이고 키를 막지 않으며 시작 키가 "정지"로 바뀌지 않고, Reply가 받음 확인뿐이라 장비가 움직였는지 알 수 없음. HMI가 원하는 모양은 docs/hmi-server-answer-1.md 0.4와 docs/hmi-server-requests.md 3~4장(HMI는 이미 읽음) — 관련: hmi-web, api-spec, D-002 (사용자 2026-10-16 · 서버 회신 6장)
- [열림] 공백: 그리퍼(6번 모터) 단위 미정 — LeRobot은 0~100, 서버 `Home` 검사는 `deg`만 받음(6번이 `percent`면 `InvalidAngles`). HMI는 둘 다 읽고 받은 단위로 저장·전송하며, 답장 0.3 4번에 `percent`를 제안 — 관련: api-spec, D-014 (직접 2026-10-16 · 실제 서버 시험, docs/hmi-server-answer-1.md)
- [열림] 공백: 같은 id로 다시 온 명령을 서버가 하나하나 받음(같은 id 긴급정지 5개에 답 5개). 장비를 연결하면 시작 같은 명령이 두 번 실행될 수 있어, 3차 "실행 명령 중복 방지"에서 정해 달라고 답장 0.3 5번에 씀. HMI는 누를 때마다 새 id를 쓰고 자동으로 다시 보내지 않음 — 관련: api-spec (직접 2026-10-17 · 실제 서버 긴급정지 시험)
- [열림] 공백: 서버가 `Home` 각도의 범위를 검사하지 않음(유한한 숫자는 모두 받고 1e309만 거절) — 관련: api-spec (직접 2026-10-16 · 실제 서버 큰 값 시험)
- [열림] 공백: 배포 전 `devMode: false` 전환 필요. 메인 서버용 묶음도 아직 `devMode: true` 그대로라 장치 연결 표시가 보임(주소 뒤 `?dev=0`이면 숨김) — 관련: hmi-web, D-008 (직접 2026-10-17 · `hmi-web-mockup/js/config.js`, `hmi-web-mockup/tools/make-server-bundle.py`)
- [열림] 공백: 실제 키트·USB 카메라·아두이노 컨베이어로는 시험하지 않음. 서보 읽기와 PC 카메라는 가짜 장치로만 확인했고, 서보 온도·전원 경고 기준(`hmi-web-mockup/config/robot.js`)은 실측 없이 정한 값 — 관련: device-io (직접 2026-10-12 · docs/robot-arm.md §7)
- [열림] 공백: 카메라 WebRTC(WHEP) 연결과 HMI의 카메라 영상 올려 보내기는 받아 줄 서버가 없어 미확인 — 관련: hmi-web (직접 2026-10-12 · 변형 서버에 없는 기능)
- [열림] 공백: 두 번째 카메라 위치 미정(키트에는 탑 뷰 마운트만 있음). 조작 화면은 주 카메라(`cameras.primary`, 기본은 서버가 알려 준 첫 카메라) 하나만 보이고, 가짜 서버는 위(`top`)·근접(`close`) 두 대로 가정 — 관련: hmi-web (직접 2026-10-17 · `hmi-web-mockup/js/config.js`, `hmi-web-mockup/js/mock-server.js`)
- [열림] 공백: 컨베이어 하드웨어(모터·속도 조절·부품 센서·정지 단추·아두이노 보드) 미정. 규약은 아두이노가 `INFO`로 가진 기능을 알리는 일반형으로 설계 — 관련: device-protocol (사용자 2026-10-12 · "아직 모름")
- [열림] 공백: 컨베이어 운전 방식 미정. "부품마다 멈춤"일 가능성이 높아 공정 순서 초안과 가짜 서버의 기본으로 두고, 계속 도는 방식은 docs/line-sequence.md 4장의 다른 안으로 둠 — 관련: device-protocol (사용자 2026-10-12 · "아직 미정인데 아마 높은 확률로 멈추는 쪽")
- [열림] 공백: 자동 모드에서 로봇팔을 움직이는 방법 미정(정해 둔 자세와 학습 정책을 섞을 가능성). 작업을 단계 목록으로 적어 둘 다 되게 설계 — 관련: device-protocol (사용자 2026-10-12 · "아마 1,2번 섞일듯")
- [열림] 공백: 아두이노 스케치와 로봇팔 제어 코드는 하드웨어를 맡는 사람이 만들 것으로 예상하나 담당은 미확정 — 관련: device-protocol (사용자 2026-10-12 · "하드웨어 건드리는 사람이 할듯")
- [열림] 공백: docs/arm-control.md에 지금 사정과 안 맞는 곳 두 가지. ① 1장은 로봇팔 제어를 서버와 같은 파이썬 프로그램에 두라고 권하지만, 서버는 .NET 9이고 서버 README도 따로 있는 "로봇 팔 컴퓨터"와 잇는 구조(docs/server-xml-v1.0.md `RobotArm/@connected`, StatusSource). LeRobot(파이썬) 실행기와 .NET 서버 사이 약속이 필요하고, 6장 "서버가 멈춤·끊김"을 서버가 죽을 때와 실행기가 죽을 때로 나눠야 함. 서버 쪽이라 회신 뒤로 미룸. ② 3.1 정책 단계의 `until: done`은 정책이 끝을 알려야 하는데, LeRobot 공식 문서에는 그런 신호가 없고 실행은 `--duration`으로 끝남. 학습 정책을 쓰기로 하면 쥠·놓음 같은 조건이나 시간 제한으로 고침 — 관련: device-protocol (직접 2026-10-16 · docs/arm-control.md·docs/server-xml-v1.0.md 대조, LeRobot il_robots 문서)
- [열림] 공백: 장치 쪽 초안 규칙을 팀이 정하지 않음 — 화면 긴급정지 때 로봇팔 힘 빼기, 긴급정지·로봇팔 고장 뒤 원점 필요(`HOME_REQUIRED`), 고장이 풀리는 방법(`clear`) 세 가지, 수동 모드의 컨베이어 운전, 정지 때 하던 작업 마치기. 가짜 서버와 HMI는 초안대로 동작 — 관련: device-protocol, api-spec (직접 2026-10-12 · docs/arm-control.md 9장, docs/line-sequence.md 8장, docs/API.md 9장)
- [열림] 공백: 공유용 사본 3개는 React 전 화면(지금은 없앤 대시보드 2개 포함)이고 API v0.3 이후 변경(공정 단계·기록 채우기·원점 필요, v0.4 원점 잡기·원점 복귀, XML 연결·원점 HMI 저장)을 담지 않음 — 관련: hmi-web, D-007, D-014 (직접 2026-10-17 · 사본을 다시 올리지 않음)
- [열림] 공백: 심플함 보고서(docs/simplicity-report.md)의 측정값은 React 전 화면(대시보드 포함)이고 원점 키를 둘로 나누기 전 값이며 다시 재지 않음 — 관련: hmi-web (직접 2026-10-17)
- [열림] 공백: React 화면은 실제 서버에서 상태 표시까지만 확인하고 버튼은 누르지 않음(React 전 세 화면은 2026-10-16~17에 버튼별 답 안내·원점 잡기→원점 복귀·프로그램 종료까지 확인) — 관련: hmi-web (직접 2026-10-17)
- [열림] 제한: 화면 긴급정지는 네트워크·서버를 거쳐 서버가 멈추면 효과 없음. 서버가 끊기면 HMI는 DC 전원 케이블 분리를 안내함(키트 설명서의 방법), 하드웨어 비상정지 버튼 필요 여부는 미정 — 관련: hmi-web (직접 2026-10-12 · docs/API.md §8, `hmi-web-mockup/config/robot.js` hardwareStop)
- [열림] 공백: 통신이 끊겼을 때 DC 전원 케이블을 뽑으라는 HMI 안내는 서버 담당이 하드웨어 담당의 검토가 필요하다고 함(전원을 끊으면 팔이 떨어지거나 남은 동작이 있을 수 있음). 답장 4장에 검토하겠다고 씀 — 관련: hmi-web (사용자 2026-10-16 · 서버 회신 5장)
- [열림] 제한: 프로그램 종료(F-03)는 HMI만 닫고 서버에 아무것도 보내지 않음(D-015). 창은 닫지 않고 종료 화면만 남김(브라우저는 스크립트가 연 창만 닫음) — 관련: hmi-web, D-001, D-015 (직접 2026-10-17 · `hmi-web-mockup/react/src/App.jsx` onExit, 브라우저 확인)
- [열림] 제한: HMI 원점과 로봇팔 자세(`arm.json`의 `poses`)는 저장할 때의 캘리브레이션 기준이라, 캘리브레이션을 다시 하거나 서보·혼을 바꾸면 다시 잡아야 함. HMI는 원점을 어느 캘리브레이션에서 잡았는지 몰라 화면이 막지 않음(규칙은 docs/robot-arm.md 6장) — 관련: hmi-web, device-io, D-014 (직접 2026-10-16 · LeRobot main `motors_bus.py`·`so_follower.py`, `hmi-web-mockup/js/home.js`)
- [열림] 제한: 조작 화면은 모듈 스크립트라 파일 더블클릭으로는 열리지 않고 서버로 열어야 함. 다른 PC용 주소와 메인 서버는 빌드한 `hmi-web-mockup/react/dist`를 내주므로 화면을 고친 뒤에는 `npm run build`를 다시 해야 반영됨 — 관련: hmi-web (직접 2026-10-17 · `hmi-web-mockup/tools/dev-server.py`)

## 다음 작업
- 로봇팔 배선·설정(docs/robot-arm.md 4장 1~6번), 끝나면 device-io 확인 (사용자 2026-10-16)

## 참고
- HMI 실행·구조: hmi-web-mockup/README.md (React 화면 `hmi-web-mockup/react/`) · XML 규약: docs/server-xml-v1.0.md(서버 README 사본), docs/xml-protocol.md(HMI 쪽), docs/hmi-server-requests.md(보낸 요청서), docs/hmi-server-reply-1.md(서버 회신 사본), docs/hmi-server-answer-1.md(답장, 아직 보내지 않음) · API v0.5: docs/API.md · 장치 쪽 규약: docs/conveyor-protocol.md, docs/arm-control.md, docs/line-sequence.md · 서버 형식 대응표: docs/server-cases.md · 로봇팔 키트: docs/robot-arm.md · 심플함 비교: docs/simplicity-report.md(React 전 화면) · 포스터: poster/README.md
- 결정: D-001~D-011, D-014~D-016 · HISTORY: 2026-10-17-hmi-react.md, 2026-10-17-react-single-screen-decision.md, 2026-10-17-exit-hmi-only-decision.md, 2026-10-17-server-reply-1.md, 2026-10-16-robot-arm-lerobot-check.md, 2026-10-16-server-wait.md, 2026-10-14-server-xml-v1.md, 2026-10-14-home-in-hmi-decision.md, 2026-10-14-poster-v4-v6.md, 2026-10-13-comm-socket-xml.md, 2026-10-13-home-teach-decision.md, 2026-10-13-home-teach.md, 2026-10-13-poster.md, 2026-10-12-api-v03-devices.md, 2026-10-12-dashboard-controls.md, 2026-10-12-dashboard-tabs.md, 2026-10-12-standalone-screens.md, 2026-10-12-server-compat.md, 2026-10-12-dashboard.md, 2026-10-12-robot-arm-kit.md, 2026-10-12-hmi-web-light.md, 2026-10-12-hmi-web-dark.md, 2026-10-12-api-draft.md
