# HMI ↔ 서버 XML 규약 — HMI 쪽 사용법과 요청안

HMI와 서버는 웹소켓 하나로 XML을 주고받습니다 (D-002). 기준은 서버 담당이 준 **규약 v1.0**([server-xml-v1.0.md](server-xml-v1.0.md))과,
우리 요청서에 대한 **서버 담당 회신**([hmi-server-reply-1.md](hmi-server-reply-1.md), 2026-10-16에 받음)으로 서버에 더해진 것입니다.
회신은 서버 README도 고쳤다고 했지만 새 판은 아직 받지 않았습니다 — server-xml-v1.0.md는 옛 판입니다.
이 문서는 HMI 쪽 이야기입니다.

1. HMI가 v1.0을 어떻게 쓰는지 (버튼 → 명령, 서버의 답, 상태 → 화면)
2. 원점을 HMI가 저장하는 방식
3. v1.0 다음에 서버에 요청할 것 (XML 모양 제안)
4. 서버 담당과 정할 것

서버가 v1.0보다 더 보내면(4장의 모양) HMI는 이미 읽습니다. 그 전에는 화면이 "상태 미수신"으로 보이고 키를 막지 않습니다.
예전 HTTP·JSON 초안은 [API.md](API.md)에 남아 있고, 브라우저 안 가짜 서버(`useMock: true`)는 그 초안대로 동작합니다.

## 1. 연결

| 항목 | 값 |
|---|---|
| 주소 | `config.js`의 `wsUrl`. 기본 `ws://localhost:5080/ws/hmi`. 서버 기본은 `ws://127.0.0.1:5080/ws/hmi`로 같은 PC에서만 붙습니다. 다른 PC면 `ws://서버내부IP:5080/ws/hmi`, 포트포워딩한 외부면 `ws://공인IP:외부포트/ws/hmi`. 받은 내부 주소는 `ws://10.108.108.98:5080/ws/hmi` (사용자 2026-10-16). `'auto'`(주소 뒤 `?ws=auto`)면 화면을 내준 서버의 `/ws/hmi` — HMI를 메인 서버에 올렸을 때 (`tools/make-server-bundle.py`, 서버 답장 0.1) |
| 형식 | `config.js`의 `server.format: 'xml'` (기본). `'json'`이면 예전 초안 |
| 시험 주소 | 설정 파일을 고치지 않고 `index.html?mock=0&ws=ws://서버IP:5080/ws/hmi` (대시보드 단추가 같은 값을 넘김) |
| 상태 받기 | 서버가 상태를 보내는 간격은 서버 설정(`PushIntervalMs`)이라 바뀔 수 있음 (2026-10-16에 1초 → 60초, 앞으로도 바꿀 수 있음 — 사용자). 화면 값은 그 간격대로 바뀜. 상태가 60초(`server.xml.statusPollMs`) 넘게 오지 않을 때만 HMI가 `GetStatus`로 물음. 원점 잡기 때 각도가 3초보다 오래됐으면 그때 한 번 물음 |
| 연결 확인 | HMI가 60초(`server.xml.pingMs`)마다 `Ping`을 보내고 `Pong`을 받음 (사용자 2026-10-16: 60초). 상태 간격이 길어도 서버가 살아 있는지 알기 위해서 (상태 묻기와 따로) |
| 끊김 판단 | 65초(`server.xml.statusTimeoutMs`, `pingMs` + 5초보다 짧게는 잡지 않음) 넘게 아무 메시지(상태·`Pong`·답)가 없으면 "연결 끊김"으로 보이고 다시 붙음. 서버가 연결을 닫으면 바로 앎. 랜선이 빠지는 등 조용히 끊기면 최대 65초 뒤에 알고, 그동안 화면 긴급정지는 서버에 닿지 않음 (명령은 5초 안에 답이 없으면 "응답 미확인") |
| 인증·암호화 | 없음 (서버 v1.0은 TLS·접속 인증이 없음). 믿을 수 있는 장비망 안에서만 씀. HMI를 HTTPS로 띄우면 `ws://`에 붙지 못해 WSS가 필요할 수 있음 (회신 5장 6) |

## 2. HMI가 v1.0을 쓰는 방법

### 2.1 버튼 → 명령

| HMI 버튼 | 보내는 명령 (`Command/@name`) | v1.0에 있나 | 비고 |
|---|---|---|---|
| 긴급정지 | `EmergencyStop` | 있음 | |
| 시작 | `ProgramStart` | 있음 | 자동 모드에서 저장된 원점이 없으면 HMI가 보내지 않음 (3장) |
| 정지 (가동 중 시작 키) | `ProgramStop` | 있음 | 컨베이어·로봇팔 정지 요청 (회신 Q1). 서버가 제안한 별칭 `Stop`은 아직 없어(`UnknownCommand`) HMI는 `ProgramStop`을 보냄. v1.0은 라인 상태를 보내지 않아 가동 중인지 몰라 이 키는 "시작"으로만 보임 |
| 프로그램 종료 | 보내지 않음 | — | **HMI만 닫음** (사용자 2026-10-16). 확인 창 → 서버 연결을 닫고 종료 화면. 라인과 장비는 그대로 |
| 원점 복귀 | `Home` + `<Motors>` (HMI가 저장한 원점 각도) | 있음 (`<Motors>`는 회신으로 더해짐) | 서버는 형식만 검사하고 받음 확인 — 모터 1~6이 한 번씩, 숫자, `deg`만. 틀리면 `InvalidAngles` (3장). 옛 v1.0 서버는 `InvalidCommand`로 거절했음 — 그때는 `server.xml.homePose: false`로 이름만 |
| 원점 잡기 | 보내지 않음 | — | HMI가 저장 (3장) |
| 운전 모드 | `SetMode` `mode="Auto"` · `mode="Manual"` | 있음 | |
| 긴급정지 해제 | `EmergencyStopRelease` | 있음 (회신으로 더해짐, 받음 확인뿐) | v1.0은 긴급정지 여부를 보내지 않아 이 키가 보이지 않음 |
| 카메라 켜기·끄기 | `CameraStart` · `CameraStop` (`camera="top"`은 선택) | 없음 — 요청안 | 서버는 속성을 이름보다 먼저 검사해 `camera`를 붙이면 `InvalidCommand`, 없으면 `UnknownCommand`로 답함 (회신 2장) |

- 이름은 `config.js`의 `server.xml.commands`로 바꿉니다 (기본값: `js/xml-protocol.js`의 `DEFAULTS`). `null`로 두면 보내지 않고 "서버 규약에 없는 명령"이라고 알립니다.
- 명령 id는 `hmi-<창마다 다른 4글자>-<명령>-<번호>`입니다 (예: `hmi-k3f9-start-12`, 64자 이하). 세 화면이 같은 서버에 붙어도 겹치지 않습니다.
- 버튼을 누를 때마다 새 id를 씁니다. 장비 명령은 자동으로 다시 보내지 않습니다 (서버 문서 "HMI 수신 처리 순서").

보내는 모양 (원점 복귀, 각도는 받는 Status와 같은 모양):

```xml
<Message version="1.0" type="Command" id="hmi-k3f9-home-7">
  <Command name="Home">
    <Motors>
      <Motor id="1"><Angle unit="deg">1.31</Angle></Motor>
      <Motor id="2"><Angle unit="deg">-37.14</Angle></Motor>
      <Motor id="3"><Angle unit="deg">-41.44</Angle></Motor>
      <Motor id="4"><Angle unit="deg">-7.64</Angle></Motor>
      <Motor id="5"><Angle unit="deg">33.19</Angle></Motor>
      <Motor id="6"><Angle unit="deg">43.5</Angle></Motor>
    </Motors>
  </Command>
</Message>
```

### 2.2 서버의 답

| 서버가 보낸 것 | HMI가 하는 일 |
|---|---|
| `Reply` `result="Received"` | 성공으로 봅니다. `executed="false"`(v1.0은 늘 이것)면 그 버튼 아래에 "서버가 명령을 받았습니다. 아직 장비는 움직이지 않습니다(서버 규약 v1.0)." |
| 위와 같은데 긴급정지 | 빨간 글로 "서버가 긴급정지 요청을 받았지만 장비를 멈추지는 않았습니다… DC 전원 케이블을 뽑으세요." (서버 문서: Reply는 물리적 정지 확인이 아님) |
| `Reply` `result="Rejected"` | `code`에 맞는 문구: `InvalidCommand`(원점 복귀면 `homePose` 안내, 카메라면 "서버가 아직 카메라 명령을 받지 않음") · `UnknownCommand`("서버가 아직 모르는 명령") · `InvalidMode` · `InvalidAngles`("원점 잡기를 다시"). 나중에 서버가 상태 때문에 거절하는 코드는 `EstopActive` → `ESTOP_ACTIVE`처럼 HMI 코드로 바꿔 기존 문구를 씁니다 (4.2) |
| `Error` (id 있음) | 그 요청의 실패 (`UnsupportedVersion` 등) |
| `Error` (id 없음) | 다른 요청을 끝내지 않고 로그에 "서버가 통신 오류를 알렸습니다 (코드)" |
| 5초(`server.xml.replyTimeoutMs`) 안에 답 없음 · 그사이 끊김 | 실패로 단정하지 않고 "서버 응답을 확인하지 못했습니다. 명령이 처리됐는지는 상태 표시로 확인…" |
| `Pong` | 연결 확인. HMI는 `server.xml.pingMs`(기본 60초)마다 `Ping`을 보냄. `0`이면 보내지 않음 |

`Reply`는 id로 요청을 찾고, 답에 명령 이름·목표 모드가 있으면 그것도 맞아야 그 요청의 답으로 씁니다 (다른 버튼의 답으로 쓰지 않음).
거절 답에는 `mode`가, 형식이 틀린 명령의 답에는 `command`가 없을 수 있어(회신 2장) 답에 없는 값은 비교하지 않습니다. `command`가 없으면 보낸 명령 이름으로 채워 문구를 고릅니다.

`Received`는 받았다는 확인이지 장비가 움직였다는 뜻이 아닙니다. 서버가 장비를 연결한 뒤의 `Received` `code="Accepted"` `executed="true"`도 "실행 요청을 받아들였다"이고, 동작을 마친 것은 이벤트(`HomeCompleted` · `LineStopped`)와 상태로 압니다 (회신 3장).

### 2.3 상태(Status) → 화면

| 받는 것 | 화면 |
|---|---|
| `Status/@source` | `simulation`이면 상태 설명에 "화면 값은 서버의 시험용 가상 데이터입니다", `unavailable`이면 "서버에 연결된 장비가 없습니다". 탭 대시보드 시스템 탭의 "서버 데이터" |
| `Conveyor/@connected` · `RobotArm/@connected` | 장치 연결 (컨베이어·로봇팔) |
| `Conveyor/@running` | 탭 대시보드 공정 흐름의 컨베이어 칸 (연결이 끊겼으면 모름) |
| `RobotArm/Motors` | **리더암 각도** (서버 담당 답, 사용자 2026-10-14). 운전 모드를 모르는 동안은 조작 화면·대시보드에 늘 보임. `valid="false"`면 `–`. 그리퍼도 도(°) |
| `Inspection` | 검사·양품·불량·불량률. `valid="false"`면 0 대신 `–` |
| 상태 하나가 올 때마다 | 화면 값을 바꿈. 서버가 보낸 상태든 HMI가 물은 답이든 같게 씀. 연결이 살아 있는지는 `Pong`으로도 앎 (65초 넘게 아무 메시지가 없으면 끊김) |

v1.0에 없는 것: 라인 상태, 긴급정지 여부, 운전 모드, 고장, 리더암·카메라 연결, 판정 하나하나, 이벤트.
서버 담당은 라인 상태(`Line`)를 다음 단계에 시뮬레이션부터 더하고, 장비를 연결하기 전(`source="unavailable"`)에는 `Line`을 빼 HMI가 "상태 미수신"으로 남게 하겠다고 했습니다 (회신 3장).
그래서 화면은 이렇게 동작합니다.

- 상태 표시가 **"상태 미수신"** 입니다. 키는 막지 않고, 할 수 있는지는 서버의 답으로 알립니다.
- 운전 모드 키는 둘 다 눌리지 않은 모양이고, 원점 복귀·원점 잡기 키는 둘 다 열립니다.
- 탭 대시보드의 시작 조건은 서버가 보내지 않는 칸을 "정보 없음"으로 보입니다.

## 3. 원점 — HMI가 저장 (사용자 2026-10-14)

원점은 서버가 아니라 **HMI가 이 브라우저에 저장**합니다 (`localStorage`의 `hmi.home`, `js/home.js`).

| 기능 | 언제 | 하는 일 |
|---|---|---|
| 원점 잡기 | 수동 모드(가동 중에도). 운전 모드를 모르면 막지 않음. 긴급정지 중에는 안 됨 | 확인 창 → 로봇팔의 지금 6축 각도를 저장. 로봇팔(팔로워) 각도가 있으면 그것, 없으면 리더암 각도(v1.0은 리더암만). 3초 안에 받은 여섯 관절이 다 있어야 저장. 서버에는 보내지 않음 |
| 원점 복귀 | 자동 모드·정지 상태. 운전 모드를 모르면 막지 않음 | 저장한 각도를 `Home` 명령에 실어 보냄(2.1). 서버는 원점을 저장하지 않음. 지금 서버는 형식만 검사하고 받음 확인 — 실제로 옮기는 것은 장비 연결 뒤 (회신 Q3) |
| 자동 시작 | 자동 모드 | 저장된 원점이 없으면 HMI가 시작을 보내지 않음 ("저장된 원점이 없습니다…"). 서버는 원점을 모르므로 이 조건은 HMI가 봄 |

- 서버가 검사하는 것 (회신 3장): `Motor/@id` 1~6이 한 번씩(순서가 아니라 id로), 모터마다 `Angle` 하나, 유한한 숫자(NaN·무한대·빈 값은 거절), `unit="deg"`만.
  어긋나면 `InvalidAngles`. 모터별 최소·최대 각도·영점·방향·그리퍼 대응은 장비를 연결할 때 서버가 더 검사합니다.
- 단위: 서버는 지금 `deg`만 받습니다. HMI는 받은 단위 그대로 저장하므로, 서버가 그리퍼(6번)를 `percent`로 보내기 시작하면 그 원점 복귀는 거절됩니다.
  LeRobot은 그리퍼를 0~100으로 내므로([robot-arm.md](robot-arm.md)) 장비를 연결하기 전에 서버 담당과 단위를 맞춥니다.
- 서버 담당 의견 (회신 3장): 리더암 각도와 로봇팔(팔로워)의 실제 각도가 늘 같다고 볼 수 없어, 실제 원점 복귀에는 팔로워 각도나 검증한 변환이 필요합니다.
  HMI는 팔로워 각도(`Motors role="follower"`, 4.1)가 오면 그것으로 원점을 잡습니다. LeRobot 원격 조작은 각자 캘리브레이션한 리더암 값을 그대로 팔로워 목표로 보냅니다([arm-control.md](arm-control.md) 8장).
- 긴급정지·로봇팔 고장 뒤 "원점 복귀가 필요한지"는 서버가 판단합니다 (요청안의 `homeRequired`).
  원점 잡기는 서버에 알리지 않으므로, 이것만으로는 그 상태가 풀리지 않습니다. 자동으로 다시 시작하려면 원점 복귀를 합니다.
- 세 화면(조작 화면·대시보드 둘)이 같은 저장소를 씁니다. 다른 창에서 원점을 잡으면 곧바로 따라갑니다.
- 한계:
  - 저장소는 브라우저(PC)마다 따로입니다. 다른 PC나 다른 브라우저에서 HMI를 열면 원점이 없습니다.
  - 브라우저의 사이트 데이터를 지우면 원점도 지워집니다.
  - 저장소가 막힌 환경에서는 그 창에서만 기억하고, 화면에 그렇게 알립니다.
- 저장한 원점은 탭 대시보드의 조작 탭(원점 표)과 시스템 탭에서 볼 수 있습니다.

## 4. 서버에 요청할 것 (v1.0 다음, 제안)

서버 담당이 "나중에 더한다"고 한 것들입니다 (사용자 2026-10-14). 아래는 HMI가 원하는 모양입니다.
v1.0과 같은 결: 메시지 하나에 `type` 하나, 그 이름의 요소 하나, 이름은 대문자로 시작합니다.
HMI는 이 모양을 이미 읽습니다 (`tests/xml.test.js`, 시험용 서버 `tests/xml-server.py --extended`).
서버 담당이 다른 이름·모양을 고르면 HMI를 맞춥니다.

**서버 담당에게 보낸 요청서**는 [hmi-server-requests.md](hmi-server-requests.md)입니다 (2026-10-14, 우선순위·질문·코드표를 묶어 혼자 읽히게 쓴 것).
이 장은 요약이고, 요청서와 다르면 요청서가 보낸 내용입니다.

**회신 결과** ([hmi-server-reply-1.md](hmi-server-reply-1.md), 2026-10-16에 받음). 서버 담당은 1차·2차·3차로 나눠 진행하겠다고 했습니다.

| 요청 | 회신 |
|---|---|
| 원점 각도 `Home`+`Motors` (4.2) | **반영** — 받아서 형식만 검사, 받음 확인뿐 (1차) |
| 긴급정지 해제 `EmergencyStopRelease` (4.2) | **반영** — 받음 확인뿐, 상태는 바꾸지 않음 (1차) |
| 라인 상태 `Line` · 상태에 따른 거절 코드 · 핵심 이벤트 · 바뀌면 바로 모든 HMI에 (4.1~4.3) | 2차에 시뮬레이션부터. 장비 연결 전에는 `Line`을 빼서 HMI는 "상태 미수신" |
| 실행 결과 `Accepted` `executed="true"` | 2차 이후. "실행 요청 수락"이지 동작 완료가 아님 — 완료는 이벤트와 상태로 |
| 완료 알림 | `HomeCompleted`는 실제 복귀를 확인한 뒤. `ShutdownCompleted`는 두지 않음(`ProgramStop`은 장비 정지라 정지 완료는 `LineStopped`). 완료 이벤트에 `<Param name="requestId">` 제안 |
| 일반 정지 `Stop` | `ProgramStop`의 별칭으로 제안만 함 (아직 `UnknownCommand`). HMI는 `ProgramStop`을 보냄 |
| 고장 `Fault` · 리더암·카메라 연결 · 카메라 명령·영상 · 판정 하나하나 · 공정 단계 · 팔로워 각도 · 서보 값 | 모양은 받아들일 수 있음. 실제 데이터 공급원(장비)을 연결한 뒤 (3차) |

### 4.1 상태에 더할 것 (우선순위 1)

```xml
<Message version="1.0" type="Status" timestamp="2026-10-14T01:00:00Z">
  <Status source="equipment">
    <Line state="Stopped" mode="Auto" emergencyStop="false" homeRequired="false" startedAt="2026-10-14T00:30:00Z" />
    <Fault code="ServoOverheat" clear="Auto"><Param name="arm">RobotArm</Param><Param name="joint">3</Param><Param name="temp">65.2</Param></Fault>
    <Cycle stage="Inspecting" part="128" />
    <Equipment>
      <Conveyor connected="true" running="false" />
      <RobotArm connected="true"><Motors>…리더암 각도 (v1.0과 같음)…</Motors></RobotArm>
      <LeaderArm connected="true" />
      <Camera id="top" connected="true" streaming="true" url="http://서버:5080/camera/top" transport="mjpeg" />
    </Equipment>
    <Inspection valid="true"><GoodCount>120</GoodCount><DefectCount>8</DefectCount></Inspection>
  </Status>
</Message>
```

| 요소·속성 | 값 | 뜻 |
|---|---|---|
| `Line/@state` | `Stopped` · `Starting` · `Running` · `Stopping` · `Homing` | 라인 상태 — 화면의 정지·가동 중 등과 키 잠금 |
| `Line/@mode` | `Auto` · `Manual` | 지금 운전 모드 (목표가 아니라 실제) |
| `Line/@emergencyStop` | `true` · `false` | 긴급정지가 걸려 있는지 |
| `Line/@homeRequired` | `true` · `false` | 긴급정지·로봇팔 고장 뒤 원점 복귀를 해야 자동으로 시작할 수 있음 |
| `Line/@startedAt` | 시각 (선택) | 이번 가동을 시작한 때 |
| `Fault` | 없으면 고장 없음 | 멈춘 이유. `code`는 [API.md 3.1](API.md#31-고장-코드-faultcode-시작-거절의-fault_active)의 코드를 대문자로 시작하게(`ServoOverheat` — `SERVO_OVERHEAT`도 읽음), `clear`는 `Auto`·`Home`·`Start`, 값은 `Param` (`arm`: `RobotArm`·`LeaderArm`, `joint`: 모터 번호 1~6도 됨) |
| `Cycle` | 선택 | 공정 단계 `Feeding`·`Inspecting`·`Sorting`·`Passing` ([line-sequence.md](line-sequence.md)) |
| `LeaderArm/@connected` · `Camera` | | 리더암·카메라 연결 |
| `Motors/@role` | `leader`(기본) · `follower` | 로봇팔(팔로워) 각도를 따로 보내면 `role="follower"` |

### 4.2 명령에 더할 것 (우선순위 2)

| 명령 | 모양 | 뜻 |
|---|---|---|
| 원점 복귀 | `<Command name="Home"><Motors>…</Motors></Command>` (2.1 예시) | HMI가 저장한 원점 각도로 옮김. 각도가 없으면 `HomeNotSet`, 여섯 개가 다 없으면 `InvalidAngles` (형식 검사는 회신으로 반영됨) |
| 긴급정지 해제 | `<Command name="EmergencyStopRelease" />` | 해제해도 라인은 정지 상태로 남음 (D-004). 받기는 회신으로 반영됨 |
| 정지 | `<Command name="ProgramStop" />` | 가동 중 장비 정지 (서버와 연결은 그대로, 회신 Q1). 서버가 제안한 `Stop` 별칭은 HMI에 필요 없음 |
| 카메라 | `<Command name="CameraStart" camera="top" />` · `CameraStop` (`camera` 빼면 모두) | |

실제로 장비를 움직이게 되면 이렇게 답해 주세요.

- 시작함: `Reply` `result="Received"` `code="Accepted"` `executed="true"`. 끝난 것은 상태와 이벤트로 알립니다.
- 상태 때문에 못 함: `result="Rejected"`와 다음 코드 중 하나 —
  `EstopActive` · `EstopNotActive` · `NotStopped` · `InvalidState` · `NotAuto` · `HomeRequired` · `HomeNotSet` · `InvalidAngles` · `DevicesNotReady` · `FaultActive`.
  HMI는 이 코드를 기존 문구로 보입니다.
- 거절 이유의 값은 `Reply` 안의 `Param`으로: 끊긴 장치 `<Param name="missing">Conveyor</Param>`(여러 번 또는 쉼표로, 이름은 `Conveyor`·`RobotArm`·`LeaderArm`·`Camera:top`),
  남은 고장 `<Param name="fault">ServoOverheat</Param>`.

### 4.3 새 메시지 (우선순위 3)

이벤트 — 로그와 경보에 씁니다. 원점 복귀를 마친 것은 `HomeCompleted`, 정지를 마친 것은 `LineStopped`로 알려 주세요 (회신 3장).
이벤트는 접속한 모든 HMI에 가므로 HMI는 이벤트로 화면을 바꾸지 않고 로그에만 남깁니다 — 한 화면의 요청이 끝났다고 다른 화면이 닫히지 않습니다.
서버가 제안한 요청 id `<Param name="requestId">`는 있어도 없어도 됩니다 (HMI는 모르는 Param을 무시함).

```xml
<Message version="1.0" type="Event" timestamp="2026-10-14T01:00:00Z">
  <Event code="DeviceDisconnected" level="Warning" seq="57"><Param name="device">conveyor</Param></Event>
</Message>
```

- 코드: `LineStarted` · `LineStopped` · `EstopPressed` · `EstopReleased` · `ModeChanged` · `HomeStarted` · `HomeCompleted` ·
  `DeviceDisconnected` · `DeviceReconnected` · `ShutdownStarted` · `ShutdownCompleted` · `DefectDetected`
  (그 밖은 [API.md 5.1](API.md#51-event-코드)의 코드를 대문자로 시작하게).
- `level`: `Info` · `Warning` · `Alarm`.
- `seq`: 순번 (선택). 서버를 다시 켜면 1부터 다시 셉니다 (회신 3장). HMI는 같은 순번을 한 번만 쓰고, 다시 붙으면 지난 순번을 잊습니다.

판정 하나하나 — 최근 판정 목록·분당 그래프·영상 위 판정 표시에 씁니다.

```xml
<Message version="1.0" type="Inspection" timestamp="2026-10-14T01:00:01Z">
  <Inspection seq="58" id="128" result="Defect" confidence="0.93" camera="top" latencyMs="21">
    <GoodCount>120</GoodCount><DefectCount>9</DefectCount>
  </Inspection>
</Message>
```

### 4.4 정해지지 않은 것

- 카메라 영상: XML에 넣지 말고 따로 받기를 권합니다 (MJPEG 주소를 `Camera/@url`로). 아직 답을 받지 않았습니다.
- 서보 온도·전압(대시보드 서보 표)과 판정 성능 값: v1.0에도 요청안에도 아직 없습니다. 필요하면 다음에 정합니다.

## 5. 서버 담당과 정할 것

- [x] `ProgramStop`의 뜻 → 컨베이어·로봇팔 정지 요청 (회신 Q1). HMI는 정지 키가 `ProgramStop`을 보내고, 프로그램 종료는 HMI만 닫습니다 (사용자 2026-10-16).
- [x] `Home`의 뜻 → 원점 복귀 (회신 Q2). 서버 README의 버튼 이름도 "원점 복귀"로 고쳤다고 함.
- [x] 원점을 HMI가 저장하고 원점 복귀 때 각도를 보내는 방식과 `Home` 안의 `<Motors>` 모양 → 받음 (회신 Q3, 3장).
- [ ] 자동 작업이 원점을 쓰는지 → 서버에 자동 공정 제어가 없어 미정. 장비 담당과 정한 뒤, 쓴다면 `ProgramStart`의 원점 전달 등을 함께 정함 (회신 Q5).
- [ ] 각도 단위: 지금 XML은 1~6번 모두 `deg`이고 실장비는 확인하지 않음 (회신 Q4). LeRobot은 그리퍼를 0~100으로 내므로 장비 연결 전에 맞춤.
- [ ] 서버 PC의 실제 주소와 접속 방식(HTTP·HTTPS, `ws`·`wss`) → 서버 담당이 따로 알려 주기로 함 (회신 Q6, 5장 6).
- [ ] 서버 담당이 우리에게 물은 것 (회신 5장) → 답장 초안 [hmi-server-answer-1.md](hmi-server-answer-1.md) (아직 보내지 않음).
- [ ] 서버 README 새 판 받기 (회신에 README를 고쳤다고 함). 받으면 server-xml-v1.0.md는 그대로 두고 새 파일로.

## 6. 설정 (`config.js`의 `server.xml`)

| 값 | 기본 | 뜻 |
|---|---|---|
| `version` | `'1.0'` | 보내는 메시지의 `version` |
| `replyTimeoutMs` | `5000` | 이 안에 답이 없으면 "응답 미확인" |
| `statusTimeoutMs` | `65000` | 서버 메시지(상태·`Pong`·답)가 이 시간 동안 없으면 끊김으로 보고 다시 붙음. `pingMs` + 5초보다 짧으면 그 값으로 씀 (Pong을 기다리다 끊김으로 보지 않게) |
| `pingMs` | `60000` | 연결 확인: 이 간격으로 `Ping`을 보냄 (사용자 2026-10-16: 60초). 줄이면 조용한 끊김을 빨리 알지만 요청이 늘어남. `0`이면 보내지 않음 (그때는 서버의 상태 간격이 `statusTimeoutMs`보다 짧아야 함) |
| `statusPollMs` | `60000` | 서버 상태가 이 시간 동안 오지 않으면 HMI가 `GetStatus`로 물음. 답을 기다리는 동안은 다시 묻지 않음. 원점 잡기 때 각도가 오래됐으면 이 값과 상관없이 한 번 물음. `0`이면 주기적으로 묻지 않음 |
| `homePose` | `true` | 원점 복귀 때 원점 각도를 함께 보냄. 회신 뒤 서버는 받음. 각도를 받지 않는 옛 v1.0 서버에 붙을 때만 `false`로 이름만 (주소 뒤 `&homePose=0`으로도) |
| `commands` | `js/xml-protocol.js` `DEFAULTS` | HMI 명령 → 서버 명령 이름. `null`이면 보내지 않음. 정지(`stop`)는 `ProgramStop` |
| `modeValues` | `{ auto: 'Auto', manual: 'Manual' }` | `SetMode`의 `mode` 값 |
| `motorsAre` | `'leader'` | `RobotArm/Motors` 각도가 누구 것인지. 서버가 로봇팔(팔로워) 각도로 바꾸면 `'arm'` |

## 7. 시험

```bash
node --test "hmi-web-mockup/tests/*.test.js"
```

- `tests/xml.test.js`: XML 읽기·쓰기, v1.0 메시지(서버 문서의 예시 그대로), 요청안 메시지, 명령 보내기와 답 찾기(거절 답에 빠진 값), 연결 확인 Ping, 연결 닫기.
- `tests/home.test.js`: 원점 저장.
- `tests/store.test.js`: 다시 붙으면 이벤트 순번을 잊는지(서버 재시작), 상태가 오래 안 오면 묻는지, 원점 잡기 때 각도가 오래됐으면 묻는지, 끊김 판단(Ping 간격보다 짧게 잡지 않음), 프로그램 종료 때 연결을 닫는지.
- `tests/xml-server.test.js`: 시험용 XML 서버가 v1.0과 회신으로 더해진 것대로 답하는지 (파이썬이 없으면 건너뜀).

브라우저에서 확인할 때는 시험용 XML 서버를 띄웁니다. 실제 서버(.NET)가 아니라 v1.0과 회신으로 더해진 것(원점 각도 검사·긴급정지 해제 받기·속성을 이름보다 먼저 검사)을 흉내 내는 개발용 서버입니다.

```bash
python hmi-web-mockup/tests/xml-server.py 5080 --simulation
```

그다음 `http://localhost:5173/?mock=0&ws=ws://localhost:5080/ws/hmi`를 엽니다.

- `--simulation`을 빼면 장비가 없는 기본 상태(`unavailable`)입니다.
- `--extended`를 붙이면 4장 요청안도 흉내 냅니다.
- 미리보기 설정(`.claude/launch.json`)에는 `xml-server`(5080)·`xml-server-plain`(5082)·`xml-server-extended`(5081)로 들어 있습니다.
- 서버 점검 도구(`tools/server-check.html`)는 형식을 "XML"로 두면 연결·GetStatus·Ping·상태 간격을 봅니다. 명령은 보내지 않습니다.
