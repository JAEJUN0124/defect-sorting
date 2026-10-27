# 밖에서 여는 HMI (Cloudflare)

장비망 밖에서도 HMI 조작 화면을 열기 위한 구조와 설정 순서입니다. 서버 코드는 바꾸지 않습니다.
도메인은 `hypefree.net`, 화면 주소는 `https://hmi.hypefree.net/`, 터널 주소는 `hmi-origin.hypefree.net`입니다.

화면 주소는 로그인 없이 열리고 모든 기능을 씁니다. 로그인(팀 공용 비밀번호 하나)으로 바뀌는 것은 **원점 잡기**뿐입니다 (사용자 2026-10-27).
전에는 화면 주소 앞에 Cloudflare Access(허락한 이메일 + 일회용 코드)를 두었습니다.

## 구조

```text
브라우저 (어디서든, 로그인 없이)
  │  https://hmi.hypefree.net/
  ▼
Cloudflare Worker  defect-hmi  (hmi-web-mockup/cloudflare/)
  ├─ /, /assets/…, /tools/…  → 화면 파일 (site/ — 메인 서버 묶음의 wwwroot/와 같음)
  ├─ /auth/session · /auth/login · /auth/logout
  │                           → 로그인 (공용 비밀번호, 쿠키 24시간)
  ├─ /home (GET 누구나 · PUT 로그인만)
  │                           → 원점 (KV HOME — 이 주소로 연 모든 HMI가 같은 원점)
  ├─ /ws/hmi (웹소켓만)       → https://hmi-origin.hypefree.net/ws/hmi  (서비스 토큰을 붙임)
  │                             원점 복귀 각도가 저장된 원점과 다르면 넘기지 않고 거절을 돌려줌
  └─ /video/status, /video/1.mjpg, /video/2.mjpg (GET·HEAD만)
                              → https://hmi-origin.hypefree.net/video/…  (서비스 토큰을 붙임, 2026-10-17)
        ▼
Cloudflare Access — 서비스 토큰만 (없으면 401)
        ▼
Cloudflare Tunnel  defect-hmi
        ▼
cloudflared (장비망 안 PC, 밖으로 나가는 연결만 씀)
        ▼
메인 서버  http://192.168.219.101:8000/ws/hmi  (그대로)
```

- 빌드한 화면은 자기를 내준 주소의 `/ws/hmi`에 붙습니다 (`react/src/server-defaults.js`). 그래서 `wss://hmi.hypefree.net/ws/hmi`로 붙고, 연결 코드는 바꾸지 않았습니다.
- Worker(`worker.js`)는 `/ws/hmi` 웹소켓과 카메라 영상 세 경로(서버 담당 안내 [hmi-video-integration.md](hmi-video-integration.md))만 터널로 넘기고, 서버의 다른 경로(`/`, 영상 확인 화면 `/video` 등)는 넘기지 않습니다. 사람의 Access 쿠키는 서버로 보내지 않습니다.
- 영상도 같은 주소(`https://hmi.hypefree.net/video/…`)로 받으므로, 서버에 CORS가 없어도 브라우저가 상태 JSON을 막지 않습니다 (안내 8장). Worker는 서버의 답을 그대로 돌려주어 MJPEG를 쌓아 두지 않고 흘려 보냅니다.
- 넘기는 방식: Worker가 서버 쪽 웹소켓을 열고 브라우저 쪽 웹소켓을 따로 받아, 둘 사이에서 메시지와 닫힘을 옮깁니다. 서버의 답(101)을 브라우저에 그대로 돌려주는 방식은 이 PC(`wrangler dev`)에서는 됐지만 Cloudflare에서는 브라우저 쪽이 열리지 않아 버렸습니다 (2026-10-17).
- Worker가 서비스 토큰을 들고 있어, 화면 주소를 아는 사람은 누구나 Worker를 거쳐 서버에 붙습니다. 시작·정지·긴급정지·운전 모드·옮길 부품·원점 복귀는 로그인 없이 서버로 갑니다 (사용자 2026-10-27 — 로그인으로 바뀌는 것은 원점 잡기뿐).
- 원점 값은 로그인한 사람만 바꿉니다. 원점 잡기는 서버에 보내지 않고 Worker(KV)에 저장하므로, Worker는 원점 저장(`PUT /home`)에 로그인 쿠키를 요구하고, 원점 복귀(`Home`)의 각도가 저장된 원점과 다르면 서버로 넘기지 않습니다 — 웹소켓에 직접 붙어 아무 각도나 보내는 것도 막힙니다 (서버는 원점 각도의 범위를 보지 않음). 각도 없이 이름만 보낸 원점 복귀와 다른 명령은 그대로 넘깁니다.
- 브라우저 → 서버 메시지는 Worker가 XML로 읽고 다시 써서 넘깁니다 — 서버가 받는 글이 Worker가 검사한 글과 같도록. 읽지 못한 글·바이너리·64KB가 넘는 글은 넘기지 않고 `Error`를 돌려줍니다.
- 로그인: 비밀번호는 Worker 비밀값 `HMI_PASSWORD`, 쿠키(`hmi_session`, HttpOnly·Secure·SameSite=Strict, 24시간)는 `SESSION_KEY`로 서명만 하고 저장하지 않습니다. 로그인 시도는 한 IP에서 60초에 5번까지입니다(`LOGIN_LIMIT`).
- 주소는 하나로 둡니다 — `*.workers.dev`·미리 보기 주소는 열지 않습니다 (`wrangler.jsonc`의 `workers_dev`·`preview_urls`).
- 검색: `/robots.txt`가 모든 경로를 막고(`react/public/robots.txt`), 조작 화면에 `noindex`를 둡니다 (사용자 2026-10-28). 지키는 검색 로봇만 따르는 약속이라 접속을 막지는 못합니다 — 인증서 공개 기록(Certificate Transparency)에 `hmi.hypefree.net`이 실려, 주소를 모아 두드려 보는 로봇은 찾아옵니다.
- 서버 담당 README는 외부 연결을 VPN이나 인증·TLS를 갖춘 프록시로 제한하라고 합니다 ([server-xml-v1.0.md](server-xml-v1.0.md)). 화면 주소의 Access를 없애면 이 권고와 다르므로 서버 담당에게 알립니다. 터널 주소의 Access(서비스 토큰만)와 Cloudflare의 TLS는 그대로입니다.
- 비용: 모두 무료 플랜입니다. Zero Trust는 Free 플랜도 결제 정보를 넣어야 하지만 청구되지 않습니다.

## 한 번 하는 설정 (Cloudflare 대시보드 — 로그인·토큰이 필요해 사람이 직접)

1. **도메인**: Cloudflare의 Domains 목록에 `hypefree.net`이 Active여야 합니다. `hmi`·`hmi-origin` DNS 레코드는 직접 만들지 않습니다 (터널 route와 Worker 배포가 만듦. `hmi`에 CNAME이 있으면 Worker 연결이 실패).
2. **Zero Trust**: 팀 이름 → Free 플랜 → 결제 정보. 일회용 코드 로그인은 Zero Trust → Integrations → Identity providers → Add new identity provider → One-time PIN으로 더합니다 (처음에는 없음).
3. **장비망 PC 확인** (cloudflared를 돌릴 PC의 PowerShell): `Test-NetConnection region1.v2.argotunnel.com -Port 7844`와 `region2…`가 `True`, `Test-NetConnection 192.168.219.101 -Port 8000`이 `True`. 절전은 "안 함".
4. **터널**: Networking → Tunnels → Create a tunnel(`defect-hmi`) → Windows → 대시보드의 설치 파일과 `cloudflared.exe service install <토큰>`(관리자 권한) → Healthy 확인 → Routes → Add route → Published application: Subdomain `hmi-origin`, Domain `hypefree.net`, Service URL `http://192.168.219.101:8000` (서버 PC에서 돌려도 이 주소 — 서버가 이 주소에만 붙어 있음). 토큰은 어디에도 올리지 않습니다.
5. **서비스 토큰**: Zero Trust → Access controls → Service credentials → Service Tokens → Create Service Token(`defect-hmi-worker`, 1년). Client ID는 `….access`로 끝나고, Client Secret은 이때 한 번만 보입니다 (길이·형식은 Cloudflare가 정함 — 2026-10에 받은 값은 54글자). 잃어버리면 그 토큰의 ⋯ → Rotate secret으로 새로 받습니다 (Client ID와 정책은 그대로). 터널 설치 토큰(`eyJ…`)과 다른 값입니다.
6. **Access 앱** (첫 배포 전에): Access controls → Applications → Create new application → Self-hosted and private → Add public hostname. Worker 방식(`+ Workers 추가`, Worker 설정의 Access 켜기)은 웹소켓을 403으로 막으니 쓰지 않습니다.
   터널 주소 앱은 계속 둡니다. 화면 주소 앱은 2026-10-27에 로그인으로 바꾸며 지웁니다 — 순서는 아래 "로그인으로 바꾸기"에 있습니다. 아래 표의 화면 주소 칸은 지우기 전 설정입니다.

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

로그인 비밀번호도 같은 방식으로 넣습니다. 아래 도구가 팀이 같이 쓸 비밀번호를 화면에 보이지 않게 두 번 받고(10글자 이상), 쿠키 서명 키(`SESSION_KEY`)를 새로 만들어 `HMI_PASSWORD`와 함께 Worker 비밀값으로 넣습니다. 비밀번호를 바꾸면 전에 로그인한 사람은 모두 다시 로그인해야 합니다.

```bash
python hmi-web-mockup/cloudflare/set-password.py
```

- 원점을 둘 KV(`wrangler.jsonc`의 `kv_namespaces` — 바인딩 `HOME`)는 id를 비워 두어, 첫 배포 때 wrangler가 만들어 붙입니다. 이미 만든 KV를 쓰려면 그 id를 적습니다.
- 로그인 시도 제한(`ratelimits` — `LOGIN_LIMIT`)은 Cloudflare 위치마다 따로 세는 대략의 제한입니다. 무료 플랜에서 되는지는 첫 배포로 확인합니다 (안 되면 배포가 오류를 냄 — 그때는 그 줄을 지우고, 비밀번호를 길게 정합니다).

### 로그인으로 바꾸기 (2026-10-27, 한 번)

화면 주소의 Access를 지우기 전에 새 Worker를 먼저 올리고 확인합니다 — 지운 순간부터 누구나 열 수 있기 때문입니다.

1. `npm --prefix hmi-web-mockup/cloudflare run deploy` (KV가 이때 만들어짐)
2. `python hmi-web-mockup/cloudflare/set-password.py`
3. 아직 Access가 있는 화면 주소에서 확인: 맨 아래 줄 "로그인" → 비밀번호 → 수동 모드에서 원점 잡기 → 로그아웃 → 원점 복귀가 받아짐.
4. Zero Trust → Access controls → Applications에서 **화면 주소(`hmi.hypefree.net`) 앱만** 지웁니다. 터널 주소(`hmi-origin`) 앱은 그대로 둡니다 — 지우면 토큰 없이 서버에 붙을 수 있습니다.
5. 새 시크릿 창에서 `https://hmi.hypefree.net/`이 이메일 확인 없이 열리는지, `https://hmi-origin.hypefree.net/`은 여전히 401인지 봅니다.
6. 원점은 브라우저가 아니라 Worker에 두므로, 전에 브라우저에 저장한 원점은 쓰지 않습니다. 로그인한 사람이 수동 모드에서 원점 잡기를 한 번 합니다.
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
로그인 비밀번호는 `.dev.vars`의 `HMI_PASSWORD`(예시 파일 값 `local-test-password`)이고, 원점 KV와 시도 제한은 이 PC 안에서 흉내 냅니다 (`.wrangler/`).

## 확인

- 장비망 밖(휴대폰 데이터 등)에서 `https://hmi.hypefree.net/` → 조작 화면 (로그인 없이). 서버 연결 표시가 초록이고 상태가 "상태 미수신"이면 됩니다 (서버 v1.0은 `Line`을 보내지 않음).
- 로그인하지 않고 원점 잡기를 누르면 로그인 창이 뜹니다. 로그인하면 맨 아래 키가 "로그아웃"이 되고, 원점 잡기 확인 창에 "이 주소로 여는 모든 HMI가 이 원점을 씁니다"가 보입니다.
- 카메라 연결 → 설비가 영상을 보내는 중이면 탑뷰 영상, 아니면 "설비 영상 연결 대기". "영상 상태 확인 불가"면 아래 표에서 `/video/status`의 답 코드를 봅니다.
- `https://hmi-origin.hypefree.net/`은 401이어야 합니다 (서비스 토큰 없이는 못 들어감).

## 안 될 때

화면은 뜨는데 서버 끊김이면, `hmi-web-mockup/cloudflare`에서 `npx wrangler tail`로 Worker 기록을 켜고 화면을 새로 고쳐 `/ws/hmi`의 답 코드를 봅니다 (값·쿠키는 출력하지 않도록 경로와 코드만 보세요).

| 보이는 것 | 볼 곳 |
|---|---|
| 터널이 Healthy가 아님 | 장비망이 7844를 막음, 그 PC의 인터넷, cloudflared 서비스가 꺼짐 |
| `/ws/hmi`가 101 | 정상 (웹소켓이 서버까지 붙음) |
| `/ws/hmi`가 500 | 서비스 토큰을 안 넣음 → `set-token.py` |
| `/ws/hmi`가 401 | 터널 주소의 Access가 토큰을 거절 — 값이 틀림(글자 그대로·터널 토큰·다른 토큰) → `set-token.py`, 또는 `hmi-origin` 정책이 Service Auth · `defect-hmi-worker`가 아님 |
| `/ws/hmi`가 502 | 토큰은 통과, 터널 너머 서버가 답하지 않음 — 서버가 꺼짐·주소가 바뀜. cloudflared를 돌리는 PC에서 `Test-NetConnection 192.168.219.101 -Port 8000` |
| 서버가 웹소켓을 400으로 거절 | 터널 route의 Additional application settings → HTTP Settings → HTTP Host Header를 `192.168.219.101:8000`으로 |
| 카메라가 "영상 상태 확인 불가" | `/video/status`의 답 코드 — 401·500·502는 `/ws/hmi`와 같은 원인, 404는 서버가 영상 경로를 내주지 않음(영상 기능이 없는 서버 판), 405는 GET·HEAD가 아닌 요청 |
| Worker 배포가 사용자 지정 도메인에서 실패 | `hmi.hypefree.net`에 이미 DNS 레코드(CNAME)가 있음 → 지우고 다시 배포 |
| 이메일 확인(Access) 화면이 뜸 | 화면 주소의 Access 앱이 아직 있음 → "로그인으로 바꾸기" 4번 |
| 로그인 창에 "Worker에 비밀번호가 설정되지 않아…" | `set-password.py`를 안 함 (`/auth/login`이 500 `NOT_CONFIGURED`) |
| 로그인 창에 "시도가 너무 많습니다" | 한 IP에서 60초에 5번을 넘음 → 1분 뒤 다시 |
| 원점 잡기가 "원점을 저장하지 못했습니다" | `/home`의 답 코드 — 500이면 KV가 묶이지 않음(`wrangler.jsonc`의 `kv_namespaces`), 401이면 로그인이 끝남 |
| 원점 복귀가 "저장된 원점이 바뀌어…보내지 않았습니다" | 그 사이 다른 HMI가 원점을 바꿈(또는 다른 Cloudflare 위치에 아직 안 닿음) → 잠시 뒤 다시 누름. 화면은 누를 때마다 Worker의 원점을 다시 읽음 |
| 로그아웃으로 바뀜 | 로그인(24시간)이 끝났거나 비밀번호를 바꿈 → 다시 로그인 |

## 제한

- cloudflared를 돌리는 PC가 꺼지면 화면은 뜨지만 서버 끊김으로 나옵니다. 인터넷이 끊기면 밖에서 열 수 없습니다 — 장비망 안에서는 HMI 담당 PC의 개발용 서버로 엽니다 (`tools/dev-server.py 8080 --host 0.0.0.0 --server http://192.168.219.101:8000`, 주소 `?mock=0&ws=auto` — 카메라까지 같은 주소로 이어짐. [HMI README](../hmi-web-mockup/README.md#실행)).
- 화면 긴급정지가 인터넷을 한 번 더 거칩니다. 화면 긴급정지는 원래도 서버를 거쳐 믿을 수 없는 것으로 두고, 서버가 끊기면 DC 전원 분리를 안내합니다.
- 원점: `https://hmi.hypefree.net`은 Worker(KV) 한 곳에 두어 이 주소로 연 HMI가 모두 같은 원점을 쓰고, 다른 주소(8080 등, 장비망 안)로 연 HMI는 지금처럼 브라우저마다 따로입니다 (D-014). KV는 바뀐 값이 다른 Cloudflare 위치에 늦게 닿을 수 있어, 원점을 바꾼 직후 다른 곳의 원점 복귀가 한 번 거절될 수 있습니다.
- 화면 주소가 공개라, 주소를 아는 사람은 누구나 시작·정지·긴급정지 등을 보내고 카메라 영상을 봅니다 (사용자 2026-10-27의 결정). 로그인으로 막는 것은 원점 값뿐입니다.
- 공용 비밀번호라 누가 원점을 바꿨는지는 남지 않습니다. 로그인 쿠키는 서명만 확인하므로 한 사람만 내보낼 수 없고, 모두를 내보내려면 비밀번호를 바꿉니다(`set-password.py`).
- 보는 사람·검색 로봇이 늘면 Worker 무료 요청 수(아래 카메라 항목)를 같이 씁니다.
- 서버가 다른 HTTP 경로를 더 내주게 되면 Worker가 그 경로도 넘기게 고쳐야 합니다 (`worker.js`의 `VIDEO_PATHS`처럼. 지금은 `/ws/hmi`와 영상 세 경로).
- 카메라를 켠 화면은 1초마다 `/video/status`를 물어, 그때마다 Worker 요청이 하나씩 듭니다 (화면 파일은 Worker를 거치지 않음). 무료 플랜은 하루 요청 수에 한도(Cloudflare 문서 기준 10만 번)가 있어, 화면 하나가 8시간 켜 두면 약 2만 9천 번입니다. 그래서 카메라를 켠 동안만, 탭이 보일 때만 묻습니다.
- MJPEG가 Worker·Tunnel을 거쳐 끊김 없이 흐르는지와 지연은 실제 영상으로 확인하지 않았습니다 (Worker 중계는 시험으로만 확인).
- 서비스 토큰은 1년으로 만들었습니다. 끝나기 전에 Refresh(기한 연장)하거나, 새로 만들어 `set-token.py`로 다시 넣습니다.
