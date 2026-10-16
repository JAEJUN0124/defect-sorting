// 화면 공통 상태(js/store.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 서버 연결은 가짜(HmiApi 흉내)로 바꾸고, 받은 메시지를 store가 어떻게 모으는지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;

const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const tick = () => new Promise((r) => setTimeout(r, 10));

// store.js를 새로 불러온다. 가짜 서버 연결이 받은 handlers(onOpen·onClose·onMessage)로 메시지를 넣는다
function freshStore(api) {
  window.HMI_CONFIG = { useMock: false, server: { xml: {} }, cameras: {}, heartbeatTimeoutMs: 0 };
  window.HMI_ROBOT = {};
  window.I18N = { t: (k) => k };
  window.HmiHome = { JOINTS, read: () => null, save: () => null, subscribe: () => () => {}, persisted: () => null };
  window.HmiApi = Object.assign({ xml: true, reconnect() {}, close() {} }, api);
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

test('store.js: stop()은 서버 연결을 닫는다 (프로그램 종료 — 이 HMI만 끝낸다)', () => {
  let closed = 0;
  const store = freshStore({ connect() {}, close() { closed += 1; } });
  store.start();
  store.stop();
  assert.equal(closed, 1);
});
