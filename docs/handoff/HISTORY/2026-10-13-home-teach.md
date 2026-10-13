---
date: 2026-10-13
type: completion
branch: feature/home-teach
items: [hmi-web, api-spec, device-io]
decisions: [D-007]
corrects: null
source: null
---
# 원점 잡기·원점 복귀 구현과 API v0.4

## 요약
- 세 화면에 "원점 복귀"·"원점 잡기" 두 키. 원점 잡기는 수동 모드(정지·가동 중)에서만, 확인 창을 거쳐 서버에 저장 명령을 보낸다. 원점 복귀는 자동 모드·정지 상태에서 저장된 원점이 있을 때만. 긴급정지 중에는 둘 다 잠긴다. 모드 때문에 잠긴 키는 마우스를 올리면 이유가 보인다.
- 원점은 서버가 저장하고 상태 `home: { angles, unit, set_at }` 또는 `null`로 알린다. 원점 잡기를 하면 `home_required`와 `clear: home` 고장이 풀린다. `home_required`·저장된 원점 없음(`HOME_NOT_SET`)은 자동 시작만 막는다.
- API를 v0.4로 올림: 원점 잡기 `POST /api/robot/home/set`, 원점 복귀 `POST /api/robot/home`(본문 없음), 오류 `NOT_AUTO`·`NOT_MANUAL`·`HOME_NOT_SET` 추가, `INVALID_ANGLES` 제거, 이벤트 `home_set`. docs/arm-control.md·line-sequence.md·robot-arm.md·server-cases.md, README도 맞춤.
- `hmi-web-mockup/config/home-position.js`와 장치 점검의 "지금 자세를 원점값으로"를 없앰.
- `feature/home-teach`에 커밋(3bca3ed)하고 사용자 승인으로 main에 fast-forward함.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-web | 완료 (테스트 67/67, 브라우저 확인) | 완료 (3bca3ed) | 미실행 | 미실행 |
| api-spec | 완료 (docs/API.md v0.4) | 완료 (3bca3ed) | 해당 없음 | 해당 없음 |

## 근거
- 직접: `node --test "hmi-web-mockup/tests/*.test.js"` 67/67 통과 (원점 시험 5개 추가, 예전 원점 시험 1개 교체) (2026-10-13)
- 직접: 브라우저에서 조작 화면 수동 전환 → 가동 중 원점 잡기(확인 창, 저장 시각 표시, 로그) → 자동 전환 → 원점 복귀 → 긴급정지·해제 뒤 안내 확인. 첫 대시보드에서 확인 창 저장·취소, 탭 대시보드에서 시작 조건·원점 표·원점 복귀·시스템 탭 확인 (가짜 서버, 2026-10-13)
- 직접: 폭 1100(조작반 360px)·1366·1440에서 키 글자가 한 줄, 넘침 없음 (2026-10-13)

## 시도했다가 버린 방법
- 조작 화면의 두 키를 아이콘 없이 21px로 → 바로 아래 운전 모드 선택 스위치처럼 보임 (스크린샷) → 아이콘을 붙이고 글자를 16px로.
- 원점 값을 HMI 설정 파일에 두기 → 브라우저는 파일을 쓸 수 없고 팔의 실제 각도와 원점을 쓰는 곳이 서버 → 서버가 저장.

## 남은 공백·다음
- 원점을 저장할 서버 파일, 자동 작업에서 원점을 어떻게 쓸지, 수동 뒤 자동 전환 때 원점 복귀를 꼭 거칠지 미정 (docs/API.md 9장).
- 가짜 서버는 원점을 메모리에만 둠. 실제 서버·실제 키트로는 확인하지 않음.
- 심플함 보고서 측정값은 다시 재지 않음.
- 일회성 조치: 다른 세션이 main 폴더를 `feature/poster`로 쓰고 있어 `.claude/worktrees/home-teach` 작업 폴더에서 작업했고(로컬 git 제외 목록에 추가), 미리보기를 띄우려고 main 폴더의 `.claude/launch.json`에 항목을 잠깐 넣었다가 원래대로 되돌림. 다시 할 일 아님.

## 관련
- 결정: D-007
