// 화면 공통 상태(js/store.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 서버 연결은 가짜(HmiApi 흉내)로 바꾸고, 받은 메시지를 store가 어떻게 모으는지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;

const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const tick = () => new Promise((r) => setTimeout(r, 10));

// store.js를 새로 불러온다. 가짜 서버 연결이 받은 handlers(onOpen·onClose·onMessage)로 메시지를 넣는다
function freshStore(api, xml) {
  window.HMI_CONFIG = { useMock: false, server: { xml: Object.assign({}, xml) }, cameras: {}, heartbeatTimeoutMs: 0 };
  window.HMI_ROBOT = {};
  window.I18N = { t: (k) => k };
  window.HmiHome = { JOINTS, read: () => null, save: (pose) => Object.assign({ setAt: new Date().toISOString() }, pose), subscribe: () => () => {}, persisted: () => true };
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
