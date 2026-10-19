---
date: 2026-10-19
type: decision
branch: main
items: [hmi-web, api-spec]
decisions: [D-021]
corrects: null
source: null
---
# 컨베이어 벨트 신호는 항상 켜짐 (D-021 추가)

## 요약
- 사용자가 컨베이어 쪽 일이 늦어지니 컨베이어 벨트 신호를 항상 켜짐으로 두고 다른 일을 먼저 진행하자고 정했다. DECISIONS에 D-021로 더했다.
- 그때 실제 서버는 컨베이어를 끊김으로 보내고 있었다(CURRENT 기준 상태 "서버", 2026-10-17 기록). HMI는 이 값을 장치 연결 줄의 불에만 쓰고 이 값으로 키를 막지 않아, HMI 쪽 적용은 장치 연결 줄에 늘 켜짐으로 보이는 것으로 했다 (HISTORY/2026-10-19-conveyor-always-on.md).
- 서버에 보낼 문서(docs/hmi-server-answer-1.md 8장 표)는 장치가 끊기면 시작·원점 복귀를 `DevicesNotReady`로 거절해 달라고 하며 그 장치에 컨베이어가 들어 있다. 이 요청을 고칠지는 이번에 정하지 않았다 — 구현 뒤 다음 단계를 물었을 때 사용자는 요청서도 고친 뒤 합치는 선택지 대신 커밋·main 합치기를 골랐다.

## 근거
- 사용자: "그러면 이제 컨베이어 벨트 신호는 항상 켜짐으로 두자. 컨베이어 관련 좀 늦어져서 그거 말고 다른거 진행좀 하게." (대화, 2026-10-19)
- 사용자: "feature/conveyor-always-on에 커밋하고 main에 fast-forward로 합쳐 줘." (대화, 2026-10-19)

## 관련
- 결정: D-021
- 구현: HISTORY/2026-10-19-conveyor-always-on.md
