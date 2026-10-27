// 밖 주소의 로그인 · 원점 시험 (cloudflare/worker.js) — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 화면 주소 앞 Access를 없애고, 로그인(공용 비밀번호 하나)은 원점 잡기에만 쓴다 (사용자 2026-10-27).
// 원점은 Worker(KV) 한 곳에 두고, 원점 복귀 각도가 저장된 원점과 다르면 서버로 넘기지 않는지 본다
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const DIR = path.join(__dirname, '..', 'cloudflare');
const loadModule = () => import(pathToFileURL(path.join(DIR, 'worker.js')).href);
const loadWorker = () => loadModule().then((m) => m.default);

const ENV = { ORIGIN: 'https://hmi-origin.example.net', CF_ACCESS_CLIENT_ID: 'id-1', CF_ACCESS_CLIENT_SECRET: 'secret-1' };
const PASSWORD = 'correct horse battery';
const POSE = { shoulder_pan: 12.345, shoulder_lift: -20, elbow_flex: 30.5, wrist_flex: -4, wrist_roll: 0, gripper: 10 };
const UNITS = { gripper: 'pct' };

// KV 흉내: get(key, 'json') · put(key, text)
function fakeKV(home) {
  const map = new Map(home ? [['home', JSON.stringify(home)]] : []);
  return {
    map,
    get: async (k, type) => (map.has(k) ? (type === 'json' ? JSON.parse(map.get(k)) : map.get(k)) : null),
    put: async (k, v) => { map.set(k, String(v)); },
  };
}

// 화면 파일(ASSETS)과 바깥으로 나가는 fetch는 기록만 한다 — 로그인 · 원점 요청은 어느 쪽에도 가지 않아야 한다
function setup(t, extra = {}) {
  const calls = { assets: [], fetch: [] };
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.fetch.push(String(url)); return new Response('upstream'); };
  t.after(() => { globalThis.fetch = real; });
  const env = {
    ...ENV, HMI_PASSWORD: PASSWORD, SESSION_KEY: 'session-key-for-tests', HOME: fakeKV(),
    ASSETS: { fetch: async (req) => { calls.assets.push(new URL(req.url).pathname); return new Response('file'); } },
    ...extra,
  };
  return { env, calls };
}

const post = (p, body, headers = {}) => new Request('https://hmi.example.net' + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const put = (body, headers = {}) => new Request('https://hmi.example.net/home', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers },
  body: JSON.stringify(body),
});
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

test('로그인: 로그인 전 false → 맞는 비밀번호면 24시간 쿠키(HttpOnly · Secure · SameSite=Strict) → 그 쿠키로 true → 로그아웃은 쿠키를 지움', async (t) => {
  const worker = await loadWorker();
  const { env, calls } = setup(t);
  const session = (headers) => worker.fetch(new Request('https://hmi.example.net/auth/session', { headers }), env);
  const before = await session();
  assert.equal(before.status, 200);
  assert.match(before.headers.get('content-type'), /application\/json/);
  assert.equal(before.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await before.json(), { loggedIn: false, until: null });

  const t0 = Date.now();
  const res = await worker.fetch(post('/auth/login', { password: PASSWORD }), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.loggedIn, true);
  const hours = (Date.parse(body.until) - t0) / 3600e3;
  assert.ok(hours > 23.9 && hours <= 24, String(hours));
  const set = res.headers.get('set-cookie');
  ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=86400'].forEach((a) => assert.ok(set.includes(a), a));
  assert.ok(!set.includes(PASSWORD)); // 쿠키에 비밀번호를 넣지 않는다

  const after = await (await session({ Cookie: 'other=1; ' + cookieOf(res) })).json();
  assert.equal(after.loggedIn, true);
  assert.equal(after.until, body.until);

  const out = await worker.fetch(post('/auth/logout', {}), env);
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /^hmi_session=; .*Max-Age=0/);
  assert.deepEqual(calls, { assets: [], fetch: [] });
});

test('로그인: 틀린 · 빈 · 너무 긴 비밀번호는 401, JSON이 아니거나 다른 사이트에서 온 요청은 403, 맞지 않는 방식은 405, 비밀번호를 안 넣었으면 500', async (t) => {
  const worker = await loadWorker();
  const { env } = setup(t);
  const status = async (req, e = env) => (await worker.fetch(req, e)).status;
  assert.equal(await status(post('/auth/login', { password: 'wrong password' })), 401);
  assert.equal(await status(post('/auth/login', { password: '' })), 401);
  assert.equal(await status(post('/auth/login', {})), 401);
  assert.equal(await status(post('/auth/login', '{망가짐')), 401);
  assert.equal(await status(post('/auth/login', { password: PASSWORD + 'x'.repeat(300) })), 401);
  assert.equal(await status(post('/auth/login', { password: PASSWORD, pad: 'x'.repeat(5000) })), 401); // 몸통이 4KB를 넘으면 읽지 않음
  assert.equal(await status(post('/auth/login', { password: PASSWORD }, { 'Content-Type': 'text/plain' })), 403); // 다른 사이트의 폼으로는 못 보냄
  assert.equal(await status(post('/auth/login', { password: PASSWORD }, { 'Sec-Fetch-Site': 'cross-site' })), 403);
  assert.equal(await status(post('/auth/logout', {}, { 'Sec-Fetch-Site': 'same-site' })), 403);
  assert.equal(await status(new Request('https://hmi.example.net/auth/login')), 405);
  assert.equal(await status(post('/auth/session', {})), 405);
  const none = await worker.fetch(post('/auth/login', { password: PASSWORD }), { ...env, HMI_PASSWORD: undefined });
  assert.equal(none.status, 500);
  assert.deepEqual(await none.json(), { error: 'NOT_CONFIGURED' });
  assert.equal((await worker.fetch(post('/auth/login', { password: 'wrong password' }), env)).headers.get('set-cookie'), null);
});

test('로그인: 시도 제한(LOGIN_LIMIT)은 IP마다 세고, 넘으면 비밀번호를 보기 전에 429', async (t) => {
  const worker = await loadWorker();
  const keys = [];
  let allow = true;
  const { env } = setup(t, { LOGIN_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: allow }; } } });
  const ip = { 'CF-Connecting-IP': '203.0.113.9' };
  assert.equal((await worker.fetch(post('/auth/login', { password: PASSWORD }, ip), env)).status, 200);
  allow = false;
  const res = await worker.fetch(post('/auth/login', { password: PASSWORD }, ip), env);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.deepEqual(keys, ['203.0.113.9', '203.0.113.9']);
});

test('로그인: 서명이 틀린 · 시각만 늘린 · 다른 키로 만든 · 끝난 쿠키는 로그인으로 보지 않음', async (t) => {
  const { default: worker, readSession } = await loadModule();
  const { env } = setup(t);
  const good = cookieOf(await worker.fetch(post('/auth/login', { password: PASSWORD }), env));
  const req = (c) => new Request('https://hmi.example.net/', { headers: { Cookie: c } });
  assert.ok(await readSession(req(good), env));
  const [name, value] = good.split('=');
  const [until, sig] = value.split('.');
  assert.equal(await readSession(req(name + '=' + (Number(until) + 3600) + '.' + sig), env), null);
  assert.equal(await readSession(req(name + '=' + until + '.' + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)), env), null);
  assert.equal(await readSession(req(good), { ...env, SESSION_KEY: 'another-key' }), null); // 비밀번호를 바꾸면(set-password.py) 무효
  assert.equal(await readSession(req(good), env, (Number(until) + 1) * 1000), null); // 끝난 뒤
  assert.equal(await readSession(req('hmi_session=abc'), env), null);
  assert.equal(await readSession(req(good), { ...env, SESSION_KEY: undefined }), null);
});

test('원점: GET은 누구나, PUT은 로그인해야 하고(401) 이 화면이 보낸 JSON만(403), 틀린 값 · 범위 밖은 400, 저장하면 Worker 시각과 함께 KV에', async (t) => {
  const worker = await loadWorker();
  const { env, calls } = setup(t);
  const get = (e = env) => worker.fetch(new Request('https://hmi.example.net/home'), e);
  assert.deepEqual(await (await get()).json(), { home: null });
  assert.equal((await worker.fetch(put({ home: { angles: POSE, units: UNITS } }), env)).status, 401);
  assert.equal(env.HOME.map.size, 0);

  const Cookie = cookieOf(await worker.fetch(post('/auth/login', { password: PASSWORD }), env));
  assert.equal((await worker.fetch(put({ home: { angles: POSE } }, { Cookie, 'Sec-Fetch-Site': 'cross-site' }), env)).status, 403);
  assert.equal((await worker.fetch(put({ home: { angles: { ...POSE, gripper: null } } }, { Cookie }), env)).status, 400);
  assert.equal((await worker.fetch(put({ home: { angles: { ...POSE, elbow_flex: 1e9 } } }, { Cookie }), env)).status, 400);
  assert.equal(env.HOME.map.size, 0);

  const res = await worker.fetch(put({ home: { angles: POSE, units: UNITS, source: 'leader', setAt: '2000-01-01T00:00:00Z' } }, { Cookie }), env);
  assert.equal(res.status, 200);
  const saved = (await res.json()).home;
  assert.deepEqual(saved.angles, POSE);
  assert.equal(saved.units.gripper, 'pct');
  assert.equal(saved.source, 'leader');
  assert.ok(Date.now() - Date.parse(saved.setAt) < 5000); // 보낸 시각이 아니라 Worker 시각
  assert.deepEqual(JSON.parse(env.HOME.map.get('home')), saved);
  assert.deepEqual((await (await get()).json()).home, saved);
  assert.equal((await worker.fetch(new Request('https://hmi.example.net/home', { method: 'DELETE' }), env)).status, 405);
  assert.equal((await get({ ...env, HOME: undefined })).status, 500);
  assert.deepEqual(calls, { assets: [], fetch: [] });
});

test('원점 복귀 검사: 화면이 보내는 Home(저장된 원점 각도)은 넘기고, 다르면 같은 id로 Rejected HomeMismatch, 원점이 없으면 HomeNotSet', async () => {
  const { screenMessage } = await loadModule();
  require(path.join(__dirname, '..', 'js', 'xml-protocol.js')); // 화면과 같은 코드로 명령을 만든다
  const P = globalThis.HmiXmlProtocol;
  const X = globalThis.HmiXml;
  const home = { angles: POSE, units: UNITS };
  const env = { HOME: fakeKV(home) };
  const homeCmd = (pose, id = 'hmi-home-1') => P.command('home', pose, id).text;
  const replyOf = (text) => {
    const m = X.parse(text);
    const r = X.child(m, 'Reply');
    return { type: X.attr(m, 'type'), id: X.attr(m, 'id'), result: X.attr(r, 'result'), code: X.attr(r, 'code'), command: X.attr(r, 'command') };
  };

  const ok = await screenMessage(homeCmd(home), env);
  assert.equal(ok.forward, homeCmd(home)); // 화면의 글은 다시 써도 그대로
  assert.match(ok.forward, /<Angle unit="deg">12\.35<\/Angle>.*<Angle unit="percent">10<\/Angle>/);

  const off = await screenMessage(homeCmd({ angles: { ...POSE, elbow_flex: 30.52 }, units: UNITS }), env);
  assert.equal(off.forward, undefined);
  assert.deepEqual(replyOf(off.reply), { type: 'Reply', id: 'hmi-home-1', result: 'Rejected', code: 'HomeMismatch', command: 'Home' });
  assert.equal(replyOf((await screenMessage(homeCmd({ angles: POSE }), env)).reply).code, 'HomeMismatch'); // 그리퍼 단위가 다름
  assert.equal(replyOf((await screenMessage(homeCmd(home), { HOME: fakeKV() })).reply).code, 'HomeNotSet');
  assert.equal(replyOf((await screenMessage(homeCmd(home), {})).reply).code, 'HomeNotSet'); // KV 설정이 빠졌으면 각도를 붙인 원점 복귀는 넘기지 않음

  // 각도 없이 이름만 보낸 Home(homePose false)과 다른 명령은 그대로 넘긴다
  const bare = '<Message version="1.0" type="Command" id="h-2"><Command name="Home" /></Message>';
  assert.equal((await screenMessage(bare, { HOME: fakeKV() })).forward, bare);
  for (const [name, body] of [['estop', null], ['start', null], ['mode', { mode: 'manual' }], ['sortTarget', { target: 'defect' }]]) {
    const text = P.command(name, body, 'c-' + name).text;
    assert.equal((await screenMessage(text, { HOME: fakeKV() })).forward, text, name);
  }

  // 화면이 받는 쪽(xml-protocol.js)은 Worker의 거절을 원점 문구로 읽는다
  const ctx = { note() {}, time: () => new Date().toISOString() };
  const decoded = P.decode(off.reply, ctx);
  assert.equal(decoded[0].data.body.error.code, 'HOME_MISMATCH');
  const notSet = (await screenMessage(homeCmd(home), {})).reply;
  assert.equal(P.decode(notSet, ctx)[0].data.body.error.code, 'HOME_NOT_SET');
});

test('원점 복귀 검사: 서버가 너그럽게 읽을 수 있는 모양(대소문자 · 공백 · 다른 자리)과 이상한 모터 목록도 막고, 읽지 못한 글 · 바이너리 · 너무 긴 글은 넘기지 않음', async () => {
  const { screenMessage } = await loadModule();
  const X = globalThis.HmiXml;
  const env = { HOME: fakeKV({ angles: POSE, units: UNITS }) };
  const motor = (id, v, unit = 'deg') => '<Motor id="' + id + '"><Angle unit="' + unit + '">' + v + '</Angle></Motor>';
  const right = [motor(1, 12.35), motor(2, -20), motor(3, 30.5), motor(4, -4), motor(5, 0), motor(6, 10, 'percent')];
  const evil = [motor(1, 90)].concat(right.slice(1)).join('');
  const msg = (cmd) => '<Message version="1.0" type="Command" id="x-1">' + cmd + '</Message>';
  const outcome = async (text) => {
    const r = await screenMessage(text, env);
    if (r.forward !== undefined) return 'forward';
    const m = X.parse(r.reply);
    return X.attr(X.child(m, 'Reply') || X.child(m, 'Error'), 'code');
  };
  assert.equal(await outcome(msg('<Command name="Home"><Motors>' + right.join('') + '</Motors></Command>')), 'forward');
  assert.equal(await outcome(msg('<Command name="Home"><Motors>' + right.slice().reverse().join('') + '</Motors></Command>')), 'forward'); // 모터 순서는 상관없음
  assert.equal(await outcome(msg('<Command name="Home"><Motors>' + right.slice(0, 5).join('') + motor(6, '10.001', 'percent') + '</Motors></Command>')), 'forward'); // 소수 둘째 자리까지
  const blocked = [
    '<Command name="home"><Motors>' + evil + '</Motors></Command>',
    '<Command name=" HOME "><Motors>' + evil + '</Motors></Command>',
    '<command NAME="Home"><Motors>' + evil + '</Motors></command>',
    '<Other><Command name="Home"><Motors>' + evil + '</Motors></Command></Other>',
    '<Command name="Home"><Motors>' + right.join('') + motor(7, 1) + '</Motors></Command>', // 모터 7
    '<Command name="Home"><Motors>' + right.slice(0, 5).join('') + motor(5, 0) + '</Motors></Command>', // 5번이 둘, 6번 없음
    '<Command name="Home"><Motors>' + right.join('') + '</Motors><Motors>' + evil + '</Motors></Command>',
    '<Command name="Home">90<Motors>' + right.join('') + '</Motors></Command>',
    '<Command name="Home"><Motors>' + right.slice(0, 5).join('') + motor(6, 'abc', 'percent') + '</Motors></Command>',
    '<Command name="Home"><Motors>' + right.slice(0, 5).join('') + motor(6, '', 'percent') + '</Motors></Command>',
    '<Command name="Home"><Motors>' + right.slice(0, 5).join('') + motor(6, 10, 'deg') + '</Motors></Command>',
    '<Command name="Start" /><Command name="Home"><Motors>' + evil + '</Motors></Command>',
  ];
  for (const cmd of blocked) assert.equal(await outcome(msg(cmd)), 'HomeMismatch', cmd);
  assert.equal(await outcome('<Message type="Command"><Command name="Home"'), 'InvalidXml');
  assert.equal(await outcome('<!DOCTYPE x><Message/>'), 'InvalidXml');
  assert.equal(await outcome('<Message a="1" a="2"/>'), 'InvalidXml'); // 같은 속성 둘 — 서버와 다르게 읽을 수 있는 글은 넘기지 않음
  assert.equal(await outcome(new Uint8Array([60, 77, 47, 62]).buffer), 'InvalidRequest');
  assert.equal(await outcome('<Message>' + 'x'.repeat(70 * 1024) + '</Message>'), 'InvalidRequest');
  // id가 없으면 Reply 대신 Error로
  const noId = await screenMessage('<Message version="1.0" type="Command"><Command name="Home"><Motors>' + evil + '</Motors></Command></Message>', env);
  assert.equal(X.attr(X.parse(noId.reply), 'type'), 'Error');
});

// 웹소켓 흉내: 보낸 메시지·닫힘을 기록하고, 받은 이벤트를 일으킬 수 있다
class FakeSocket {
  constructor() { this.sent = []; this.closed = null; this.listeners = {}; }
  accept() {}
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closed = { code, reason }; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
}

test('웹소켓 중계: 저장된 원점과 다른 원점 복귀는 서버에 가지 않고 그 브라우저에만 거절이 가며, 뒤 메시지는 차례대로 넘어감', async (t) => {
  const worker = await loadWorker();
  require(path.join(__dirname, '..', 'js', 'xml-protocol.js'));
  const P = globalThis.HmiXmlProtocol;
  const server = new FakeSocket();
  const client = new FakeSocket();
  const inner = new FakeSocket();
  const real = { fetch: globalThis.fetch, Response: globalThis.Response, WebSocketPair: globalThis.WebSocketPair };
  globalThis.fetch = async () => ({ status: 101, webSocket: server, headers: new Headers() });
  globalThis.WebSocketPair = class { constructor() { this[0] = client; this[1] = inner; } };
  globalThis.Response = class { constructor(body, init) { Object.assign(this, init); } }; // node의 Response는 101을 만들지 못한다
  t.after(() => Object.assign(globalThis, real));
  const env = { ...ENV, ASSETS: {}, HOME: fakeKV({ angles: POSE, units: UNITS }) };
  await worker.fetch(new Request('https://hmi.example.net/ws/hmi', { headers: { Upgrade: 'websocket' } }), env);

  const wrong = P.command('home', { angles: { ...POSE, shoulder_pan: 90 }, units: UNITS }, 'h-1').text;
  const right = P.command('home', { angles: POSE, units: UNITS }, 'h-2').text;
  const estop = P.command('estop', null, 'e-1').text;
  [wrong, estop, right].forEach((data) => inner.emit('message', { data }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(server.sent, [estop, right]);
  assert.equal(inner.sent.length, 1);
  assert.match(inner.sent[0], /type="Reply".*id="h-1".*result="Rejected" code="HomeMismatch"/);
});

test('worker: 로그인 · 원점 주소 밖의 비슷한 경로는 화면 파일로 (터널에 가지 않음)', async (t) => {
  const worker = await loadWorker();
  const { env, calls } = setup(t);
  const paths = ['/auth', '/auth/', '/auth/other', '/home/', '/home.json', '/Home'];
  for (const p of paths) await worker.fetch(new Request('https://hmi.example.net' + p), env);
  assert.deepEqual(calls.assets, paths);
  assert.equal(calls.fetch.length, 0);
});

test('wrangler.jsonc: 원점 KV(HOME)와 로그인 시도 제한(LOGIN_LIMIT, 60초)을 묶어 둠', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(cfg.kv_namespaces.map((k) => k.binding), ['HOME']);
  const rl = cfg.ratelimits.find((r) => r.name === 'LOGIN_LIMIT');
  assert.ok(rl && /^\d+$/.test(rl.namespace_id));
  assert.equal(rl.simple.period, 60);
  assert.ok(rl.simple.limit > 0 && rl.simple.limit <= 10);
});

const PY = ['python', 'python3'].find((cmd) => { try { return spawnSync(cmd, ['--version']).status === 0; } catch (e) { return false; } });

test('set-password.py: 짧거나(10글자 미만) 너무 길거나 앞뒤에 띄어쓰기가 있는 비밀번호는 거절', { skip: !PY && 'python 없음' }, () => {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("sp", sys.argv[1]); sp = importlib.util.module_from_spec(spec); spec.loader.exec_module(sp)',
    'cases = ["short", "a" * 9, " " + "a" * 12, "a" * 12 + " ", "a" * 257, "a" * 10, "team password 2026", "\\uac00" * 10]',
    'print(json.dumps([bool(sp.problem(c)) for c in cases]))',
  ].join('\n');
  const run = spawnSync(PY, ['-I', '-c', code, path.join(DIR, 'set-password.py')]);
  assert.equal(run.status, 0, String(run.stderr));
  assert.deepEqual(JSON.parse(String(run.stdout)), [true, true, true, true, true, false, false, false]);
});
