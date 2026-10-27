---
date: 2026-10-28
type: checkpoint
branch: main
items: [server-move, hmi-web]
decisions: [D-017]
corrects: null
source: null
---
# 서버 주소 이전(192.168.219.101:8000)과 터널 route 변경

## 요약
- 사용자가 서버가 `192.168.219.101:8000`으로 옮겨 갔다고 알렸다. 같은 서버(`/ws/hmi` XML)이고 예전 주소 `10.108.108.98:5080`은 쓰지 않는다. 서버는 집 공유기 안에 있고 사용자 PC가 아니다. HMI는 밖(`hmi.hypefree.net`)에서 쓴다.
- 저장소의 지금 쓰는 서버 주소를 바꿨다(`fix/server-address` 8da9626 → main fast-forward): `.claude/launch.json`(`hmi-web-mockup-lan`), docs/cloudflare.md, docs/xml-protocol.md, docs/hmi-server-answer-1.md, hmi-web-mockup/README.md, `tools/dev-server.py` 예시, `cloudflare/wrangler.jsonc` 주석, 시험 예시 주소(config·video).
- Cloudflare 터널 `defect-hmi`의 route `hmi-origin.hypefree.net`을 `http://10.108.108.98:5080` → `http://192.168.219.101:8000`으로 바꿨다(원격 설정 1판 → 2판). HTTP Host Header는 원래 없었다.
- 터널은 `down`이다(붙은 `cloudflared` 없음). 새 서버가 사설 주소라 같은 망 안의 PC(서버 PC 권장)에서 `cloudflared`가 Cloudflare 쪽으로 연결을 열어야 밖에서 붙는다. 서버 PC가 사용자 PC가 아니어서, 서버 담당에게 설치 안내 docs/hmi-server-tunnel.md(ba67a15)를 만들어 보냈다.

## 단계 결과
| 항목 | 로컬 | main | 배포 | 운영검증 |
| --- | --- | --- | --- | --- |
| server-move | 완료 | 완료 | 부분 | 미실행 |

## 근거
- 사용자: "192.168.219.101:8000 서버 주소임", "서버가 192.168.219.101:8000으로 옮겨갔어. 같은 서버(/ws/hmi XML)이고 예전 주소는 안 써", "서버는 집에 있고 외부에서 돌릴건데", "내 pc가 아니라고", "일단 보냈고" (대화, 2026-10-28)
- 직접: 이 PC(새 서버와 다른 사설망 주소)에서 `http://192.168.219.101:8000`의 `/`·`/ws/hmi`·`/video/status`에 curl 응답 없음 — 다른 망 (2026-10-28)
- 직접: 주소 변경 뒤 시험 147/147, `.claude/launch.json` JSON 읽기 정상 (2026-10-28)
- 직접: Cloudflare API(`cfd_tunnel/<터널>/configurations`)로 route를 바꾸고 다시 읽어 `"service": "http://192.168.219.101:8000"`, version 2 확인 (2026-10-28)
- 직접: `wrangler tunnel list`·`wrangler tunnel info defect-hmi` → Status `down`; 이 PC에는 `cloudflared` 서비스가 없음(`sc.exe query cloudflared` 1060) (2026-10-28)

## 조치
- 터널 route는 대시보드가 아니라 Cloudflare API로 바꿨다. wrangler 4.147에는 터널 설정(ingress)을 고치는 명령이 없고(`create·delete·info·list·run·quick-start`만), wrangler 로그인의 `connectivity (admin)` 권한으로 API를 불렀다. 쓴 스크립트는 저장소 밖 임시 파일이고 남기지 않는다. 다시 바꿀 때는 대시보드(Networks → Tunnels → `defect-hmi` → Routes)에서 해도 된다.
- 터널 토큰은 저장소·문서에 쓰지 않았다. 서버 담당에게는 대시보드에서 따로 보내도록 안내했다.

## 시도했다가 버린 방법
- 이 PC에 `cloudflared`를 깔아 터널을 붙이기 → 이 PC가 새 서버와 다른 망이라 서버에 닿지 않음 (직접 2026-10-28 · curl 응답 없음) → 서버 PC(서버 담당)에 설치를 부탁
- 공유기 포트 포워딩으로 서버를 직접 열기 → 서버가 인터넷에 그대로 열려 아무나 붙고, 서버 README의 외부 연결 권고와 다름 (docs/server-xml-v1.0.md) → 터널 유지

## 남은 공백·다음
- 서버 담당의 `cloudflared` 설치 여부와 토큰 전달 여부는 미확인
- 다음: 설치되면 `wrangler tunnel info defect-hmi`로 연결을 보고, 밖 주소로 서버·카메라에 붙는지 확인
- 그대로 둔 예전 주소: docs/hmi-video-integration.md(서버 담당 안내 사본), docs/hmi-server-answer-1.md 6장의 10-17 시험 기록, 기존 HISTORY
- 이전 기준값: 서버 `ws://10.108.108.98:5080/ws/hmi`, 터널 route `http://10.108.108.98:5080`, `cloudflared`는 장비망 안 HMI 담당 PC

## 관련
- 결정: D-017 (터널 방식 그대로, 바꾸지 않음)
