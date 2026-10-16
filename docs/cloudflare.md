# 밖에서 여는 HMI (Cloudflare)

장비망 밖에서도 HMI 조작 화면을 열기 위한 구조와 설정 순서입니다. 서버 코드는 바꾸지 않습니다.
도메인은 `hypefree.net`, 화면 주소는 `https://hmi.hypefree.net/`, 터널 주소는 `hmi-origin.hypefree.net`입니다.

## 구조

```text
브라우저 (어디서든)
  │  https://hmi.hypefree.net/
  ▼
Cloudflare Access — 허락한 이메일만 (일회용 코드 로그인)
  ▼
Cloudflare Worker  defect-hmi  (hmi-web-mockup/cloudflare/)
  ├─ /, /assets/…, /tools/…  → 화면 파일 (site/ — 메인 서버 묶음의 wwwroot/와 같음)
  └─ /ws/hmi (웹소켓만)       → https://hmi-origin.hypefree.net/ws/hmi  (서비스 토큰을 붙임)
        ▼
Cloudflare Access — 서비스 토큰만 (없으면 401)
        ▼
Cloudflare Tunnel  defect-hmi
        ▼
cloudflared (장비망 안 PC, 밖으로 나가는 연결만 씀)
        ▼
메인 서버  http://10.108.108.98:5080/ws/hmi  (그대로)
```

- 빌드한 화면은 자기를 내준 주소의 `/ws/hmi`에 붙습니다 (`react/src/server-defaults.js`). 그래서 `wss://hmi.hypefree.net/ws/hmi`로 붙고, 연결 코드는 바꾸지 않았습니다.
- Worker(`worker.js`)는 `/ws/hmi` 웹소켓만 터널로 넘기고, 서버의 다른 경로는 넘기지 않습니다. 사람의 Access 쿠키는 서버로 보내지 않습니다.
- 넘기는 방식: Worker가 서버 쪽 웹소켓을 열고 브라우저 쪽 웹소켓을 따로 받아, 둘 사이에서 메시지와 닫힘을 옮깁니다. 서버의 답(101)을 브라우저에 그대로 돌려주는 방식은 이 PC(`wrangler dev`)에서는 됐지만 Cloudflare에서는 브라우저 쪽이 열리지 않아 버렸습니다 (2026-10-17).
- Worker가 서비스 토큰을 들고 있으므로 화면 주소 앞의 Access 앱이 꼭 있어야 합니다. 같은 이유로 `*.workers.dev`·미리 보기 주소는 열지 않습니다 (`wrangler.jsonc`의 `workers_dev`·`preview_urls`).
- 서버 담당 README도 외부 연결은 VPN이나 인증·TLS를 갖춘 프록시로 제한하라고 합니다 ([server-xml-v1.0.md](server-xml-v1.0.md)). Access와 Cloudflare의 TLS가 그 역할입니다.
- 비용: 모두 무료 플랜입니다. Zero Trust는 Free 플랜도 결제 정보를 넣어야 하지만 청구되지 않습니다.

## 한 번 하는 설정 (Cloudflare 대시보드 — 로그인·토큰이 필요해 사람이 직접)

1. **도메인**: Cloudflare의 Domains 목록에 `hypefree.net`이 Active여야 합니다. `hmi`·`hmi-origin` DNS 레코드는 직접 만들지 않습니다 (터널 route와 Worker 배포가 만듦. `hmi`에 CNAME이 있으면 Worker 연결이 실패).
2. **Zero Trust**: 팀 이름 → Free 플랜 → 결제 정보. 일회용 코드 로그인은 Zero Trust → Integrations → Identity providers → Add new identity provider → One-time PIN으로 더합니다 (처음에는 없음).
3. **장비망 PC 확인** (cloudflared를 돌릴 PC의 PowerShell): `Test-NetConnection region1.v2.argotunnel.com -Port 7844`와 `region2…`가 `True`, `Test-NetConnection 10.108.108.98 -Port 5080`이 `True`. 절전은 "안 함".
4. **터널**: Networking → Tunnels → Create a tunnel(`defect-hmi`) → Windows → 대시보드의 설치 파일과 `cloudflared.exe service install <토큰>`(관리자 권한) → Healthy 확인 → Routes → Add route → Published application: Subdomain `hmi-origin`, Domain `hypefree.net`, Service URL `http://10.108.108.98:5080` (서버 PC에서 돌려도 이 주소 — 서버가 이 주소에만 붙어 있음). 토큰은 어디에도 올리지 않습니다.
5. **서비스 토큰**: Zero Trust → Access controls → Service credentials → Service Tokens → Create Service Token(`defect-hmi-worker`, 1년). Client ID는 `….access`로 끝나고, Client Secret은 이때 한 번만 보입니다 (길이·형식은 Cloudflare가 정함 — 2026-10에 받은 값은 54글자). 잃어버리면 그 토큰의 ⋯ → Rotate secret으로 새로 받습니다 (Client ID와 정책은 그대로). 터널 설치 토큰(`eyJ…`)과 다른 값입니다.
6. **Access 앱 두 개** (첫 배포 전에 — Worker가 토큰을 들고 있으므로): Access controls → Applications → Create new application → Self-hosted and private → Add public hostname. Worker 방식(`+ Workers 추가`, Worker 설정의 Access 켜기)은 웹소켓을 403으로 막으니 쓰지 않습니다.

| | 터널 주소 | 화면 주소 |
|---|---|---|
| 하위 도메인 / 도메인 | `hmi-origin` / `hypefree.net` | `hmi` / `hypefree.net` |
| 정책 | Service Auth · Include Service Token `defect-hmi-worker` | Allow · Include Emails (팀원) |
| 인증 | 그대로 | 모든 ID 공급자 수락 끔, One-time PIN, 즉시 인증 적용 켬 |
| 추가 설정 | App Launcher 표시 끔, 서비스 인증 실패 → 401 응답 반환 켬 | 그대로 |
| 세션 | 24 hours | 24 hours |

## 배포 (이 PC에서)

처음 한 번 패키지를 받고 Cloudflare에 로그인합니다 (브라우저가 열리면 Allow).

```bash
npm --prefix hmi-web-mockup/cloudflare install
cd hmi-web-mockup/cloudflare
npx wrangler login
```

배포는 React 빌드 → `site/` 만들기 → `wrangler deploy`를 한 번에 합니다. 화면이나 `js/`를 고친 뒤에도 이것만 다시 합니다.

```bash
npm --prefix hmi-web-mockup/cloudflare run deploy
```

첫 배포 뒤 서비스 토큰 두 값을 넣습니다. 아래 도구가 값을 화면에 보이지 않게 받아, 모양을 보고(글자 그대로 "Client ID", 터널 토큰 `eyJ…`, 머리말까지 복사한 값은 거절) 터널 주소의 Access에 먼저 시험한 뒤 통과하면 Worker 비밀값으로 넣습니다. 토큰을 새로 만들거나 비밀을 회전하면 다시 실행합니다.

```bash
python hmi-web-mockup/cloudflare/set-token.py
```

- 대시보드(Workers & Pages → `defect-hmi` → 설정 → 변수 및 비밀)에서 넣어도 됩니다. 이름은 `CF_ACCESS_CLIENT_ID` · `CF_ACCESS_CLIENT_SECRET`, 유형은 **비밀**, 값 칸에는 실제 값만 넣습니다 (2026-10-17에 값 칸에 "Client ID"라는 글자와 터널 토큰이 들어가 401이 났음).
- 비밀값은 다시 배포해도 남습니다. 넣을 때마다 새 판이 배포됩니다.
- 열려 있던 화면은 새로 고침해야 새 판이 뜹니다.
- `wrangler`는 `package.json`에 정확한 판(4.147.0)으로 고정했습니다.

## 이 PC에서 시험 (wrangler dev)

터널 대신 시험용 XML 서버에 붙여 Worker의 웹소켓 중계를 봅니다. `.dev.vars.example`을 `.dev.vars`로 복사하고(저장소에 안 올라감) 두 서버를 띄웁니다 (미리보기 설정 `xml-server`, `hmi-cloudflare-dev`).

```bash
python hmi-web-mockup/tests/xml-server.py 5080 --simulation
```

```bash
npm --prefix hmi-web-mockup/cloudflare run dev
```

`http://localhost:8787/`을 열면 조작 화면이 `ws://localhost:8787/ws/hmi` → Worker → 시험용 서버로 붙습니다. 점검 페이지는 `.html`을 뗀 주소(`/tools/devices`)로 옮겨 갑니다 (Cloudflare 정적 파일의 기본 동작).

## 확인

- 장비망 밖(휴대폰 데이터 등)에서 `https://hmi.hypefree.net/` → 이메일 → 받은 코드 → 조작 화면. 서버 연결 표시가 초록이고 상태가 "상태 미수신"이면 됩니다 (서버 v1.0은 `Line`을 보내지 않음).
- `https://hmi-origin.hypefree.net/`은 401이어야 합니다 (서비스 토큰 없이는 못 들어감).

## 안 될 때

화면은 뜨는데 서버 끊김이면, `hmi-web-mockup/cloudflare`에서 `npx wrangler tail`로 Worker 기록을 켜고 화면을 새로 고쳐 `/ws/hmi`의 답 코드를 봅니다 (값·쿠키는 출력하지 않도록 경로와 코드만 보세요).

| 보이는 것 | 볼 곳 |
|---|---|
| 터널이 Healthy가 아님 | 장비망이 7844를 막음, 그 PC의 인터넷, cloudflared 서비스가 꺼짐 |
| `/ws/hmi`가 101 | 정상 (웹소켓이 서버까지 붙음) |
| `/ws/hmi`가 500 | 서비스 토큰을 안 넣음 → `set-token.py` |
| `/ws/hmi`가 401 | 터널 주소의 Access가 토큰을 거절 — 값이 틀림(글자 그대로·터널 토큰·다른 토큰) → `set-token.py`, 또는 `hmi-origin` 정책이 Service Auth · `defect-hmi-worker`가 아님 |
| `/ws/hmi`가 502 | 토큰은 통과, 터널 너머 서버가 답하지 않음 — 서버가 꺼짐·주소가 바뀜. cloudflared를 돌리는 PC에서 `Test-NetConnection 10.108.108.98 -Port 5080` |
| 서버가 웹소켓을 400으로 거절 | 터널 route의 Additional application settings → HTTP Settings → HTTP Host Header를 `10.108.108.98:5080`으로 |
| Worker 배포가 사용자 지정 도메인에서 실패 | `hmi.hypefree.net`에 이미 DNS 레코드(CNAME)가 있음 → 지우고 다시 배포 |
| 로그인 화면이 다시 뜸 | Access 세션(24시간)이 끝남 → 새로 고침해서 다시 로그인 |

## 제한

- cloudflared를 돌리는 PC가 꺼지면 화면은 뜨지만 서버 끊김으로 나옵니다. 인터넷이 끊기면 밖에서 열 수 없습니다 — 장비망 안에서는 지금처럼 `ws://10.108.108.98:5080/ws/hmi`로 바로 붙습니다 (`tools/dev-server.py`, `?mock=0&ws=…`).
- 화면 긴급정지가 인터넷을 한 번 더 거칩니다. 화면 긴급정지는 원래도 서버를 거쳐 믿을 수 없는 것으로 두고, 서버가 끊기면 DC 전원 분리를 안내합니다.
- 원점은 브라우저 저장소에 주소별로 저장되어, `https://hmi.hypefree.net`에서 잡은 원점은 다른 주소(8080 등)로 연 HMI와 따로입니다 (D-014).
- 카메라 영상처럼 웹소켓이 아닌 경로를 서버에서 받게 되면 Worker가 그 경로도 넘기게 고쳐야 합니다 (지금은 `/ws/hmi`만).
- 서비스 토큰은 1년으로 만들었습니다. 끝나기 전에 Refresh(기한 연장)하거나, 새로 만들어 `set-token.py`로 다시 넣습니다.
