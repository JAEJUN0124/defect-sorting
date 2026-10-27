// 밖에서 여는 HMI (Cloudflare Worker). 화면 파일(site/)은 Cloudflare가 바로 내주고, 파일이 아닌 요청만 여기로 온다.
// /ws/hmi 웹소켓과 카메라 영상 세 경로(/video/status · /video/1.mjpg · /video/2.mjpg)만 터널 주소(ORIGIN, Access 서비스 토큰이 있어야 통과)로
// 넘긴다 — 메인 서버의 다른 경로는 밖에 열지 않는다.
// 화면 주소 앞에는 사람용 Access를 두지 않는다 (사용자 2026-10-27): 누구나 열어 모든 조작을 쓰고, 로그인(공용 비밀번호 하나)은 원점 잡기에만 쓴다.
// 원점은 이 Worker(KV) 한 곳에 두고, 원점 복귀(Home)의 각도가 저장된 원점과 다르면 서버로 넘기지 않는다 —
// 로그인하지 않고는 원점 값을 바꾸지 못하게. 그 밖의 명령은 그대로 넘긴다 (docs/cloudflare.md)
import '../js/xml.js'; // globalThis.HmiXml — 화면과 같은 XML 읽기·쓰기 (DOMParser 없이)
import '../js/home.js'; // globalThis.HmiHome.valid · JOINTS — 화면과 같은 원점 모양 검사

const WS_PATH = '/ws/hmi';
// 브릿지 서버의 카메라 영상 (서버 담당 안내 2026-10-17): 수신 상태(JSON)와 MJPEG 두 개. 화면과 같은 주소라 브라우저가 상태 JSON을 막지 않는다
const VIDEO_PATHS = new Set(['/video/status', '/video/1.mjpg', '/video/2.mjpg']);
const HOME_PATH = '/home';
const SESSION_COOKIE = 'hmi_session';
const SESSION_SECONDS = 24 * 60 * 60; // 로그인 유지 24시간 — 전에 화면 주소 앞에 있던 Access 세션과 같다
const HOME_KEY = 'home';
const ANGLE_LIMIT = 360; // 저장할 원점 각도의 범위(±) — 서버는 원점 각도의 범위를 보지 않는다
const MAX_MESSAGE = 64 * 1024; // 브라우저 메시지 하나의 최대 길이 (HMI가 보내는 것은 1KB 안팎)
const MAX_PASSWORD = 256;

const X = () => globalThis.HmiXml;
const H = () => globalThis.HmiHome;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === WS_PATH) return proxyWebSocket(request, env, url);
    if (VIDEO_PATHS.has(url.pathname)) return proxyVideo(request, env, url);
    const auth = AUTH_ROUTES.get(url.pathname);
    if (auth) return auth(request, env);
    if (url.pathname === HOME_PATH) return home(request, env);
    return env.ASSETS.fetch(request); // 없는 파일 → 404
  },
};

const missingConfig = (env) => (!env.ORIGIN || !env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET
  ? new Response('Worker 설정이 비어 있습니다 (ORIGIN · CF_ACCESS_CLIENT_ID · CF_ACCESS_CLIENT_SECRET)', { status: 500 })
  : null);

// 사람의 쿠키와 Cloudflare 머리글은 넘기지 않고, 필요한 것과 서비스 토큰만 붙인다
const tokenHeaders = (env, extra) => new Headers(Object.assign({
  'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
  'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
}, extra));

// 서버(터널 주소) 쪽 웹소켓을 Worker가 열고, 브라우저 쪽 웹소켓은 따로 받아 둘 사이에 메시지를 옮긴다 (Cloudflare 문서의 방식).
// 서버의 답(101)을 브라우저에 그대로 돌려주는 방식은 이 PC(wrangler dev)에서는 됐지만 Cloudflare에서는 브라우저 쪽이 열리지 않았다 (2026-10-17).
// 서버가 101이 아닌 답(토큰이 틀려 401, 서버가 꺼져 502 등)을 주면 그 답이 그대로 가서 HMI는 끊김으로 보고 다시 붙는다.
// 브라우저 → 서버 메시지는 screenMessage를 거친다 (원점 복귀 각도 검사)
export async function proxyWebSocket(request, env, url) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('웹소켓 연결만 받습니다', { status: 426, headers: { Upgrade: 'websocket' } });
  }
  const bad = missingConfig(env);
  if (bad) return bad;
  const target = new URL(WS_PATH + url.search, env.ORIGIN);
  const headers = tokenHeaders(env, { Upgrade: 'websocket' });
  const protocol = request.headers.get('Sec-WebSocket-Protocol');
  if (protocol) headers.set('Sec-WebSocket-Protocol', protocol);
  const upstream = await fetch(target, { headers });
  const server = upstream.webSocket;
  if (!server) return upstream;

  const pair = new WebSocketPair();
  const [client, worker] = Object.values(pair);
  server.accept();
  worker.accept();
  relay(server, worker);
  relay(worker, server, (data) => screenMessage(data, env));
  const chosen = upstream.headers.get('Sec-WebSocket-Protocol');
  return new Response(null, { status: 101, webSocket: client, headers: chosen ? { 'Sec-WebSocket-Protocol': chosen } : {} });
}

// 한쪽에서 온 메시지와 닫힘을 다른 쪽으로 옮긴다. 1005·1006·1015는 보낼 수 없는 닫힘 코드라 1000으로 바꾼다.
// check가 있으면 메시지마다 check의 결과대로 넘기거나({ forward }) 보낸 쪽에 답을 돌려준다({ reply }).
// check는 기다릴 수 있어(KV 읽기) 메시지를 온 차례대로 처리하고, 닫힘도 앞 메시지를 다 넘긴 뒤에 넘긴다
export function relay(from, to, check) {
  let queue = Promise.resolve();
  const inTurn = (fn) => { queue = queue.then(fn).catch(() => { /* 한 메시지의 실패가 뒤 메시지를 막지 않게 */ }); };
  const send = (socket, data) => { try { socket.send(data); } catch (err) { /* 그쪽이 이미 닫힘 */ } };
  const closeOther = (e) => {
    const code = [1005, 1006, 1015].includes(e.code) || !e.code ? 1000 : e.code;
    try { to.close(code, e.reason || ''); } catch (err) { /* 이미 닫힘 */ }
  };
  from.addEventListener('message', (e) => {
    if (!check) { send(to, e.data); return; }
    inTurn(async () => {
      const r = await check(e.data);
      if (r.reply !== undefined) send(from, r.reply);
      else send(to, r.forward);
    });
  });
  from.addEventListener('close', (e) => (check ? inTurn(() => closeOther(e)) : closeOther(e)));
  from.addEventListener('error', () => { try { to.close(1011, 'relay error'); } catch (err) { /* 이미 닫힘 */ } });
}

// 카메라 영상: 서버의 답을 그대로 돌려준다 — MJPEG는 몸통이 흐르는 대로 브라우저에 간다 (Worker가 프레임마다 일하지 않음).
// 주소 뒤 ?t=… (다시 열기용, 안내 5장)는 그대로 넘긴다
export function proxyVideo(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('GET만 받습니다', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const bad = missingConfig(env);
  if (bad) return bad;
  const target = new URL(url.pathname + url.search, env.ORIGIN);
  return fetch(target, { method: request.method, headers: tokenHeaders(env, { Accept: request.headers.get('Accept') || '*/*' }) });
}

// ---------- 원점 복귀 각도 검사 (브라우저 → 서버) ----------

const lower = (v) => String(v === undefined || v === null ? '' : v).trim().toLowerCase();
// 서버가 이름의 대소문자·앞뒤 공백을 너그럽게 읽을 수도 있어, 검사할 것을 찾을 때는 그렇게 본다
const attrOf = (node, name) => {
  const key = Object.keys(node.attrs).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : node.attrs[key];
};
const isNamed = (node, name) => lower(node.name) === name;
function walk(node, fn) {
  fn(node);
  node.children.forEach((c) => walk(c, fn));
}

// 원점 복귀 하나가 저장된 원점과 같은지 — 문제가 있으면 거절 코드. 이름만 보낸 것(각도 없음)은 그대로 넘긴다.
// 각도를 붙였으면 화면이 보내는 모양(js/xml-protocol.js motorsOf)이어야 한다: <Motors> 하나에 모터 1~6이 하나씩, 단위와 값(소수 둘째 자리)이 같음
function homeProblem(cmd, saved) {
  if (!cmd.children.length && !cmd.text.trim()) return null;
  if (!saved) return 'HomeNotSet';
  const motors = cmd.children[0];
  if (cmd.text.trim() || cmd.children.length !== 1 || !isNamed(motors, 'motors') || motors.text.trim()) return 'HomeMismatch';
  const JOINTS = H().JOINTS;
  if (motors.children.length !== JOINTS.length) return 'HomeMismatch';
  const seen = new Set();
  for (const m of motors.children) {
    const id = Number(lower(attrOf(m, 'id')));
    const angle = m.children[0];
    if (!isNamed(m, 'motor') || m.text.trim() || m.children.length !== 1 || !isNamed(angle, 'angle') || angle.children.length) return 'HomeMismatch';
    if (!Number.isInteger(id) || id < 1 || id > JOINTS.length || seen.has(id)) return 'HomeMismatch';
    seen.add(id);
    const joint = JOINTS[id - 1];
    const unit = saved.units[joint] === 'pct' ? 'percent' : 'deg';
    const want = Math.round(saved.angles[joint] * 100) / 100;
    const text = angle.text.trim();
    const got = Number(text);
    if (lower(attrOf(angle, 'unit')) !== unit || !text || !Number.isFinite(got) || Math.abs(got - want) > 0.005) return 'HomeMismatch';
  }
  return null;
}

const DETAIL = {
  HomeMismatch: 'Home angles differ from the saved home. Reload the HMI and try again.',
  HomeNotSet: 'No home is saved. Log in and set the home first.',
};

// 서버의 Reply 모양(docs/server-xml-v1.0.md)으로 거절을 돌려준다 — 화면은 서버의 거절처럼 그 버튼 아래에 이유를 쓴다
function rejectHome(msg, code) {
  const { el, stringify, attr } = X();
  const id = attr(msg, 'id');
  const version = attr(msg, 'version') || '1.0';
  if (!id) return errorMessage(version, code, DETAIL[code]);
  return stringify(el('Message', { version, type: 'Reply', timestamp: new Date().toISOString(), id }, [
    el('Reply', { command: 'Home', result: 'Rejected', code, executed: 'false' }, [el('Detail', null, DETAIL[code])]),
  ]));
}

const errorMessage = (version, code, text) => X().stringify(X().el('Message', { version, type: 'Error', timestamp: new Date().toISOString() }, [
  X().el('Error', { code }, text),
]));

// 브라우저에서 온 메시지 하나 → { forward: 서버로 넘길 글 } 또는 { reply: 브라우저에 돌려줄 답 }.
// 읽은 XML을 다시 써서 넘긴다 — 서버가 받는 것이 여기서 검사한 그대로가 되도록. 읽지 못한 글 · 바이너리 · 너무 긴 글은 넘기지 않는다
export async function screenMessage(data, env) {
  if (typeof data !== 'string') return { reply: errorMessage('1.0', 'InvalidRequest', 'Binary frames are not accepted.') };
  if (data.length > MAX_MESSAGE) return { reply: errorMessage('1.0', 'InvalidRequest', 'Message is too large.') };
  let msg;
  try { msg = X().parse(data); } catch (err) { return { reply: errorMessage('1.0', 'InvalidXml', 'Message could not be read.') }; }
  const homes = [];
  walk(msg, (n) => { if (isNamed(n, 'command') && lower(attrOf(n, 'name')) === 'home') homes.push(n); });
  if (homes.length) {
    const saved = await storedHome(env); // KV가 없으면(설정 빠짐) 없는 원점으로 — 각도를 붙인 원점 복귀는 넘기지 않는다
    for (const cmd of homes) {
      const code = homeProblem(cmd, saved);
      if (code) return { reply: rejectHome(msg, code) };
    }
  }
  return { forward: X().stringify(msg) };
}

// ---------- 로그인 (공용 비밀번호 하나 — 로그인으로 바뀌는 것은 원점 잡기뿐) ----------

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers),
});
const iso = (sec) => new Date(sec * 1000).toISOString();
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hmacKey = (secret) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const cookie = (value, maxAge) => SESSION_COOKIE + '=' + value + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; Secure; SameSite=Strict';
const SESSION_RE = new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=(\\d{1,12})\\.([A-Za-z0-9_-]{43})(?:;|$)');

// 요청 몸통(JSON)을 읽는다. 4KB가 넘거나 JSON이 아니면 null — 로그인·원점 저장은 몇백 바이트다
async function readJson(request, max = 4096) {
  if (Number(request.headers.get('Content-Length') || 0) > max) return null;
  try {
    const text = await request.text();
    return text.length > max ? null : JSON.parse(text);
  } catch (err) { return null; }
}

// 값을 바꾸는 요청(로그인 · 로그아웃 · 원점 저장)은 이 화면이 보낸 것만 받는다: JSON이어야 하고(다른 사이트의 폼으로는 못 보냄),
// 브라우저가 다른 사이트에서 왔다고 알리면(Sec-Fetch-Site) 거절한다. 로그인 쿠키도 SameSite=Strict라 다른 사이트의 요청에는 붙지 않는다
function fromThisPage(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return false;
  return (request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json');
}

// 로그인 쿠키: "<끝나는 시각(초)>.<서명>" — 저장해 두는 것 없이 SESSION_KEY로 서명만 확인한다.
// 비밀번호를 바꾸면(set-password.py가 SESSION_KEY도 새로 만듦) 전에 받은 쿠키는 모두 무효가 된다
async function newSession(env, now = Date.now()) {
  const until = Math.floor(now / 1000) + SESSION_SECONDS;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_KEY), enc.encode('session:' + until));
  return { value: until + '.' + b64url(sig), until };
}

export async function readSession(request, env, now = Date.now()) {
  if (!env.SESSION_KEY) return null;
  const m = SESSION_RE.exec(request.headers.get('Cookie') || '');
  if (!m) return null;
  const until = Number(m[1]);
  if (until * 1000 <= now) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_KEY), fromB64url(m[2]), enc.encode('session:' + until));
  return ok ? { until } : null;
}

// 비밀번호 비교: 두 값의 HMAC을 견주어(crypto.subtle.verify) 걸린 시간으로 비밀번호를 알아낼 수 없게 한다
async function samePassword(env, given) {
  const key = await hmacKey(env.SESSION_KEY);
  const want = await crypto.subtle.sign('HMAC', key, enc.encode('password:' + env.HMI_PASSWORD));
  return crypto.subtle.verify('HMAC', key, want, enc.encode('password:' + given));
}

// 지금 로그인했는지. 화면은 이 주소가 JSON으로 답하면 로그인이 있는 HMI(밖 주소)로 안다 (js/auth.js)
async function session(request, env) {
  if (request.method !== 'GET') return json({ error: 'METHOD' }, 405, { Allow: 'GET' });
  const s = await readSession(request, env);
  return json({ loggedIn: !!s, until: s ? iso(s.until) : null });
}

async function login(request, env) {
  if (request.method !== 'POST') return json({ error: 'METHOD' }, 405, { Allow: 'POST' });
  if (!fromThisPage(request)) return json({ error: 'FORBIDDEN' }, 403);
  if (!env.HMI_PASSWORD || !env.SESSION_KEY) return json({ error: 'NOT_CONFIGURED' }, 500);
  // 비밀번호 맞히기를 늦춘다: 한 IP에서 60초에 5번까지 (wrangler.jsonc ratelimits — Cloudflare 위치마다 따로 세는 대략의 제한)
  if (env.LOGIN_LIMIT) {
    const { success } = await env.LOGIN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!success) return json({ error: 'TOO_MANY' }, 429, { 'Retry-After': '60' });
  }
  const body = await readJson(request); // 읽지 못하면 아래에서 틀린 비밀번호로
  const given = body && typeof body.password === 'string' ? body.password : '';
  if (!given || given.length > MAX_PASSWORD || !(await samePassword(env, given))) return json({ error: 'WRONG_PASSWORD' }, 401);
  const s = await newSession(env);
  return json({ loggedIn: true, until: iso(s.until) }, 200, { 'Set-Cookie': cookie(s.value, SESSION_SECONDS) });
}

// 로그아웃: 이 브라우저의 쿠키를 지운다. 서명만 보는 쿠키라, 다른 곳에 남은 쿠키까지 막으려면 비밀번호를 바꾼다 (set-password.py)
async function logout(request) {
  if (request.method !== 'POST') return json({ error: 'METHOD' }, 405, { Allow: 'POST' });
  if (!fromThisPage(request)) return json({ error: 'FORBIDDEN' }, 403);
  return json({ loggedIn: false, until: null }, 200, { 'Set-Cookie': cookie('', 0) });
}

const AUTH_ROUTES = new Map([['/auth/session', session], ['/auth/login', login], ['/auth/logout', logout]]);

// ---------- 원점 (누구나 읽고 — 원점 복귀가 이 값을 보냄 — 로그인한 사람만 바꾼다) ----------

// 화면과 같은 검사(home.js valid)에 각도 범위를 더한다
function homeValue(raw) {
  const h = H().valid(raw);
  return h && H().JOINTS.every((j) => Math.abs(h.angles[j]) <= ANGLE_LIMIT) ? h : null;
}

async function storedHome(env) {
  if (!env.HOME) return null;
  try { return H().valid(await env.HOME.get(HOME_KEY, 'json')); } catch (err) { return null; }
}

async function home(request, env) {
  if (!env.HOME) return json({ error: 'NOT_CONFIGURED' }, 500);
  if (request.method === 'GET') return json({ home: await storedHome(env) });
  if (request.method !== 'PUT') return json({ error: 'METHOD' }, 405, { Allow: 'GET, PUT' });
  if (!fromThisPage(request)) return json({ error: 'FORBIDDEN' }, 403);
  if (!(await readSession(request, env))) return json({ error: 'LOGIN_REQUIRED' }, 401);
  const body = await readJson(request); // 읽지 못하면 아래에서 틀린 값으로
  const h = homeValue(body && body.home);
  if (!h) return json({ error: 'INVALID_HOME' }, 400);
  h.setAt = new Date().toISOString(); // 저장 시각은 Worker 시계로
  await env.HOME.put(HOME_KEY, JSON.stringify(h));
  return json({ home: h });
}
