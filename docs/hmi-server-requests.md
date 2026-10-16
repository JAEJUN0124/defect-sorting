# HMI → 서버 요청 정리 (XML 규약 v1.0 다음)

- 날짜: 2026-10-14
- 보내는 쪽: HMI 담당
- 기준: 서버 문서 「ECP HMI 통신 서버」의 XML 규약 v1.0
- 회신: [hmi-server-reply-1.md](hmi-server-reply-1.md) (2026-10-16 받음). 이 문서는 보낸 그대로 둡니다 — 회신으로 바뀐 것은 [xml-protocol.md](xml-protocol.md), 우리 답장 초안은 [hmi-server-answer-1.md](hmi-server-answer-1.md)

v1.0 문서 잘 받았습니다. HMI는 v1.0에 맞춰 연결, 상태 표시, 명령 보내기, Reply 처리를 붙였습니다.
이 문서는 HMI가 제대로 동작하려면 서버에 더 필요한 것과, 먼저 답을 듣고 싶은 질문을 모은 것입니다.

- 아래 XML은 v1.0과 같은 결로 제안한 모양입니다. 요소 이름은 대문자로 시작하고, 값은 `Auto`·`Received`처럼 씁니다.
- **HMI는 이 모양을 이미 읽도록 만들어 두었습니다.** 이 모양대로 더하면 HMI는 고치지 않아도 됩니다.
- 이름이나 모양을 다르게 하고 싶으면 알려 주세요. HMI를 맞추겠습니다.
- HMI는 모르는 요소·속성을 무시합니다. 하나씩 더해도 HMI가 깨지지 않습니다.
- 서버가 정한 규칙(메시지 하나에 문서 하나, `id`, Reply, Error, 1초마다 상태)은 그대로 따릅니다.

## 한눈에 보기

| 순위 | 항목 | 왜 필요한가 |
|---|---|---|
| 먼저 | 질문 6개 (1장) | 답에 따라 HMI 버튼과 명령의 연결이 바뀜 |
| 1순위 | 라인 상태 `Line` (2.1) | 지금은 가동/정지·긴급정지·운전 모드를 몰라 화면이 "상태 미수신"이고, 버튼을 잠그지 못함 |
| 1순위 | `Home`에 원점 각도 `Motors` (2.2) | 원점은 HMI가 저장하기로 함 — 원점 복귀 때 각도를 보내야 함 |
| 1순위 | 긴급정지 해제 `EmergencyStopRelease` (2.3) | 긴급정지를 풀 방법이 없음 |
| 1순위 | 실행 결과와 거절 이유 (2.4) | 지금 Reply는 받음 확인뿐이라 왜 안 되는지 화면에 쓸 수 없음 |
| 1순위 | 완료 알림 `HomeCompleted` · `ShutdownCompleted` (2.5) | 원점 복귀·종료가 끝났는지 알 수 없음 |
| 1순위 | 바뀌면 바로, 모든 HMI에 상태 보내기 (2.6) | 긴급정지 표시가 최대 1초 늦음. HMI 화면은 셋까지 동시에 열림 |
| 2순위 | 고장 이유 `Fault` (3.1) | 왜 멈췄는지, 어떻게 풀리는지 화면에 써야 함 |
| 2순위 | 이벤트 `Event` (3.2) | 로그·경보 기록 |
| 2순위 | 리더암·카메라 연결 (3.3) | 장치 연결 표시, 시작 조건 |
| 2순위 | 일반 정지 `Stop` (3.4) | 가동 중 정지 (질문 1의 답에 따라) |
| 2순위 | 카메라 켜기·끄기와 영상 주소 (3.5) | 카메라 화면 |
| 3순위 | 판정 하나하나 `Inspection` 메시지 (4.1) | 최근 판정 목록, 분당 그래프, 불량 표시 |
| 3순위 | 공정 단계 `Cycle` (4.2) · 로봇팔(팔로워) 각도 (4.3) | 대시보드 공정 흐름, 원점 잡기 정확도 |
| 3순위 | 서보 온도·전압 (4.4) | 대시보드 서보 표 — 모양은 같이 정하고 싶음 |

## 1. 먼저 답이 필요한 질문

| # | 질문 | HMI가 지금 가정한 것 |
|---|---|---|
| Q1 | `ProgramStop`은 HMI의 **"프로그램 종료"** 버튼인가요, 가동 중 **"정지"** 인가요? | 프로그램 종료로 가정했습니다. 확인 창 → `ProgramStop` → 받음 확인 5초 뒤(또는 `ShutdownCompleted`를 받으면 바로) HMI 종료 화면. 그래서 가동 중 일반 정지는 `Stop`으로 따로 요청합니다 (3.4) |
| Q2 | `Home`은 **"원점 복귀"**(저장된 원점으로 옮기기)가 맞나요? 문서 표에는 "원점 잡기 버튼"이라고 되어 있습니다 | 원점 복귀. HMI에는 버튼이 둘 있습니다: **원점 잡기**(지금 자세를 원점으로 저장 — HMI 안에서 끝남)와 **원점 복귀**(`Home`) |
| Q3 | 원점은 HMI가 저장하고, 원점 복귀 때 HMI가 각도를 `Home`에 실어 보내는 방식(2.2)을 받아 줄 수 있나요? | 그렇게 만들었습니다. 지금 v1.0은 `InvalidCommand`로 거절합니다 |
| Q4 | `RobotArm/Motors`가 리더암 각도인 것은 들었습니다. **6번(그리퍼)도 도(°)** 인가요? | 6개 모두 도로 읽습니다 |
| Q5 | 자동 작업이 원점을 쓰나요? (예: 작업을 원점에서 시작하고 원점에서 끝냄) | 쓰지 않는다고 가정했습니다. 쓴다면 `ProgramStart`에도 원점 각도를 실어야 합니다 |
| Q6 | 장비망에서 서버 PC의 IP와 포트를 알려 주세요 | HMI 설정 기본값은 `ws://localhost:5080/ws/hmi` |

## 2. 1순위 — 꼭 필요한 것

### 2.1 상태에 라인 상태 (`Line`)

v1.0 상태에는 라인이 가동 중인지, 긴급정지가 걸렸는지, 지금 운전 모드가 무엇인지가 없습니다.
그래서 HMI는 "상태 미수신"으로 보이고 버튼을 잠그지 못합니다 (가동 중 모드 전환, 긴급정지 중 시작 등).
`Status` 안에 `Line` 요소 하나를 더해 주세요.

```xml
<Message version="1.0" type="Status" timestamp="2026-10-14T01:00:00Z">
  <Status source="simulation">
    <Line state="Running" mode="Auto" emergencyStop="false" homeRequired="false" startedAt="2026-10-14T00:30:00Z" />
    <Equipment>…v1.0과 같음…</Equipment>
    <Inspection valid="true">…v1.0과 같음…</Inspection>
  </Status>
</Message>
```

| 속성 | 값 | 뜻 |
|---|---|---|
| `state` | `Stopped` · `Starting` · `Running` · `Stopping` · `Homing` | 라인 상태. 긴급정지 중에는 `Stopped` |
| `mode` | `Auto` · `Manual` | **실제** 운전 모드 (Reply의 목표 모드가 아님) |
| `emergencyStop` | `true` · `false` | 긴급정지가 걸려 있는지 |
| `homeRequired` | `true` · `false` | 긴급정지·로봇팔 고장 뒤라 원점 복귀를 해야 자동으로 시작할 수 있음. 원점 복귀를 마치면 `false` |
| `startedAt` | 시각 (선택) | 이번 가동을 시작한 때 (UTC, v1.0 `timestamp`와 같은 모양) |

HMI가 지키는 운전 규칙입니다. 서버도 같은 규칙으로 거절해 주세요 (2.4).

- 운전 모드 전환은 정지 상태에서만 합니다.
- 긴급정지를 해제해도 라인은 정지 상태로 남고, 저절로 다시 가동하지 않습니다.
- 원점 복귀는 자동 모드·정지 상태에서만 합니다.
- 자동 모드에서 `homeRequired`가 `true`면 시작하지 않습니다. 수동 모드 시작은 막지 않습니다 (사람이 리더암으로 움직임).

### 2.2 원점 복귀(`Home`)에 원점 각도 (`Motors`)

원점은 **HMI가 저장**하기로 했습니다.

- **원점 잡기**: 수동 모드에서 사람이 리더암으로 로봇팔을 원하는 자세에 두고 HMI에서 누르면, HMI가 상태로 받은 지금 각도를 저장합니다. 서버에는 아무것도 보내지 않습니다.
- **원점 복귀**: HMI가 저장한 각도를 `Home` 명령에 실어 보냅니다. 서버는 원점을 저장하지 않고, 받은 각도로 로봇팔을 옮기면 됩니다.

`Command` 안에 `Motors` 하나를 받아 주세요. 모양은 상태의 `Motors`와 같습니다 (`valid`만 없음).

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

- 6개가 모두 옵니다. 단위는 HMI가 저장할 때 받은 단위 그대로입니다 (v1.0 상태에서 받으면 모두 `deg`).
- 지금 v1.0은 `Command` 안의 하위 요소를 받지 않아 `InvalidCommand`로 거절합니다. 이것을 받도록 바꿔 주세요.
  HMI는 설정으로 각도 없이 보낼 수도 있지만, 그러면 서버가 원점을 알 수 없습니다.
- 거절할 때 (코드는 2.4):
  - 긴급정지 중 → `EstopActive`
  - 자동 모드가 아님 → `NotAuto`
  - 정지 상태가 아님 → `NotStopped`
  - 각도가 없음 → `HomeNotSet`
  - 여섯 개가 다 없거나 숫자가 아님 → `InvalidAngles`
  - 로봇팔이 연결 안 됨 → `DevicesNotReady`
- 옮기는 동안은 `Line state="Homing"`, 끝나면 `Stopped` · `homeRequired="false"` · 이벤트 `HomeCompleted` (2.5).

### 2.3 긴급정지 해제 (`EmergencyStopRelease`)

```xml
<Message version="1.0" type="Command" id="hmi-k3f9-release-9">
  <Command name="EmergencyStopRelease" />
</Message>
```

- HMI는 "긴급정지 해제" 버튼 → 확인 창을 거쳐 보냅니다.
- 해제해도 라인은 `Stopped`로 남습니다. 긴급정지가 걸려 있지 않으면 `EstopNotActive`로 거절해 주세요.
- 긴급정지 뒤에는 `homeRequired="true"`로 두어 주세요. 긴급정지 때 로봇팔 힘을 빼면 팔 자세가 바뀌므로, 자동으로 시작하기 전에 원점 복귀를 하게 합니다.

### 2.4 실행 결과와 거절 이유 (Reply)

지금 Reply는 "받았음"뿐입니다(`executed="false"`). 그래서 HMI는 버튼 아래에 "서버가 명령을 받았습니다. 아직 장비는 움직이지 않습니다"라고만 씁니다.
장비를 연결한 뒤에는 이렇게 답해 주세요.

| 경우 | `result` | `code` | `executed` |
|---|---|---|---|
| 장비에 명령을 내림 (시작함) | `Received` | `Accepted` | `true` |
| 상태 때문에 할 수 없음 | `Rejected` | 아래 표 | `false` |
| 형식 오류 | `Rejected` | v1.0 그대로 (`InvalidCommand` · `UnknownCommand` · `InvalidMode`) | `false` |

거절 코드입니다. HMI는 코드마다 화면 문구를 이미 가지고 있습니다.

| `code` | 뜻 | 쓰는 명령 |
|---|---|---|
| `EstopActive` | 긴급정지 중 | 시작 · 운전 모드 · 원점 복귀 |
| `EstopNotActive` | 긴급정지 중이 아님 | 긴급정지 해제 |
| `InvalidState` | 지금 상태에서 할 수 없음 (예: 가동 중에 시작) | 시작 · 정지 |
| `NotStopped` | 정지 상태가 아님 | 운전 모드 · 원점 복귀 |
| `NotAuto` | 자동 모드가 아님 | 원점 복귀 |
| `HomeRequired` | 원점 복귀를 먼저 해야 함 (자동 모드) | 시작 |
| `HomeNotSet` | 원점 각도가 없음 | 원점 복귀 |
| `InvalidAngles` | 원점 각도가 잘못됨 | 원점 복귀 |
| `DevicesNotReady` | 장치가 연결 안 됨. `<Param name="missing">`로 장치를 알려 주세요 (아래 예) | 시작 · 원점 복귀 · 카메라 |
| `FaultActive` | 고장이 남아 있음. `<Param name="fault">ServoOverheat</Param>` (고장 코드는 3.1) | 시작 |

```xml
<Message version="1.0" type="Reply" timestamp="2026-10-14T01:00:00Z" id="hmi-k3f9-start-3">
  <Reply command="ProgramStart" result="Rejected" code="DevicesNotReady" executed="false">
    <Param name="missing">Conveyor</Param>
    <Param name="missing">RobotArm</Param>
    <Detail>Conveyor and robot arm are not connected.</Detail>
  </Reply>
</Message>
```

- 이 예를 받으면 HMI는 "컨베이어, 로봇팔 연결이 끊겨 있어 실행하지 못했습니다…"라고 씁니다.
- `missing`의 장치 이름은 상태의 요소 이름과 같게 써 주세요: `Conveyor` · `RobotArm` · `LeaderArm` · `Camera:top`.
- HMI는 `Detail` 문장이 아니라 `code`로 문구를 고릅니다 (v1.0 문서와 같음). 모르는 코드면 "서버가 거절했습니다: (Detail 문장)"으로 보입니다.

### 2.5 완료 알림

오래 걸리는 명령이 끝나면 이벤트로 알려 주세요 (이벤트 모양은 3.2).

| 이벤트 `code` | 보내는 때 | HMI가 하는 일 |
|---|---|---|
| `HomeCompleted` | 원점 복귀를 마침 | 로그에 남김 |
| `ShutdownCompleted` | `ProgramStop` 뒤 정리를 마침 | 종료 화면을 바로 띄움 (안 오면 5초 뒤) |

### 2.6 상태가 바뀌면 바로, 모든 HMI에

- 라인 상태·긴급정지·운전 모드·장치 연결이 바뀌면 1초를 기다리지 말고 상태를 한 번 바로 보내 주세요. 긴급정지 표시가 늦지 않게 하려는 것입니다.
- Reply는 요청한 HMI에만 가는 것이 맞습니다. 다만 HMI 화면은 셋(조작 화면, 대시보드 둘)이고 동시에 열 수 있습니다.
  그래서 **바뀐 상태와 이벤트는 접속한 모든 HMI에** 보내 주세요. 한 화면에서 시작을 누르면 다른 화면도 "가동 중"이 되어야 합니다.

## 3. 2순위 — 있으면 좋은 것

### 3.1 고장 이유 (`Fault`)

라인이 고장으로 멈췄을 때 `Status` 안에 넣어 주세요.

```xml
<Fault code="ServoOverheat" clear="Auto">
  <Param name="arm">RobotArm</Param>
  <Param name="joint">3</Param>
  <Param name="temp">65.2</Param>
</Fault>
```

- 이 예를 받으면 HMI는 "로봇팔 팔꿈치 서보가 과열(65.2°C)되어 멈췄습니다. 원인을 없앤 뒤 시작하세요."라고 씁니다.
- 고장이 없으면 `Fault`를 빼 주세요. `Line`이 있는 상태에 `Fault`가 없으면 HMI는 "고장 없음"으로 봅니다.
- `clear`는 고장이 풀리는 방법입니다.
  - `Auto`: 원인이 사라지면 서버가 지움.
  - `Home`: 원점 복귀를 마치면 지움.
  - `Start`: 사람이 확인하고 시작을 누르면 지우고 시작함.

HMI가 아는 고장 코드입니다. 서버가 실제로 쓰는 것만 보내면 됩니다. 모르는 코드면 HMI는 `Fault` 안의 `<Detail>` 문장 또는 "고장(코드)"를 보입니다.

| `code` | 뜻 | `Param` | `clear` |
|---|---|---|---|
| `ServoOverheat` | 서보 과열로 멈춤 | `arm`, `joint`(모터 번호 1~6), `temp`(°C) | `Auto` |
| `PowerAbnormal` | 전원 전압 이상 (어댑터를 잘못 꽂음 등) | `arm`, `volt` | `Auto` |
| `CalibrationRequired` | 로봇팔 캘리브레이션 값이 없음 | `arm` | `Auto` |
| `GripFailed` | 다시 해도 불량품을 집지 못함 | `step`, `part` | `Home` |
| `ArmMotionTimeout` | 로봇팔이 자세에 제때 닿지 못함 (걸림·과부하) | `step`, `part` | `Home` |
| `ConveyorHalted` | 컨베이어가 스스로 멈춤 | `reason`: `watchdog`(서버 신호 끊김) · `button`(정지 단추) · `fault` · `reset` | `Start` |
| `PartStuck` | 부품이 검사 자리를 지나가지 않음 | `part` | `Start` |
| `InspectionTimeout` | 판정이 제한 시간 안에 오지 않음 | `part`, `ms` | `Start` |

`arm` 값은 `RobotArm` · `LeaderArm`입니다.

### 3.2 이벤트 (`Event`)

로그와 경보 기록에 씁니다. 일이 생길 때마다 한 번씩 보내 주세요.

```xml
<Message version="1.0" type="Event" timestamp="2026-10-14T01:00:00Z">
  <Event code="DeviceDisconnected" level="Warning" seq="57">
    <Param name="device">Conveyor</Param>
  </Event>
</Message>
```

- `level`: `Info` · `Warning` · `Alarm`. `Warning`·`Alarm`이면 HMI의 로그 버튼에 빨간 점이 켜집니다 (불량 검출 `DefectDetected`는 빼고).
- `seq`: 서버를 켤 때부터 1씩 느는 번호 (선택).

| `code` | `level` | `Param` |
|---|---|---|
| `LineStarted` · `LineStopped` | `Info` | — |
| `LineHalted` | `Warning` | `reason` (고장 코드, 3.1) |
| `EstopPressed` | `Alarm` | — |
| `EstopReleased` | `Info` | — |
| `ModeChanged` | `Info` | `mode` (`Auto` · `Manual`) |
| `HomeStarted` · `HomeCompleted` | `Info` | — |
| `DeviceDisconnected` | `Warning` | `device` (`Conveyor` · `RobotArm` · `LeaderArm` · `Camera:top`) |
| `DeviceReconnected` | `Info` | `device` |
| `DefectDetected` | `Warning` | `id` (부품 번호) |
| `ShutdownStarted` · `ShutdownCompleted` | `Info` | — |

### 3.3 리더암·카메라 연결

`Equipment` 안에 넣어 주세요.

```xml
<LeaderArm connected="true" />
<Camera id="top" connected="true" streaming="false" />
<Camera id="close" connected="true" streaming="false" />
```

- 카메라 id는 서버가 정합니다. HMI에는 `top`(위 카메라)·`close`(근접 카메라) 이름표가 있습니다. 다른 id를 쓰면 알려 주세요.
- `streaming`은 영상을 보내는 중인지입니다. 영상 주소는 3.5.

### 3.4 일반 정지 (`Stop`) — Q1의 답에 따라

`ProgramStop`이 프로그램 종료라면, 가동 중에 멈추는 명령을 따로 주세요.

```xml
<Command name="Stop" />
```

- HMI의 시작 버튼은 가동 중이면 "정지"로 바뀝니다. 정지한 뒤에도 서버와 연결은 그대로입니다.
- 제안: 로봇팔이 불량품을 옮기는 중이면 그 작업을 끝낸 뒤 멈춥니다 (`Line state="Stopping"` → `Stopped`).

### 3.5 카메라 켜기·끄기와 영상

```xml
<Command name="CameraStart" camera="top" />
<Command name="CameraStop" camera="top" />
```

- `camera`를 빼면 모든 카메라입니다. (v1.0은 `Command`에 `name`·`mode` 말고는 속성을 받지 않으니, `camera`를 받도록 해 주세요.)
- 영상 자체는 XML에 넣지 말고 따로 받기를 제안합니다. 카메라마다 MJPEG 주소를 열어 두고, 상태의 `Camera`에 `url`·`transport`로 알려 주세요.

  ```xml
  <Camera id="top" connected="true" streaming="true" url="http://192.168.0.10:5080/camera/top" transport="mjpeg" />
  ```

  `url`은 전체 주소로 써도 되고 `/camera/top`처럼 써도 됩니다. 짧게 쓰면 HMI가 접속한 서버 주소(`http://<서버>:5080`)를 앞에 붙입니다.

- 다른 방식이 편하면 알려 주세요. HMI는 MJPEG, JPEG 한 장씩, 웹소켓 JPEG, WebRTC(WHEP)를 받을 수 있습니다.

## 4. 3순위 — 나중에

### 4.1 판정 하나하나 (`Inspection` 메시지)

```xml
<Message version="1.0" type="Inspection" timestamp="2026-10-14T01:00:01Z">
  <Inspection seq="58" id="128" result="Defect" confidence="0.93" camera="top" latencyMs="21">
    <GoodCount>120</GoodCount>
    <DefectCount>9</DefectCount>
  </Inspection>
</Message>
```

- 부품 하나를 판정할 때마다 보냅니다. `result`: `Good` · `Defect`. `id`: 부품 번호.
- `confidence`(0~1), `camera`, `latencyMs`(판정에 걸린 시간), 개수(이 판정을 더한 뒤의 값)는 선택입니다.
- 상태의 `Inspection`(개수)은 그대로 두세요.
- 영상 위에 불량 위치를 그리는 상자는 다음에 같이 정하고 싶습니다.

### 4.2 공정 단계 (`Cycle`)

가동 중 부품 하나를 처리하는 단계입니다. `Status` 안에 넣고, 가동 중이 아니면 빼 주세요.

```xml
<Cycle stage="Inspecting" part="128" step="grasp_part" />
```

- `stage`: `Feeding`(옮기는 중) · `Inspecting`(멈춰서 판정) · `Sorting`(로봇팔이 불량품을 옮김) · `Passing`(양품을 내보냄).
- `step`은 로봇팔 작업의 지금 단계 이름입니다 (선택).

### 4.3 로봇팔(팔로워) 각도

원점 잡기는 로봇팔의 실제 각도가 있으면 그것을 씁니다 (지금은 리더암 각도를 씀). 보낼 수 있으면 `RobotArm` 안에 `Motors`를 하나 더 넣어 주세요.

```xml
<RobotArm connected="true">
  <Motors>…리더암 (v1.0과 같음)…</Motors>
  <Motors role="follower">…로봇팔…</Motors>
</RobotArm>
```

### 4.4 서보 온도·전압

대시보드에 로봇팔·리더암 서보 6개씩 온도·전압·부하 표가 있습니다. 보낼 수 있는지, 어떤 모양으로 보낼지 같이 정하고 싶습니다.

## 5. HMI가 지금 하는 것 (참고)

### 5.1 연결

- 주소는 `ws://<서버>:5080/ws/hmi`이고, HMI 설정에서 바꿉니다. 접속하면 `GetStatus`를 한 번 보냅니다.
- 상태가 3초 넘게 오지 않으면 끊김으로 보고 다시 접속합니다 (서버 문서 권장대로).
  끊긴 동안 화면 조작은 잠기고 "로봇팔과 컨베이어의 DC 전원 케이블을 뽑으세요"라고 안내합니다.
- `Ping`은 기본으로 보내지 않습니다 (상태가 1초마다 오므로). 필요하면 켤 수 있습니다.
- 보내는 메시지의 `version`은 `"1.0"`입니다. 판을 올리면 알려 주세요 — HMI 설정에서 바꿉니다.

### 5.2 버튼 → 명령

| HMI 버튼 | 보내는 것 | 지금 v1.0 서버의 답 |
|---|---|---|
| 긴급정지 | `EmergencyStop` | 받음(`executed="false"`) → HMI가 빨간 글로 "서버가 받았지만 장비를 멈추지 않았습니다 — DC 전원 케이블을 뽑으세요" |
| 시작 | `ProgramStart` | 받음 |
| 프로그램 종료 | `ProgramStop` | 받음 → 5초 뒤 종료 화면 |
| 운전 모드 | `SetMode` `mode="Auto"` · `"Manual"` | 받음 |
| 원점 복귀 | `Home` + `Motors` | `InvalidCommand` (2.2) |
| 원점 잡기 | 보내지 않음 (HMI가 저장) | — |
| 정지 (가동 중) | `Stop` | `UnknownCommand` (3.4) |
| 긴급정지 해제 | `EmergencyStopRelease` | `UnknownCommand` (2.3). 지금은 긴급정지 여부를 몰라 버튼이 보이지 않음 |
| 카메라 켜기·끄기 | `CameraStart` · `CameraStop` | `UnknownCommand` (3.5) |

- 명령 id는 `hmi-<화면마다 다른 4글자>-<명령>-<번호>`입니다 (예: `hmi-k3f9-start-12`, 64자 이하).
  누를 때마다 새 id를 쓰고, 자동으로 다시 보내지 않습니다.
- Reply는 id·명령 이름·목표 모드가 모두 맞을 때만 그 버튼의 답으로 씁니다. 5초 안에 답이 없으면 "응답 미확인"이라고 씁니다 (실패로 단정하지 않음).

### 5.3 상태 → 화면 (v1.0)

- `Status/@source` → 상태 설명에 "화면 값은 서버의 시험용 가상 데이터입니다" / "서버에 연결된 장비가 없습니다".
- `Conveyor`·`RobotArm`의 `connected` → 장치 연결 표시. `Conveyor/@running` → 대시보드 공정 흐름의 컨베이어 칸.
- `RobotArm/Motors` → 리더암 각도. `valid="false"`면 "–".
- `Inspection` → 검사·양품·불량·불량률. `valid="false"`면 0 대신 "–".

## 6. 확인 방법

- HMI 화면(웹)을 열 때 주소 뒤에 `?mock=0&ws=ws://<서버IP>:5080/ws/hmi`를 붙이면 서버에 붙습니다. HMI 파일은 HMI 담당이 드립니다.
- HMI의 서버 점검 페이지(`tools/server-check.html`)에서 형식을 "XML"로 두고 점검하면 연결, 첫 상태, `GetStatus`·`Ping`의 답, 상태 간격을 봅니다. 명령은 보내지 않습니다.
- HMI 쪽은 v1.0을 흉내 낸 시험용 서버로만 확인했습니다. 실제 서버로는 아직 확인하지 못했습니다.

## 7. 그 밖에

- 화면 긴급정지는 네트워크 명령이라 하드웨어 정지를 대신하지 못합니다 (서버 문서와 같음).
  하드웨어 비상정지 버튼을 달지는 하드웨어 담당과 따로 정합니다.
