---
date: 2026-10-17
type: checkpoint
branch: feature/camera-sort-target
items: [hmi-web, api-spec, device-protocol]
decisions: [D-017, D-018, D-019]
corrects: null
source: null
---
# 카메라 영상(서버 안내)과 양품/불량품 선택, 서버에 보낼 문서

## 요약
- 서버 담당의 「HMI 카메라 영상 수신 연동 안내」를 docs/hmi-video-integration.md로 옮겼다(내용은 그대로). 영상은 같은 서버의 HTTP MJPEG `/video/1.mjpg`(탑뷰, id 1)·`/video/2.mjpg`(그리퍼, id 2)와 상태 JSON `/video/status`이고, 서버에는 CORS와 카메라 명령이 없다.
- 카메라: `hmi-web-mockup/js/video.js`(영상 주소를 웹소켓 서버의 호스트·포트로 만들기, 상태 JSON을 화면 단계로 나누기, 상태를 겹치지 않게 묻기), `js/camera.js`의 브릿지 방식, `js/config.js`의 `cameras.bridge`. "카메라 연결"을 누른 동안만 1초마다(제한 3초, 숨은 탭은 쉼) 묻고, 안내 5장대로 "설비 영상 연결 대기"·"영상 미수신"·"5초 이상 새 영상 없음"·"영상 상태 확인 불가"면 영상을 숨긴다. 첫 장면이 그려진 뒤에만 보이고, 끊기면 1초부터 최대 5초 간격으로 `?t=`를 붙여 다시 연다. 화면 하나에 탑뷰·그리퍼 바꾸기 버튼과 장치 연결 줄의 두 카메라 점(D-019).
- 같은 주소로 중계(CORS 없음): Cloudflare Worker가 `/video/status`·`/video/1.mjpg`·`/video/2.mjpg`(GET·HEAD)도 서비스 토큰을 붙여 넘기고, `hmi-web-mockup/tools/dev-server.py --server`가 `/ws/hmi`와 `/video/…`를 서버로 그대로 잇는다. 미리보기 설정 `hmi-web-mockup-lan`에 `--server`를 넣었고 다른 PC 주소는 `?mock=0&ws=auto`로 바뀌었다.
- 양품/불량품: XML `SetSortTarget target="Good|Defect"`(요청안), 상태 `Line/@sortTarget`, 이벤트 `SortTargetChanged`를 읽고, 거절 `InvalidTarget`은 "양품 또는 불량품만" 문구로. 키는 운전 모드 아래, 정지 상태에서만. 서버가 지금 값을 보내지 않으면 그 브라우저에서 마지막으로 서버가 받아 준 값(`hmi.sortTarget`)을 보인다. HMI는 고른 값만 보낸다(D-018).
- 가짜 서버는 API v0.6(`PUT /sort-target`, 상태 `sort_target`, 처음 `defect`)으로 고른 쪽을 로봇팔 작업 `sort_part`(전 `sort_defect`)로 옮기는 흉내를 낸다. 시험용 XML 서버는 `--extended`에 `SetSortTarget`, `--video`에 상태 JSON·MJPEG 흉내(`hmi-web-mockup/tests/fixtures/video-*.jpg`)와 끊김 흉내 `/video/_sim`을 더했다(미리보기 설정 `xml-server-video`, 5092).
- 불량품을 옮긴다고 못 박힌 문구(공정 단계·집기 실패·단계 이름)를 중립으로 바꿨다.
- 문서: docs/xml-protocol.md(8장 카메라, 4장 `SetSortTarget`), docs/API.md v0.6, hmi-web-mockup/README.md, docs/cloudflare.md(영상 경로, 무료 요청 수), docs/line-sequence.md·docs/arm-control.md(`sort_part`).
- 서버에 보낼 문서: 처음에는 변경 반영 요청을 따로 썼다가 사용자 요청으로 docs/hmi-server-answer-1.md 하나로 합쳤다(0장 맨 위 할 일 표, 7장 고른 값 보내기 — `SetSortTarget` 받기와 선택인 `Line/@sortTarget`, 8장 카메라 반영 결과와 같이 확인할 것, 9장 HMI로 확인하는 방법). 따로 쓴 초안은 커밋 전에 합치고 지웠다.
- 커밋 c44f679(카메라·양품/불량품), 3985959(고른 값만 보냄·문서 하나로). 각각 main을 fast-forward 하고 Cloudflare에 배포했다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-web | 완료 | 완료 (3985959) | 완료 (Cloudflare) | 부분 |
| api-spec | 완료 | 완료 (3985959) | 해당 없음 | 해당 없음 |
| device-protocol | 완료 | 완료 (c44f679) | 해당 없음 | 미실행 |

## 근거
- 직접: 시험 125/125 (node --test "hmi-web-mockup/tests/*.test.js", 2026-10-17) — 영상 주소·단계·묻기, `SetSortTarget` 보내기·읽기·`InvalidTarget`, 가짜 서버 v0.6, 시험용 서버 `--extended`·`--video`, Worker 영상 경로, `dev-server.py --server`
- 직접: 브라우저, 시험용 XML 서버(5092, `--simulation --extended --video --static`) — 탑뷰↔그리퍼, 카메라 2 업로드 멈춤 → "5초 이상 새 영상 없음", 업로드 연결 끊김 → "설비 영상 연결 대기", 둘 다 복구, 양품 선택이 서버까지(`SetSortTarget` executed), 가동 중 키 잠김과 중립 문구, 좁은 화면 360px 가로 넘침 없음 (2026-10-17)
- 직접: 브라우저, v1.0 흉내 서버(5091) — 양품 → "서버가 아직 … 받지 않습니다", 영상 경로가 없는 서버 → "영상 상태 확인 불가". 가짜 서버(`?mock=1`) — 양품을 고르면 로봇팔이 양품을 옮기는 흉내, 로그 "로봇팔이 옮길 부품을 양품으로 바꿨습니다" (2026-10-17)
- 직접: 배포 뒤 로그인 없이 `/`·`/video/status`·`/video/1.mjpg`·`/ws/hmi`가 모두 Access 로그인으로 넘어감 (curl, 2026-10-17)
- 사용자: "파일 하나로 합쳐" (대화, 2026-10-17)

## 시도했다가 버린 방법
- 자동 가동 중 상태 설명을 고른 값에 따라 "로봇팔이 양품을 골라냅니다"로 바꾸기 → HMI는 판정하지 않고 고른 값만 보낸다는 사용자 지적 (사용자 2026-10-17) → "카메라 판정에 따라 로봇팔이 부품을 골라냅니다"로 고정
- 서버에 보낼 문서에 공정 처리(판정이 고른 값과 같으면 로봇팔이 옮김)·처음 값 제안·정지 상태 거절 규칙을 요구로 적기 → 같은 지적 → `SetSortTarget`을 받아 달라는 것과 (선택) 지금 값 알려 주기만 요청
- 시험 화면 JPEG를 base64로 손으로 옮겨 적어 만들기 → 파일이 깨짐(5370바이트 대 5850바이트) (직접 2026-10-17) → 브라우저 캔버스로 그린 그림을 이 PC의 임시 수신기로 받아 `tests/fixtures/video-*.jpg`로 저장 (임시 수신기는 일회성, 남기지 않음)

## 남은 공백·다음
- 실제 서버는 `SetSortTarget`을 아직 받지 않는다 (HISTORY/2026-10-17-real-server-check.md).
- 안내 9장의 4·5(실제 서버), 6, 7과 `dev-server.py --server`를 실제 서버로 잇는 것은 확인하지 않았다.
- 서버에 보낼 문서를 서버 담당에게 보냈는지는 미확인이다.
- 다음: 사용자가 문서를 보내고, 서버 담당이 고치면 장비망 밖에서 다시 확인한다.

## 관련
- 결정: D-017, D-018, D-019
- 이전 기록: HISTORY/2026-10-17-cloudflare-hmi.md, HISTORY/2026-10-17-camera-sort-decisions.md
