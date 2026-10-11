---
project_id: defect-sorting
handoff_spec: 1
timezone: Asia/Seoul
---
# CURRENT
마지막 갱신: docs/handoff-hmi-status · 2026-10-12

## 기준 상태
- 서버: 다른 팀원 담당, HMI가 연결할 실제 서버는 아직 없음 (사용자 2026-10-06 · 역할 분담 설명)
- HMI 서버 연결: 브라우저 안 가짜 서버로 동작, `hmi-web-mockup/js/config.js`의 `useMock: true` (직접 2026-10-12 · 파일 확인)

## 진행 항목
| 항목 | 로컬 | main | 배포 | 운영검증 | 재개 지점 |
| --- | --- | --- | --- | --- | --- |
| hmi-web 불량 선별 HMI(웹) | 완료 (직접 2026-10-07 · 가짜 서버로 F-01~F-06·로그 창·다크 테마 브라우저 확인) | 완료 (직접 2026-10-12 · 15b267e) | 미실행 | 미실행 | 실제 서버가 준비되면 `useMock: false`로 연동 확인 |
| api-spec HMI↔서버 API 초안 v0.1 | 완료 (직접 2026-10-06 · docs/API.md 작성) | 완료 (직접 2026-10-12 · 15b267e) | 해당 없음 | 해당 없음 | 서버 담당과 docs/API.md §6 항목 합의 |

## 공백·차단·제한
- [열림] 차단: 실제 서버가 없어 실서버 연동 미확인 — 관련: hmi-web (사용자 2026-10-06 · 서버는 다른 팀원 담당)
- [열림] 공백: 카메라 영상 전달 방식 미정, 초안은 MJPEG 제안 — 관련: api-spec (사용자 2026-10-06 · "아직 모름")
- [열림] 공백: 원점 각도 실제 값 미정, `hmi-web-mockup/config/home-position.js`는 임시값 0 — 관련: hmi-web, D-007 (직접 2026-10-12 · 파일 확인)
- [열림] 공백: 일반 정지(비긴급) 필요 여부 미확정, 시작 키가 가동 중 "정지"로 바뀌는 토글로 가정해 구현 — 관련: hmi-web (사용자 2026-10-06 · "중지가 있는지는 모르겠네")
- [열림] 공백: 배포 전 `devMode: false` 전환 필요 — 관련: hmi-web, D-008 (사용자 2026-10-06 · 장치 연결 표시는 추후 삭제)
- [열림] 제한: 화면 긴급정지는 네트워크·서버를 거쳐 서버가 멈추면 효과 없음, 하드웨어 비상정지 필요 여부 미정 — 관련: hmi-web (직접 2026-10-06 · docs/API.md §5)
- [열림] 제한: 프로그램 종료(F-03) 뒤 HMI 창은 닫지 않고 종료 화면만 남김(브라우저는 스크립트가 연 창만 닫음) — 관련: hmi-web, D-001 (직접 2026-10-06 · js/app.js finishExit)

## 다음 작업
- 지정 없음

## 참고
- HMI 실행·구조: hmi-web-mockup/README.md · API 초안: docs/API.md · 심플함 비교: docs/simplicity-report.md
- 결정: D-001~D-011 · HISTORY: 2026-10-12-hmi-web-light.md, 2026-10-12-hmi-web-dark.md, 2026-10-12-api-draft.md
