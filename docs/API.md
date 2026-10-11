# HMI ↔ 서버 API 초안 (v0.1)

HMI가 서버에 기대하는 동작을 정리한 초안입니다. 서버 담당과 맞춰 가며 고칩니다.
HMI(웹)의 가짜 서버(`hmi-web-mockup/js/mock-server.js`)가 이 문서대로 동작하므로, 실제 서버를 만들 때 동작 견본으로 쓸 수 있습니다.

## 1. 기본 규칙

| 항목 | 값 |
|---|---|
| 명령 | HTTP REST, JSON. 기본 주소 `http://<서버>:8000/api` |
| 실시간 상태 | WebSocket `ws://<서버>:8000/ws` (서버 → HMI 단방향) |
| 인증 | 없음 (내부망 전제, 로그인 없음) |
| 시간 | ISO 8601 문자열 (예: `2026-10-06T14:32:05+09:00`) |
| 실패 응답 | HTTP 상태 코드 + `{ "error": { "code": "...", "details": { ... } } }` |

화면 문구는 HMI가 `code`를 보고 직접 만듭니다(다국어 대비). 서버는 문장 대신 **코드와 값**만 보내 주세요.

## 2. 상태 모델

`GET /api/status` 응답이자 WebSocket `status` 메시지의 내용입니다.

```json
{
  "line": "stopped",
  "estop": false,
  "mode": "auto",
  "devices": {
    "conveyor": "connected",
    "arm": "connected",
    "leader": "connected",
    "camera": "connected"
  },
  "stats": { "total": 128, "good": 120, "defect": 8 },
  "camera": { "streaming": false, "url": null }
}
```

| 필드 | 값 | 설명 |
|---|---|---|
| `line` | `stopped` `starting` `running` `stopping` `homing` | 라인 상태 |
| `estop` | `true` / `false` | 긴급정지 잠금. `true`인 동안 `line`은 항상 `stopped` |
| `mode` | `auto` / `manual` | 자동 = 카메라 판정으로 로봇팔이 선별, 수동 = 리더암으로 사람이 조작 |
| `devices.*` | `connected` / `disconnected` | 컨베이어(아두이노), 로봇팔, 리더암, 카메라 |
| `stats` | 정수 | 이번 실행에서 검사한 수 / 양품 / 불량 |

## 3. 명령 (HTTP)

| 요구사항 | 메서드 · 경로 | 요청 본문 | 성공 | 대표 실패 |
|---|---|---|---|---|
| F-01 시작 | `POST /api/line/start` | 없음 | `200` 상태 | `409 DEVICES_NOT_READY` `409 ESTOP_ACTIVE` `409 INVALID_STATE` |
| 정지 (일반) | `POST /api/line/stop` | 없음 | `200` 상태 | `409 INVALID_STATE` |
| F-02 긴급정지 | `POST /api/estop` | 없음 | `200` 상태 (항상 허용, 여러 번 보내도 같음) | — |
| F-02 해제 | `POST /api/estop/release` | 없음 | `200` 상태. 라인은 `stopped` 유지 | `409 ESTOP_NOT_ACTIVE` |
| F-03 종료 | `POST /api/system/shutdown` | 없음 | `202`. 정리가 끝나면 WS `shutdown_complete` | — |
| F-04 원점 잡기 | `POST /api/robot/home` | `{ "angles": { 관절: 각도 } }` | `202`. 끝나면 WS `home_complete` | `409 NOT_STOPPED` `409 ESTOP_ACTIVE` `422 INVALID_ANGLES` |
| F-05 카메라 켜기 | `POST /api/camera/start` | 없음 | `200 { "url": "/api/camera/stream" }` | `409 DEVICES_NOT_READY` |
| F-05 카메라 끄기 | `POST /api/camera/stop` | 없음 | `200` | — |
| F-05 영상 | `GET /api/camera/stream` | — | MJPEG (`multipart/x-mixed-replace`) **제안** | — |
| F-06 모드 전환 | `PUT /api/mode` | `{ "mode": "auto" }` | `200` 상태 | `409 NOT_STOPPED` `409 ESTOP_ACTIVE` |

### 3.1 시작 조건 (F-01)
서버는 시작 요청을 받으면 `line`을 `starting`으로 바꾸고 아래 장치 연결을 확인합니다.

- 자동 모드: 컨베이어, 로봇팔, 카메라
- 수동 모드: 컨베이어, 로봇팔, 리더암, 카메라

하나라도 끊겨 있으면 `stopped`로 되돌리고 다음처럼 응답합니다.

```json
{ "error": { "code": "DEVICES_NOT_READY", "details": { "missing": ["arm", "camera"] } } }
```

### 3.2 원점 각도 (F-04)
원점 각도는 HMI 설정 파일 `hmi-web-mockup/config/home-position.js`에 따로 두고, 요청할 때 함께 보냅니다.
서버는 관절 한계를 넘는 값이면 `422 INVALID_ANGLES`로 거절해 주세요.

```json
{ "angles": { "shoulder_pan": 0, "shoulder_lift": 0, "elbow_flex": 0,
              "wrist_flex": 0, "wrist_roll": 0, "gripper": 0 } }
```

관절 이름은 LeRobot SO-100/101 표기를 따릅니다.

| id | 화면 이름 |
|---|---|
| `shoulder_pan` | 어깨 회전 |
| `shoulder_lift` | 어깨 들기 |
| `elbow_flex` | 팔꿈치 |
| `wrist_flex` | 손목 굽힘 |
| `wrist_roll` | 손목 회전 |
| `gripper` | 그리퍼 |

## 4. 실시간 메시지 (WebSocket, 서버 → HMI)

모든 메시지는 `{ "type": "...", "data": { ... } }` 모양입니다.

| type | data | 보내는 때 |
|---|---|---|
| `status` | 2장의 상태 전체 | 연결 직후 1번 + 상태가 바뀔 때마다 |
| `inspection` | `{ "id": 128, "result": "good" \| "defect", "at": "...", "stats": { ... } }` | 부품 하나를 판정할 때 |
| `event` | `{ "code": "...", "level": "info" \| "warning" \| "alarm", "params": { ... }, "at": "..." }` | 이벤트 기록에 남길 일이 생길 때 |
| `joints` | `{ "source": "leader", "angles": { 관절: 각도 } }` | 수동 모드에서 최대 10Hz |
| `home_complete` | `{}` | 원점 이동이 끝났을 때 |
| `shutdown_complete` | `{}` | 종료 정리가 끝났을 때 |
| `heartbeat` | `{ "at": "..." }` | 2초마다. HMI는 6초 동안 아무 메시지가 없으면 연결 끊김으로 표시 |

### 4.1 event 코드

| code | level | params |
|---|---|---|
| `line_started` | info | — |
| `line_stopped` | info | — |
| `line_stopped_fault` | warning | `device` |
| `start_rejected` | warning | `devices` (배열) |
| `estop_pressed` | alarm | — |
| `estop_released` | info | — |
| `home_started` / `home_completed` | info | — |
| `mode_changed` | info | `mode` |
| `defect_detected` | warning | `id` |
| `device_disconnected` | warning | `device` |
| `device_reconnected` | info | `device` |
| `camera_started` / `camera_stopped` | info | — |
| `shutdown_started` | info | — |

## 5. 안전 메모

화면의 긴급정지는 네트워크와 서버를 거칩니다. 서버가 멈추면 화면 버튼은 효과가 없으므로,
컨베이어와 로봇팔 전원을 직접 끊는 **하드웨어 비상정지 버튼**을 따로 두는 것을 권장합니다.
HMI는 서버 연결이 끊기면 화면 긴급정지를 비활성화하고 하드웨어 버튼을 쓰라고 안내합니다.

## 6. 서버 담당과 정할 것

- [ ] 카메라 영상 방식 (MJPEG 제안 / WebSocket 프레임)
- [ ] 시간대 표기 (UTC 또는 +09:00)
- [ ] heartbeat 주기 (2초 제안)
- [ ] 원점 각도 실제 값과 관절별 허용 범위
- [ ] 장치가 가동 중에 끊기면 라인을 자동 정지할지 (초안: 정지)
