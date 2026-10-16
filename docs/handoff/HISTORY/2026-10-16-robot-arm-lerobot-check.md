---
date: 2026-10-16
type: checkpoint
branch: docs/robot-arm-lerobot-update
items: [device-io, device-protocol]
decisions: [D-014]
corrects: null
source: null
---
# 로봇팔 자료를 LeRobot 최신판과 대조하고 로봇팔 문서를 고침

## 요약
- 사용자가 로봇팔 자료 두 가지를 주고, 우리가 할 작업이 있는지 확인만 하라고 했다("작업은 하지마").
  - LeRobot 조립 후 기술 가이드: 사용자가 보낸 Markdown 문서. 공식 문서·코드를 정리한 2차 자료이고, "리더암과 팔로워암의 기계적 조립이 완료되었습니다"라고 적혀 있다.
  - LeRobot 공식 문서 「Imitation Learning on Real-World Robots」(il_robots): 원격 조작 → 녹화 → 정책 학습 → 실행.
- 두 자료를 저장소 문서·코드와 LeRobot main 코드(`297774f`)에 대조했다.
  - 같음: HMI `js/feetech.js`의 각도 계산(관절은 도, 그리퍼는 범위 안 0~100%)과 캘리브레이션 판단, `use_degrees` 기본 켜짐, `max_relative_target` 기본 없음, 연결을 끊을 때 힘 빼기 기본 켜짐, 손목 회전은 한 바퀴(0~4095).
  - 낡음: docs/robot-arm.md의 설치 명령 `pip install -e ".[feetech]"`. main은 Python 3.12 이상이고, 캘리브레이션·원격 조작·녹화 명령에 필요한 패키지를 `core_scripts` 묶음으로 나눴다.
  - 빠짐: 팔 이름(`--robot.id`·`--teleop.id`)을 늘 같게 쓰는 규칙, 캘리브레이션을 다시 하면 원점·자세를 다시 잡는 규칙. LeRobot의 도는 캘리브레이션 범위의 가운데가 0°라서, 다시 하면 같은 값이 다른 자세가 된다.
  - 미룸: ① docs/arm-control.md 1장은 로봇팔 제어를 서버와 같은 파이썬 프로그램에 두라고 하나, 서버는 .NET 9이고 README도 따로 있는 "로봇 팔 컴퓨터"와 잇는 구조다. ② 그리퍼 단위: LeRobot은 `use_degrees`와 상관없이 0~100으로 내는데, v1.0 README는 모터 6개 모두 `deg`다. ③ arm-control.md 3.1 정책 단계의 `until: done`: 공식 문서에 정책이 끝을 알리는 신호가 없고 실행은 `--duration`으로 끝난다. ①②는 서버 회신 뒤, ③은 자동 모드 방법을 정한 뒤 본다.
  - 필요 없음: 가이드 7장(XYZ·역기구학), 10장(REST 작업 API), 11장(원격 추론). 가이드 3.3의 리더 5V는 Seeed 키트 기준이고, 우리 키트는 설명서대로 리더 7.5V·팔로워 12V다.
- 사용자 승인("수정")으로 고친 문서:
  - docs/robot-arm.md: 출처 3줄(il_robots, 다시 확인한 LeRobot 코드, 가이드), 4장 1번 설치를 Python 3.12 이상에서 `pip install -e ".[core_scripts,feetech]"`로, 5·6번에 팔 이름 `follower_01`·`leader_01`, 표 아래에 팔 이름 설명, 6장 안전에 "캘리브레이션을 다시 하면 원점·자세도 다시 잡기".
  - docs/arm-control.md 3.4: 자세 값과 HMI 원점은 저장할 때의 캘리브레이션 기준이라, 캘리브레이션을 다시 하면 둘 다 다시 저장한다.
  - 팔 이름 `follower_01`·`leader_01`은 문서를 고치며 정한 이름이다. 다른 이름을 원하면 바꾼다고 사용자에게 알렸다.
- `docs/robot-arm-lerobot-update`에 커밋(c619f14)하고 사용자 승인으로 main을 fast-forward했다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| device-io | 부분 (그대로. 실제 키트 미시험, 설치 순서 문서만 고침) | 완료 (그대로) | 미실행 | 미실행 |
| device-protocol | 완료 (arm-control.md 3.4에 한 줄 더함) | 완료 (c619f14) | 해당 없음 | 미실행 |

## 근거
- 사용자: 가이드 문서와 il_robots 링크 전달, "우리가 이거 관련해서 할 작업이 존재하는지 체크하고 나한테 말해줘. 작업은 하지마." (대화, 2026-10-16)
- 사용자: 고칠 내용 설명을 듣고 "수정", 이어서 "커밋하고 main에 fast-forward로 합쳐줘" (대화, 2026-10-16)
- 직접: LeRobot main 코드 읽기 (raw.githubusercontent.com, main 297774f, 2026-10-16)
  - `pyproject.toml`: `requires-python = ">=3.12"`, `core_scripts` = dataset·hardware·viz 묶음(lerobot-record·replay·calibrate·teleoperate용)
  - `config_so_follower.py`·`config_so_leader.py`: `use_degrees = True`, `max_relative_target = None`, `disable_torque_on_disconnect = True`
  - `motors_bus.py` `_normalize`: 도 = (위치 − 범위 가운데) × 360 / 4095, 그리퍼 = 범위 안에서 0~100
  - `so_follower.py`: `connect()`는 그 `id`의 캘리브레이션 파일이 없으면 캘리브레이션을 시작한다. 손목 회전 범위는 0~4095로 둔다
- 직접: HMI `js/feetech.js`의 `toDegrees`·`toPercent`가 위 식과 같음 (파일 읽기, 2026-10-16)
- 직접: 저장소에 팔 이름(`id`) 규칙과 "캘리브레이션을 다시 하면 원점·자세를 다시 잡는다"는 내용이 없었음 (git grep, 2026-10-16)
- 직접: docs/server-xml-v1.0.md의 `RobotArm/@connected` 설명("서버와 로봇 팔 컴퓨터의 연결 여부"), 로봇 컴퓨터를 이을 때 StatusSource를 바꾼다는 설명, 모터 6개 모두 `unit="deg"` (파일 읽기, 2026-10-16)
- 직접: 고친 설치 표 11줄의 칸 수가 그대로 (awk, 2026-10-16)
- 직접: 커밋 c619f14, main fast-forward·merge 커밋 없음 (git log·git rev-list, 2026-10-16)

## 남은 제한
- 코드와 문서만 읽었다. LeRobot을 설치·실행하지 않았고 키트에도 연결하지 않았다.
- 문서만 바뀌어 HMI 시험은 돌리지 않았다.

## 남은 공백·다음
- 실제 키트로는 아직 아무것도 시험하지 않았다. 배선 직후 장치 점검으로 ID 1~6이 잡혀 있는지부터 읽는다. ID 설정은 모터를 하나씩만 연결해서 해야 하므로, 안 돼 있으면 조립한 팔의 커넥터를 다시 빼야 할 수 있다(가이드 3.5).
- 서보 드라이버 보드 종류를 모른다. 가이드는 Waveshare 보드면 점퍼 두 개를 B(USB) 쪽으로 두라고 한다.
- docs/robot-arm.md 출처에는 키트 설명서의 "권장 OS"가 있으나 그 값은 적혀 있지 않다.
- 미룬 것 ①②③ (요약 참고)
- 다음: 로봇팔 배선·설정(docs/robot-arm.md 4장 1~6번) 뒤 device-io 확인 (사용자 2026-10-16)

## 관련
- 결정: D-014
- 이전 기록: HISTORY/2026-10-12-robot-arm-kit.md
