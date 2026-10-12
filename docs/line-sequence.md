# 공정 순서 (초안)

부품 하나가 들어와 판정되고 분류될 때까지 서버가 컨베이어·카메라·로봇팔을 어떤 순서로 움직이는지 정리합니다.
컨베이어 운전 방식은 아직 정하지 않았지만 **부품마다 멈추는 방식**일 가능성이 높아 그것을 기본으로 적고, 계속 도는 방식은 4장에 따로 둡니다.

- 관련 문서: [컨베이어 시리얼 규약](conveyor-protocol.md) · [로봇팔 제어 약속](arm-control.md) · [HMI ↔ 서버 API](API.md)
- HMI의 가짜 서버([`js/mock-server.js`](../hmi-web-mockup/js/mock-server.js))가 이 순서(부품마다 멈춤, 센서와 스스로 멈추기가 있는 컨베이어)대로 움직입니다.

## 1. 단계 (`cycle.stage`)

서버는 가동 중 지금 단계를 HMI 상태의 `cycle`로 알립니다 ([API 3장](API.md#3-상태-모델)).

| 단계 | 뜻 | 컨베이어 | 로봇팔 |
|---|---|---|---|
| `feeding` | 다음 부품을 검사 자리로 옮기는 중 | 가동 | 대기 자세 |
| `inspecting` | 멈춘 부품을 촬영·판정하는 중 | 멈춤 | 대기 자세 (카메라를 가리지 않는 곳) |
| `sorting` | 불량품을 불량 상자로 옮기는 중 | 멈춤 | 작업 `sort_defect` |
| `passing` | 양품을 검사 자리 밖으로 내보내는 중 | 가동 | 대기 자세 |

```json
"cycle": { "stage": "sorting", "part": 812, "step": "pick" }
```

`part`는 지금 다루는 부품의 판정 번호(`inspection.id`)이고, `step`은 로봇팔 작업의 지금 단계 이름입니다 (선택). 가동 중이 아니면 `cycle`은 `null`입니다.

## 2. 자동 모드 — 부품마다 멈춤

```text
             ┌───────────────── 양품 ─────────────────┐
             │                                         ▼
 feeding ──부품 도착──> inspecting ──판정──┬──> passing ──부품이 센서를 지남──> feeding
    ▲                                       │
    └──────────── 작업 성공 ──── sorting <──┘ 불량
```

1. **feeding** — 컨베이어 `RUN`. 부품 도착을 기다립니다.
   - 센서가 있으면 `!PART 1`이 옵니다. 스스로 멈추기(`AUTOSTOP 1`)면 아두이노가 이미 멈췄고, 아니면 서버가 바로 `STOP`을 보냅니다.
   - 센서가 없으면 카메라가 검사 구역에 부품이 들어온 것을 보고 `STOP`을 보냅니다 (판정 모델과 별도로 "부품 있음"만 보는 가벼운 검출). 카메라 한 장 + 처리 시간만큼 늦게 멈추므로 벨트를 느리게 돌립니다.
2. **inspecting** — 멈추고 `settle_ms`(초안 300ms) 기다려 흔들림이 멎으면 촬영·판정합니다. 결과는 HMI로 `inspection`.
3. 양품이면 **passing** — `RUN`. 부품이 센서를 다 지나가면(`!PART 0`) feeding으로. 센서가 없으면 `pass_ms` 동안 가동한 뒤 feeding으로.
4. 불량이면 **sorting** — 로봇팔 `run_task("sort_defect")`. 성공하면 `RUN` → feeding (부품은 팔이 치웠으므로 내보낼 것이 없음).

## 3. 시간 제한과 고장

| 무엇 | 기준 (초안) | 서버가 하는 일 | `fault.code` | 풀리는 방법 (`clear`) |
|---|---|---|---|---|
| 판정이 오지 않음 | `judge_timeout_ms` 5000 | 라인 정지 | `INSPECTION_TIMEOUT` | `start` |
| 부품이 검사 자리를 지나가지 않음 (걸림) | `pass_timeout_ms` 3000 | 컨베이어 `STOP`, 라인 정지 | `PART_STUCK` | `start` |
| 부품이 오지 않음 | 없음 | feeding에서 계속 기다림 | — | — |
| 다시 해도 집지 못함 | 로봇팔 작업 결과 | 라인 정지, 로봇팔은 그 자리에서 멈춤 | `GRIP_FAILED` | `home` |
| 자세에 제때 닿지 못함 | 로봇팔 단계 시간 | 라인 정지, 로봇팔은 그 자리에서 멈춤 | `ARM_MOTION_TIMEOUT` | `home` |
| 컨베이어가 스스로 멈춤 (감시 타이머·정지 단추·이상·리셋) | `!STATE halted` 또는 뜻밖의 `!READY` | 로봇팔이 작업 중이면 그 작업은 끝냄. 라인 정지 | `CONVEYOR_HALTED` (`reason`) | `start` |
| 컨베이어가 답하지 않음 | 3번 이어서 놓침 | 라인 정지, 장치 끊김 | — (`devices.conveyor`) | 다시 연결되면 |
| 서보 과열·전압 이상 | [API 3.1장](API.md#31-고장-코드-faultcode-시작-거절의-fault_active) | 라인 정지 | `SERVO_OVERHEAT` · `POWER_ABNORMAL` | `auto` |

`clear`는 고장이 풀리는 방법입니다.

- `auto`: 원인이 사라지면 서버가 지웁니다 (서보가 식으면 등). 그동안 시작은 `409 FAULT_ACTIVE`.
- `home`: 원점 잡기를 마치면 지웁니다. 그동안 시작은 `409 HOME_REQUIRED`.
- `start`: 사람이 확인하고 시작을 누르면 지웁니다 (시작이 곧 확인). 서버는 시작할 때 컨베이어에 `RESET`을 보냅니다.

## 4. 자동 모드 — 계속 돌다 불량만 멈춤 (다른 안)

1. 컨베이어는 계속 `RUN`이고, 카메라가 움직이는 부품을 판정합니다.
2. 불량이면 그 부품이 집는 자리에 왔을 때 멈춥니다. 집는 자리에 두 번째 센서를 두거나, 판정 위치에서 집는 자리까지의 거리 ÷ 벨트 속도로 시간을 계산합니다.
3. sorting → 다시 `RUN`.

처리량은 높지만 판정을 움직이는 영상으로 해야 하고(번짐), 멈추는 시점 계산이 틀리면 집지 못합니다. 이 방식에서 `cycle.stage`는 `feeding`(움직이며 판정)과 `sorting`만 씁니다.

## 5. 수동 모드 (초안)

- 컨베이어는 시작·정지로만 움직이고 부품마다 멈추지 않습니다. 판정은 계속 HMI로 보냅니다 (사람이 보고 리더암으로 집음).
- 로봇팔은 `teleop(True)`로 리더암을 따라갑니다.
- `cycle.stage`는 늘 `feeding`입니다.
- 정할 것: 수동 모드에서도 부품마다 멈출지 (그러면 다시 가동하라는 신호가 따로 필요), 시연 녹화와 묶을지.

## 6. HMI 명령을 받았을 때

| HMI 명령 | 컨베이어 | 로봇팔 | 상태 |
|---|---|---|---|
| 시작 (F-01) | `clear: start` 고장이 있으면 지움 → `RESET` → (`SPEED`·`AUTOSTOP`) → `RUN` | 대기 자세로 | `starting` → `running`, `cycle.stage = "feeding"` |
| 정지 | `STOP` | 작업 중이면 끝까지 → 대기 자세 | `stopping` → `stopped` |
| 긴급정지 (F-02) | `HALT` (가장 먼저) | `relax()` | `estop: true`, `home_required: true` |
| 긴급정지 해제 | `RESET` | 지금 자세로 힘을 다시 줌 | `estop: false`, 정지 그대로 (D-004) |
| 원점 잡기 (F-04) | 그대로 (멈춤) | `move_home()` | `homing` → `stopped`, `home_required: false`, `clear: home` 고장을 지움 |
| 운전 모드 전환 (F-06) | 그대로 | 수동이면 `teleop` 준비 | 정지 상태에서만 (D-003) |
| 프로그램 종료 (F-03) | `STOP` | `park` 작업 → 힘 빼기 | `shutdown_complete` |

시작을 거절하는 순서: 긴급정지(`ESTOP_ACTIVE`) → 상태(`INVALID_STATE`) → `clear: auto` 고장(`FAULT_ACTIVE`) → 원점 필요(`HOME_REQUIRED`) → 장치 연결(`DEVICES_NOT_READY`).

## 7. 서버 설정값 (초안)

| 이름 | 초안 | 뜻 |
|---|---|---|
| `part_arrival` | `sensor` | 부품 도착을 `sensor`(컨베이어 센서) 또는 `camera`로 앎 |
| `settle_ms` | 300 | 멈춘 뒤 촬영까지 기다림 |
| `judge_timeout_ms` | 5000 | 판정을 기다리는 최대 시간 |
| `pass_ms` | 1500 | 센서가 없을 때 양품을 내보내는 가동 시간 |
| `pass_timeout_ms` | 3000 | 센서가 있을 때 부품이 센서를 지나가기까지의 최대 시간 |
| `conveyor_speed` | 50 | 벨트 속도 % (속도 조절이 있을 때) |
| `ping_ms` · `watchdog_ms` | 250 · 1000 | 컨베이어 감시 ([규약 6장](conveyor-protocol.md#6-감시-타이머--서버가-멈추면-벨트도-멈춘다)) |

## 8. 정할 것

- [ ] 부품마다 멈춤(초안) / 계속 돎
- [ ] 부품 도착을 센서로 알지, 카메라로 알지
- [ ] 위 시간 값들
- [ ] 고장을 `auto`·`home`·`start` 세 가지로 푸는 방식이 맞는지
- [ ] 수동 모드에서 컨베이어를 어떻게 돌릴지
- [ ] 정지(일반) 때 로봇팔이 하던 작업을 끝내고 멈출지(초안), 바로 멈출지
