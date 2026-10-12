// 연결 방식(js/transport.js)과 명령 보내기(js/api.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 브라우저의 WebSocket·EventSource·fetch를 가짜로 바꿔 끼우고, 서버 쪽이 보내는 글자를 그대로 흉내 낸다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    FakeWebSocket.all.push(this);
  }
  send(s) { this.sent.push(s); }
  close() { this.readyState = 3; this.closed = true; }
  // 시험에서 서버 역할
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  receive(data) { if (this.onmessage) this.onmessage({ data }); }
  drop() { this.readyState = 3; if (this.onclose) this.onclose(); }
}
FakeWebSocket.all = [];

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    FakeEventSource.last = this;
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  close() { this.closed = true; }
  dispatch(type, data) {
    if (type === 'message') { if (this.onmessage) this.onmessage({ data }); return; }
    (this.listeners[type] || []).forEach((fn) => fn({ data }));
  }
}

globalThis.WebSocket = FakeWebSocket;
globalThis.EventSource = FakeEventSource;

const load = (file) => {
  const full = path.join(__dirname, '..', 'js', file);
  delete require.cache[require.resolve(full)];
  require(full);
};
load('adapter.js');
load('transport.js');
const T = window.HmiTransport;

const recorder = () => {
  const r = { opened: 0, closed: 0, messages: [] };
  r.handlers = { onOpen: () => { r.opened += 1; }, onClose: () => { r.closed += 1; }, onMessage: (m) => r.messages.push(m) };
  return r;
};

test('경로 바꾸기: 경로만, 방식까지, 없는 이름', () => {
  assert.deepEqual(T.route({}, 'start'), { method: 'POST', path: '/line/start' });
  assert.deepEqual(T.route({ paths: { start: '/run' } }, 'start'), { method: 'POST', path: '/run' });
  assert.deepEqual(T.route({ paths: { mode: 'post /mode/set' } }, 'mode'), { method: 'POST', path: '/mode/set' });
  assert.throws(() => T.route({}, 'fly'));
  assert.equal(T.joinUrl('http://h:8000/api/', '/status'), 'http://h:8000/api/status');
  assert.equal(T.joinUrl('http://h:8000/api', 'http://other/x'), 'http://other/x');
});

test('HTTP: JSON·글자·HTML 응답, 머리글, 시간 초과', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/text')) return { status: 409, text: async () => 'NOT_STOPPED' };
    if (url.endsWith('/slow')) {
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
    }
    return { status: 200, text: async () => '{"line":"running"}' };
  };
  const cfg = { apiBase: 'http://h:8000/api', server: { headers: { Authorization: 'Bearer x' }, timeoutMs: 50 } };
  const ok = await T.httpRequest(cfg, 'POST', '/line/start', { a: 1 });
  assert.deepEqual(ok, { status: 200, body: { line: 'running' } });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer x');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, '{"a":1}');
  assert.deepEqual(await T.httpRequest(cfg, 'GET', '/text'), { status: 409, body: 'NOT_STOPPED' });
  await assert.rejects(T.httpRequest(cfg, 'GET', '/slow'), (e) => e.code === 'TIMEOUT');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(T.httpRequest(cfg, 'GET', '/status'), (e) => e.code === 'NETWORK');
});

test('소켓IO: 열림 → 네임스페이스 연결 → 이벤트 → ping/pong → 응답(ack)', async () => {
  FakeWebSocket.all = [];
  const r = recorder();
  const conn = T.push({ wsUrl: 'ws://h:8000/ws', server: { push: 'socketio' } }, r.handlers);
  const ws = FakeWebSocket.all[0];
  assert.equal(ws.url, 'ws://h:8000/socket.io/?EIO=4&transport=websocket');
  ws.open();
  ws.receive('0{"sid":"abc","upgrades":[],"pingInterval":25000,"pingTimeout":20000}');
  assert.deepEqual(ws.sent, ['40']);
  ws.receive('40{"sid":"xyz"}');
  assert.equal(r.opened, 1);
  ws.receive('42["status",{"line":"running"}]');
  ws.receive('42["inspection",{"id":1,"result":"NG"}]');
  assert.deepEqual(r.messages, [{ type: 'status', data: { line: 'running' } }, { type: 'inspection', data: { id: 1, result: 'NG' } }]);
  ws.receive('2');
  assert.equal(ws.sent[ws.sent.length - 1], '3');
  const ack = conn.emit('start', {}, 1000);
  assert.equal(ws.sent[ws.sent.length - 1], '421["start",{}]');
  ws.receive('431[{"ok":true,"status":200}]');
  assert.deepEqual(await ack, { ok: true, status: 200 });
  // 끊기면 기다리던 응답은 실패하고 onClose. 닫은 뒤에는 다시 붙지 않는다
  const pending = conn.emit('stop', {}, 1000);
  ws.drop();
  await assert.rejects(pending, (e) => e.code === 'NETWORK');
  assert.equal(r.closed, 1);
  conn.close();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(FakeWebSocket.all.length, 1);
});

test('소켓IO: 네임스페이스와 인증값', () => {
  FakeWebSocket.all = [];
  const r = recorder();
  const conn = T.push({ wsUrl: 'wss://h/ws', server: { push: 'socketio', socketioNamespace: '/hmi', socketioAuth: { token: 't' }, socketioPath: '/io/' } }, r.handlers);
  const ws = FakeWebSocket.all[0];
  assert.equal(ws.url, 'wss://h/io/?EIO=4&transport=websocket');
  ws.open();
  ws.receive('0{"sid":"a"}');
  assert.deepEqual(ws.sent, ['40/hmi,{"token":"t"}']);
  ws.receive('40/hmi,{"sid":"b"}');
  ws.receive('42["status",{"line":"x"}]'); // 다른 네임스페이스(/)는 무시
  ws.receive('42/hmi,["status",{"line":"running"}]');
  assert.equal(r.opened, 1);
  assert.deepEqual(r.messages, [{ type: 'status', data: { line: 'running' } }]);
  assert.deepEqual(T.parseSocketio('3/hmi,12["ok"]'), { type: 3, nsp: '/hmi', id: 12, data: ['ok'] });
  conn.close();
});

test('WebSocket: 열림·글자 메시지 전달·바이너리 무시·HMI ping', () => {
  FakeWebSocket.all = [];
  const r = recorder();
  const realSetInterval = globalThis.setInterval;
  let pingFn = null;
  globalThis.setInterval = (fn) => { pingFn = fn; return 1; };
  const conn = T.push({ wsUrl: 'ws://h/ws', server: { push: 'ws', clientPingMs: 1000 } }, r.handlers);
  const ws = FakeWebSocket.all[0];
  ws.open(); // ping 타이머는 열릴 때 건다
  globalThis.setInterval = realSetInterval;
  assert.equal(r.opened, 1);
  ws.receive('{"type":"heartbeat"}');
  ws.receive(new Uint8Array([1, 2]));
  assert.deepEqual(r.messages, ['{"type":"heartbeat"}']);
  pingFn();
  assert.equal(JSON.parse(ws.sent[0]).type, 'ping');
  conn.close();
});

test('SSE: 이름 붙은 이벤트와 기본 메시지', () => {
  const r = recorder();
  const conn = T.push({ server: { push: 'sse', sseUrl: 'http://h/events' } }, r.handlers);
  const es = FakeEventSource.last;
  assert.equal(es.url, 'http://h/events');
  es.onopen();
  es.dispatch('status', '{"line":"running"}');
  es.dispatch('message', '{"type":"event","data":{"code":"line_started"}}');
  assert.equal(r.opened, 1);
  assert.deepEqual(r.messages, [{ type: 'status', data: { line: 'running' } }, { type: 'event', data: { code: 'line_started' } }]);
  es.onerror();
  assert.equal(r.closed, 1);
  assert.throws(() => conn.send({}), (e) => e.code === 'UNSUPPORTED');
  conn.close();
});

test('폴링: 상태를 물어 status 메시지로 넘기고, 실패하면 끊김', async () => {
  let fail = false;
  globalThis.fetch = async (url) => {
    if (fail) throw new TypeError('Failed to fetch');
    assert.equal(url, 'http://h/api/state');
    return { status: 200, text: async () => '{"state":"RUN"}' };
  };
  const r = recorder();
  const conn = T.push({ apiBase: 'http://h/api', server: { push: 'poll', pollMs: 10, paths: { status: '/state' } } }, r.handlers);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(r.opened, 1);
  assert.ok(r.messages.length >= 2);
  assert.deepEqual(r.messages[0], { type: 'status', data: { state: 'RUN' } });
  fail = true;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(r.closed, 1);
  conn.close();
});

test('api.js: WebSocket으로 명령 보내기(command → command_result)와 오류 모양 맞추기', async () => {
  FakeWebSocket.all = [];
  window.HMI_CONFIG = {
    useMock: false,
    apiBase: 'http://h/api',
    wsUrl: 'ws://h/ws',
    server: { push: 'ws', commands: 'ws', timeoutMs: 500, modeValues: { manual: 'MANUAL' }, commandNames: { mode: 'set_mode' } },
    cameras: { primary: 'auto', bboxFormat: 'xywh' },
  };
  load('api.js');
  const api = window.HmiApi;
  const r = recorder();
  api.connect(r.handlers);
  const ws = FakeWebSocket.all[0];
  ws.open();
  const started = api.start();
  const sent = JSON.parse(ws.sent[0]);
  assert.deepEqual(sent, { type: 'command', data: { id: '1', name: 'start', body: null } });
  ws.receive(JSON.stringify({ type: 'command_result', data: { id: 1, status: 200, body: { line: 'running' } } }));
  assert.deepEqual(await started, { line: 'running' });
  const mode = api.setMode('manual');
  assert.deepEqual(JSON.parse(ws.sent[1]).data, { id: '2', name: 'set_mode', body: { mode: 'MANUAL' } });
  ws.receive(JSON.stringify({ type: 'ack', data: { id: '2', ok: false, error: { code: 'not_stopped' } } }));
  await assert.rejects(mode, (e) => e instanceof api.ApiError && e.code === 'NOT_STOPPED' && e.status === 409);
  // 명령 응답은 화면 메시지로 새지 않는다
  ws.receive('{"type":"status","data":{"line":"stopped"}}');
  assert.deepEqual(r.messages.map((m) => m.type), ['status']);
  // 응답이 없으면 시간 초과
  await assert.rejects(api.stop(), (e) => e.code === 'TIMEOUT');
});

test('api.js: HTTP 명령의 FastAPI 오류와 서버 정보 없음(v0.1)', async () => {
  window.HMI_CONFIG = {
    useMock: false,
    apiBase: 'http://h/api',
    wsUrl: 'ws://h/ws',
    server: { push: 'ws', commands: 'http', timeoutMs: 500, startBody: { speed: 40 } },
    cameras: { primary: 'auto', bboxFormat: 'xywh' },
  };
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, body: init.body });
    if (url.endsWith('/info')) return { status: 404, text: async () => '{"detail":"Not Found"}' };
    if (url.endsWith('/line/start')) return { status: 409, text: async () => '{"detail":{"code":"DEVICES_NOT_READY","missing":["robot","cam_top"]}}' };
    return { status: 200, text: async () => '{}' };
  };
  load('api.js');
  const api = window.HmiApi;
  assert.equal(await api.getInfo(), null);
  await assert.rejects(api.start(), (e) => e.code === 'DEVICES_NOT_READY' && e.details.missing.join() === 'arm,camera_top');
  assert.equal(seen[1].body, '{"speed":40}');
});
