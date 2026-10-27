# 서버 PC에 Cloudflare 연결 프로그램(cloudflared) 설치 부탁

- 날짜: 2026-10-28
- 보내는 쪽: HMI 담당
- 받는 쪽: 서버 담당
- 함께 보내는 것: 터널 토큰 (이 문서에는 쓰지 않고 따로 보냄)

서버가 `192.168.219.101:8000`으로 옮겨 가서, 밖에서 HMI(`https://hmi.hypefree.net/`)로 서버에 붙으려면 서버 PC에 `cloudflared`를 하나 깔아 주셔야 합니다.
서버 코드와 공유기 설정은 바꾸지 않습니다.

## 1. 왜 필요한가

- `192.168.219.101`은 집 공유기 안에서만 통하는 주소라, 인터넷에서 바로 찾아갈 수 없습니다. 공유기는 밖에서 먼저 들어오는 연결을 막습니다.
- `cloudflared`는 서버 PC에서 Cloudflare 쪽으로 **나가는** 연결을 열어 둡니다. 밖에서 HMI가 보낸 요청은 Cloudflare가 이 연결로 넘기고, `cloudflared`가 같은 PC의 서버(`http://192.168.219.101:8000`)에 전합니다.
- 공유기 포트 포워딩으로도 되지만, 그러면 서버가 인터넷에 그대로 열려 아무나 붙습니다. 서버 README의 권고(외부 연결은 VPN이나 인증된 프록시로)와도 다릅니다.
- 지금까지는 장비망 안 HMI 담당 PC에서 돌렸습니다. 이제 서버가 그 망에 없어서 서버와 같은 곳에 있어야 합니다.

```text
밖의 브라우저 → hmi.hypefree.net (Cloudflare Worker)
             → hmi-origin.hypefree.net (서비스 토큰이 있어야만 통과)
             → 터널 → [서버 PC] cloudflared → http://192.168.219.101:8000
```

## 2. 해 주실 일 (Windows, 서버 PC에서)

AI에게 맡기셔도 이 순서대로면 끝납니다. **관리자 권한**이 필요해, 설치 창(UAC)의 "예"는 사람이 눌러야 할 수 있습니다.
이 일 말고는 바꾸지 않습니다: 서버 코드·설정, 공유기, 방화벽 규칙은 그대로 둡니다.

1. 미리 확인 (보통 PowerShell). 둘 다 `TcpTestSucceeded : True`여야 합니다.
   ```powershell
   Test-NetConnection region1.v2.argotunnel.com -Port 7844
   Test-NetConnection 192.168.219.101 -Port 8000
   ```
   첫 줄이 `False`면 그 망이 Cloudflare 7844번을 막는 것입니다. 두 번째가 `False`면 서버가 꺼졌거나 주소가 다릅니다. 둘 중 하나라도 `False`면 멈추고 알려 주세요.
2. 설치 (관리자 PowerShell). 둘 중 하나:
   ```powershell
   winget install --id Cloudflare.cloudflared -e
   ```
   또는 https://github.com/cloudflare/cloudflared/releases 의 `cloudflared-windows-amd64.msi`.
   설치한 PowerShell 창에서는 `cloudflared`가 바로 안 잡힐 수 있습니다. 새 창을 열거나, 설치된 `cloudflared.exe`의 전체 경로로 실행합니다 (msi는 보통 `C:\Program Files (x86)\cloudflared\cloudflared.exe`).
3. 서비스 등록 (관리자 PowerShell). `<토큰>`은 따로 보내 드린 값으로 바꿉니다 (`eyJ`로 시작하는 긴 글자 하나, 꺾쇠는 빼고).
   ```powershell
   cloudflared.exe service install <토큰>
   ```
4. 확인. `STATE`가 `RUNNING`이면 끝입니다.
   ```powershell
   sc.exe query cloudflared
   ```
5. HMI 담당에게 "설치 끝"이라고 알려 주세요. 터널이 붙었는지와 밖에서 서버에 닿는지는 HMI 쪽에서 Cloudflare로 확인합니다 (서버 PC에서는 볼 수 없음).

- Windows 서비스라 PC를 켜면 저절로 붙습니다. PC가 꺼지거나 절전에 들어가면 밖에서 끊기니, 쓰는 동안은 절전을 꺼 주세요.
- 서버 PC가 Windows가 아니면 알려 주세요 (macOS·Linux도 같은 토큰으로 설치합니다).
- 3에서 "already installed"가 나오면 전에 깐 것이 있는 것입니다. `cloudflared.exe service uninstall` 뒤에 3을 다시 합니다.
- 지울 때: 관리자 PowerShell에서 `cloudflared.exe service uninstall`.
- 토큰은 문서·코드·대화 기록에 남기지 말아 주세요 (AI에게 줄 때도 실행 한 번에만).

## 3. 서버 PC에서 바뀌는 것과 안 바뀌는 것

| | |
| --- | --- |
| 공유기 | 바꾸지 않음. 포트를 열지 않음 |
| 방화벽 | 들어오는 규칙 필요 없음. Cloudflare 쪽으로 나가는 연결만 씀 (7844번 TCP·UDP) |
| 서버 코드·설정 | 바꾸지 않음 |
| 터널이 닿는 곳 | `http://192.168.219.101:8000` 하나뿐 (집 안 다른 기기로는 가지 않음 — 터널의 사설망 연결은 꺼 둠) |
| 터널로 오는 요청 | HMI 화면 Worker가 `/ws/hmi`(웹소켓)와 영상 세 경로(`/video/status`·`/video/1.mjpg`·`/video/2.mjpg`, GET·HEAD)만 넘김. 터널 주소(`hmi-origin.hypefree.net`)는 Worker의 서비스 토큰 없이는 401 |
| 서버가 받는 `Host` | `hmi-origin.hypefree.net`. 서버가 `Host`를 검사해 웹소켓을 400으로 거절하면 알려 주세요 — 터널에서 `192.168.219.101:8000`으로 바꿔 보낼 수 있습니다 |

## 4. 부탁

- 서버를 지금처럼 `192.168.219.101:8000`에 켜 두세요. 공유기가 IP를 바꿔 줄 수 있으니, 가능하면 공유기에서 서버 PC의 IP를 고정(DHCP 예약)해 주세요. 주소나 포트가 바뀌면 알려 주세요 — 터널 설정을 고쳐야 합니다.
- 토큰은 이 터널에 연결 프로그램을 붙이는 열쇠입니다. 다른 곳에 올리지 말아 주세요. 새어 나갔으면 알려 주세요 — 토큰을 바꾸고 다시 보내 드립니다.
