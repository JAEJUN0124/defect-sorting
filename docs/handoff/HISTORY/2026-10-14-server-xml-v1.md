---
date: 2026-10-14
type: checkpoint
branch: feature/server-xml
items: [hmi-web, api-spec]
decisions: [D-002, D-007, D-014]
corrects: null
source: null
---
# 서버 XML 규약 v1.0을 HMI에 붙이고 원점을 HMI에 저장, 서버 요청서 작성

## 요약
- 사용자가 서버 담당의 HMI 통신 서버 README를 전달했고, 저장소에 사본 `docs/server-xml-v1.0.md`를 두었다. 내용:
  - .NET 9 서버가 WebSocket `ws://<서버>:5080/ws/hmi`를 열고, 텍스트 메시지 하나에 XML 문서 하나를 주고받는다.
  - 접속 직후와 1초마다 상태를 보낸다: 컨베이어·로봇팔 연결과 가동, 모터 6개 각도, 양품·불량 개수, 데이터 출처(`source`).
  - 명령 5개(`EmergencyStop` · `ProgramStart` · `ProgramStop` · `Home` · `SetMode`)는 형식만 검증하고 Reply(받음 확인, `executed="false"`)를 돌려준다. 실제 장비 연결은 없다.
- 사용자 답 (2026-10-14):
  - 라인 상태 등 나머지는 서버 담당이 나중에 더한다. XML 붙이기는 지금 한다.
  - 서버 코드는 아직 받기 어렵다. README 사본은 저장소에 둔다.
  - 원점 잡기·원점 복귀는 둘 다 동작하게 둔다(나중에 하나를 막을 수 있음).
  - `ProgramStop`은 프로그램 종료로 가정한다. 모터 각도는 리더암 것이다.
  - 원점은 HMI가 저장한다 (D-014, HISTORY/2026-10-14-home-in-hmi-decision.md).
- HMI (`hmi-web-mockup/`):
  - XML 읽기·쓰기 `js/xml.js`(DTD·외부 엔티티 거절)와 규약 바꾸기 `js/xml-protocol.js`를 더했다. `js/config.js`에 `server.format: 'xml'`(기본)과 `server.xml`(replyTimeoutMs 5000 · statusTimeoutMs 3000 · homePose · commands · modeValues · motorsAre)을 두고, 주소 기본값을 `ws://localhost:5080/ws/hmi`로 바꿨다. 주소 뒤 `?format=`·`?homePose=`도 받는다.
  - 같은 웹소켓으로 명령을 보내고 Reply·Error를 id·명령 이름·목표 모드로 찾는다. id는 `hmi-<창마다 다른 4글자>-<명령>-<번호>`. 5초 안에 답이 없거나 끊기면 "응답 미확인", 상태가 3초 없으면 끊김으로 보고 다시 붙는다. 접속하면 `GetStatus`를 한 번 보낸다.
  - v1.0은 라인 상태·긴급정지·운전 모드를 보내지 않아, 상태 단계 `unreported`("상태 미수신")를 새로 두고 키를 막지 않는다. 받음 확인(`executed="false"`)은 키 아래에 "아직 장비는 움직이지 않습니다", 긴급정지는 빨간 글로 DC 전원 케이블 안내를 쓴다. 검사 개수가 무효면 "–", `RobotArm/Motors`는 리더암 각도로 보인다(그리퍼도 도).
  - 명령: 긴급정지 `EmergencyStop`, 시작 `ProgramStart`, 프로그램 종료 `ProgramStop`, 운전 모드 `SetMode`(Auto/Manual), 원점 복귀 `Home` + `Motors`(저장한 원점). v1.0에 없는 정지·긴급정지 해제·카메라 켜기/끄기는 요청안 이름 `Stop` · `EmergencyStopRelease` · `CameraStart`/`CameraStop`으로 보낸다.
  - 원점은 `js/home.js`가 브라우저 저장소 `hmi.home`에 둔다. 세 화면이 같이 쓰고 다른 창의 변경을 따라가며, 저장소가 막히면 그 창에서만 기억하고 알린다. 원점 잡기는 최근 3초 안에 받은 여섯 관절 각도(로봇팔 것, 없으면 리더암 것)를 저장하고 로그에 `home_set`을 남긴다. 자동 모드에서 저장된 원점이 없으면 HMI가 시작을 보내지 않는다.
  - 요청안 모양(상태의 `Line` · `Fault` · `Cycle` · `LeaderArm` · `Camera`, `Motors`의 `role`, `Event` · `Inspection` 메시지, Reply의 `Param`(missing · fault))도 읽는다.
  - 가짜 서버(JSON, API v0.5): 서버의 원점 저장(`home`), 원점 잡기 경로(`POST /robot/home/set`), 시작의 `HOME_NOT_SET` 검사를 뺐다. 원점 복귀는 본문의 각도를 받고, 없으면 `409 HOME_NOT_SET`, 숫자가 아닌 관절이 있으면 `422 INVALID_ANGLES`.
  - 서버 점검 도구(`tools/server-check.html`)에 XML 점검(연결 · 첫 상태 · GetStatus · Ping · 상태 간격, 명령은 보내지 않음)을 더했다.
  - 시험용 XML 서버 `tests/xml-server.py`(v1.0 흉내, `--simulation`, `--extended`는 요청안 흉내)와 `.claude/launch.json`의 xml-server(5080) · xml-server-plain(5082) · xml-server-extended(5081)를 더했다.
  - `js/adapter.js`의 v0.4 서버 원점(`home`) 읽기를 뺐다. XML일 때 카메라 상대 주소는 웹소켓 주소의 http 쪽을 기준으로 푼다.
- 문서:
  - `docs/xml-protocol.md`: HMI 쪽 v1.0 사용법 · 원점 · 요청안 · 정할 것.
  - `docs/hmi-server-requests.md`: 서버 담당에게 보낼 요청서. 사용자 요청으로, 저장소 없이 읽히게 썼다.
  - API v0.5(`docs/API.md` 13장). arm-control · line-sequence · robot-arm · server-cases와 `hmi-web-mockup/README.md`를 원점 HMI 저장에 맞췄다.
- `feature/server-xml`에 커밋(13ffc15)하고 사용자 승인으로 main을 fast-forward했다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-web | 완료 (테스트 87/87, 시험용 XML 서버·가짜 서버로 브라우저 확인) | 완료 (13ffc15) | 미실행 | 미실행 |
| api-spec | 완료 (API v0.5, xml-protocol.md, 서버 요청서) | 완료 (13ffc15) | 해당 없음 | 해당 없음 |

## 근거
- 사용자: 서버 담당의 README 전달과 "전에 말했던거 서버관련 있지? 그거야" (대화, 2026-10-14)
- 사용자: 질문 7개의 답과 원점 저장 결정 (요약의 사용자 답) (대화, 2026-10-14)
- 사용자: "필요한것들 정리해서 서버쪽에 보내게 md파일로 만들어서 줘", 커밋과 main 통합 승인 (대화, 2026-10-14)
- 직접: `node --test "hmi-web-mockup/tests/*.test.js"` 87/87. XML 15 · 원점 저장 3 · 시험용 서버 2를 더하고 가짜 서버의 원점 시험 4개를 바꿈 (2026-10-14)
- 직접: 가짜 서버로 조작 화면에서 수동 → 원점 잡기(확인 창) → 자동 → 원점 복귀 → "원점 복귀를 마쳤습니다" (브라우저, 2026-10-14)
- 직접: 시험용 XML 서버(`--simulation`)로 조작 화면 확인 (브라우저·서버 기록, 2026-10-14)
  - "상태 미수신", 검사 개수, 리더암 각도가 보임
  - 시작 · 자동 · 긴급정지 · 원점 복귀(각도 없이, `?homePose=0`) · 프로그램 종료가 서버에 도착함
  - 각도를 붙인 원점 복귀는 InvalidCommand 안내, 카메라 연결은 UnknownCommand 안내가 나옴
  - 원점 잡기가 리더암 각도를 저장함. 프로그램 종료 뒤 종료 화면이 뜸
  - 서버를 껐다 켜면 끊김 표시 후 다시 붙음
- 직접: 첫 대시보드와 탭 대시보드(개요 · 조작 · 리더암 · 시스템 탭)도 XML로 확인. 탭 대시보드 시작 조건은 폭 1366에서 한 줄 (브라우저, 2026-10-14)
- 직접: 장비 없는(`unavailable`) 시험용 서버로 개수·각도가 "–", 원점 잡기는 "각도를 받지 못해" 안내 (브라우저, 2026-10-14)
- 직접: `--extended` 시험용 서버로 가동 → 긴급정지 → 해제 → 원점 복귀 → 완료. 서버가 받은 원점 각도가 저장한 원점과 같음 (브라우저·서버 기록, 2026-10-14)
- 직접: 요청서에 쓴 요청안 모양(고장 Param의 모터 번호·장치 이름, Reply의 missing·fault, 대문자로 시작하는 고장 코드)이 맞는 화면 문구가 됨 (브라우저 콘솔, 2026-10-14)
- 직접: 서버 점검 도구의 XML 점검이 시험용 서버에서 모두 정상 (브라우저, 2026-10-14)
- 직접: 커밋 13ffc15, main fast-forward (git log, 2026-10-14)

## 경위
- 실제 서버(.NET) 코드가 없어, README를 보고 v1.0을 흉내 낸 시험용 서버로만 확인했다. 시험용 서버가 README대로 답하는지(오류 코드 · 닫기 코드)는 `tests/xml-server.test.js`로 본다.
- 원점을 HMI가 가지므로 원점 복귀는 각도를 실어 보내야 하는데, v1.0 서버는 Command 안의 하위 요소를 `InvalidCommand`로 거절한다. `server.xml.homePose` 기본값을 true(각도를 보냄)로 두어, 서버가 지원하기 전까지 원점 복귀는 거절된다. false면 이름만 보내 v1.0이 받는다. 사용자에게 알렸다.
- v1.0에 없는 명령은 보내지 않는 대신 요청안 이름으로 보내 서버가 `UnknownCommand`로 답하게 했다. 서버가 그 이름으로 더하면 HMI는 고치지 않아도 된다.
- 원점 잡기는 서버에 알리지 않으므로 서버의 원점 필요(`homeRequired`)를 풀지 않는다. 긴급정지 뒤 자동으로 다시 시작하려면 원점 복귀를 해야 한다. v0.4에서는 원점 잡기도 풀었다.
- 요청서를 쓰면서 요청안 모양 일부를 HMI가 못 읽는 것을 찾아 고쳤다: 고장 Param의 모터 번호·장치 이름, Reply의 Param(missing · fault), 대문자로 시작하는 고장 코드의 이유 문구, `INVALID_ANGLES` 문구, XML일 때 카메라 상대 주소.

## 시도했다가 버린 방법
- store.js에 라인 시작 함수를 `start`라는 이름으로 내보냄 → 연결을 여는 기존 `HmiStore.start()`를 덮어써, 화면을 열면 서버 연결 대신 라인 시작 명령이 나감 (직접 2026-10-14 · 가짜 서버 기록에 line_started, 화면이 "연결 중"에 머묾) → `startLine`으로 이름을 바꿈
- 탭 대시보드 시작 조건에 "서버가 보내지 않음"을 씀 → 폭 1024에서 조건 이름 칸이 좁아져 글자마다 줄이 바뀜 (직접 2026-10-14 · 스크린샷) → "정보 없음"
- 시스템 탭 원점 표에 "저장한 곳" 줄을 더함 → 판 머리글이 이미 저장한 곳을 보여 겹침 (직접 2026-10-14 · 스크린샷) → 줄을 빼고 머리글 문구만 "이 HMI (브라우저 저장소)"로 바꿈

## 바뀐 기준 상태 (이전 값)
- 서버: "다른 팀원 담당, HMI가 연결할 실제 서버는 아직 없음" (사용자 2026-10-06)
- HMI 서버 연결: "브라우저 안 가짜 서버로 동작, `useMock: true`" (직접 2026-10-12)
- HMI↔서버 통신 방식: "소켓으로 통신하고 데이터는 XML … 소켓 종류(WebSocket·TCP)와 XML 형식은 미정" (사용자 2026-10-13)
- 원점: "서버가 저장하고 상태 `home`으로 알림 … 가짜 서버는 메모리에만 저장" (직접 2026-10-13)
- 진행 항목 hmi-web: 로컬 "완료 (직접 2026-10-13 · 테스트 67/67 …)", main "완료 (직접 2026-10-13 · 3bca3ed)"
- 진행 항목 api-spec: "HMI↔서버 API 초안 v0.4", 로컬·main "완료 (직접 2026-10-13 · … 3bca3ed)"
- CURRENT에서 지운 공백: 소켓 종류 미확인(→ WebSocket), HMI가 XML을 읽지 못함(→ 읽음), 서버가 원점을 저장할 파일·가짜 서버 원점이 메모리뿐(→ D-014로 HMI 저장, 남은 원점 공백은 새 줄로). 공유용 사본 공백 두 줄은 한 줄로 합침

## 남은 공백·다음
- 실제 서버에 붙여 보지 못함 (서버 코드 없음)
- 서버 v1.0에 라인 상태 등이 없어 "상태 미수신", 각도를 붙인 원점 복귀는 거절됨 — 서버 담당이 더하기로 함
- 서버 담당에게 물을 것: 요청서 1장 Q1~Q6
- 조작 화면(`js/app.js`)의 확인 창은 close 이벤트로 답을 받아, 창이 숨은 동안(미리보기 창을 보지 않는 동안 등)에는 답이 늦게 처리되는 것을 봄. 대시보드(`js/controls.js`)는 이미 피함. 고치지 않음 (직접 2026-10-14 · 브라우저)
- 다음: 지정 없음

## 관련
- 결정: D-002, D-007, D-014
- 이전 기록: HISTORY/2026-10-13-comm-socket-xml.md, HISTORY/2026-10-13-home-teach.md
