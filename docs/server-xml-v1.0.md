<!-- 서버 담당이 준 HMI 통신 서버 설명서(README)의 사본입니다. 2026-10-14 사용자가 전달. 내용은 고치지 않습니다.
     새 판을 받으면 이 파일을 고치지 말고 새 파일(server-xml-v1.1.md 등)로 둡니다. HMI 쪽 사용법과 요청안: xml-protocol.md -->

# ECP HMI 통신 서버

HMI가 WebSocket 클라이언트로 접속하고, 이 프로그램이 서버가 됩니다.
UTF-8 XML 텍스트 메시지로 장비 상태와 검사 개수를 전달합니다.
현재 실제 컨베이어·로봇·검사 프로그램 연결은 없으며, 기본 상태와 시뮬레이션으로 HMI 연동을 개발할 수 있습니다.
HMI의 긴급 정지·프로그램 시작/정지·원점 복귀·자동/수동 모드 명령을 검증하고,
같은 WebSocket 연결로 `Reply`를 돌려줍니다. 현재 Reply는 **명령 수신 확인**이며 장비 실행 완료가 아닙니다.

## 실행

현재 설치된 .NET 9 SDK를 사용합니다. 외부 NuGet 패키지는 없습니다.
프로젝트 최상위 폴더의 PowerShell에서 실행하세요.

```powershell
dotnet run --project src/Ecp.HmiServer
```

같은 PC에서 접속할 주소: `ws://127.0.0.1:5080/ws/hmi`

테스트 값(각도·양품/불량 개수)이 변하는 시뮬레이션:

```powershell
dotnet run --project src/Ecp.HmiServer -- --Hmi:Simulation=true
```

다른 PC/HMI에서 접속하려면 서버 PC의 장비망 IPv4 주소로 바인딩합니다.
아래 `192.168.0.10`은 실제 서버 IP로 바꾸세요.

```powershell
dotnet run --project src/Ecp.HmiServer -- --urls=http://192.168.0.10:5080 --Hmi:Simulation=true
```

이때 HMI 접속 주소는 `ws://192.168.0.10:5080/ws/hmi`입니다.
Windows 방화벽은 필요한 장비망에서 TCP 5080 접속을 허용하도록 설정해야 합니다.
현재 인증·TLS가 없는 개발용 서버이므로 신뢰할 수 있는 장비망에서 사용하세요.
종료는 `Ctrl+C`입니다.

포트포워딩을 사용하는 외부 HMI는 `ws://공인IP:외부포트/ws/hmi`에 접속합니다.
공유기의 TCP 외부 포트를 서버 PC의 내부 IP와 5080 포트로 전달하고,
서버는 위 예처럼 내부 IP에 바인딩해야 합니다. 실제 주소로 대체해서 사용하세요.
포트포워딩만으로 암호화나 인증이 추가되지는 않습니다. 현재 코드에는 접속 인증이 없으므로,
외부 연결은 VPN 또는 인증과 TLS를 갖춘 프록시 등으로 접근을 제한해야 합니다.

## 설정

`src/Ecp.HmiServer/appsettings.json`의 `Hmi` 항목:

| 설정 | 기본값 | 의미 |
| --- | --- | --- |
| `PushIntervalMs` | `1000` | 상태 전송 간격. 100~60000ms |
| `Simulation` | `false` | true이면 모든 HMI에 동일한 시뮬레이션 상태 제공 |

명령행에서 `--Hmi:PushIntervalMs=500`처럼 덮어쓸 수 있습니다.
기본 바인딩은 `127.0.0.1:5080`입니다.

## XML 규약 v1.0

WebSocket **텍스트 메시지 한 개에 XML 문서 한 개**를 보냅니다.
인코딩은 UTF-8이며 별도 줄바꿈 구분자는 필요하지 않습니다.
WebSocket 프레임이 분할되어도 서버가 메시지를 합쳐 처리합니다.

접속 직후 상태 한 번, 이후 설정된 간격마다 상태를 자동 전송합니다.
HMI는 요청 응답과 자동 전송을 계속 수신할 수 있어야 합니다.
`GetStatus`, `Ping`의 `id`는 선택 사항이고, **`Command`의 `id`는 필수**입니다.
`id`는 1~64자로, 공백만 사용할 수 없으며 응답에 그대로 포함됩니다.
자동 전송에는 `id`가 없습니다. 요청에 고유한 `id`를 넣으면 응답을 구분할 수 있습니다.
`timestamp`는 서버가 메시지를 생성한 UTC 시각이며 장비 측정 시각이 아닙니다.

### HMI → 서버

현재 상태 요청:

```xml
<Message version="1.0" type="GetStatus" id="status-001" />
```

응답 확인 요청:

```xml
<Message version="1.0" type="Ping" id="ping-001" />
```

`Ping` 응답:

```xml
<Message version="1.0" type="Pong" timestamp="2026-10-13T10:00:00Z" id="ping-001" />
```

`Message`에는 `version`, `type`, `id` 외 속성을 넣지 않습니다.
`GetStatus`와 `Ping`에는 하위 요소를 넣지 않습니다.

### HMI → 서버: 장비 명령 전송

HMI는 버튼을 클릭할 때마다 새로운 `id`를 만들어 아래 XML을 **텍스트 메시지**로 전송합니다.
각 예시는 별도의 WebSocket 메시지입니다. 한 메시지에 여러 명령을 넣지 않습니다.
요소명·속성명·명령명·모드 값은 대소문자를 구분하며 XML 네임스페이스는 사용하지 않습니다.
한글 설명 문장을 명령으로 보내는 것이 아니라 아래 정해진 명령명을 사용합니다.

| HMI 동작 | `Command/@name` | 추가 속성 | 명령의 의미 |
| --- | --- | --- | --- |
| 긴급 정지 버튼 | `EmergencyStop` | 없음 | 장비 긴급 정지 요청 |
| 프로그램 시작 버튼 | `ProgramStart` | 없음 | 컨베이어·로봇팔 가동 요청 |
| 프로그램 종료 버튼 | `ProgramStop` | 없음 | 컨베이어·로봇팔 정지 요청. 서버와 WebSocket은 유지 |
| 원점 잡기 버튼 | `Home` | 없음 | 로봇팔 원점 복귀 요청 |
| 자동 모드 선택 | `SetMode` | `mode="Auto"` | 자동 모드 지정 요청 |
| 수동 모드 선택 | `SetMode` | `mode="Manual"` | 수동 모드 지정 요청 |

긴급 정지:

```xml
<Message version="1.0" type="Command" id="hmi01-estop-001">
  <Command name="EmergencyStop" />
</Message>
```

프로그램 시작:

```xml
<Message version="1.0" type="Command" id="hmi01-start-001">
  <Command name="ProgramStart" />
</Message>
```

프로그램 종료(장비 정지):

```xml
<Message version="1.0" type="Command" id="hmi01-stop-001">
  <Command name="ProgramStop" />
</Message>
```

원점 잡기:

```xml
<Message version="1.0" type="Command" id="hmi01-home-001">
  <Command name="Home" />
</Message>
```

자동 모드 지정:

```xml
<Message version="1.0" type="Command" id="hmi01-auto-001">
  <Command name="SetMode" mode="Auto" />
</Message>
```

수동 모드 지정:

```xml
<Message version="1.0" type="Command" id="hmi01-manual-001">
  <Command name="SetMode" mode="Manual" />
</Message>
```

`SetMode`는 목표 모드를 명시합니다. 토글 명령은 지원하지 않습니다.
`Command`에는 `name`, 필요할 때의 `mode` 외 속성·하위 요소·문자열 본문을 넣지 않습니다.

### 서버 → HMI: Reply 수신

서버는 명령 형식을 검증한 직후 **요청한 HMI의 기존 WebSocket 연결**에 Reply 한 건을 보냅니다.
1초 주기 상태 전송을 기다리지 않으며 다른 HMI에 Reply를 방송하지 않습니다.
HMI에 별도 수신 포트나 두 번째 연결을 열 필요는 없습니다.

프로그램 시작 요청을 정상 수신한 예:

```xml
<Message version="1.0" type="Reply" timestamp="2026-10-13T10:00:00Z" id="hmi01-start-001">
  <Reply command="ProgramStart" result="Received" code="ReceiptOnly" executed="false">
    <Detail>Command validated and received. No equipment action was executed or queued.</Detail>
  </Reply>
</Message>
```

자동 모드 요청의 Reply에는 요청한 모드도 포함합니다:

```xml
<Message version="1.0" type="Reply" timestamp="2026-10-13T10:00:00Z" id="hmi01-auto-001">
  <Reply command="SetMode" result="Received" code="ReceiptOnly" executed="false" mode="Auto">
    <Detail>Command validated and received. No equipment action was executed or queued.</Detail>
  </Reply>
</Message>
```

나머지 명령도 같은 형식으로 요청의 `id`와 명령명을 돌려줍니다.

| 응답 항목 | HMI에서 해석할 내용 |
| --- | --- |
| `Message/@id` | 자신이 보낸 요청과 연결하는 식별자 |
| `Reply/@command` | 요청한 명령명. 명령 구조나 이름 자체가 잘못되면 생략될 수 있음 |
| `Reply/@result` | `Received`: 유효한 명령 수신 확인. `Rejected`: 명령 검증 실패 |
| `Reply/@code` | 프로그램이 분기할 상세 코드. 아래 표 참고 |
| `Reply/@executed` | 현재는 항상 `false`. 실제 장비가 수행했다는 뜻으로 처리하면 안 됨 |
| `Reply/@mode` | 정상 `SetMode` 요청의 목표 모드. 실제 장비의 현재 모드가 아님 |
| `Detail` | 사람이 읽는 설명. HMI의 로직은 이 문구 대신 `result`, `code`를 기준으로 분기 |

| Reply 코드 | `result` | 의미 |
| --- | --- | --- |
| `ReceiptOnly` | `Received` | 형식이 유효하여 수신 확인. 장비 실행·예약 없음 |
| `InvalidCommand` | `Rejected` | 명령 누락, 여러 명령, 잘못된 속성/본문 등 |
| `UnknownCommand` | `Rejected` | 지원하지 않는 명령명 |
| `InvalidMode` | `Rejected` | `SetMode`의 mode 누락 또는 Auto/Manual 외 값 |

예를 들어 `mode="Toggle"`을 보낸 경우:

```xml
<Message version="1.0" type="Reply" timestamp="2026-10-13T10:00:00Z" id="hmi01-mode-002">
  <Reply command="SetMode" result="Rejected" code="InvalidMode" executed="false">
    <Detail>SetMode requires mode Auto or Manual.</Detail>
  </Reply>
</Message>
```

XML 자체가 깨졌거나, 버전/최상위 구조/id가 잘못된 경우에는 `Reply` 대신 기존 `Error`를 받습니다.
명령 요청에 id가 없으면 다음처럼 응답합니다:

```xml
<Message version="1.0" type="Error" timestamp="2026-10-13T10:00:00Z">
  <Error code="MissingRequestId">Command requires an id.</Error>
</Message>
```

### HMI 수신 처리 순서

1. WebSocket 연결이 열린 것을 확인하고, 보낼 `id`·명령명·목표 모드를 대기 목록에 먼저 기록한 뒤 명령을 전송합니다.
   전송 자체가 실패하면 해당 대기를 해제하고 전송 실패를 표시합니다.
2. 수신한 텍스트를 XML 파서로 읽고 `Message/@type`을 확인합니다. 문자열 일부를 검색해서 판정하지 않습니다.
3. `Status`는 장비 화면 갱신에 사용합니다. 상태 메시지가 명령 응답보다 먼저 도착할 수 있습니다.
4. `Reply`는 `id`로 대기 요청을 찾고 명령명과 목표 모드도 대조합니다.
   `Received`이면 **서버 수신 확인**, `Rejected`이면 요청 오류를 표시하고 해당 대기를 해제합니다.
5. `Error`는 유효한 id가 있으면 해당 요청 오류로 처리합니다. id가 없으면 통신/프로토콜 오류로 표시하고
   임의의 다른 요청을 완료 처리하지 않습니다. `Pong`은 연결 확인용입니다.
6. 예를 들어 5초 안에 응답이 없으면 **응답 미확인**으로 표시합니다. 실제 동작 실패/성공으로 단정하지 않습니다.
   연결이 끊기면 대기 요청도 미확인으로 처리하고 재접속 후 상태를 다시 조회합니다.

한 연결에서 수신하는 루프는 하나로 유지하고 메시지 type/id에 따라 분배하세요.
명령을 보낸 뒤 무조건 '다음 수신 메시지'를 Reply라고 가정하면 주기 상태 전송과 섞입니다.
알 수 없는 id의 Reply나 이미 처리한 Reply를 다른 버튼 요청의 응답으로 사용하지 마세요.
새로운 버튼 동작에는 새 id를 사용합니다. 재전송은 같은 논리 요청에 한해 같은 id를 사용하되,
현재 서버에는 중복 실행 방지 저장소가 없으므로 장비 제어 명령의 자동 재전송은 구현하지 마세요.
현재는 중복 요청에도 수신 확인만 다시 보내고 어떤 장비 동작도 실행하지 않습니다.

**현재 구현 범위:** 명령 검증과 Reply 송신까지입니다. 명령을 저장·예약하거나,
장비/시뮬레이션 상태·모터 각도·카운터를 변경하지 않습니다.
시뮬레이션 모드도 동일하며, 정지 Reply 이후에도 기존 가상 상태 전송은 계속됩니다.
장비 연결 뒤에 받은 명령을 뒤늦게 자동 실행하지 않습니다.
실제 제어 연동 시 장비 응답을 확인하는 단계와 중복 요청 처리를 추가해야 합니다.
`EmergencyStop` Reply는 물리적 긴급 정지 확인이 아니며, 네트워크 메시지를 장비의 하드웨어 안전 정지 회로 대신 사용하면 안 됩니다.

### 서버 → HMI: 상태

장비가 미연결된 기본 상태의 예시입니다. 자동 전송에서는 `id`만 생략합니다.

```xml
<Message version="1.0" type="Status" timestamp="2026-10-13T10:00:00Z" id="status-001">
  <Status source="unavailable">
    <Equipment>
      <Conveyor connected="false" running="false" />
      <RobotArm connected="false">
        <Motors>
          <Motor id="1"><Angle unit="deg" valid="false" /></Motor>
          <Motor id="2"><Angle unit="deg" valid="false" /></Motor>
          <Motor id="3"><Angle unit="deg" valid="false" /></Motor>
          <Motor id="4"><Angle unit="deg" valid="false" /></Motor>
          <Motor id="5"><Angle unit="deg" valid="false" /></Motor>
          <Motor id="6"><Angle unit="deg" valid="false" /></Motor>
        </Motors>
      </RobotArm>
    </Equipment>
    <Inspection valid="false">
      <GoodCount>0</GoodCount>
      <DefectCount>0</DefectCount>
    </Inspection>
  </Status>
</Message>
```

| 항목 | 해석 |
| --- | --- |
| `Status/@source` | `unavailable`: 실제 데이터 공급원 없음. `simulation`: 시험용 가상 데이터 |
| `Conveyor/@connected` | 서버와 컨베이어의 연결 여부 |
| `Conveyor/@running` | 컨베이어 가동 여부. `connected=false`일 때는 미확인으로 표시 |
| `RobotArm/@connected` | 서버와 로봇 팔 컴퓨터의 연결 여부. HMI 접속 여부와는 별개 |
| `Motor/@id` | 리더암 모터 번호 1~6 |
| `Angle` | 도(deg) 단위 각도. 유효한 예: `<Angle unit="deg" valid="true">12.34</Angle>` |
| `Angle/@valid` | false이면 미수신 값이므로 HMI에 `—` 또는 `미수신`으로 표시 |
| `Inspection/@valid` | false이면 개수 0은 자리 표시값이며 실제 검사 결과가 아님 |
| `GoodCount`, `DefectCount` | 각각 양품 개수, 불량 개수. 정수 |

시뮬레이션은 연결/가동을 true로 표시하고, 각도는 -45~45도 범위에서 변합니다.
2초마다 검사 1개가 추가되며 매 5번째는 불량입니다.
시뮬레이션 시간과 개수는 서버 시작 기준이고 재시작하면 초기화됩니다.
실제 검사 결과 저장·누적·초기화 정책은 아직 구현하지 않았습니다.

### 오류와 연결 처리

```xml
<Message version="1.0" type="Error" timestamp="2026-10-13T10:00:00Z" id="req-001">
  <Error code="UnknownType">Supported requests: GetStatus, Ping, Command.</Error>
</Message>
```

Error 코드: `InvalidXml`, `InvalidRequest`, `UnsupportedVersion`, `UnknownType`, `MissingRequestId`.
명령 본문의 오류는 위 Reply 코드 표를 참고하세요.
해석할 수 없는 XML은 요청 `id` 없이 오류를 돌려줍니다.
일반 XML 오류 후에는 연결을 유지합니다. DTD/외부 엔티티는 허용하지 않습니다.
바이너리 메시지는 연결 종료 코드 1003, 16KiB 초과 요청은 1009로 종료합니다.
분할 메시지 완성 제한은 첫 프레임 이후 10초, 전송 제한은 5초입니다.
WebSocket Ping/Pong으로 끊긴 연결을 감지하며 여러 HMI가 동시에 접속할 수 있습니다.

HMI는 연결 해제 또는 상태 수신 중단 시 기존 값을 최신 상태로 표시하지 않아야 합니다.
기본 1초 주기에서는 예를 들어 3초 이상 상태가 없으면 통신 지연/끊김 표시 후 재접속하세요.
갱신 주기를 변경하면 이 시간도 함께 조정하세요.

## 검사 실행

```powershell
dotnet run --project tests/Ecp.HmiServer.Checks
```

로컬 임시 포트에 서버를 띄워 실제 WebSocket으로 기본 상태, 주기 전송,
복수 접속, 조회/Ping, 분할 UTF-8 XML, 잘못된 XML/DTD, 요청 형식 오류,
바이너리/크기 제한, 종료/재접속, 시뮬레이션을 검사합니다. 실패하면 종료 코드가 0이 아닙니다.
또한 모든 명령과 두 모드의 Reply, 요청 id 대응, HMI별 응답 분리,
잘못된 명령/모드/id 거절, 장비 실행 여부의 정확한 표시를 검사합니다.

## 파일 구성과 다음 연결 지점

- `Program.cs`: 서버 주소, 설정, WebSocket 경로, 접속 로그
- `HmiSession.cs`: HMI별 송수신, 주기 전송, 메시지 크기/시간 제한
- `Protocol.cs`: XML 요청·장비 명령 검증, Status/Pong/Reply/Error 생성
- `StatusSource.cs`: 장비·검사 데이터 생성. 실제 장비 연결 시 교체할 위치

로봇 컴퓨터 연결 시 `StatusSource`가 실제 상태의 스냅샷을 읽도록 바꿉니다.
그때 모터 ID 대응, 각도 영점·방향·범위, 실제 데이터의 수신 시각/유효성,
컨베이어 상태 공급원, 검사 카운터 누적 기준을 장비 측 규약과 맞춰야 합니다.

구현 참고: [Microsoft ASP.NET Core WebSocket 문서](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets?view=aspnetcore-9.0).
