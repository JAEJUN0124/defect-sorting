---
date: 2026-10-12
type: checkpoint
branch: feature/so101-kit-dashboard
items: [device-io, hmi-web]
decisions: [D-003, D-007]
corrects: null
source: null
---
# 로봇팔 키트 반영과 HMI 쪽 장치 읽기 도구

## 요약
- 사용자가 키트 설명서 사진 2장을 보냈다: Brain Us "AI Robot ARM Edu Kit"(SO-ARM101 기반). 설명서와 LeRobot 공개 코드를 근거로 HMI를 키트에 맞췄고, 정리는 docs/robot-arm.md에 했다.
- 키트 설정(`hmi-web-mockup/config/robot.js`): 팔로워(12V 서보 6개)와 리더암(7.4V급 서보 6개)의 모델·감속비·ID, 어댑터 전압 기준, 온도 경고 55°C·비상 65°C(서보가 스스로 힘을 빼는 70°C 전에 알림).
- 어댑터를 바꿔 꽂으면 알린다: 리더암 전압이 10V를 넘거나 팔로워 전압이 9V 아래면 비상. 가짜 서버는 이때 수동 모드 시작을 거절한다(`POWER_ABNORMAL`).
- 서버가 서보 경고를 보내지 않아도 HMI가 서보 상태 값으로 판단해 기록한다 (`hmi-web-mockup/js/store.js`).
- 비상 정지: 설명서는 DC 케이블 분리 방법을 익힌 뒤 쓰라고 한다. 서버가 끊기면 HMI는 화면 긴급정지를 막고 "로봇팔과 컨베이어의 DC 전원 케이블을 뽑으세요"라고 안내한다 (`hardwareStop: 'dc-cable'`).
- 원점 각도 파일에 단위를 넣었다 (`unit: 'deg'`, LeRobot 기본값). 값은 아직 임시값 0이다.
- HMI 쪽 장치 읽기 (사용자 요청: 카메라·기기 통신 가운데 서버가 아니라 여기서 할 일):
  - `hmi-web-mockup/js/feetech.js`: Feetech 서보 패킷을 Web Serial로 주고받는다. 읽기만 한다 — ID·통신 속도 바꾸기, 힘 켜기, 움직이기는 없다.
  - `hmi-web-mockup/tools/devices.html`: 서보 6개의 응답·전압·온도·부하·캘리브레이션 범위 읽기, 지금 자세를 원점값으로 복사, USB 카메라 목록·해상도, 서버 영상 주소 시험, 아두이노 시리얼 콘솔.
  - `hmi-web-mockup/js/camera.js`: MJPEG·스냅샷·웹소켓·WebRTC(WHEP)·video와, 카메라를 HMI PC에서 직접 띄우는 방식(`local`, 서버로 올려 보내기 선택)을 한 코드로 연다.
- 서보 버스와 카메라는 한 프로그램만 열 수 있어, 장치 점검은 서버를 끈 상태에서 쓴다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| device-io | 부분 | 완료 | 미실행 | 미실행 |

## 근거
- 사용자: 키트 구성, 전원(리더 DC 7.5V 3A, 팔로워 DC 12V 5A), 안전 주의 (첨부한 설명서 사진 2장, 2026-10-12)
- 직접: LeRobot 공개 코드(feetech `tables.py`, SO-101 팔로워, `motors_bus.py`)와 Feetech 메모리 표 정리 문서를 읽고 관절 이름·모터 번호, 1Mbps·프로토콜 0, 메모리 주소, 각도 계산식을 docs/robot-arm.md 2장에 정리 (WebFetch, 2026-10-12)
- 직접: 서보 패킷 시험 6/6 통과 (node --test, 2026-10-12)
- 직접: 장치 점검의 가짜 서보·가짜 카메라 모드로 화면 확인, PC 카메라 방식은 브라우저의 카메라 함수를 가짜 영상으로 바꿔 확인 (미리보기 브라우저, 2026-10-12)
- 직접: main 단계는 4358be4 (git log, 2026-10-12)

## 남은 제한
- 실제 키트·USB 카메라·아두이노로는 아무것도 시험하지 않았다. 서보 드라이버 보드의 칩은 설명서에 없어 모른다.
- 경고 기준(55·65°C, 어댑터 정격 ±10%, 리더 10V·팔로워 9V)은 실측 없이 정한 값이다.
- 두 번째 카메라 위치는 정하지 않았다(키트에는 탑 뷰 마운트만 있음). HMI는 위(`top`)·근접(`close`)으로 가정했다.
- 하드웨어 비상정지 버튼을 달지는 정하지 않았다. 달면 `hardwareStop: 'button'`으로 바꾼다.

## 남은 공백·다음
- 다음: 실제 키트를 연결해 `hmi-web-mockup/tools/devices.html`로 서보 6개·전압·캘리브레이션과 카메라를 읽어 보고, 원점 자세를 읽어 `hmi-web-mockup/config/home-position.js`를 채움

## 관련
- 결정: D-003, D-007
- 문서: docs/robot-arm.md, docs/API.md §8
