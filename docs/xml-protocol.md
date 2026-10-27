# HMI ↔ 서버 XML 규약 — HMI 쪽 사용법과 요청안

HMI와 서버는 웹소켓 하나로 XML을 주고받습니다 (D-002). 기준은 서버 담당이 준 **규약 v1.0**([server-xml-v1.0.md](server-xml-v1.0.md))과,
우리 요청서에 대한 **서버 담당 회신**([hmi-server-reply-1.md](hmi-server-reply-1.md), 2026-10-16에 받음)으로 서버에 더해진 것입니다.
회신은 서버 README도 고쳤다고 했지만 새 판은 아직 받지 않았습니다 — server-xml-v1.0.md는 옛 판입니다.
이 문서는 HMI 쪽 이야기입니다.

1. HMI가 v1.0을 어떻게 쓰는지 (버튼 → 명령, 서버의 답, 상태 → 화면)
2. 원점을 HMI가 저장하는 방식
3. v1.0 다음에 서버에 요청할 것 (XML 모양 제안) — 로봇팔이 옮길 부품(양품·불량품, `SetSortTarget`)도 여기
4. 서버 담당과 정할 것
5. 카메라 영상 — XML이 아니라 서버의 HTTP 주소에서 따로 받음 (8장, 서버 안내 2026-10-17)

서버가 v1.0보다 더 보내면(4장의 모양) HMI는 이미 읽습니다. 그 전에는 화면이 "상태 미수신"으로 보이고 키를 막지 않습니다.
예전 HTTP·JSON 초안은 [API.md](API.md)에 남아 있고, 브라우저 안 가짜 서버(`useMock: true`)는 그 초안대로 동작합니다.

## 1. 연결

| 항목 | 값 |
|---|---|
| 주소 | `config.js`의 `wsUrl`. 기본 `ws://localhost:5080/ws/hmi`. 서버 기본은 `ws://127.0.0.1:5080/ws/hmi`로 같은 PC에서만 붙습니다. 다른 PC면 `ws://서버내부IP:5080/ws/hmi`, 포트포워딩한 외부면 `ws://공인IP:외부포트/ws/hmi`. 받은 내부 주소는 `ws://10.108.108.98:5080/ws/hmi` (사용자 2026-10-16). `'auto'`(주소 뒤 `?ws=auto`)면 화면을 내준 서버의 `/ws/hmi` — HMI를 메인 서버에 올렸을 때 (`tools/make-server-bundle.py`, 서버 답장 0.1) |
| 형식 | `config.js`의 `server.format: 'xml'` (기본). `'json'`이면 예전 초안 |
| 시험 주소 | 설정 파일을 고치지 않고 조작 화면 주소 뒤에 `?mock=0&ws=ws://서버IP:5080/ws/hmi` (예: `http://localhost:5174/?mock=0&ws=…`) |
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
| 로봇팔이 옮길 부품 (양품 · 불량품) | `SetSortTarget` `target="Good"` · `target="Defect"` | 없음 — 요청안 (4.2) | 정지 상태에서만 (사용자 2026-10-17). 서버는 속성을 이름보다 먼저 검사해 `InvalidCommand`로 답하고, HMI는 "서버가 아직 … 명령(SetSortTarget)을 받지 않습니다"를 보이며 고른 값을 바꾸지 않음 |
| 긴급정지 해제 | `EmergencyStopRelease` | 있음 (회신으로 더해짐, 받음 확인뿐) | v1.0은 긴급정지 여부를 보내지 않아 이 키가 보이지 않음 |
| 카메라 켜기·끄기 | 보내지 않음 | — | 영상은 서버 안내대로 HTTP로 직접 받음 (8장). 서버는 `CameraStart`·`CameraStop`을 두지 않음 (안내 7장). 브릿지 설정을 끄면(`cameras.bridge: null`) 예전처럼 `CameraStart` · `CameraStop`을 보냄 — 서버는 `camera`를 붙이면 `InvalidCommand`, 없으면 `UnknownCommand` (회신 2장) |

- 이름은 `config.js`의 `server.xml.commands`로 바꿉니다 (기본값: `js/xml-protocol.js`의 `DEFAULTS`). `null`로 두면 보내지 않고 "서버 규약에 없는 명령"이라고 알립니다.
- 명령 id는 `hmi-<창마다 다른 4글자>-<명령>-<번호>`입니다 (예: `hmi-k3f9-start-12`, 64자 이하). 여러 창·여러 PC가 같은 서버에 붙어도 겹치지 않습니다.
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
| `Reply` `result="Rejected"` | `code`에 맞는 문구: `InvalidCommand`(원점 복귀면 `homePose` 안내, 카메라면 "서버가 아직 카메라 명령을 받지 않음", `SetSortTarget`이면 "서버가 아직 로봇팔이 옮길 부품 명령을 받지 않음") · `UnknownCommand`("서버가 아직 모르는 명령") · `InvalidMode` · `InvalidAngles`("원점 잡기를 다시") · `InvalidTarget`(요청안, "양품 또는 불량품만"). 나중에 서버가 상태 때문에 거절하는 코드는 `EstopActive` → `ESTOP_ACTIVE`처럼 HMI 코드로 바꿔 기존 문구를 씁니다 (4.2) |
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
| `Status/@source` | `simulation`이면 상태 설명에 "화면 값은 서버의 시험용 가상 데이터입니다", `unavailable`이면 "서버에 연결된 장비가 없습니다" |
| `Conveyor/@connected` · `RobotArm/@connected` | 장치 연결 (컨베이어·로봇팔). 컨베이어는 지금 화면에서 이 값과 상관없이 "항상 켜짐"으로 보임 — 컨베이어가 늦어져서 (사용자 2026-10-19, `config.js` `alwaysOn`). 장치가 끊겨 거절된 안내는 이 값으로 지움 |
| `Conveyor/@running` | 읽어 두지만 지금 화면에는 보이지 않음 (보이던 탭 대시보드는 2026-10-17에 없앰) |
| `RobotArm/Motors` | **리더암 각도** (서버 담당 답, 사용자 2026-10-14). 운전 모드를 모르는 동안은 조작 화면에 늘 보임(화면 제목은 "팔로워암 각도", 사용자 2026-10-17). `valid="false"`면 `–`. 모두 도(°)로 보임 — `unit="percent"`로 온 값(2026-10-17부터 서버가 6번 그리퍼를 percent로 보냄)은 `config/robot.js`의 `percentToDeg` 범위(임의, 기본 0~100% → 0~100°)로 바꿔 보임. 원점 저장·원점 복귀 값은 받은 단위 그대로 |
| `Inspection` | 검사·양품·불량·불량률. `valid="false"`면 0 대신 `–` |
| 상태 하나가 올 때마다 | 화면 값을 바꿈. 서버가 보낸 상태든 HMI가 물은 답이든 같게 씀. 연결이 살아 있는지는 `Pong`으로도 앎 (65초 넘게 아무 메시지가 없으면 끊김) |

v1.0에 없는 것: 라인 상태, 긴급정지 여부, 운전 모드, 로봇팔이 옮길 부품, 고장, 리더암 연결, 판정 하나하나, 이벤트. (카메라 연결은 XML이 아니라 `/video/status`로 앎 — 8장)
서버 담당은 라인 상태(`Line`)를 다음 단계에 시뮬레이션부터 더하고, 장비를 연결하기 전(`source="unavailable"`)에는 `Line`을 빼 HMI가 "상태 미수신"으로 남게 하겠다고 했습니다 (회신 3장).
그래서 화면은 이렇게 동작합니다.

- 상태 표시가 **"상태 미수신"** 입니다. 키는 막지 않고, 할 수 있는지는 서버의 답으로 알립니다.
- 운전 모드 키는 둘 다 눌리지 않은 모양이고, 원점 복귀·원점 잡기 키는 둘 다 열립니다.
- 로봇팔이 옮길 부품 키(양품·불량품)도 열려 있지만 v1.0 서버는 거절하므로 고른 값이 바뀌지 않습니다. 서버가 받은 적이 있으면 그 값(이 브라우저에 기억, `hmi.sortTarget`)을 눌린 모양으로 보이고 "서버가 지금 값을 아직 알려 주지 않아…"라고 씁니다.

## 3. 원점 — HMI가 저장 (사용자 2026-10-14)

원점은 서버가 아니라 **HMI가 이 브라우저에 저장**합니다 (`localStorage`의 `hmi.home`, `js/home.js`).

장비망 밖 주소(`https://hmi.hypefree.net/`)는 다릅니다 (사용자 2026-10-27, [cloudflare.md](cloudflare.md)).
원점을 브라우저가 아니라 **Cloudflare Worker 한 곳(KV)** 에 두어, 그 주소로 연 모든 브라우저가 같은 원점을 씁니다.
원점 잡기는 로그인(공용 비밀번호)해야 하고, 원점 복귀는 누구나 합니다.
Worker는 원점 복귀(`Home`)의 각도가 저장된 원점과 다르면 서버로 넘기지 않고, 같은 `id`로 `Reply result="Rejected"`를 돌려줍니다 (`code="HomeMismatch"`, 원점이 없으면 `HomeNotSet`).
그 밖의 명령은 그대로 넘기고, 읽은 XML을 다시 써서 넘깁니다(서버가 받는 글이 Worker가 검사한 글과 같도록).
장비망 안 화면(dev-server.py 등)은 아래 표대로 브라우저마다 저장합니다.

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
- 조작 화면을 여러 창에 띄워도 같은 저장소를 씁니다. 다른 창에서 원점을 잡으면 곧바로 따라갑니다.
- 한계:
  - 저장소는 브라우저(PC)마다 따로입니다. 다른 PC나 다른 브라우저에서 HMI를 열면 원점이 없습니다 (밖 주소는 Worker 한 곳이라 같음).
  - 브라우저의 사이트 데이터를 지우면 원점도 지워집니다.
  - 저장소가 막힌 환경에서는 그 창에서만 기억하고, 화면에 그렇게 알립니다.
- 원점을 저장한 때는 수동 모드에서 원점 키 아래에 보입니다.

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
| 고장 `Fault` · 리더암 연결 · 판정 하나하나 · 공정 단계 · 팔로워 각도 · 서보 값 | 모양은 받아들일 수 있음. 실제 데이터 공급원(장비)을 연결한 뒤 (3차) |
| 카메라 명령·영상 (4.4) | **따로 안내를 받음** ([hmi-video-integration.md](hmi-video-integration.md), 2026-10-17) — XML이 아니라 HTTP MJPEG와 상태 JSON. `Camera` 요소와 `CameraStart`·`CameraStop`은 더하지 않음 (8장) |

**새로 요청할 것** (2026-10-17, 아직 보내지 않음 — 답장 [hmi-server-answer-1.md](hmi-server-answer-1.md) 0.5·7장): HMI가 고른 로봇팔이 옮길 부품을 보내는 `SetSortTarget` (4.2). 서버가 지금 값을 `Line/@sortTarget`·이벤트 `SortTargetChanged` (4.1·4.3)로 알려 주는 것은 선택.

### 4.1 상태에 더할 것 (우선순위 1)

```xml
<Message version="1.0" type="Status" timestamp="2026-10-14T01:00:00Z">
  <Status source="equipment">
    <Line state="Stopped" mode="Auto" emergencyStop="false" homeRequired="false" sortTarget="Defect" startedAt="2026-10-14T00:30:00Z" />
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
| `Line/@sortTarget` | `Good` · `Defect` | 로봇팔이 상자에 옮길 부품의 지금 값 (2026-10-17 추가 요청, 4.2 `SetSortTarget`). HMI는 이 값으로 양품·불량품 키를 눌린 모양으로 보임. 없으면 이 브라우저에서 마지막으로 서버가 받은 값을 보이고 그렇다고 씀 |
| `Line/@startedAt` | 시각 (선택) | 이번 가동을 시작한 때 |
| `Fault` | 없으면 고장 없음 | 멈춘 이유. `code`는 [API.md 3.1](API.md#31-고장-코드-faultcode-시작-거절의-fault_active)의 코드를 대문자로 시작하게(`ServoOverheat` — `SERVO_OVERHEAT`도 읽음), `clear`는 `Auto`·`Home`·`Start`, 값은 `Param` (`arm`: `RobotArm`·`LeaderArm`, `joint`: 모터 번호 1~6도 됨) |
| `Cycle` | 선택 | 공정 단계 `Feeding`·`Inspecting`·`Sorting`·`Passing` ([line-sequence.md](line-sequence.md)) |
| `LeaderArm/@connected` · `Camera` | | 리더암·카메라 연결. 카메라는 서버 안내(2026-10-17)대로 XML이 아니라 `/video/status`로 봄 (8장) — `Camera`는 보내지 않아도 됨 |
| `Motors/@role` | `leader`(기본) · `follower` | 로봇팔(팔로워) 각도를 따로 보내면 `role="follower"` |

### 4.2 명령에 더할 것 (우선순위 2)

| 명령 | 모양 | 뜻 |
|---|---|---|
| 원점 복귀 | `<Command name="Home"><Motors>…</Motors></Command>` (2.1 예시) | HMI가 저장한 원점 각도로 옮김. 각도가 없으면 `HomeNotSet`, 여섯 개가 다 없으면 `InvalidAngles` (형식 검사는 회신으로 반영됨) |
| 긴급정지 해제 | `<Command name="EmergencyStopRelease" />` | 해제해도 라인은 정지 상태로 남음 (D-004). 받기는 회신으로 반영됨 |
| 정지 | `<Command name="ProgramStop" />` | 가동 중 장비 정지 (서버와 연결은 그대로, 회신 Q1). 서버가 제안한 `Stop` 별칭은 HMI에 필요 없음 |
| 로봇팔이 옮길 부품 (2026-10-17 추가) | `<Command name="SetSortTarget" target="Good" />` · `target="Defect"` | HMI에서 작업자가 고른 값(로봇팔이 옮길 부품)을 서버에 알림. HMI는 판정하지 않고 고른 값만 보냄 — 값을 어떻게 쓸지는 서버·장비가 정함 (사용자 2026-10-17). HMI는 정지 상태에서만 보냄. 값이 틀리거나 없으면 `InvalidTarget`(제안), 서버가 받을 수 없는 때는 `NotStopped`·`EstopActive` 등으로 거절해도 됨. 서버가 지금 값을 `Line/@sortTarget`(4.1)·이벤트 `SortTargetChanged`(4.3)로 알려 주면 HMI가 그 값을 보임(선택). 값 글자는 `server.xml.sortTargetValues`로 바꿈 |
| 카메라 | ~~`<Command name="CameraStart" camera="top" />` · `CameraStop`~~ | 더 요청하지 않음 — 서버가 영상을 HTTP로 주기로 함 (8장) |

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
  `DeviceDisconnected` · `DeviceReconnected` · `ShutdownStarted` · `ShutdownCompleted` · `DefectDetected` ·
  `SortTargetChanged`(`<Param name="target">Good</Param>`, 2026-10-17 추가 — 로그에 "로봇팔이 옮길 부품을 양품으로 바꿨습니다")
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

- ~~카메라 영상: XML에 넣지 말고 따로 받기를 권합니다 (MJPEG 주소를 `Camera/@url`로).~~ → 정해짐: 서버 안내(2026-10-17)대로 정해진 HTTP 주소에서 MJPEG와 상태 JSON을 받음. `Camera/@url`은 쓰지 않음 (8장).
- 서보 온도·전압과 판정 성능 값: v1.0에도 요청안에도 아직 없습니다. 이 값을 보이던 대시보드를 없애(2026-10-17) 지금은 서보 경고 기록에만 씁니다. 필요하면 다음에 정합니다.

## 5. 서버 담당과 정할 것

- [x] `ProgramStop`의 뜻 → 컨베이어·로봇팔 정지 요청 (회신 Q1). HMI는 정지 키가 `ProgramStop`을 보내고, 프로그램 종료는 HMI만 닫습니다 (사용자 2026-10-16).
- [x] `Home`의 뜻 → 원점 복귀 (회신 Q2). 서버 README의 버튼 이름도 "원점 복귀"로 고쳤다고 함.
- [x] 원점을 HMI가 저장하고 원점 복귀 때 각도를 보내는 방식과 `Home` 안의 `<Motors>` 모양 → 받음 (회신 Q3, 3장).
- [ ] 자동 작업이 원점을 쓰는지 → 서버에 자동 공정 제어가 없어 미정. 장비 담당과 정한 뒤, 쓴다면 `ProgramStart`의 원점 전달 등을 함께 정함 (회신 Q5).
- [ ] 각도 단위: 지금 XML은 1~6번 모두 `deg`이고 실장비는 확인하지 않음 (회신 Q4). LeRobot은 그리퍼를 0~100으로 내므로 장비 연결 전에 맞춤.
- [ ] 서버 PC의 실제 주소와 접속 방식(HTTP·HTTPS, `ws`·`wss`) → 서버 담당이 따로 알려 주기로 함 (회신 Q6, 5장 6).
- [ ] 서버 담당이 우리에게 물은 것 (회신 5장) → 답장 초안 [hmi-server-answer-1.md](hmi-server-answer-1.md) (아직 보내지 않음).
- [ ] 서버 README 새 판 받기 (회신에 README를 고쳤다고 함). 받으면 server-xml-v1.0.md는 그대로 두고 새 파일로.
- [x] 카메라 영상 전달 방식 → 서버 안내 (2026-10-17, [hmi-video-integration.md](hmi-video-integration.md)): HTTP MJPEG `/video/1.mjpg`(탑뷰)·`/video/2.mjpg`(그리퍼)와 상태 JSON `/video/status` (8장).
- [ ] 로봇팔이 옮길 부품 `SetSortTarget` 받기 (4.2), 지금 값 `Line/@sortTarget`(선택, 4.1) → 답장 0.5·7장에 요청 (아직 보내지 않음). 값을 어떻게 쓸지와 서버를 켰을 때의 값은 서버·장비 쪽에서 정함 — HMI는 고른 값만 보냄 (사용자 2026-10-17).
- [ ] 영상 연동 같이 확인 (안내 9장의 2·4·5·6·7 — 실제 설비 영상) → 답장 8.3. 1·3은 2026-10-17 실제 서버로 확인 (장비망 밖에서 영상까지).

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
| `sortTargetValues` | `{ good: 'Good', defect: 'Defect' }` | `SetSortTarget`의 `target` 값 (명령 이름은 `commands.sortTarget`) |
| `motorsAre` | `'leader'` | `RobotArm/Motors` 각도가 누구 것인지. 서버가 로봇팔(팔로워) 각도로 바꾸면 `'arm'` |

## 7. 시험

```bash
node --test "hmi-web-mockup/tests/*.test.js"
```

- `tests/xml.test.js`: XML 읽기·쓰기, v1.0 메시지(서버 문서의 예시 그대로), 요청안 메시지(`SetSortTarget`·`Line/@sortTarget`·`InvalidTarget` 포함), 명령 보내기와 답 찾기(거절 답에 빠진 값), 연결 확인 Ping, 연결 닫기.
- `tests/home.test.js`: 원점 저장.
- `tests/store.test.js`: 다시 붙으면 이벤트 순번을 잊는지(서버 재시작), 상태가 오래 안 오면 묻는지, 원점 잡기 때 각도가 오래됐으면 묻는지, 끊김 판단(Ping 간격보다 짧게 잡지 않음), 프로그램 종료 때 연결을 닫는지, 로봇팔이 옮길 부품(서버 값 → 없으면 기억한 값, v1.0 거절 문구), 브릿지 영상(카메라 명령 없이 켜고 끔).
- `tests/video.test.js`: 영상 주소 만들기(웹소켓 서버의 호스트·포트로), 상태 JSON → 화면 단계(8장 표), 상태 묻기가 겹치지 않는지·제한 시간·숨은 탭.
- `tests/xml-server.test.js`: 시험용 XML 서버가 v1.0과 회신으로 더해진 것대로 답하는지, `--extended`의 `SetSortTarget`, `--video`의 영상 흉내 (파이썬이 없으면 건너뜀).

브라우저에서 확인할 때는 시험용 XML 서버를 띄웁니다. 실제 서버(.NET)가 아니라 v1.0과 회신으로 더해진 것(원점 각도 검사·긴급정지 해제 받기·속성을 이름보다 먼저 검사)을 흉내 내는 개발용 서버입니다.

```bash
python hmi-web-mockup/tests/xml-server.py 5080 --simulation
```

그다음 `http://localhost:5173/?mock=0&ws=ws://localhost:5080/ws/hmi`를 엽니다.

- `--simulation`을 빼면 장비가 없는 기본 상태(`unavailable`)입니다.
- `--extended`를 붙이면 4장 요청안도 흉내 냅니다 (`SetSortTarget`·`Line/@sortTarget`·`SortTargetChanged` 포함).
- `--video`를 붙이면 서버 안내의 영상도 흉내 냅니다 (8장): `/video/status`와 `/video/1.mjpg`·`/video/2.mjpg`(시험 화면 `tests/fixtures/video-*.jpg`를 초당 5장). 끊김은 `/video/_sim`으로 만듭니다 — `?cam=2&on=0`(카메라 2 업로드 멈춤 → 5초 뒤 "5초 이상 새 영상 없음"), `?link=0`(설비 업로드 연결 끊김 → "설비 영상 연결 대기"), `on=1`·`link=1`로 되돌림.
- `--static <폴더>`를 붙이면 그 폴더(예: `hmi-web-mockup/react/dist`)를 같은 주소로 내줍니다 — 메인 서버에 HMI를 올린 모양. 영상 상태 JSON도 같은 주소라 브라우저가 막지 않습니다.
- 미리보기 설정(`.claude/launch.json`)에는 `xml-server`(5080)·`xml-server-plain`(5082)·`xml-server-extended`(5081)·`xml-server-hosting`(5091, 화면 내주기)·`xml-server-video`(5092, 요청안 + 영상 + 화면 내주기 — `http://localhost:5092/`)로 들어 있습니다.
- 서버 점검 도구(`tools/server-check.html`)는 형식을 "XML"로 두면 연결·GetStatus·Ping·상태 간격을 봅니다. 명령은 보내지 않습니다.

## 8. 카메라 영상 — 서버의 HTTP 주소에서 따로 받음 (서버 안내 2026-10-17)

기준은 서버 담당의 안내 [hmi-video-integration.md](hmi-video-integration.md)입니다. 영상은 XML에 싣지 않고, 같은 서버(같은 5080 포트)가 HTTP로 내줍니다.
HMI는 `/ws/hmi`로 영상 명령을 보내지 않고, 설비가 영상을 올리는 `/ws/video`에는 붙지 않습니다.

| 경로 | 내용 | HMI 카메라 |
|---|---|---|
| `/video/1.mjpg` | MJPEG (`multipart/x-mixed-replace`) | `top` 탑뷰 (서버 id 1) |
| `/video/2.mjpg` | MJPEG | `close` 그리퍼 (서버 id 2) |
| `/video/status` | JSON `{ connected, freshnessMs, cameras: [{ id, available, receivedAt, sourceTimestampMs, sequence }] }` | 두 카메라의 영상 상태 |

- 주소: 붙은 웹소켓 주소의 호스트·포트를 그대로 쓰고 `ws`→`http`, `wss`→`https`로 바꿉니다 (HMI 화면의 주소가 아니라, 안내 2장). 예: `ws://10.108.108.98:5080/ws/hmi` → `http://10.108.108.98:5080/video/1.mjpg`.
- 설정: `config.js`의 `cameras.bridge` (`statusPath`, `pollMs` 1000, `timeoutMs` 3000, `streams` — 카메라 이름 → 서버 id·경로). XML 연결일 때만 씁니다. `null`이면 예전 방식(`Status`의 `Camera`와 카메라 명령)으로 돌아갑니다.
- 화면: 카메라 화면 하나에 탑뷰·그리퍼 바꾸기 버튼 (사용자 2026-10-17). "카메라 연결"을 누르면 그때부터 상태를 묻고, 고른 카메라의 영상 하나만 엽니다. 바꾸면 앞 영상을 닫고 새로 엽니다. "카메라 끄기"는 영상 연결을 닫고 묻기를 멈출 뿐 설비 카메라는 그대로입니다 (안내 7장 3).
- 상태 묻기: 앞 조회가 끝난 뒤 1초 뒤에 다음을 묻습니다(겹치지 않음). 제한 시간 3초, 캐시하지 않음(`cache: 'no-store'`). 브라우저 탭이 숨어 있으면 묻지 않고 쉽니다. 카메라는 배열 순서가 아니라 `id`로 찾습니다.
- 화면 단계 (안내 5장):

| 상태 JSON | 화면 (`camera.bridge.*`) |
|---|---|
| 아직 첫 답이 없음 | "영상 상태를 확인하고 있습니다" |
| `connected=false` | 영상을 숨기고 "설비 영상 연결 대기 — 설비가 아직 영상을 보내지 않습니다" |
| 그 카메라 `available=false`, `receivedAt=null` (또는 목록에 없음) | "영상 미수신 — 이 카메라의 영상이 아직 오지 않았습니다" |
| 그 카메라 `available=false`, `receivedAt` 있음 | 마지막 영상을 숨기고 "5초 이상 새 영상 없음" |
| `available=true` | 영상을 엶 ("영상을 여는 중입니다"). 200 응답만으로는 정상으로 보지 않고, 첫 장면이 실제로 그려진 뒤(`naturalWidth > 0`) 영상을 보임 |
| 상태 요청 실패·3초 초과 (지난 값은 믿지 않음) | 영상을 숨기고 "영상 상태 확인 불가 — 다시 확인하고 있습니다" |
| 영상 연결 끊김·그림 오류 (`img` 오류) | 숨기고 "영상을 받지 못해 다시 연결합니다". 1초 → 2초 → 4초, 최대 5초 뒤 `?t=시각`을 붙인 새 주소로 다시 엶 (그사이 상태가 좋아도 기다림, 영상이 나오면 처음부터) |

- 장치 연결 줄과 바꾸기 버튼의 점: 초록 = 그 카메라 영상이 옴(`available=true`). 회색 = 그 밖.
- 영상과 XML 연결은 따로입니다 (안내 5장). 영상이 끊겨도 `/ws/hmi`를 다시 붙지 않고, 서버 연결이 끊겨도 영상은 계속 볼 수 있습니다. 카메라 하나가 끊겨도 다른 카메라는 그대로입니다.
- 브라우저 출처 (안내 8장): 서버에 CORS 설정이 없어, 상태 JSON은 **HMI 화면과 같은 주소**에서 읽어야 합니다 (다른 주소면 브라우저가 막아 "영상 상태 확인 불가"로 남고 영상을 열지 않음). 그래서 HMI는 늘 화면을 내준 곳에 붙는 배치로 씁니다.
  - 밖에서: Cloudflare Worker가 `/ws/hmi`와 함께 `/video/status`·`/video/1.mjpg`·`/video/2.mjpg`도 터널로 넘깁니다 ([cloudflare.md](cloudflare.md)).
  - 장비망 안 다른 PC: HMI 담당 PC에서 `python hmi-web-mockup/tools/dev-server.py 8080 --host 0.0.0.0 --server http://10.108.108.98:5080`, 다른 PC는 `http://<그 PC 주소>:8080/?mock=0&ws=auto`. 개발용 서버가 `/ws/hmi`와 `/video/…`를 메인 서버로 그대로 잇습니다. 주소 뒤에 `ws=ws://10.108.108.98:5080/ws/hmi`처럼 서버 주소를 직접 주면 XML은 되지만 영상 상태는 막힙니다.
  - 메인 서버가 HMI 화면을 내주면(`wsUrl: 'auto'`) 원래 같은 주소입니다.
- 확인한 범위: 시험용 서버(`xml-server.py --video`)의 시험 화면으로 연결·바꾸기·업로드 멈춤·업로드 연결 끊김·복구·상태 확인 불가·좁은 화면(360px)을 브라우저로 확인했습니다 (2026-10-17). 실제 설비 영상, 실제 해상도·FPS의 지연과 부하(안내 9장 7), 여러 HMI 동시 표시는 아직입니다.
