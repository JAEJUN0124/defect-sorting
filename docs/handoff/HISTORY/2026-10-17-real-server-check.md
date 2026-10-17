---
date: 2026-10-17
type: blocked
branch: feature/camera-sort-target
items: [hmi-web, api-spec]
decisions: [D-017, D-018]
corrects: null
source: null
---
# 실제 서버로 장비망 밖에서 확인 — 영상은 됨, 각도 고정·SetSortTarget 거절

## 요약
- 카메라·양품/불량품을 배포한 직후 장비망 밖(`https://hmi.hypefree.net/`)에서 확인하려 했지만 `/video/status`가 Cloudflare 502였고 화면은 "연결 중"이었다. 이 PC의 `cloudflared`는 정상이었고 서버 PC가 장비망에서 응답하지 않았다(그때 꺼져 있었음).
- 사용자가 서버가 켜졌다고 한 뒤 다시 확인했다. 서버 연결과 상태 받기, 영상 상태 JSON, 두 카메라 영상이 장비망 밖에서 된다. 설비 영상 업로드는 확인 도중에 켜졌다.
- 그리퍼(카메라 2) 영상은 들어오지만 화면이 거의 검게 보였다. 카메라가 가려졌거나 어두운 곳을 보는지 설비 쪽 확인이 필요하다.
- 양품 키를 한 번 눌러 `SetSortTarget target="Good"`을 보냈더니 서버가 거절했고, HMI는 "서버가 아직 … 명령(SetSortTarget)을 받지 않습니다"를 보였다. 서버 담당이 명령을 더해야 한다.
- 상태 원문에 `Line`이 없어 "상태 미수신"으로 보인다(사용자가 이유를 이해함). 각도는 로봇팔이 움직이는데도 고정값이었다 — 서버가 실제 관절 위치를 넘기지 않는 것으로 보인다. 사용자가 서버 담당에게 전했다.
- 각도가 고정인 동안 원점 잡기를 하면 그 값이 원점으로 저장되므로 하지 않는다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| hmi-web | 완료 | 완료 | 완료 (Cloudflare) | 부분 |

## 근거
- 직접: 첫 확인 때 `/video/status` 502, 이 PC(장비망)에서 서버로 ping이 "대상 호스트에 연결할 수 없습니다", 5080 응답 없음, `cloudflared` `/ready` 연결 4개 (curl·ping, 2026-10-17)
- 직접: 서버가 켜진 뒤 장비망 안에서 `/video/status`·`/video` 200(처음 `connected=false`), 밖(Worker)에서도 `/video/status` 200 (curl·브라우저 fetch, 2026-10-17)
- 직접: 밖에서 연 HMI가 서버 연결, "상태 미수신", `source="equipment"`, 로봇팔 연결·컨베이어 끊김을 보임. 업로드가 켜진 뒤 두 카메라 `available=true`, 탑뷰·그리퍼 영상 640×480, 바꾸기 됨. 장비망 안에서 두 스트림 모두 초당 약 15장 (앱 브라우저·curl, 2026-10-17)
- 직접: 밖에서 양품 키 → 거절, HMI 문구 확인 (앱 브라우저, 2026-10-17)
- 직접: 상태 원문 — `<Status source="equipment">`에 `Line` 없음, `RobotArm connected="true"`, 1~5번 `0.00` deg, 6번 `10.00` percent, 모두 `valid="true"`. 10초 동안 GetStatus 10번에 상태 19개가 왔고 각도 조합은 하나뿐 (Node 웹소켓으로 GetStatus, 2026-10-17)
- 사용자: 서버가 켜짐 — "서버 켜졌으니까 체크", 로봇팔이 움직임 — "지금 서버 연결되었고 로봇팔 움직이는데 왜 상태 미수신인지 모르겠음", "아 서버 상태는 이해 했어", 서버 담당에게 전함 — "지금 서버쪽에 말 넣어놨어" (대화, 2026-10-17)

## 남은 공백·다음
- 서버: 실제 관절 위치를 `RobotArm/Motors`에 넣고, 모르는 동안은 `valid="false"`로 보내기 (사용자가 전함)
- 서버: `SetSortTarget` 받기, 2차 `Line` (docs/hmi-server-answer-1.md 0장)
- 설비: 그리퍼 카메라가 거의 검게 보이는 이유, 카메라 1·2의 실제 위치 대응
- 상태의 `source`는 확인하는 동안 `equipment`와 `unavailable`을 오갔다. 서버 쪽 작업 중이었던 것으로 보이며 이유는 미확인이다.
- 다음: 서버 담당이 고쳤다고 하면 같은 방법(상태 원문 10초, 장비망 밖 화면)으로 다시 확인

## 관련
- 결정: D-017, D-018
- 이전 기록: HISTORY/2026-10-17-camera-sort-target.md
