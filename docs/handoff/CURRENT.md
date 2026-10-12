---
project_id: defect-sorting
handoff_spec: 1
timezone: Asia/Seoul
---
# CURRENT
마지막 갱신: main · 2026-10-12

## 기준 상태
- 서버: 다른 팀원 담당, HMI가 연결할 실제 서버는 아직 없음 (사용자 2026-10-06 · 역할 분담 설명)
- HMI 서버 연결: 브라우저 안 가짜 서버로 동작, `hmi-web-mockup/js/config.js`의 `useMock: true` (직접 2026-10-12 · 파일 확인)
- 로봇팔 키트: Brain Us AI Robot ARM Edu Kit(SO-ARM101 기반), 팔로워 12V·리더암 7.4V급 서보 6개씩, USB 카메라 2대. 세부는 docs/robot-arm.md (사용자 2026-10-12 · 첨부한 키트 설명서 사진)
- 공유용 사본: claude.ai 비공개 페이지 3개(조작 화면·첫 대시보드·탭 대시보드), 화면마다 따로 동작. 실제로 열리는지는 미확인. 주소와 저장소 파일과의 차이는 HISTORY/2026-10-12-dashboard-controls.md (직접 2026-10-12 · Artifact 올리기 결과)

## 진행 항목
| 항목 | 로컬 | main | 배포 | 운영검증 | 재개 지점 |
| --- | --- | --- | --- | --- | --- |
| hmi-web 불량 선별 HMI(웹) 조작 화면·대시보드 | 완료 (직접 2026-10-12 · 테스트 37/37, 가짜 서버·변형 서버로 브라우저 확인. 탭 대시보드와 대시보드 조작은 가짜 서버로만) | 완료 (직접 2026-10-12 · d52c539) | 미실행 | 미실행 | 실제 서버가 준비되면 `hmi-web-mockup/tools/server-check.html`로 형식 점검 후 `useMock: false`로 세 화면 연동 확인 |
| api-spec HMI↔서버 API 초안 v0.2 | 완료 (직접 2026-10-12 · docs/API.md v0.2 작성) | 완료 (직접 2026-10-12 · 4358be4) | 해당 없음 | 해당 없음 | 서버 담당과 docs/API.md §9 항목 합의 |
| device-io HMI 쪽 장치 읽기(서보·PC 카메라) | 부분 (직접 2026-10-12 · 단위 테스트, 가짜 서보·가짜 카메라로만 확인) | 완료 (직접 2026-10-12 · 4358be4) | 미실행 | 미실행 | 실제 키트를 연결해 `hmi-web-mockup/tools/devices.html`로 서보 6개·카메라 읽기 확인 |

## 공백·차단·제한
- [열림] 차단: 실제 서버가 없어 실서버 연동 미확인 — 관련: hmi-web (사용자 2026-10-06 · 서버는 다른 팀원 담당)
- [열림] 공백: 카메라 영상 전달 방식 미정, 초안은 MJPEG 제안 — 관련: api-spec (사용자 2026-10-06 · "아직 모름")
- [열림] 공백: 원점 각도 실제 값 미정, `hmi-web-mockup/config/home-position.js`는 임시값 0(단위 deg). 실제 자세를 읽어 채우는 기능은 `hmi-web-mockup/tools/devices.html`에 있음 — 관련: hmi-web, device-io, D-007 (직접 2026-10-12 · 파일 확인)
- [열림] 공백: 일반 정지(비긴급) 필요 여부 미확정, 시작 키가 가동 중 "정지"로 바뀌는 토글로 가정해 구현 — 관련: hmi-web (사용자 2026-10-06 · "중지가 있는지는 모르겠네")
- [열림] 공백: 배포 전 `devMode: false` 전환 필요 — 관련: hmi-web, D-008, D-012 (사용자 2026-10-06 · 장치 연결 표시는 추후 삭제)
- [열림] 공백: 실제 키트·USB 카메라·아두이노 컨베이어로는 시험하지 않음. 서보 읽기와 PC 카메라는 가짜 장치로만 확인했고, 서보 온도·전원 경고 기준(`hmi-web-mockup/config/robot.js`)은 실측 없이 정한 값 — 관련: device-io (직접 2026-10-12 · docs/robot-arm.md §7)
- [열림] 공백: 카메라 WebRTC(WHEP) 연결과 HMI의 카메라 영상 올려 보내기는 받아 줄 서버가 없어 미확인 — 관련: hmi-web (직접 2026-10-12 · 변형 서버에 없는 기능)
- [열림] 공백: 두 번째 카메라 위치 미정(키트에는 탑 뷰 마운트만 있음), HMI는 위(`top`)·근접(`close`) 두 대로 가정 — 관련: hmi-web (직접 2026-10-12 · docs/robot-arm.md §7)
- [열림] 공백: 대시보드가 첫 대시보드(`hmi-web-mockup/dashboard.html`)와 탭 시안(`hmi-web-mockup/dashboard-tabs.html`) 두 가지이고 어느 쪽을 쓸지 미정. 조작 화면의 "대시보드" 단추는 첫 대시보드로 감 — 관련: hmi-web, D-013 (직접 2026-10-12 · `hmi-web-mockup/js/app.js` 확인)
- [열림] 공백: 탭 시안도 장치 연결 표시를 `devMode`와 상관없이 늘 보이지만 D-012의 범위는 첫 대시보드뿐이라, 탭 시안에도 적용할지 미확인 — 관련: hmi-web, D-012 (직접 2026-10-12 · `hmi-web-mockup/js/dashboard-tabs.js` 확인)
- [열림] 제한: 화면 긴급정지는 네트워크·서버를 거쳐 서버가 멈추면 효과 없음. 서버가 끊기면 HMI는 DC 전원 케이블 분리를 안내함(키트 설명서의 방법), 하드웨어 비상정지 버튼 필요 여부는 미정 — 관련: hmi-web (직접 2026-10-12 · docs/API.md §8, `hmi-web-mockup/config/robot.js` hardwareStop)
- [열림] 제한: 프로그램 종료(F-03) 뒤 HMI 창은 닫지 않고 종료 화면만 남김(브라우저는 스크립트가 연 창만 닫음) — 관련: hmi-web, D-001 (직접 2026-10-06 · js/app.js finishExit)

## 다음 작업
- 지정 없음

## 참고
- HMI 실행·구조: hmi-web-mockup/README.md · API v0.2: docs/API.md · 서버 형식 대응표: docs/server-cases.md · 로봇팔 키트: docs/robot-arm.md · 심플함 비교: docs/simplicity-report.md(탭 시안·대시보드 조작은 11장)
- 결정: D-001~D-013 · HISTORY: 2026-10-12-dashboard-controls.md, 2026-10-12-dashboard-tabs.md, 2026-10-12-standalone-screens.md, 2026-10-12-server-compat.md, 2026-10-12-dashboard.md, 2026-10-12-robot-arm-kit.md, 2026-10-12-hmi-web-light.md, 2026-10-12-hmi-web-dark.md, 2026-10-12-api-draft.md
