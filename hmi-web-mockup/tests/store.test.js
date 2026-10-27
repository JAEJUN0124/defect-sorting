// 화면 공통 상태(js/store.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 서버 연결은 가짜(HmiApi 흉내)로 바꾸고, 받은 메시지를 store가 어떻게 모으는지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;

const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const tick = () => new Promise((r) => setTimeout(r, 10));

// store.js를 새로 불러온다. 가짜 서버 연결이 받은 handlers(onOpen·onClose·onMessage)로 메시지를 넣는다
function freshStore(api, xml, cfgExtra, homeExtra) {
  window.HMI_CONFIG = Object.assign({ useMock: false, server: { xml: Object.assign({}, xml) }, cameras: {}, heartbeatTimeoutMs: 0 }, cfgExtra);
  window.HMI_ROBOT = {};
  window.I18N = { t: (k) => k };
  window.HmiHome = Object.assign({ JOINTS, read: () => null, save: (pose) => Object.assign({ setAt: new Date().toISOString() }, pose), subscribe: () => () => {}, persisted: () => true }, homeExtra);
  class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
  window.HmiApi = Object.assign({ xml: true, ApiError, reconnect() {}, close() {} }, api);
  const full = path.join(__dirname, '..', 'js', 'store.js');
  delete require.cache[require.resolve(full)];
  // store.js는 불러올 때 끊김을 보는 1초 타이머를 건다 — 시험이 끝나도 프로세스를 붙잡지 않게
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { const timer = realSetInterval(fn, ms); timer.unref(); return timer; };
  try { require(full); } finally { globalThis.setInterval = realSetInterval; }
  return window.HmiStore;
}

test('store.js: 기록 조회가 없는 서버(XML)는 다시 붙으면 지난 순번을 잊는다 — 재시작한 서버의 이벤트를 버리지 않는다', async () => {
  let handlers = null;
  const store = freshStore({
    connect(h) { handlers = h; },
    getInfo: async () => null,
    getStatus: async () => ({}),
    getHistory: async () => null, // XML 규약에는 지난 기록 조회가 없다
  });
  const seen = [];
  store.subscribe((kind, d) => { if (kind === 'event') seen.push(d.code + ':' + d.seq); });
  store.start();
  handlers.onOpen();
  await tick();
  assert.equal(store.state.history.supported, false);
  const ev = (code, seq) => ({ type: 'event', data: { code, level: 'info', params: {}, seq } });
  handlers.onMessage(ev('line_started', 1));
  handlers.onMessage(ev('line_started', 1)); // 같은 연결에서 같은 순번은 한 번만
  assert.deepEqual(seen, ['line_started:1']);
  // 서버가 다시 켜지면(연결이 끊겼다 다시 붙음) 순번이 1부터 다시 시작한다 (서버 담당 회신 2026-10-16)
  handlers.onClose();
  handlers.onOpen();
  await tick();
  handlers.onMessage(ev('estop_pressed', 1));
  assert.deepEqual(seen, ['line_started:1', 'estop_pressed:1']);
});

// 서버의 상태 간격은 바뀔 수 있다 (2026-10-16에 60초로 바뀜). 상태가 늦으면 HMI가 GetStatus로 묻는다
test('store.js: 서버 상태가 늦으면 상태를 묻고, 답을 기다리는 동안은 다시 묻지 않으며, 상태가 자주 오면 묻지 않는다', async () => {
  let handlers = null;
  let asked = 0;
  let answer = null;
  const store = freshStore({
    connect(h) { handlers = h; },
    getInfo: async () => null,
    getHistory: async () => null,
    getStatus() { asked += 1; return new Promise((resolve) => { answer = resolve; }); },
  }, { statusPollMs: 100 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  store.start();
  handlers.onOpen();
  await sleep(10);
  assert.equal(asked, 1); // 연결되면 한 번 묻는다 (refresh)
  await sleep(400); // 상태가 오지 않음 → 물음. 답을 기다리는 동안은 더 묻지 않음
  assert.equal(asked, 2);
  answer({});
  await sleep(400); // 답은 왔지만 상태 메시지는 여전히 없음 → 다시 물음
  assert.equal(asked, 3);
  answer({});
  // 상태가 50ms마다 오면 묻지 않는다
  const feed = setInterval(() => handlers.onMessage({ type: 'status', data: {} }), 50);
  await sleep(600);
  clearInterval(feed);
  assert.equal(asked, 3);
});

test('store.js: statusPollMs가 0이면 상태를 묻지 않는다', async () => {
  let handlers = null;
  let asked = 0;
  const store = freshStore({
    connect(h) { handlers = h; },
    getInfo: async () => null,
    getHistory: async () => null,
    getStatus: async () => { asked += 1; return {}; },
  }, { statusPollMs: 0 });
  store.start();
  handlers.onOpen();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(asked, 1); // 연결 때 한 번(refresh)뿐
});

test('store.js: 원점 잡기 때 각도가 오래됐으면(상태가 드문 서버) 상태를 한 번 물어 지금 각도로 저장한다', async () => {
  let handlers = null;
  let asked = 0;
  const angles = { shoulder_pan: 1, shoulder_lift: -2, elbow_flex: 3, wrist_flex: -4, wrist_roll: 5, gripper: 6 };
  const store = freshStore({
    connect(h) { handlers = h; },
    getInfo: async () => null,
    getHistory: async () => null,
    // 연결 때 묻는 것(refresh)에는 각도를 주지 않고, 그 뒤에 물으면 지금 각도가 온다 (서버 답의 상태에 실려 오는 것처럼)
    async getStatus() {
      asked += 1;
      if (asked > 1) handlers.onMessage({ type: 'joints', data: { source: 'leader', unit: 'deg', angles, units: {} } });
      return {};
    },
  }, { statusPollMs: 0 });
  store.start();
  handlers.onOpen();
  handlers.onMessage({ type: 'status', data: {} });
  await tick();
  assert.equal(asked, 1);
  const res = await store.saveHome();
  assert.equal(asked, 2); // 각도가 없어 한 번 물었다
  assert.deepEqual(res.home.angles, angles);
  await store.saveHome(); // 이번에는 각도가 새것이라 묻지 않는다
  assert.equal(asked, 2);
});

// 끊김 판단: 서버 메시지가 statusTimeoutMs 동안 없으면 끊김. 다만 Ping 간격보다 짧게는 잡지 않는다 (Pong을 기다리다 끊김으로 보지 않게)
test('store.js: 메시지가 statusTimeoutMs 동안 없으면 끊김으로 보고 다시 붙는다 (Ping을 안 보낼 때)', async () => {
  let handlers = null;
  let reconnects = 0;
  const store = freshStore({
    connect(h) { handlers = h; },
    getInfo: async () => null,
    getHistory: async () => null,
    getStatus: () => new Promise(() => {}),
    reconnect() { reconnects += 1; },
  }, { statusTimeoutMs: 100, pingMs: 0, statusPollMs: 0 });
  store.start();
  handlers.onOpen();
  await new Promise((r) => setTimeout(r, 1200)); // 끊김은 1초마다 본다
  assert.equal(store.state.online, false);
  assert.ok(reconnects >= 1);
});

test('store.js: 끊김 시간이 Ping 간격보다 짧으면 Ping 간격 + 5초로 본다', async () => {
  let handlers = null;
  let reconnects = 0;
  const store = freshStore({
    connect(h) { handlers = h; },
    getInfo: async () => null,
    getHistory: async () => null,
    getStatus: () => new Promise(() => {}),
    reconnect() { reconnects += 1; },
  }, { statusTimeoutMs: 100, pingMs: 1000, statusPollMs: 0 });
  store.start();
  handlers.onOpen();
  await new Promise((r) => setTimeout(r, 1200)); // 100ms가 지났지만 Ping 간격 + 5초(6초) 전이라 끊김이 아니다
  assert.equal(store.state.online, true);
  assert.equal(reconnects, 0);
});

test('store.js: stop()은 서버 연결을 닫는다 (프로그램 종료 — 이 HMI만 끝낸다)', () => {
  let closed = 0;
  const store = freshStore({ connect() {}, close() { closed += 1; } });
  store.start();
  store.stop();
  assert.equal(closed, 1);
});

test('store.js: 브릿지 영상 — 카메라 켜기·끄기는 서버 명령 없이 이 HMI에서, 탑뷰/그리퍼 바꾸기, 상태 조회(/video/status)로 카메라마다 단계', async (t) => {
  require(path.join(__dirname, '..', 'js', 'video.js'));
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    return { ok: true, json: async () => ({ connected: true, cameras: [{ id: 2, available: false, receivedAt: null }, { id: 1, available: true, receivedAt: '2026-10-17T06:00:00+00:00' }] }) };
  };
  t.after(() => { globalThis.fetch = realFetch; });
  let cameraCommands = 0;
  const bridge = { statusPath: '/video/status', pollMs: 20, timeoutMs: 500, streams: { top: { id: 1, path: '/video/1.mjpg' }, close: { id: 2, path: '/video/2.mjpg' } } };
  const store = freshStore({ connect() {}, startCamera: async () => { cameraCommands += 1; } }, {}, { wsUrl: 'wss://hmi.example.net/ws/hmi', cameras: { bridge } });
  assert.equal(store.videoBridge(), true);
  assert.deepEqual(store.cameraIds(), ['top', 'close']);
  assert.equal(store.primaryCamera(), 'top');
  assert.equal(store.cameraSource('top').streaming, false);
  assert.equal(store.videoPhase('top'), null); // 꺼져 있으면 모른다
  await store.startCamera();
  assert.equal(cameraCommands, 0); // 서버 명령을 보내지 않는다 (서버에 카메라 명령이 없다)
  const src = store.cameraSource('top');
  assert.deepEqual([src.streaming, src.transport, src.url, src.videoId], [true, 'bridge', 'https://hmi.example.net/video/1.mjpg', 1]);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(asked[0], 'https://hmi.example.net/video/status');
  assert.equal(store.videoPhase('top'), 'live');
  assert.equal(store.videoPhase('close'), 'none');
  store.selectCamera('close');
  assert.equal(store.primaryCamera(), 'close');
  await store.stopCamera();
  assert.equal(store.videoPhase('close'), null);
  const n = asked.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(asked.length, n); // 끄면 더 묻지 않는다
});

test('store.js: 로봇팔이 옮길 부품 — 서버가 알려 주면 그 값, 아니면 서버가 받은 마지막 값(이 HMI), 거절되면 기억하지 않음', async () => {
  let handlers = null;
  let reply = async () => ({ reply: { executed: true } });
  const store = freshStore({ connect(h) { handlers = h; }, getInfo: async () => null, getStatus: async () => ({}), getHistory: async () => null, setSortTarget: (v) => reply(v) });
  store.start();
  handlers.onOpen();
  await tick();
  assert.deepEqual(store.sortTarget(), { value: null, from: null });
  await store.setSortTarget('good');
  assert.deepEqual(store.sortTarget(), { value: 'good', from: 'local' });
  reply = async () => { const e = new Error('x'); e.code = 'XML_INVALID_COMMAND'; e.details = { command: 'SetSortTarget' }; throw e; };
  await assert.rejects(store.setSortTarget('defect'));
  assert.equal(store.sortTarget().value, 'good');
  handlers.onMessage({ type: 'status', data: { sortTarget: 'defect' } });
  assert.deepEqual(store.sortTarget(), { value: 'defect', from: 'server' });
  assert.equal(store.errorText({ code: 'XML_INVALID_COMMAND', details: { command: 'SetSortTarget' } }), 'error.sortTarget.unsupported');
  assert.equal(store.errorText({ code: 'XML_UNKNOWN_COMMAND', details: { command: 'SetSortTarget' } }), 'error.sortTarget.unsupported');
});

test('store.js: 퍼센트로 온 관절(그리퍼)은 화면에서 도로 바꿔 보인다 — 범위는 config/robot.js percentToDeg(없으면 0~100°), 도는 그대로', () => {
  const store = freshStore({ connect() {}, getInfo: async () => null, getStatus: async () => ({}), getHistory: async () => null });
  assert.equal(store.shownAngle('gripper', 10, 'pct'), 10); // 범위를 적지 않으면 0~100% → 0~100°
  assert.equal(store.shownAngle('elbow_flex', -12.5, 'deg'), -12.5);
  assert.equal(store.shownAngle('gripper', undefined, 'pct'), undefined);
  window.HMI_ROBOT.percentToDeg = { gripper: [0, 120] }; // 캘리브레이션 범위를 알면 바꾸는 값
  assert.equal(store.shownAngle('gripper', 50, 'pct'), 60);
  assert.equal(store.shownAngle('wrist_roll', -50, 'pct'), -50);
});

// 밖 주소(Cloudflare Worker)의 로그인: 원점 잡기만 로그인해야 하고, 원점은 Worker 한 곳에 둔다 (사용자 2026-10-27)
const ANGLES = { shoulder_pan: 1, shoulder_lift: -2, elbow_flex: 3, wrist_flex: -4, wrist_roll: 5, gripper: 6 };

test('store.js: 로그인이 있는 곳에서 로그인하지 않으면 원점 잡기를 LOGIN_REQUIRED로 막고, 로그인하면 저장하며, Worker가 로그인이 끝났다고 하면 화면도 로그아웃', async (t) => {
  const auth = { state: { checked: true, available: true, loggedIn: false, until: null }, subscribe: () => () => {}, check() {}, expired() { this.state.loggedIn = false; } };
  window.HmiAuth = auth;
  t.after(() => { delete window.HmiAuth; });
  let handlers = null;
  const saves = [];
  const store = freshStore({ connect(h) { handlers = h; }, getInfo: async () => null, getHistory: async () => null, getStatus: async () => ({}) }, { statusPollMs: 0 }, undefined, {
    remote: () => true,
    save: async (pose) => { saves.push(pose); return Object.assign({ setAt: new Date().toISOString() }, pose); },
  });
  store.start();
  handlers.onOpen();
  handlers.onMessage({ type: 'status', data: { mode: 'manual' } });
  handlers.onMessage({ type: 'joints', data: { source: 'leader', unit: 'deg', angles: ANGLES, units: {} } });
  await tick();
  assert.equal(store.loginNeeded(), true);
  assert.equal(store.homeShared(), true);
  await assert.rejects(store.saveHome(), (e) => e.code === 'LOGIN_REQUIRED');
  assert.equal(saves.length, 0);

  auth.state.loggedIn = true;
  assert.equal(store.loginNeeded(), false);
  const res = await store.saveHome();
  assert.deepEqual(res.home.angles, ANGLES);
  assert.deepEqual(store.state.home.angles, ANGLES);

  window.HmiHome.save = async () => { throw Object.assign(new Error('LOGIN_REQUIRED'), { code: 'LOGIN_REQUIRED' }); };
  await assert.rejects(store.saveHome(), (e) => e.code === 'LOGIN_REQUIRED');
  assert.equal(auth.state.loggedIn, false);

  auth.state.checked = false; // 로그인이 있는 곳인지 아직 모르면 어디에 저장할지 몰라 막는다
  await assert.rejects(store.saveHome(), (e) => e.code === 'LOGIN_UNKNOWN');
});

test('store.js: 로그인이 없는 곳(장비망 안)은 지금처럼 — 로그인 없이 원점 잡기', async () => {
  let handlers = null;
  const store = freshStore({ connect(h) { handlers = h; }, getInfo: async () => null, getHistory: async () => null, getStatus: async () => ({}) }, { statusPollMs: 0 });
  store.start();
  handlers.onOpen();
  handlers.onMessage({ type: 'status', data: { mode: 'manual' } });
  handlers.onMessage({ type: 'joints', data: { source: 'leader', unit: 'deg', angles: ANGLES, units: {} } });
  await tick();
  assert.equal(store.loginNeeded(), false);
  assert.equal(store.loginUnknown(), false);
  assert.equal(store.homeShared(), false);
  assert.deepEqual((await store.saveHome()).home.angles, ANGLES);
});

test('store.js: 원점을 Worker에 둘 때 원점 복귀 · 자동 시작은 Worker의 원점을 다시 읽은 뒤 — 읽지 못하면 가진 값으로 (다르면 Worker가 거절)', async () => {
  let handlers = null;
  let notify = null;
  let remote = { angles: ANGLES, units: {}, setAt: '2026-10-27T00:00:00Z', source: 'leader' };
  let reads = 0;
  const sent = [];
  const store = freshStore({
    connect(h) { handlers = h; }, getInfo: async () => null, getHistory: async () => null, getStatus: async () => ({}),
    home: async (h) => { sent.push(h); return {}; },
    start: async () => { sent.push('start'); return {}; },
  }, { statusPollMs: 0 }, undefined, {
    remote: () => true,
    subscribe: (fn) => { notify = fn; return () => {}; },
    refresh: async () => { reads += 1; notify(remote); return remote; },
  });
  store.start();
  handlers.onOpen();
  handlers.onMessage({ type: 'status', data: { mode: 'auto' } });
  await tick();
  assert.equal(store.state.home, null); // 아직 읽지 않음 — 자동 시작이 원점 없음으로 막혀 보인다
  await store.startLine(); // 다른 HMI가 그 사이 저장했을 수 있어 한 번 읽고 시작
  assert.deepEqual(sent, ['start']);
  await store.goHome();
  assert.deepEqual(sent[1], remote);
  assert.equal(reads, 2);

  window.HmiHome.refresh = async () => { throw Object.assign(new Error('HOME_LOAD_FAILED'), { code: 'HOME_LOAD_FAILED' }); };
  await store.goHome(); // 읽지 못해도 가진 원점으로 보낸다
  assert.deepEqual(sent[2], remote);

  remote = null; // 다른 곳에서 원점이 없어짐
  window.HmiHome.refresh = async () => { notify(remote); return remote; };
  await assert.rejects(store.goHome(), (e) => e.code === 'HOME_NOT_SET');
  await assert.rejects(store.startLine(), (e) => e.code === 'HOME_NOT_SET');
});
