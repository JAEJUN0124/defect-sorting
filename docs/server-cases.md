# 서버 형식 대응표 — 서버가 어떻게 만들어지든 바로 맞추기

> **서버 형식이 정해졌습니다 (D-002): 웹소켓 하나 + XML, 서버 담당 규약 v1.0.** HMI 쪽 사용법은 [xml-protocol.md](xml-protocol.md)입니다.
> 이 표는 `config.js`의 `server.format`을 `'json'`으로 둘 때(예전 HTTP·JSON 초안) 쓰는 대응표로 남깁니다.

서버는 다른 팀원이 만들고, 무엇을 어떻게 보낼지는 아직 정해지지 않았습니다. 그래서 HMI는
**서버가 보내는 모양을 스스로 맞춰 읽고**(`hmi-web-mockup/js/adapter.js`), 맞출 수 없는 것은 **설정 한 줄**(`js/config.js`, `config/robot.js`)로 바꾸게 만들었습니다.
이 문서는 "서버가 이렇게 오면 → HMI는 이렇게 하고 → 우리는 이것을 바꾼다"를 사례별로 정리한 표입니다. 권하는 기준 형식은 [API.md](API.md)입니다.

표의 "HMI 동작" 칸: **자동** = 아무것도 안 바꿔도 됨 · **설정** = 설정 한 줄 · **요청** = 서버 담당에게 바꿔 달라고 해야 함.

## 1. 먼저 할 일: 서버 점검

실제 서버가 생기면 HMI를 고치기 전에 이것부터 엽니다.

```bash
python hmi-web-mockup/tools/dev-server.py 5173
```

`http://localhost:5173/tools/server-check.html` → 형식을 고르고(XML이면 실시간 주소만) API 주소·실시간 주소를 넣고 **점검 시작**.
서버 정보·상태를 묻고(GET), 실시간 메시지를 듣기만 합니다(명령은 보내지 않음). 결과로 다음을 보여 줍니다.

- 막는 문제 (서버에 안 닿음, CORS, 상태에 필수 값 없음, 모르는 상태 값 …)
- 실시간 방식 자동 찾기 (WebSocket → Socket.IO → SSE → 폴링 순서로 시도)
- HMI가 알아서 맞춘 것 목록 (이름·단위·묶음 차이)
- **`config.js`에 넣을 값** (그대로 복사)

설정 파일을 고치기 전에 주소만 바꿔 화면을 시험할 수도 있습니다.

```
http://localhost:5173/?mock=0&format=json&api=http://192.168.0.10:8000/api&ws=ws://192.168.0.10:8000/ws&push=socketio
```

`mock=0`(실제 서버) · `format`(`xml`·`json`, 기본 `xml`) · `api` · `ws` · `push`(`ws`·`socketio`·`sse`·`poll`)를 주소 뒤에 붙입니다.
XML 서버는 `?mock=0&ws=ws://192.168.0.10:5080/ws/hmi`면 됩니다.

## 2. 주소와 연결

| 상황 | HMI 동작 | 할 일 |
|---|---|---|
| 서버와 HMI가 같은 PC | — | `apiBase: 'http://localhost:8000/api'`, `wsUrl: 'ws://localhost:8000/ws'` (기본값) |
| 서버가 다른 PC | — | 주소를 그 PC의 IP로. 서버 PC 방화벽에서 포트 허용 |
| HMI를 다른 주소(다른 포트, 파일 더블클릭 `file://`)에서 엶 | 서버가 CORS를 안 열면 명령·상태가 막힘. 서버 점검이 "CORS"로 알려 줌 | **요청**: CORS 허용 (아래) — 또는 서버가 HMI 파일을 직접 내주게 (가장 깔끔) |
| HMI를 `https`로, 서버를 `http`로 | 브라우저가 막음(혼합 콘텐츠) | 둘 다 `http`(내부망) 또는 둘 다 `https` |
| 서버 경로 앞부분이 다름 (`/api` 없음 등) | — | **설정** `apiBase` |

FastAPI에서 CORS 허용 (서버 담당에게 전달):

```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["Location"])  # Location은 WebRTC(WHEP)를 쓸 때만
```

Flask는 `flask-cors`(`CORS(app)`), Flask-SocketIO는 `SocketIO(app, cors_allowed_origins="*")`.

HMI 파일을 서버가 직접 내주면(같은 주소라 CORS가 필요 없음):

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="hmi-web-mockup", html=True), name="hmi")  # API 경로를 먼저 등록한 뒤 마지막에
```

이때 HMI의 `apiBase`는 `'/api'`처럼 같은 주소 기준으로 써도 됩니다.

## 3. 실시간 방식

| 서버가 쓰는 것 | HMI 동작 | 할 일 |
|---|---|---|
| WebSocket (FastAPI `WebSocket`, `websockets`) | 기본 | 없음 |
| Socket.IO (Flask-SocketIO, python-socketio 5.x) | 라이브러리 없이 직접 읽음(Engine.IO 4). 이벤트 이름 = 메시지 종류 | **설정** `server.push: 'socketio'` (네임스페이스가 있으면 `socketioNamespace`, 경로가 다르면 `socketioPath`) |
| SSE (`text/event-stream`, `EventSource`) | 이름 붙은 이벤트·기본 `message` 둘 다 받음 | **설정** `server.push: 'sse'`, `server.sseUrl` |
| 실시간 연결이 없음 (REST만) | 상태를 주기적으로 물음. 서버가 기록 조회(`GET /history`)를 주면 2초마다 물어 판정·이벤트도 받음. 없으면 판정·이벤트 기록은 생기지 않고 통계는 상태로 봄 | **설정** `server.push: 'poll'`, `pollMs` — 판정 목록이 필요하면 **요청**: 기록 조회 또는 실시간 연결 |
| ROS 2 rosbridge | 받기는 됨(`{op:'publish', topic, msg}`) | 명령은 서비스 호출이라 따로 만들어야 함 — 웹 서버를 앞에 두는 것을 권함 |
| MQTT | 직접 받지 않음 | 서버(또는 브리지)가 WebSocket·SSE로 내보내게 **요청** |

Socket.IO의 Engine.IO 3(python-socketio 4.x 이하)은 지원하지 않습니다. 5.x를 쓰게 해 주세요.

## 4. 명령 방식

| 서버가 이렇게 하면 | HMI 동작 | 할 일 |
|---|---|---|
| REST 경로·방식이 다름 (`POST /run`, `POST /mode/set`) | — | **설정** `server.paths: { start: '/run', mode: 'POST /mode/set' }` (이름: `info status start stop estop release home mode cameraStart cameraStop`) |
| 명령을 웹소켓으로만 받음 | `{type:'command', data:{id, name, body}}`를 보내고 `command_result`를 기다림 | **설정** `server.commands: 'ws'`, 이름이 다르면 `server.commandNames` |
| 명령을 Socket.IO 이벤트로 받음 | 이벤트 이름 = 명령 이름, 응답(ack)을 결과로 씀 | **설정** `push: 'socketio'` + `commands: 'ws'` |
| 운전 모드 값이 `AUTO`/`MANUAL` 등 | 받을 때는 자동. 보낼 때 다르면 422가 나고 화면에 "요청 형식을 받지 않았습니다" | **설정** `server.modeValues: { auto: 'AUTO', manual: 'MANUAL' }` (서버 점검이 대문자를 보면 이 줄을 만들어 줌) |
| 시작할 때 값을 더 받음 (속도 등) | — | **설정** `server.startBody: { speed: 40 }` |
| 토큰·키를 요구 | — | **설정** `server.headers: { Authorization: 'Bearer …' }` (비밀값은 저장소에 올리지 말 것) |
| 응답이 느림 | 8초 뒤 "제시간에 답하지 않았습니다" | **설정** `server.timeoutMs` |
| HMI가 끊겼는지 서버가 알아야 함 (끊기면 라인 정지) | `clientPingMs`마다 `{type:'ping'}` 보냄 | **설정** `server.clientPingMs: 2000` + **요청**: 서버가 이것을 보고 판단 |

## 5. 메시지 묶음 모양 — 자동

| 서버가 보내는 모양 | 예 |
|---|---|
| 기준 | `{"type":"status","data":{...}}` |
| 종류 칸 이름이 다름 | `{"event":"status",...}` · `{"kind":...}` · `{"topic":...}` · `{"msg_type":...}` |
| 값 칸 이름이 다름 | `{"type":"status","payload":{...}}` · `"body"` · `"content"` |
| 값이 바로 붙어 옴 | `{"type":"status","line":"running"}` |
| 배열 | `["status", {...}]` (소켓IO식) · `[{...}, {...}]` (여러 개 묶음) |
| 종류가 없음 | `{"line":"running"}` → 내용으로 짐작 (짐작이 틀릴 수 있어 서버 점검이 "확인"으로 알림) |
| 종류 이름이 다름 | `state`·`snapshot`→상태, `result`·`detection`·`judgement`→판정, `log`·`alarm`→이벤트, `ping`·`keepalive`→heartbeat, `servos`·`motors`→서보 상태, `homed`→원점 완료 … |
| 모르는 종류 | 무시하고 서버 점검에 "모르는 종류"로 보임 |

## 6. 상태 값

| 서버가 이렇게 보내면 | HMI 동작 | 할 일 |
|---|---|---|
| `state`·`status`·`phase`로 라인 상태 | 자동 | — |
| `IDLE`·`READY`·`RUN`·`ACTIVE`·`HOMING`·`PAUSED` 등 | 자동 (PAUSED는 정지로) | — |
| 상태 글자로 `EMERGENCY_STOP`·`FAULT` | 자동 (긴급정지·고장으로) | — |
| 모르는 상태 (`CALIBRATING` 등) | 화면 "알 수 없음", 긴급정지·종료만 남김 | **요청**: 기준 값으로 — 또는 `adapter.js`의 `LINE` 표에 한 줄 더함 |
| 긴급정지가 `emergency`·`e_stop`·`ems`, 값이 `"ON"`·`1` | 자동 | — |
| 모드가 `operation_mode`, 값이 `AUTO`·`teleop` | 자동 (보낼 때는 4장 `modeValues`) | — |
| 장치가 `robot`·`follower`·`teleop`·`cam`, 값이 `true`·`"ok"`·`"offline"`·`{connected:true}` | 자동 | — |
| 통계가 `counts: {ok, ng}`, `total` 없음 | 자동 (`total` = 양품 + 불량) | — |
| 연결 직후 상태를 안 보냄 | 연결되면 `GET /status`로 물음 | — |
| 바뀐 필드만 보냄 | 합쳐서 씀 | — |
| 한 겹 더 싸서 보냄 (`{"status": {...}}`) | 자동 | — |

## 7. 시각

| 서버가 이렇게 보내면 | HMI 동작 | 할 일 |
|---|---|---|
| `2026-10-12T14:32:05+09:00` (기준) | 그대로 | — |
| `...Z`, 마이크로초(`.123456`) | 자동 | — |
| `2026-10-12 14:32:05` (공백, 시간대 없음 — 파이썬 `str(datetime)`) | 이 PC 시간으로 읽음 | 로그 시각이 **9시간 어긋나면** **설정** `server.naiveTime: 'utc'` (서버가 `utcnow()`를 쓴 경우) |
| 1970년 기준 초(`time.time()`)·밀리초 | 자동 | — |

## 8. 판정

| 서버가 이렇게 보내면 | HMI 동작 | 할 일 |
|---|---|---|
| 결과 `OK`/`NG`, `pass`/`fail`, `양품`/`불량`, `is_defect: true` | 자동 | — |
| 결과가 숫자 클래스(0/1) | 알아듣지 못함 (서버 점검이 "문제"로 알림) | **요청**: `good`/`defect` 글자로 |
| 신뢰도 `score: 97` (0~100) | 0.97로 바꿈 | — |
| 지연 `latency: 0.021` (초) | 21ms로 바꿈 | — |
| 판정마다 통계 없음 | HMI가 셈 (다음 상태의 통계로 바로잡음) | — |
| 상자 `[x,y,w,h]` 비율 (기준) | 영상 위에 그림 | — |
| 상자 두 모서리 `xyxy`, 키 이름이 `xyxy` | 자동 | — |
| 상자 YOLO 가운데 기준 `[cx,cy,w,h]` | 키가 `cxcywh`면 자동, 아니면 | **설정** `cameras.bboxFormat: 'cxcywh'` |
| 상자가 픽셀 좌표 | 영상 크기를 알면 자동 (서버 정보의 카메라 width·height, 판정의 `image_size`) | 크기를 모르면 **요청**: 서버 정보에 width·height |
| 서버가 상자를 영상에 직접 그림 | 두 번 그려짐 | **설정** `cameras.overlay: false` |

## 9. 이벤트

| 서버가 이렇게 보내면 | HMI 동작 | 할 일 |
|---|---|---|
| `LINE_STARTED`, `lineStarted` | 자동 (소문자 밑줄로) | — |
| `EMERGENCY_STOP_PRESSED`, `homed`, `ng_detected` 등 흔한 다른 이름 | 자동 (`adapter.js` `EVENT_ALIAS`) | — |
| 모르는 코드 + `message` 문장 | 그 문장을 기록 | — |
| 모르는 코드, 문장 없음 | "서버 이벤트: 코드"로 기록 | 자주 쓰면 `js/i18n/ko.js`에 `event.<코드>` 문구 추가 |
| 등급 `WARN`·`CRITICAL`·`severity`, 숫자(파이썬 logging 30·40) | 자동 | — |
| 값(장치·모드)이 빠짐 | 짧은 문장으로 ("장치 연결이 끊겼습니다") | — |

## 10. 오류 응답

| 서버가 이렇게 보내면 | 화면 문구 |
|---|---|
| `{"error":{"code":"DEVICES_NOT_READY","details":{"missing":["arm"]}}}` (기준) | "로봇팔 연결이 끊겨 있어 실행하지 못했습니다…" |
| FastAPI `{"detail":{"code":"E_STOP_ACTIVE"}}`, `{"detail":"ESTOP_ACTIVE"}` | 코드에 맞는 문구 (`E_STOP_ACTIVE` 같은 다른 이름도 알아들음) |
| FastAPI `{"detail":"Not Found"}` (404) | "서버에 이 기능이 없습니다(404). server.paths를 확인하세요" |
| FastAPI 검증 실패 422 `{"detail":[{loc, msg, type}]}` | "서버가 요청 형식을 받지 않았습니다…" — 모드 값이면 4장 `modeValues` |
| 문장만 (`{"detail":"line is busy"}`) | "서버가 거절했습니다: line is busy" |
| HTML 오류 페이지 (Flask 기본) | 상태 코드에 맞는 일반 문구 (401·403·404·405·409·422·500·502·503·504) |

## 11. 카메라

| 상황 | 할 일 |
|---|---|
| 카메라 한 대, 주소만 알려 줌 (v0.1) | 없음. 방식은 주소로 짐작, 아니면 MJPEG |
| 카메라 여러 대 | 서버 정보·상태의 `cameras`에 id별로. 화면 이름은 **설정** `cameras.labels` (`top`·`close`·`side`·`wrist`·`front`는 이미 있음) |
| 조작 화면에 띄울 카메라를 고르고 싶음 | **설정** `cameras.primary: 'top'` (기본: 서버 목록의 첫 번째) |
| 방식을 알려 주지 않음 | **설정** `cameras.transport` (`mjpeg`·`snapshot`·`ws`·`webrtc`·`video`) |
| JPEG를 주 웹소켓에 base64로 섞어 보냄 | `transport: 'ws'`에 주소 없이 → `frame` 메시지를 그림 |
| WebRTC (MediaMTX·go2rtc·aiortc의 WHEP) | `transport: 'webrtc'`, 주소 = WHEP 주소. 다른 주소면 서버가 `Location` 머리글 노출 |
| 카메라가 HMI PC에 꽂혀 있고 서버는 영상을 안 줌 | **설정** `cameras.transport: 'local'` + `tools/devices.html`에서 카메라마다 자리 저장 |
| 위 경우인데 서버도 판정하려면 영상이 필요 | **설정** `cameras.local.upload: 'ws://서버:8000/ws/camera/{id}/upload'` (장면마다 JPEG 바이너리) + **요청**: 받는 쪽 |
| 서버(OpenCV)가 카메라를 쓰는 중 | 같은 PC에서 HMI가 그 카메라를 직접 열 수 없음 (Windows는 한 프로그램만) — 서버가 영상을 주게 |

## 12. 로봇팔 값

| 서버가 이렇게 보내면 | HMI 동작 | 할 일 |
|---|---|---|
| LeRobot 그대로 `{"shoulder_pan.pos": 12.3, ...}` | 자동 | — |
| 단위 도 (LeRobot `use_degrees=True`, 기본) | 관절 °, 그리퍼 % | — |
| 단위 정규화 (`use_degrees=False`, -100~100) | `unit`을 보내면 자동, 아니면 | **설정** `config/robot.js jointUnit: 'norm'` (원점은 HMI가 저장하고, 원점 복귀 때 관절마다 단위를 함께 보냄) |
| 라디안 | 도로 바꿈 (`unit: 'rad'` 또는 설정) | **설정** `jointUnit: 'rad'` |
| 서보 원시값 0~4095 | 도로 바꿈 (서버 정보의 캘리브레이션 최소·최대가 있으면 LeRobot과 같게) | **설정** `jointUnit: 'raw'` |
| 관절을 배열 `[6개]`, `joint1~6`, `j1`, `base`·`elbow` | 자동 (1~6번 순서) | — |
| 서보 전압을 원시값(121 = 12.1V) | 자동 | — |
| 서보 부하를 원시값(0.1% 단위) | 100을 넘는 값을 본 뒤부터 원시값으로 | 처음부터 맞추려면 **설정** `robot.loadUnit: 'permille'` |
| 서보 경고(과열·전압)를 서버가 안 보냄 | HMI가 서보 상태로 판단해 기록 (55°C 경고·65°C 비상, 어댑터 정격 ±10%) | 기준은 `config/robot.js limits`·`supply` |
| 서버도 서보 경고를 보냄 | 서버 것만 씀 (첫 `servo_*` 이벤트를 받은 뒤 HMI 판단은 멈춤) | 늘 HMI도 판단하려면 `localAlarms: true` |
| 서보 상태(`telemetry`)를 아예 안 보냄 | HMI가 서보 과열·전압 이상을 알 수 없어 경고를 기록하지 못함 (서보 표를 보이던 대시보드는 2026-10-17에 없앰) | **요청**: 1~2Hz로 (LeRobot `bus.sync_read`로 읽을 수 있음) |

## 13. 연결 끊김 판단

| 서버가 이렇게 하면 | HMI 동작 | 할 일 |
|---|---|---|
| heartbeat를 2초마다 (기준) | 6초 동안 아무 메시지가 없으면 끊김 | — |
| heartbeat 없음 | 웹소켓이 닫힐 때만 끊김으로 봄 (랜선이 빠지면 늦게 앎) | **요청**: heartbeat — 또는 그대로 |
| heartbeat가 느림 (5초 이상) | 끊김을 잘못 띄울 수 있음 | **설정** `heartbeatTimeoutMs` (서버 점검이 값을 제안) |

## 14. 하나도 안 맞을 때 — 직접 더하기

1. `tools/server-check.html`에서 서버가 보낸 모양을 확인합니다 ("받은 실시간 메시지" 표의 서버가 쓴 이름·마지막 내용).
2. `hmi-web-mockup/js/adapter.js` 위쪽의 이름표(`TYPES`·`LINE`·`MODE`·`DEVICE`·`GOOD`·`DEFECT`·`EVENT_ALIAS`·`ERROR_ALIAS`·`JOINT_ALIAS`)에 다른 이름을 한 줄 더합니다.
3. `hmi-web-mockup/tests/adapter.test.js`에 그 모양을 한 줄 더하고 시험합니다.

```bash
node --test "hmi-web-mockup/tests/*.test.js"
```

형식이 다른 서버를 흉내 내는 시험용 서버도 있습니다. FastAPI·Flask식 모양을 일부러 섞었고, WebSocket·Socket.IO·SSE·MJPEG·스냅샷·웹소켓 영상을 다 냅니다.

```bash
python hmi-web-mockup/tests/variant-server.py 8765
```

`http://localhost:5173/?mock=0&api=http://localhost:8765/api&ws=ws://localhost:8765/ws` 로 열면 HMI가 이 서버를 그대로 쓰는 모습을 볼 수 있습니다.
시험용 서버는 v0.2식이라 기록 조회(`GET /history`)·순번·공정 단계가 없습니다. 이런 서버에서도 HMI가 v0.2 때처럼 동작하는지 볼 때 씁니다.
미리보기 설정(`.claude/launch.json`)에 `variant-server`로도 들어 있습니다.

## 15. 지난 기록과 순번 (v0.3)

화면을 새로 열거나 서버에 다시 붙을 때 지난 기록을 채우는 기능입니다 ([API 5.2장](API.md#52-순번seq과-기록-조회--get-apihistory-v03-권장)). 없어도 화면은 동작합니다.

| 서버가 이렇게 하면 | HMI 동작 | 할 일 |
|---|---|---|
| 기록 조회가 없음 (404·405·501) | 화면을 연 뒤 받은 것만 보임 (v0.2와 같음) | 그대로 — 또는 **요청**: `GET /api/history` |
| 경로가 다름 (`/api/logs` 등) | 없는 것으로 봄 | **설정** `server.paths: { history: '/logs' }` |
| 이름이 다름 (`logs`·`results`·`buckets`·`runId`·`server_time`) | 자동 | — |
| 판정·이벤트에 순번(`seq`)이 없음 | 처음 열 때 채우기는 됨. 다시 붙을 때 겹친 기록을 가려내지 못함 | **요청**: `seq` (서버 점검이 알려 줌) |
| `run_id`가 없음 | 서버를 다시 켜면 순번이 처음부터라 다시 붙을 때 빈 곳 채우기가 빠질 수 있음 | **요청**: `run_id` |
| 서버 시각(`now`)이 없음 | 분당 그래프를 받은 시각 그대로 그림. 서버와 PC 시계가 5초 넘게 다르면 밀림 | **요청**: `now` |
| 분당 집계(`minutes`)가 없음 | 기록의 판정으로 셈 (최근 판정 개수만큼만) | **요청**: `minutes` |
| 명령을 웹소켓으로 받음 (`commands: 'ws'`) | `history` 명령의 `body`에 `after`·`events`·`inspections`·`minutes` | — |

## 16. 공정 단계 · 원점 필요 · 고장이 풀리는 방법 (v0.3)

| 서버가 이렇게 하면 | HMI 동작 | 할 일 |
|---|---|---|
| `cycle`이 없음 | 지금 화면은 `cycle`을 쓰지 않음 (공정 흐름을 보이던 대시보드는 2026-10-17에 없앰) | 그대로 — 또는 **요청**: `cycle` |
| 단계 이름이 다름 (`PICKING`·`judging`·`eject` 등) | 자동 (`adapter.js`의 `STAGE` 표) | 모르는 이름은 그대로 보임 — 자주 쓰면 표에 한 줄 더함 |
| 단계를 글자 하나로 보냄 (`"process": "sorting"`) | 자동 | — |
| `home_required`가 없음 | 원점 필요 안내를 하지 않음. 서버가 `409 HOME_REQUIRED`로 거절하면 그때 이유를 보임 | **요청**: `home_required` |
| 원점 필요를 다른 이름으로 (`needs_home` 등) | 자동 | — |
| `fault.clear`가 없음 | `auto`로 봄 ("원인을 없앤 뒤 시작하세요") | 원점·확인으로 풀리는 고장이면 **요청**: `clear` |
| `clear` 값이 다름 (`ack`·`confirm`·`homing`) | 자동 (`ack`·`confirm` → `start`, `homing` → `home`) | — |
| (v0.5) 원점 | 원점은 HMI가 저장한다 — 서버가 상태에 `home`을 보내도 쓰지 않음. 원점 잡기는 서버 명령이 없고, 원점 복귀는 본문에 각도(`angles`·`units`·`unit`)를 실어 보냄 | 원점 복귀 경로가 다르면 **설정** `server.paths: { home: 'POST /robot/origin' }` |
