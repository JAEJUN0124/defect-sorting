// 밖에서 여는 HMI(cloudflare/) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// Worker가 /ws/hmi 웹소켓만 서비스 토큰을 붙여 터널로 넘기고 나머지는 화면 파일로 돌리는지, 배포 설정이 Access 없는 주소를 열지 않는지 본다
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const DIR = path.join(__dirname, '..', 'cloudflare');
const loadWorker = () => import(pathToFileURL(path.join(DIR, 'worker.js')).href).then((m) => m.default);

const ENV = { ORIGIN: 'https://hmi-origin.example.net', CF_ACCESS_CLIENT_ID: 'id-1', CF_ACCESS_CLIENT_SECRET: 'secret-1' };
const UPSTREAM = { upstream: true }; // 터널 쪽의 101이 아닌 답 (토큰이 틀려 401, 서버가 꺼져 502 등) — Worker는 이것을 그대로 돌려줘야 한다

// 정적 파일(ASSETS)과 바깥으로 나가는 fetch를 흉내 낸다
function setup(t, env = ENV) {
  const calls = { assets: [], fetch: [] };
  const assets = { fetch: async (req) => { calls.assets.push(new URL(req.url).pathname); return new Response('file'); } };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.fetch.push({ url: String(url), headers: new Headers(init && init.headers) }); return UPSTREAM; };
  t.after(() => { globalThis.fetch = real; });
  return { env: { ...env, ASSETS: assets }, calls };
}

const wsRequest = (url, extra = {}) => new Request(url, {
  headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', ...extra },
});

test('worker: 화면 파일 요청은 정적 파일로 보내고 터널에는 가지 않음', async (t) => {
  const worker = await loadWorker();
  const { env, calls } = setup(t);
  for (const p of ['/', '/index.html', '/assets/index.js', '/tools/devices.html']) {
    const res = await worker.fetch(new Request('https://hmi.example.net' + p), env);
    assert.equal(await res.text(), 'file');
  }
  assert.deepEqual(calls.assets, ['/', '/index.html', '/assets/index.js', '/tools/devices.html']);
  assert.equal(calls.fetch.length, 0);
});

test('worker: /ws/hmi 웹소켓은 터널 주소로 — 서비스 토큰을 붙이고 사람의 쿠키·Cloudflare 머리글은 넘기지 않음, 주소 뒤 ?는 그대로', async (t) => {
  const worker = await loadWorker();
  const { env, calls } = setup(t);
  const res = await worker.fetch(wsRequest('https://hmi.example.net/ws/hmi?a=1', {
    Cookie: 'CF_Authorization=person-token',
    'CF-Connecting-IP': '203.0.113.7',
    'Cf-Access-Jwt-Assertion': 'person-jwt',
    'Sec-WebSocket-Protocol': 'hmi-xml',
  }), env);
  assert.equal(res, UPSTREAM); // 터널의 답을 그대로 돌려준다
  assert.equal(calls.fetch.length, 1);
  const { url, headers } = calls.fetch[0];
  assert.equal(url, 'https://hmi-origin.example.net/ws/hmi?a=1');
  assert.equal(headers.get('upgrade'), 'websocket');
  assert.equal(headers.get('cf-access-client-id'), 'id-1');
  assert.equal(headers.get('cf-access-client-secret'), 'secret-1');
  assert.equal(headers.get('sec-websocket-protocol'), 'hmi-xml');
  ['cookie', 'cf-connecting-ip', 'cf-access-jwt-assertion'].forEach((h) => assert.equal(headers.get(h), null, h));
  assert.equal(calls.assets.length, 0);
});

// 웹소켓 흉내: 보낸 메시지·닫힘을 기록하고, 받은 이벤트를 일으킬 수 있다
class FakeSocket {
  constructor() { this.sent = []; this.closed = null; this.accepted = false; this.listeners = {}; }
  accept() { this.accepted = true; }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closed = { code, reason }; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  emit(type, ev) { (this.listeners[type] || []).forEach((fn) => fn(ev)); }
}

test('worker: 서버가 101로 받으면 브라우저 쪽 웹소켓을 따로 열어 둘 사이에 메시지와 닫힘을 옮김 (Cloudflare 문서의 중계 방식)', async (t) => {
  const worker = await loadWorker();
  const server = new FakeSocket(); // Worker → 터널 주소
  const client = new FakeSocket(); // 브라우저에 돌려주는 쪽
  const inner = new FakeSocket(); // Worker가 쥐는 쪽
  const real = { fetch: globalThis.fetch, Response: globalThis.Response, WebSocketPair: globalThis.WebSocketPair };
  globalThis.fetch = async () => ({ status: 101, webSocket: server, headers: new Headers() });
  globalThis.WebSocketPair = class { constructor() { this[0] = client; this[1] = inner; } };
  globalThis.Response = class { constructor(body, init) { Object.assign(this, init); } }; // node의 Response는 101을 만들지 못한다
  t.after(() => Object.assign(globalThis, real));

  const res = await worker.fetch(wsRequest('https://hmi.example.net/ws/hmi'), { ...ENV, ASSETS: {} });
  assert.equal(res.status, 101);
  assert.equal(res.webSocket, client);
  assert.ok(server.accepted && inner.accepted);
  server.emit('message', { data: '<Message type="Status"/>' });
  assert.deepEqual(inner.sent, ['<Message type="Status"/>']);
  inner.emit('message', { data: '<Message type="Ping"/>' });
  assert.deepEqual(server.sent, ['<Message type="Ping"/>']);
  server.emit('close', { code: 1006, reason: '' }); // 보낼 수 없는 코드는 1000으로
  assert.deepEqual(inner.closed, { code: 1000, reason: '' });
  inner.emit('close', { code: 1001, reason: 'bye' });
  assert.deepEqual(server.closed, { code: 1001, reason: 'bye' });
});

test('worker: 카메라 영상 세 경로(/video/status · /video/1.mjpg · /video/2.mjpg)만 터널로 — 서비스 토큰을 붙이고 사람의 쿠키는 안 넘김, ?t=는 그대로', async (t) => {
  const worker = await loadWorker();
  const { env, calls } = setup(t);
  const get = (p, headers) => worker.fetch(new Request('https://hmi.example.net' + p, { headers }), env);
  assert.equal(await get('/video/status', { Cookie: 'CF_Authorization=person-token' }), UPSTREAM);
  assert.equal(await get('/video/1.mjpg?t=123'), UPSTREAM);
  assert.equal(await get('/video/2.mjpg'), UPSTREAM);
  assert.deepEqual(calls.fetch.map((c) => c.url), [
    'https://hmi-origin.example.net/video/status',
    'https://hmi-origin.example.net/video/1.mjpg?t=123',
    'https://hmi-origin.example.net/video/2.mjpg',
  ]);
  calls.fetch.forEach(({ headers }) => {
    assert.equal(headers.get('cf-access-client-id'), 'id-1');
    assert.equal(headers.get('cf-access-client-secret'), 'secret-1');
    assert.equal(headers.get('cookie'), null);
  });
  // 서버가 내주는 확인 화면(/video)·없는 카메라·업로드 경로(/ws/video)는 넘기지 않는다
  for (const p of ['/video', '/video/3.mjpg', '/ws/video']) await get(p);
  assert.deepEqual(calls.assets, ['/video', '/video/3.mjpg', '/ws/video']);
  assert.equal(calls.fetch.length, 3);
  const post = await worker.fetch(new Request('https://hmi.example.net/video/status', { method: 'POST' }), env);
  assert.equal(post.status, 405);
});

test('worker: 웹소켓이 아닌 /ws/hmi는 426, 다른 /ws/ 경로는 터널로 보내지 않음 (메인 서버의 다른 경로는 밖에 열지 않는다)', async (t) => {
  const worker = await loadWorker();
  const { env, calls } = setup(t);
  const plain = await worker.fetch(new Request('https://hmi.example.net/ws/hmi'), env);
  assert.equal(plain.status, 426);
  await worker.fetch(wsRequest('https://hmi.example.net/ws/other'), env);
  await worker.fetch(wsRequest('https://hmi.example.net/ws/hmi/x'), env);
  assert.deepEqual(calls.assets, ['/ws/other', '/ws/hmi/x']);
  assert.equal(calls.fetch.length, 0);
});

test('worker: 터널 주소나 서비스 토큰이 비면 500 (토큰을 아직 넣지 않았을 때) — 바깥으로 보내지 않음', async (t) => {
  const worker = await loadWorker();
  for (const missing of ['ORIGIN', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET']) {
    const env = { ...ENV };
    delete env[missing];
    const s = setup(t, env);
    const res = await worker.fetch(wsRequest('https://hmi.example.net/ws/hmi'), s.env);
    assert.equal(res.status, 500, missing);
    assert.equal(s.calls.fetch.length, 0, missing);
  }
});

test('wrangler.jsonc: workers.dev·미리 보기 주소를 열지 않고(Access는 화면 주소에만 있음), 화면 주소와 터널 주소가 다르며, 화면 파일은 site/', () => {
  const src = fs.readFileSync(path.join(DIR, 'wrangler.jsonc'), 'utf8');
  const cfg = JSON.parse(src.replace(/^\s*\/\/.*$/gm, '')); // 주석은 줄 전체로만 쓴다
  assert.equal(cfg.workers_dev, false);
  assert.equal(cfg.preview_urls, false);
  assert.equal(cfg.routes.length, 1);
  assert.equal(cfg.routes[0].custom_domain, true);
  const origin = new URL(cfg.vars.ORIGIN);
  assert.equal(origin.protocol, 'https:');
  assert.notEqual(origin.host, cfg.routes[0].pattern);
  assert.equal(cfg.assets.directory, './site');
  assert.equal(cfg.assets.binding, 'ASSETS');
  assert.equal(cfg.main, 'worker.js');
});

const PY = ['python', 'python3'].find((cmd) => { try { return spawnSync(cmd, ['--version']).status === 0; } catch (e) { return false; } });

test('set-token.py: 확실히 틀린 값(글자 그대로 · 터널 토큰 · 머리말 · 비밀 자리의 Client ID)은 거절하고, 비밀의 길이는 보지 않음 — 터널 주소는 wrangler.jsonc에서', { skip: !PY && 'python 없음' }, () => {
  const code = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("st", sys.argv[1]); st = importlib.util.module_from_spec(spec); spec.loader.exec_module(st)',
    'ok = "0123456789abcdef0123456789abcdef.access"',
    'cases = [("Client ID", "Client Secret"), (ok, "eyJ" + "a" * 181), (ok, "CF-Access-Client-Secret: abc"), (ok, ok), (ok, "ab" * 32), (ok, "Zx9_" * 13 + "Zx")]',
    'print(json.dumps({"rejected": [bool(st.problem(a, b)) for a, b in cases], "origin": st.origin()}))',
  ].join('\n');
  const run = spawnSync(PY, ['-I', '-c', code, path.join(DIR, 'set-token.py')]);
  assert.equal(run.status, 0, String(run.stderr));
  const out = JSON.parse(String(run.stdout));
  assert.deepEqual(out.rejected, [true, true, true, true, false, false]); // 64글자 16진수도, 54글자 다른 형식도 받는다 (진짜인지는 Access에 시험해 정함)
  const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(out.origin, cfg.vars.ORIGIN);
});

test('package.json: wrangler 판을 정확히 고정 (^ · ~ 없이)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8'));
  assert.match(pkg.devDependencies.wrangler, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.type, 'module'); // worker.js는 ES 모듈
});
