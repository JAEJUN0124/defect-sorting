# HMI ↔ 서버 API 초안 (v0.6)

> **통신 방식이 정해졌습니다 (D-002): 웹소켓 하나 + XML.** 서버 담당의 규약 v1.0은 [server-xml-v1.0.md](server-xml-v1.0.md),
> HMI가 그것을 어떻게 쓰고 v1.0 다음에 무엇을 요청하는지는 [xml-protocol.md](xml-protocol.md)에 있습니다.
> 이 문서(HTTP·JSON)는 HMI 안에서 쓰는 상태·고장·이벤트의 뜻과, 브라우저 안 가짜 서버(`useMock: true`)의 기준으로 남깁니다.

HMI가 서버에 기대하는 동작을 정리한 초안입니다. 서버 담당과 맞춰 가며 고칩니다.
HMI(웹)의 가짜 서버(`hmi-web-mockup/js/mock-server.js`)가 이 문서대로 동작하므로, 실제 서버를 만들 때 동작 견본으로 쓸 수 있습니다.

**이 문서는 "권하는 기준 형식"입니다.** 서버가 이름·단위·묶음 방식을 다르게 만들어도 HMI는 대부분 그대로 읽습니다
(`hmi-web-mockup/js/adapter.js`). 무엇이 다르게 와도 되는지, 다를 때 설정을 무엇으로 바꾸는지는 [서버 형식 대응표](server-cases.md)에 있습니다.
실제 서버가 생기면 [`tools/server-check.html`](../hmi-web-mockup/tools/server-check.html)로 형식을 먼저 확인하세요.

서버가 장치와 주고받는 약속은 따로 있습니다: [컨베이어 시리얼 규약](conveyor-protocol.md) · [로봇팔 제어 약속](arm-control.md) · [공정 순서](line-sequence.md).
이 문서는 그 결과 중 HMI가 보는 것(상태·고장·이벤트)만 다룹니다.

달라진 점은 [10장](#10-v01--v02-바뀐-점)(v0.1 → v0.2), [11장](#11-v02--v03-바뀐-점)(v0.2 → v0.3), [12장](#12-v03--v04-바뀐-점)(v0.3 → v0.4), [13장](#13-v04--v05-바뀐-점)(v0.4 → v0.5), [14장](#14-v05--v06-바뀐-점)(v0.5 → v0.6)에 모았습니다.
v0.2·v0.3은 더하기만 했습니다. v0.4는 원점(F-04)의 뜻이 바뀌었습니다: 수동 모드의 "원점 잡기"가 로봇팔의 지금 자세를 원점으로 저장하고, 자동 모드의 "원점 복귀"가 그 원점으로 옮깁니다.
**v0.5는 원점을 저장하는 곳이 바뀌었습니다**: 서버가 아니라 HMI(브라우저)가 저장하고, 원점 복귀 명령이 그 각도를 가져갑니다 (4.2장).
v0.6은 로봇팔이 상자에 옮길 부품(양품·불량품)을 HMI에서 고르는 명령 `PUT /api/sort-target`과 상태 `sort_target`을 더했습니다 (4.3장).

## 1. 기본 규칙

| 항목 | 값 |
|---|---|
| 명령 | HTTP REST, JSON. 기본 주소 `http://<서버>:8000/api` |
| 실시간 메시지 | WebSocket `ws://<서버>:8000/ws` (서버 → HMI). Socket.IO·SSE·폴링도 받습니다 ([대응표 3장](server-cases.md#3-실시간-방식)) |
| 인증 | 없음 (내부망 전제, 로그인 없음). 필요하면 머리글을 붙일 수 있음 (`config.js server.headers`) |
| 시각 | ISO 8601, **시간대 포함** 권장 (예: `2026-10-06T14:32:05+09:00`) |
| 실패 응답 | HTTP 상태 코드 + `{ "error": { "code": "...", "details": { ... } } }` |
| 다른 주소 허용(CORS) | HMI를 다른 주소(다른 포트·파일 더블클릭)에서 열면 서버가 CORS를 허용해야 합니다 ([대응표 2장](server-cases.md#2-주소와-연결)) |

화면 문구는 HMI가 `code`를 보고 직접 만듭니다(다국어 대비). 서버는 문장 대신 **코드와 값**만 보내 주세요.

## 2. 서버 정보 — `GET /api/info` (v0.2 새로 추가, 권장)

서버가 무엇을 가졌는지 한 번에 알려 줍니다. 없으면(404) HMI는 v0.1 서버로 보고 `config.js` 값을 씁니다.

```json
{
  "api": "0.6",
  "server": { "name": "defect-sorting-server", "version": "0.1.0" },
  "joint_unit": "deg",
  "cameras": [
    { "id": "top",   "transport": "mjpeg", "url": "/api/camera/top/stream",   "width": 1280, "height": 720, "fps": 30 },
    { "id": "close", "transport": "mjpeg", "url": "/api/camera/close/stream", "width": 1280, "height": 720, "fps": 30 }
  ],
  "arms": {
    "arm":    { "role": "follower", "calibration": { "shoulder_pan": { "min": 1012, "max": 3086 } } },
    "leader": { "role": "leader" }
  },
  "features": ["telemetry", "metrics", "inspection_bbox", "multi_camera", "history", "cycle", "home", "sort_target"]
}
```

| 필드 | 뜻 |
|---|---|
| `joint_unit` | 관절 값 단위. `deg`(도, 그리퍼만 0~100) · `norm`(-100~100, 그리퍼 0~100) · `rad` · `raw`(0~4095). LeRobot 기본(`use_degrees=True`)이면 `deg` |
| `cameras` | 카메라 목록. 첫 번째가 조작 화면에 띄우는 주 카메라. `transport`는 [7장](#7-카메라-영상-방식) |
| `arms.*.calibration` | (선택) 관절별 원시값 최소·최대. `joint_unit`이 `raw`일 때 HMI가 도로 바꾸는 데 씀 |
| `features` | (선택) 보내는 것들의 목록. 표시용 |

## 3. 상태 모델

`GET /api/status` 응답이자 실시간 `status` 메시지의 내용입니다. 실시간 `status`는 **바뀐 필드만** 보내도 됩니다(HMI가 합침).

```json
{
  "line": "running",
  "estop": false,
  "mode": "auto",
  "fault": null,
  "started_at": "2026-10-12T14:02:11+09:00",
  "home_required": false,
  "sort_target": "defect",
  "cycle": { "stage": "inspecting", "part": 128, "step": null },
  "devices": {
    "conveyor": "connected", "arm": "connected", "leader": "connected",
    "camera_top": "connected", "camera_close": "connected"
  },
  "stats": { "total": 128, "good": 120, "defect": 8 },
  "cameras": {
    "top":   { "streaming": true, "url": "/api/camera/top/stream",   "transport": "mjpeg" },
    "close": { "streaming": true, "url": "/api/camera/close/stream", "transport": "mjpeg" }
  }
}
```

| 필드 | 값 | 설명 |
|---|---|---|
| `line` | `stopped` `starting` `running` `stopping` `homing` | 라인 상태. 모르는 값이 오면 HMI는 "알 수 없음"으로 보이고 긴급정지·종료만 남깁니다 |
| `estop` | `true` / `false` | 긴급정지 잠금. `true`인 동안 `line`은 늘 `stopped` |
| `mode` | `auto` / `manual` | 자동 = 카메라 판정으로 로봇팔이 선별, 수동 = 리더암으로 사람이 조작 |
| `fault` | `null` 또는 `{ "code": "SERVO_OVERHEAT", "params": { "arm": "arm", "joint": "elbow_flex", "temp": 65.2 }, "clear": "auto" }` | (v0.2) 고장으로 멈췄을 때 이유. 정지 상태 설명과 시작 거절 문구에 쓰입니다. `clear`(v0.3)는 풀리는 방법 (3.1장) |
| `started_at` | 시각 또는 `null` | (v0.2) 이번 가동을 시작한 때 (가동 시간을 보이던 대시보드는 2026-10-17에 없앰) |
| `home_required` | `true` / `false` | (v0.3) 원점 복귀를 해야 **자동으로** 시작할 수 있음. 긴급정지·로봇팔 고장 뒤 `true`, 원점 복귀를 마치면 `false`. 그동안 자동 시작은 `409 HOME_REQUIRED` (v0.4: 수동 시작은 막지 않음). v0.4에 있던 저장된 원점 `home` 필드는 v0.5에서 뺐습니다 — 원점은 HMI가 저장합니다 (4.2장) |
| `sort_target` | `good` / `defect` | (v0.6) 로봇팔이 상자에 옮길 부품. 이 판정의 부품은 로봇팔이 옮기고, 다른 쪽은 컨베이어로 내보냅니다. 바꾸는 것은 `PUT /api/sort-target` (4.3장). 보내지 않으면 HMI는 이 브라우저에서 마지막으로 서버가 받은 값을 보입니다 |
| `cycle` | `null` 또는 `{ "stage", "part", "step" }` | (v0.3) 가동 중 부품 하나를 처리하는 단계. `stage`: `feeding`(옮기는 중) · `inspecting`(멈춰서 판정) · `sorting`(로봇팔이 `sort_target` 부품을 상자에 옮김 — v0.5까지는 늘 불량품) · `passing`(다른 쪽을 내보냄). `part`는 그 부품의 판정 번호, `step`은 로봇팔 작업의 지금 단계 이름(선택). [공정 순서](line-sequence.md) |
| `devices.*` | `connected` / `disconnected` | 컨베이어(아두이노), 로봇팔(팔로워), 리더암, 카메라마다 `camera_<id>` |
| `stats` | 정수 | 이번 실행에서 검사한 수 / 양품 / 불량 |
| `cameras.<id>` | `{ streaming, url, transport }` | (v0.2) 카메라마다. v0.1의 `camera: { streaming, url }`(한 대)도 그대로 받습니다 |

### 3.1 고장 코드 (`fault.code`, 시작 거절의 `FAULT_ACTIVE`)

| code | 뜻 | params | `clear` |
|---|---|---|---|
| `SERVO_OVERHEAT` | 서보 과열로 멈춤 | `arm`, `joint`, `temp` | `auto` |
| `POWER_ABNORMAL` | 전원 전압 이상 (어댑터를 잘못 꽂음 등) | `arm`, `volt` | `auto` |
| `CALIBRATION_REQUIRED` | 로봇팔 캘리브레이션 값이 없음 | `arm` | `auto` |
| `GRIP_FAILED` | (v0.3) 다시 해도 불량품을 집지 못함 | `step`, `part` | `home` |
| `ARM_MOTION_TIMEOUT` | (v0.3) 로봇팔이 자세에 제때 닿지 못함 (걸림·과부하) | `step`, `part` | `home` |
| `CONVEYOR_HALTED` | (v0.3) 컨베이어가 스스로 멈춤 | `reason`: `watchdog`(서버 신호 끊김) · `button`(정지 단추) · `fault`(이상, `code`) · `reset`(아두이노 리셋) | `start` |
| `PART_STUCK` | (v0.3) 부품이 검사 자리를 지나가지 않음 (걸림) | `part` | `start` |
| `INSPECTION_TIMEOUT` | (v0.3) 판정이 제한 시간 안에 오지 않음 | `part`, `ms` | `start` |
| 그 밖 | HMI는 "고장(코드)으로 멈췄습니다"로 보이고, `message`가 있으면 그 문장을 씁니다 | — | `auto` |

`clear`(v0.3) — 고장이 풀리는 방법입니다. 없으면 `auto`로 봅니다.

| clear | 풀리는 때 | 그동안 시작 | 화면 안내 |
|---|---|---|---|
| `auto` | 원인이 사라지면 서버가 지움 (서보가 식으면 등) | `409 FAULT_ACTIVE` | "원인을 없앤 뒤 시작하세요" |
| `home` | 원점 복귀를 마치면 서버가 지움 (v0.5: 원점 잡기는 서버에 알리지 않으므로 풀리지 않음) | 자동 시작은 `409 HOME_REQUIRED` | "원점 복귀를 한 뒤 시작하세요" |
| `start` | 사람이 확인하고 시작을 누르면 서버가 지우고 시작 (시작이 곧 확인) | 받음 | "확인한 뒤 시작하세요" |

## 4. 명령 (HTTP)

| 요구사항 | 메서드 · 경로 | 요청 본문 | 성공 | 대표 실패 |
|---|---|---|---|---|
| F-01 시작 | `POST /api/line/start` | 없음 (설정하면 `config.js server.startBody`를 보냄) | `200` 상태 | `409 DEVICES_NOT_READY` `409 ESTOP_ACTIVE` `409 INVALID_STATE` `409 FAULT_ACTIVE` `409 POWER_ABNORMAL` `409 HOME_REQUIRED` |
| 정지 (일반) | `POST /api/line/stop` | 없음 | `200` 상태 | `409 INVALID_STATE` |
| F-02 긴급정지 | `POST /api/estop` | 없음 | `200` 상태 (항상 허용, 여러 번 보내도 같음) | — |
| F-02 해제 | `POST /api/estop/release` | 없음 | `200` 상태. 라인은 `stopped` 유지 | `409 ESTOP_NOT_ACTIVE` |
| F-03 종료 | — (2026-10-16부터 서버 명령 없음) | — | HMI 화면만 닫음. 라인과 장비는 그대로 (사용자 2026-10-16). 예전 초안의 `POST /api/system/shutdown`은 HMI가 보내지 않음 | — |
| F-04 원점 복귀 | `POST /api/robot/home` | `{ "angles": { 관절: 값 }, "units": { 관절: "deg" \| "pct" }, "unit": "deg" }` (v0.5: HMI가 저장한 원점) | `202`. 끝나면 실시간 `home_complete` | `409 NOT_AUTO` `409 NOT_STOPPED` `409 ESTOP_ACTIVE` `409 HOME_NOT_SET`(각도 없음) `422 INVALID_ANGLES` `409 DEVICES_NOT_READY` |
| F-04 원점 잡기 | — (v0.5: 서버 명령 없음) | — | HMI가 로봇팔의 지금 자세를 브라우저에 저장 | HMI가 막음: 긴급정지 중 · 자동 모드 · 각도를 받지 못함 |
| F-05 카메라 켜기 | `POST /api/camera/start` | 없음(모든 카메라) 또는 `{ "camera": "top" }` | `200 { "url": "...", "cameras": { ... } }` | `409 DEVICES_NOT_READY` `404 CAMERA_NOT_FOUND` |
| F-05 카메라 끄기 | `POST /api/camera/stop` | 없음 또는 `{ "camera": "top" }` | `200` | — |
| F-05 영상 | `GET /api/camera/<id>/stream` | — | [7장](#7-카메라-영상-방식)의 방식 중 하나 (MJPEG 권장) | — |
| F-06 모드 전환 | `PUT /api/mode` | `{ "mode": "auto" }` | `200` 상태 | `409 NOT_STOPPED` `409 ESTOP_ACTIVE` `422 INVALID_MODE` |
| 로봇팔이 옮길 부품 (추가 2026-10-17) | `PUT /api/sort-target` | `{ "target": "good" }` (`good` · `defect`) | `200` 상태 (v0.6) | `409 NOT_STOPPED` `409 ESTOP_ACTIVE` `422 INVALID_SORT_TARGET` |
| 상태 | `GET /api/status` | — | `200` 상태 | — |
| 서버 정보 | `GET /api/info` | — | `200` 서버 정보 (없으면 404) | — |
| 기록 | `GET /api/history?after=…&events=…&inspections=…&minutes=…` | — | `200` 기록 (없으면 404) — [5.2장](#52-순번seq과-기록-조회--get-apihistory-v03-권장) | — |

경로·방식이 다르면 `config.js server.paths`로 바꿉니다 (예: `{ start: 'POST /run' }`). 운전 모드 값이 대문자이면 `server.modeValues`로 맞춥니다.

### 4.1 시작 조건 (F-01)
서버는 시작 요청을 받으면 먼저 아래 순서로 거절할 것이 있는지 봅니다 (v0.3).

1. 긴급정지 중 → `409 ESTOP_ACTIVE`
2. 정지 상태가 아님 → `409 INVALID_STATE`
3. `clear`가 `auto`인 고장 → `409 FAULT_ACTIVE`, `details`는 `{ "fault": "SERVO_OVERHEAT", "params": { ... } }` (`clear: start` 고장은 여기서 지우고 계속)
4. 자동 모드에서만: 원점 복귀가 필요함(`home_required`) → `409 HOME_REQUIRED`.
   수동 모드는 보지 않습니다 — 사람이 리더암으로 팔을 움직이므로 원점이 필요 없습니다. 수동 모드로 시작하면 `clear: home` 고장도 지웁니다(사람이 팔을 넘겨받음). `home_required`는 남아 자동 시작을 계속 막습니다.
   저장된 원점이 있는지는 v0.5부터 HMI가 봅니다 (원점은 HMI가 가짐 — 없으면 HMI가 시작을 보내지 않음)

그다음 `line`을 `starting`으로 바꾸고 아래 장치 연결을 확인합니다.

- 자동 모드: 컨베이어, 로봇팔, 주 카메라
- 수동 모드: 컨베이어, 로봇팔, 리더암, 주 카메라

하나라도 끊겨 있으면 `stopped`로 되돌리고 다음처럼 응답합니다.

```json
{ "error": { "code": "DEVICES_NOT_READY", "details": { "missing": ["arm", "camera_top"] } } }
```

장치가 모두 있으면 컨베이어를 풀고(`RESET`) 가동하며 `cycle.stage`를 `feeding`으로 둡니다 ([공정 순서 6장](line-sequence.md#6-hmi-명령을-받았을-때)).

### 4.2 원점 — 원점 잡기와 원점 복귀 (F-04, v0.5)
원점은 **HMI가 저장**합니다 (사용자 2026-10-14 — 브라우저 저장소 `hmi.home`, `hmi-web-mockup/js/home.js`). 서버는 원점을 저장하지 않고, 원점 복귀 명령이 가져온 각도로 옮깁니다.
XML 규약에서의 모양은 [xml-protocol.md 3장](xml-protocol.md#3-원점--hmi가-저장-사용자-2026-10-14)입니다.

| 기능 | 모드 · 상태 | 하는 일 |
|---|---|---|
| 원점 잡기 (서버 명령 없음) | **수동 모드**. 정지·가동 중(리더암을 따라가는 중) 모두. 긴급정지 중(힘이 빠짐)에는 HMI가 막음 | 사람이 리더암으로 로봇팔(팔로워)을 원하는 자세에 둔 뒤 누릅니다. HMI가 **지금 6축 각도**(로봇팔 각도, 없으면 리더암 각도 — 3초 안에 받은 것)를 원점으로 저장하고 로그에 `home_set`을 남깁니다. 서버에는 알리지 않습니다 |
| 원점 복귀 `POST /api/robot/home` + 각도 | **자동 모드**·정지 상태. 저장된 원점이 없으면 HMI가 막음 | 서버가 받은 각도로 천천히 옮깁니다 (`line: homing` → `stopped`, `home_complete`). 각도가 없으면 `409 HOME_NOT_SET`, 숫자가 아닌 관절이 있으면 `422 INVALID_ANGLES`. 긴급정지·로봇팔 고장 뒤 자동으로 다시 시작하려면 먼저 해야 합니다 (`home_required`) |

- 수동 모드에서 원점 복귀는 `409 NOT_AUTO` 입니다. HMI도 그 모드에서는 키를 잠급니다 (원점 잡기는 자동 모드에서 HMI가 잠금).
- 원점 잡기는 저장된 원점을 덮어쓰므로 HMI가 누르기 전에 확인 창을 띄웁니다 ("지금 자세를 원점으로 저장할까요?").
- 각도 단위: 관절은 도, 그리퍼는 `units`에 적은 대로 (`pct`: LeRobot의 0~100, `deg`: 도 — XML v1.0 서버는 그리퍼도 도로 보냄).
- 원점은 브라우저(PC)마다 따로 저장됩니다. 다른 PC에서 HMI를 열면 원점이 없고, 사이트 데이터를 지우면 사라집니다.

원점 복귀 요청 본문

```json
{ "angles": { "shoulder_pan": 16.8, "shoulder_lift": -73.9, "elbow_flex": 21.3,
              "wrist_flex": 70.6, "wrist_roll": -58.1, "gripper": 50.7 },
  "units": { "shoulder_pan": "deg", "shoulder_lift": "deg", "elbow_flex": "deg",
             "wrist_flex": "deg", "wrist_roll": "deg", "gripper": "pct" },
  "unit": "deg" }
```

관절 이름은 LeRobot SO-100/101 표기를 따르고, 모터 번호(ID)도 이 순서입니다.

| ID | id | 화면 이름 |
|---|---|---|
| 1 | `shoulder_pan` | 어깨 회전 |
| 2 | `shoulder_lift` | 어깨 들기 |
| 3 | `elbow_flex` | 팔꿈치 |
| 4 | `wrist_flex` | 손목 굽힘 |
| 5 | `wrist_roll` | 손목 회전 |
| 6 | `gripper` | 그리퍼 |

### 4.3 로봇팔이 옮길 부품 (v0.6)
HMI에서 로봇팔이 상자에 옮길 부품을 **양품·불량품 중에서 고릅니다** (사용자 2026-10-17). 고른 쪽으로 판정된 부품을 로봇팔이 옮기고(`cycle.stage: sorting`, 작업 `sort_part`), 다른 쪽은 컨베이어로 내보냅니다(`passing`).
XML 규약에서의 모양(요청안)은 [xml-protocol.md 4.2](xml-protocol.md#42-명령에-더할-것-우선순위-2)의 `SetSortTarget`입니다.

| 항목 | 내용 |
|---|---|
| 바꾸는 때 | **정지 상태에서만** — 운전 모드와 같은 규칙 (사용자 2026-10-17). 가동 중이면 `409 NOT_STOPPED`, 긴급정지 중이면 `409 ESTOP_ACTIVE`. HMI도 가동 중에는 키를 잠금 |
| 값 | `good`(양품) · `defect`(불량품). 그 밖이면 `422 INVALID_SORT_TARGET` |
| 받으면 | 상태 `sort_target`을 바꾸고 이벤트 `sort_target_changed` (`target`). 같은 값이면 그대로 `200` (이벤트 없음) |
| 처음 값 | 가짜 서버는 `defect` (v0.5까지처럼 불량품을 옮김). 실제 서버는 서버 담당과 정함 (HMI 제안: 마지막 값, 없으면 `defect`) |
| 화면 | 조작반의 "로봇팔이 옮길 부품" 키 둘. 서버가 알려 준 값이 눌린 모양. 서버가 값을 보내지 않으면 이 브라우저에서 마지막으로 서버가 받은 값(`hmi.sortTarget`)을 보이고 그렇다고 씀. 자동 가동 중 상태 설명은 "카메라 판정에 따라 로봇팔이 양품을 골라냅니다"처럼 고른 쪽으로 |

## 5. 실시간 메시지 (서버 → HMI)

모든 메시지는 `{ "type": "...", "data": { ... } }` 모양입니다.

| type | data | 보내는 때 |
|---|---|---|
| `status` | 3장의 상태 (전체 또는 바뀐 필드만) | 연결 직후 1번 + 상태가 바뀔 때마다 |
| `inspection` | `{ "seq", "id", "result": "good" \| "defect", "at", "camera", "confidence", "latency_ms", "bbox", "image", "stats" }` | 부품 하나를 판정할 때 |
| `event` | `{ "seq", "code", "level": "info" \| "warning" \| "alarm", "params": { ... }, "at" }` | 기록에 남길 일이 생길 때 |
| `joints` | `{ "source": "leader" \| "arm" \| "target", "unit": "deg", "angles": { 관절: 값 } }` | 리더암은 수동 모드에서 최대 10Hz, 로봇팔은 움직일 때 |
| `telemetry` | `{ "arm": "arm" \| "leader", "unit": "deg", "motors": { 관절: { "pos", "temp", "volt", "load", "current", "status", "torque", "moving" } } }` | (v0.2) 1~2Hz |
| `metrics` | `{ "inference_ms", "fps": { 카메라: 값 }, "cpu", "queue" }` | (v0.2) 2초마다 |
| `frame` | `{ "camera", "mime": "image/jpeg", "data": "<base64>" }` | 영상을 주 연결로 보낼 때만 ([7장](#7-카메라-영상-방식)) |
| `home_complete` | `{}` | 원점 복귀가 끝났을 때 |
| `shutdown_complete` | `{}` | 쓰지 않음 — 프로그램 종료는 2026-10-16부터 HMI만 닫음 |
| `heartbeat` | `{ "at" }` | 2초마다. HMI는 heartbeat를 한 번이라도 받은 뒤부터 6초 동안 아무 메시지가 없으면 연결 끊김으로 표시 |

`inspection`의 선택 필드
- `seq`: (v0.3) 순번. `event`와 한 줄로 이어 매깁니다 ([5.2장](#52-순번seq과-기록-조회--get-apihistory-v03-권장)).
- `confidence`: 0~1. `latency_ms`: 판정에 걸린 시간(ms). `camera`: 판정한 카메라 id.
- `bbox`: `[x, y, w, h]` **영상 크기에 대한 비율(0~1), 왼쪽 위 기준.** 다른 형식(두 모서리·YOLO 가운데 기준·픽셀)도 받습니다(대응표 8장).
- `image`: 불량 사진 주소 또는 base64.
- `stats`: 없으면 HMI가 판정을 세다가, 다음 `status`의 `stats`로 바로잡습니다.

`telemetry`의 단위: `pos`는 `unit`(관절) · `temp` °C · `volt` V · `load` %(부호는 방향) · `current` mA · `status` Feetech 상태 비트(0 전압 · 1 센서 · 2 온도 · 3 전류 · 5 과부하) · `torque` 힘을 주는 중인지.

### 5.1 event 코드

| code | level | params |
|---|---|---|
| `line_started` | info | — |
| `line_stopped` | info | — |
| `line_stopped_fault` | warning | `device` |
| `line_halted` | warning | `reason` (고장 코드, v0.3의 `GRIP_FAILED`·`CONVEYOR_HALTED` 등 포함) — v0.2 |
| `start_rejected` | warning | `devices` (배열) |
| `estop_pressed` | alarm | — |
| `estop_released` | info | — |
| `home_started` / `home_completed` | info | — (원점 복귀) |
| `home_set` | info | — 원점 잡기로 지금 자세를 원점으로 저장함 (v0.5: 서버가 아니라 HMI가 로그에 남김) |
| `mode_changed` | info | `mode` |
| `sort_target_changed` | info | `target` (`good` · `defect`) — v0.6. 로봇팔이 옮길 부품을 바꿈 |
| `defect_detected` | warning | `id` |
| `device_disconnected` | warning | `device` |
| `device_reconnected` | info | `device` |
| `camera_started` / `camera_stopped` | info | `camera` (선택) |
| `shutdown_started` | info | — (쓰지 않음 — 프로그램 종료는 2026-10-16부터 HMI만 닫음) |
| `servo_overheat` | warning · alarm | `arm`, `joint`, `temp`, `limit` — v0.2 |
| `servo_voltage` | warning · alarm | `arm`, `volt`, `nominal` — v0.2 |
| `servo_error` | alarm | `arm`, `joint`, `faults` — v0.2 |
| `servo_recovered` | info | `arm`, `joint`(선택) — v0.2 |
| `inference_slow` | warning | `ms` — v0.2 |
| `calibration_missing` | warning | `arm` — v0.2 |
| `sort_retry` | warning | `part`, `step` — v0.3. 로봇팔이 집기를 다시 시도함 |
| `conveyor_halted` | warning | `reason` — v0.3. 라인이 서 있을 때 컨베이어가 스스로 잠김 (가동 중이면 `line_halted`) |

모르는 코드가 오면 HMI는 `message`(있으면) 또는 "서버 이벤트: 코드"로 기록합니다. 서보 경고를 서버가 보내지 않으면 HMI가 `telemetry` 값으로 직접 판단해 기록합니다(`config/robot.js localAlarms`).

### 5.2 순번(`seq`)과 기록 조회 — `GET /api/history` (v0.3, 권장)

HMI는 화면을 열 때와 서버에 다시 붙을 때 지난 기록을 물어서 채웁니다. 이 기능이 없으면(404) 지금처럼 화면을 연 뒤에 받은 것만 보입니다.

- 서버는 `inspection`·`event` 메시지에 **순번 `seq`** 를 붙입니다. 서버를 켤 때부터 1, 2, 3 … 하나씩 늘어나는 정수이고, 두 종류에 한 줄로 이어 매깁니다.
- 서버를 다시 켜면 순번이 처음부터라서, 켤 때마다 바뀌는 `run_id`를 기록 응답에 넣습니다.
- 경로가 `/api/events`가 아닌 것은 그 주소가 SSE 실시간 주소의 기본값(`config.js server.sseUrl`)이기 때문입니다.

`GET /api/history?after=1500&events=200&inspections=60&minutes=120`

| 값 | 뜻 |
|---|---|
| `after` | 이 순번 **뒤**의 기록만 (다시 붙을 때 빈 곳 채우기). 없으면 최근 것 |
| `events` | 이벤트 최대 개수 (최근 것부터 셈) |
| `inspections` | 판정 최대 개수 (최근 것부터 셈) |
| `minutes` | 최근 몇 분의 분당 집계. 0이면 보내지 않음 |

```json
{
  "run_id": "20261012-090001",
  "now": "2026-10-12T14:32:05+09:00",
  "last_seq": 1532,
  "events": [
    { "seq": 1517, "code": "servo_overheat", "level": "warning",
      "params": { "arm": "arm", "joint": "elbow_flex", "temp": 55.4, "limit": 55 }, "at": "2026-10-12T14:31:40+09:00" }
  ],
  "inspections": [
    { "seq": 1532, "id": 812, "result": "good", "at": "2026-10-12T14:32:04+09:00", "camera": "top", "confidence": 0.97, "latency_ms": 21 }
  ],
  "minutes": [
    { "t": "2026-10-12T14:31:00+09:00", "good": 18, "defect": 2 },
    { "t": "2026-10-12T14:32:00+09:00", "good": 3, "defect": 0 }
  ]
}
```

| 필드 | 뜻 |
|---|---|
| `run_id` | 서버를 켤 때마다 바뀌는 글자. 바뀌면 HMI는 순번을 처음부터 셈 |
| `now` | 응답을 만든 서버 시각. HMI는 이것으로 서버와 PC의 시계 차이를 빼고 분당 그래프를 그림 |
| `last_seq` | 응답을 만들 때까지 매긴 마지막 순번. 분당 집계는 이 순번까지의 판정을 셈 |
| `events` · `inspections` | 실시간 메시지의 `data`와 같은 모양 + `seq`. **오래된 것부터** |
| `minutes` | 분마다 양품·불량 수. `t`는 그 분의 시작 시각. 판정이 없던 분은 빼도 됨 |

HMI가 하는 일
- 처음 열 때: `after` 없이 묻고, 받은 기록으로 로그·최근 판정·분당 그래프를 채웁니다. 이때는 로그 알림 점을 켜지 않습니다 (예전 기록).
- 다시 붙을 때: `after=<마지막으로 받은 순번>`으로 묻고 빈 곳만 채웁니다. 그사이 생긴 경고·비상은 알림 점을 켭니다.
- 같은 순번은 한 번만 씁니다 (기록 응답과 실시간 메시지가 겹쳐도).
- 실시간 연결이 없는 서버(`server.push: 'poll'`)면 2초마다 기록을 물어 판정·이벤트도 받습니다.

## 6. HMI → 서버 (서버가 받는 것)

| 무엇 | 언제 | 모양 |
|---|---|---|
| 4장의 명령 | 버튼을 누를 때 | HTTP (기본) |
| 명령을 실시간 연결로 | `config.js server.commands = 'ws'`일 때 | WebSocket: `{ "type": "command", "data": { "id": "7", "name": "start", "body": null } }` → 서버가 `{ "type": "command_result", "data": { "id": "7", "status": 200, "body": { ... } } }`로 답함. Socket.IO: 이벤트 이름 = 명령 이름, 응답(ack)으로 결과 |
| HMI 살아 있음 | `config.js server.clientPingMs > 0`일 때 | `{ "type": "ping", "data": { "at": "..." } }` — 서버가 HMI가 끊겼을 때 라인을 세우려면 이것을 보고 판단 |
| 카메라 영상 | 카메라가 HMI PC에 꽂혀 있고 `cameras.local.upload`를 정했을 때 | 웹소켓 바이너리, 장면마다 JPEG 한 장 |

명령 이름: `info` `status` `history` `start` `stop` `estop` `release` `home`(원점 복귀) `mode` `sortTarget`(v0.6) `cameraStart` `cameraStop` (`config.js server.commandNames`로 바꿀 수 있음). 원점 잡기는 v0.5부터, 프로그램 종료는 2026-10-16부터 HMI 안에서 끝나 서버 명령이 없습니다.
명령을 실시간 연결로 보낼 때 `history`의 값(`after` 등)은 `body`에 담습니다.

## 7. 카메라 영상 방식

카메라마다 `transport`로 알려 주세요(서버 정보 또는 상태의 `cameras`). 없으면 주소 모양으로 짐작하고, 그래도 모르면 MJPEG로 엽니다.

| transport | 서버가 하는 일 | 지연 | 메모 |
|---|---|---|---|
| `mjpeg` (권장) | `multipart/x-mixed-replace`로 JPEG를 이어 보냄 | 낮음 | 가장 단순. OpenCV + FastAPI `StreamingResponse`로 만들 수 있음 |
| `snapshot` | 요청마다 JPEG 한 장 | 보통 | HMI가 초당 `cameras.snapshotFps`장 받음 |
| `ws` | 웹소켓으로 장면마다 JPEG(바이너리) | 낮음 | 주소가 없으면 주 연결의 `frame` 메시지(base64)를 씀 |
| `webrtc` | WHEP(SDP를 POST로 주고받음) | 가장 낮음 | MediaMTX·go2rtc 등. 다른 주소면 `Access-Control-Expose-Headers: Location` 필요 |
| `video` | MP4·WebM 스트림, HLS | 높음 | HLS는 브라우저가 직접 재생할 때만. 판정 화면에는 권하지 않음 |
| `local` | 서버는 영상을 주지 않음 | — | 카메라가 HMI PC에 꽂혔을 때 HMI가 직접 엶. 서버가 영상을 받아야 하면 HMI가 올려 보냄([6장](#6-hmi--서버-서버가-받는-것)) |

서버가 판정 상자를 영상에 직접 그려 보내면 `config.js cameras.overlay`를 `false`로 두세요(두 번 그려지지 않게).

실제 서버(XML)의 영상은 서버 담당 안내(2026-10-17, [hmi-video-integration.md](hmi-video-integration.md))대로 정해졌습니다: 같은 서버가 HTTP로 `/video/1.mjpg`(탑뷰)·`/video/2.mjpg`(그리퍼) MJPEG와 상태 JSON `/video/status`를 내주고, 카메라 명령은 없습니다. HMI 쪽 처리는 [xml-protocol.md 8장](xml-protocol.md#8-카메라-영상--서버의-http-주소에서-따로-받음-서버-안내-2026-10-17)입니다 (`config.js cameras.bridge`).

## 8. 안전 메모

화면의 긴급정지는 네트워크와 서버를 거칩니다. 서버가 멈추면 화면 버튼은 효과가 없습니다.
키트 설명서의 비상 정지 방법은 **DC 전원 케이블을 뽑는 것**이라, HMI는 서버 연결이 끊기면 화면 긴급정지를 비활성화하고
"로봇팔과 컨베이어의 DC 전원 케이블을 뽑으세요"라고 안내합니다(`config/robot.js hardwareStop`).
로봇팔·컨베이어의 DC 전원을 함께 끊는 **하드웨어 비상정지 버튼**을 따로 다는 것을 권장합니다. 달면 `hardwareStop`을 `'button'`으로 바꿉니다.

서버가 멈췄을 때를 대비한 장치 쪽 약속 (v0.3)
- 컨베이어: 아두이노가 서버의 신호(`PING`)를 1초 동안 못 받으면 스스로 멈추고 잠급니다 ([컨베이어 규약 6장](conveyor-protocol.md#6-감시-타이머--서버가-멈추면-벨트도-멈춘다)).
- 로봇팔: 서보가 마지막 목표 자세를 버팁니다. 화면 긴급정지는 로봇팔의 힘을 빼고(팔이 아래로 처짐), 해제한 뒤 자동으로 다시 시작하려면 원점 복귀를 해야 합니다 ([로봇팔 제어 6장](arm-control.md#6-멈출-때)). 긴급정지 중에는 HMI가 원점 잡기를 막습니다(처진 자세가 원점으로 저장되지 않게).

## 9. 서버 담당과 정할 것

- [ ] 실시간 방식 (WebSocket 권장 / Socket.IO / SSE)과 명령 방식 (HTTP 권장)
- [x] 카메라 id·이름과 영상 방식 (MJPEG 권장), 주 카메라 → 서버 안내(2026-10-17): MJPEG, 1 = 탑뷰(`top`) · 2 = 그리퍼(`close`), 화면 하나에 바꿔 봄 ([xml-protocol.md 8장](xml-protocol.md#8-카메라-영상--서버의-http-주소에서-따로-받음-서버-안내-2026-10-17))
- [ ] (v0.6) 로봇팔이 옮길 부품: 명령·상태 모양(XML `SetSortTarget`·`Line/@sortTarget`), 정지 상태에서만 바꾸는 규칙, 서버를 다시 켰을 때의 처음 값
- [ ] 관절 값 단위 (LeRobot 기본 `deg` 권장) — 원점 각도 단위와 같아야 함
- [ ] 서버 정보 `GET /api/info` 제공 여부 (권장)
- [ ] 시각에 시간대 넣기 (`+09:00` 또는 `Z`)
- [ ] heartbeat 주기 (2초 제안)
- [ ] (v0.5) 원점은 HMI가 저장하고 원점 복귀가 각도를 가져가는 방식이 맞는지, 원점 복귀 규칙(자동 모드·정지 상태)이 맞는지 ([xml-protocol.md 5장](xml-protocol.md#5-서버-담당과-정할-것))
- [ ] (v0.4) 자동 작업이 원점을 어떻게 쓸지(예: 작업을 원점에서 시작·끝낼지 — 그렇다면 시작 명령에도 원점 각도를 실어야 함), 수동으로 팔을 움직인 뒤 자동으로 바꾸면 원점 복귀를 꼭 거치게 할지 (초안: 긴급정지·로봇팔 고장 뒤에만)
- [ ] 장치가 가동 중에 끊기면 라인을 자동 정지할지 (초안: 정지), 서보 과열·전압 이상 때 정지할지 (초안: 과열 65°C에서 정지)
- [ ] 서보 상태(`telemetry`)와 판정 성능(`metrics`)을 보낼지 (서보 경고 기록에 씀. 값을 보이던 대시보드는 2026-10-17에 없앰)
- [ ] HMI를 서버가 직접 내줄지(같은 주소, CORS 불필요) 아니면 CORS를 열지
- [ ] (v0.3) 기록 조회 `GET /api/history`와 순번 `seq`를 제공할지 (권장 — 새로고침·다시 연결 때 기록이 비지 않음), 기록을 얼마나 남길지
- [ ] (v0.3) 공정 단계 `cycle`을 보낼지, 고장이 풀리는 방법 `clear` 세 가지와 원점 필요(`home_required`) 규칙이 맞는지
- [ ] (v0.3) 장치 쪽 약속: [컨베이어 규약 10장](conveyor-protocol.md#10-정할-것) · [로봇팔 제어 9장](arm-control.md#9-정할-것) · [공정 순서 8장](line-sequence.md#8-정할-것)

## 10. v0.1 → v0.2 바뀐 점

모두 **더한 것**이라 v0.1대로 만든 서버도 동작합니다.

| 바뀐 점 | v0.1 | v0.2 |
|---|---|---|
| 서버 정보 | 없음 | `GET /api/info` (카메라 목록·관절 단위) |
| 카메라 | `camera: { streaming, url }` 한 대 | `cameras: { <id>: { streaming, url, transport } }` 여러 대, 장치 `camera_<id>` |
| 상태 | — | `fault`, `started_at`, 바뀐 필드만 보내도 됨 |
| 판정 | `id, result, at, stats` | + `camera, confidence, latency_ms, bbox, image`, `stats` 생략 가능 |
| 실시간 메시지 | — | + `telemetry`(서보 상태), `metrics`(판정 성능), `frame`(주 연결 영상), `joints.source`에 `arm`·`target`, `unit` |
| 이벤트 | — | + `line_halted`, `servo_*`, `inference_slow`, `calibration_missing` |
| 명령 | — | 원점에 `unit`, 카메라에 `camera`, 시작 거절에 `FAULT_ACTIVE`·`POWER_ABNORMAL` |
| heartbeat | 6초 동안 없으면 끊김 | heartbeat를 받은 뒤부터만 잼 (heartbeat를 안 보내는 서버를 끊김으로 잘못 보지 않게) |

## 11. v0.2 → v0.3 바뀐 점

모두 **더한 것**이라 v0.2대로 만든 서버도 동작합니다. 새 필드가 없으면 HMI는 v0.2 때처럼 보입니다.

| 바뀐 점 | v0.2 | v0.3 |
|---|---|---|
| 기록 | 화면을 연 뒤 받은 것만 | `GET /api/history` (지난 이벤트·판정·분당 집계), 메시지 순번 `seq` |
| 상태 | — | `cycle` (공정 단계), `home_required` (원점 필요) |
| 고장 | 원인이 사라지면 풀림 | `fault.clear` (`auto` · `home` · `start`), 고장 코드 `GRIP_FAILED` · `ARM_MOTION_TIMEOUT` · `CONVEYOR_HALTED` · `PART_STUCK` · `INSPECTION_TIMEOUT` |
| 명령 | — | 시작 거절에 `HOME_REQUIRED`, 명령 이름 `history` |
| 이벤트 | — | `sort_retry`, `conveyor_halted` |
| 서버 정보 | — | `api: "0.3"`, `features`에 `history` · `cycle` |
| 장치 쪽 | — | [컨베이어 시리얼 규약](conveyor-protocol.md), [로봇팔 제어 약속](arm-control.md), [공정 순서](line-sequence.md) 새 문서 |

## 12. v0.3 → v0.4 바뀐 점

**원점(F-04)의 뜻이 바뀌었습니다.** v0.3에서는 HMI 설정 파일의 각도로 옮기는 기능 하나였고, v0.4에서는 원점을 서버가 저장하고 기능이 둘로 나뉩니다 (4.2장).

| 바뀐 점 | v0.3 | v0.4 |
|---|---|---|
| 원점 값 | HMI 설정 파일 `config/home-position.js` | 서버가 저장. 상태 `home: { angles, unit, set_at }` 또는 `null` |
| 원점 잡기 | `POST /api/robot/home` + 각도 = 그 각도로 이동 | `POST /api/robot/home/set` (본문 없음) = 로봇팔의 지금 자세를 원점으로 저장. 수동 모드에서만, 가동 중에도 |
| 원점 복귀 | (원점 잡기와 같은 명령) | `POST /api/robot/home` (본문 없음) = 저장된 원점으로 이동. 자동 모드·정지 상태에서만 |
| 원점 필요 | 모든 시작을 막음 | 자동 시작만 막음 (`HOME_REQUIRED`). 원점 잡기를 해도 풀림 |
| 오류 코드 | `422 INVALID_ANGLES` | 없앰. `409 NOT_AUTO` · `409 NOT_MANUAL` · `409 HOME_NOT_SET` 더함 |
| 이벤트 | — | `home_set` |
| 명령 이름 | — | `setHome` |
| 서버 정보 | `api: "0.3"` | `api: "0.4"`, `features`에 `home` |

## 13. v0.4 → v0.5 바뀐 점

**원점을 저장하는 곳이 바뀌었습니다** (사용자 2026-10-14). 통신 방식(웹소켓 + XML)은 [xml-protocol.md](xml-protocol.md)로 옮겼습니다.

| 바뀐 점 | v0.4 | v0.5 |
|---|---|---|
| 원점 값 | 서버가 저장. 상태 `home` | HMI(브라우저)가 저장. 상태 `home` 없앰 |
| 원점 잡기 | `POST /api/robot/home/set` (서버가 지금 자세를 저장, `home_required`도 풂) | 서버 명령 없음. HMI가 저장하고 로그에 `home_set`. `home_required`는 풀지 않음 |
| 원점 복귀 | `POST /api/robot/home` (본문 없음, 서버의 원점으로) | `POST /api/robot/home` + `{ angles, units, unit }` (HMI의 원점으로) |
| 자동 시작의 원점 조건 | 서버가 `409 HOME_NOT_SET` | HMI가 봄 (저장된 원점이 없으면 시작을 보내지 않음). 서버는 `HOME_REQUIRED`만 |
| 오류 코드 | — | `422 INVALID_ANGLES` 다시 씀 (원점 복귀 각도), `409 HOME_NOT_SET`은 원점 복귀에 각도가 없을 때 |
| 명령 이름 | `setHome` | 없앰 |
| 서버 정보 | `api: "0.4"` | `api: "0.5"` |

## 14. v0.5 → v0.6 바뀐 점

**로봇팔이 옮길 부품을 HMI에서 고릅니다** (사용자 2026-10-17, 4.3장). 모두 더한 것이라 v0.5대로 만든 서버도 동작합니다 — 그때 HMI는 고르기를 보내도 서버가 모른다고 알립니다.

| 바뀐 점 | v0.5 | v0.6 |
|---|---|---|
| 명령 | — | `PUT /api/sort-target` `{ "target": "good" \| "defect" }`, 명령 이름 `sortTarget` |
| 상태 | 로봇팔은 늘 불량품을 옮김 | `sort_target` (`good` · `defect`) — 그 판정의 부품을 옮기고 다른 쪽을 내보냄 |
| 공정 단계 | `sorting` = 불량품을 옮김, `passing` = 양품을 내보냄 | `sorting` = `sort_target` 부품을 옮김, `passing` = 다른 쪽을 내보냄. 로봇팔 작업 이름 `sort_defect` → `sort_part` |
| 이벤트 | — | `sort_target_changed` (`target`) |
| 오류 코드 | — | `422 INVALID_SORT_TARGET` |
| 서버 정보 | `api: "0.5"` | `api: "0.6"`, `features`에 `sort_target` |
