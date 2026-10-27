// 브릿지 서버 영상(js/video.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 서버 담당 안내(docs/hmi-video-integration.md)대로 영상 주소를 만들고, 상태 JSON을 화면 단계로 나누고, 상태를 겹치지 않게 묻는지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../js/video.js');
const V = window.HmiVideo;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cam = (id, available, receivedAt) => ({ id, available, receivedAt, sourceTimestampMs: receivedAt ? 1 : null, sequence: receivedAt ? 3 : null });

test('urls: 웹소켓 서버의 호스트·포트로 (ws → http, wss → https) — HMI 화면의 주소가 아니라', () => {
  const cfg = (wsUrl) => ({ wsUrl, cameras: { bridge: { statusPath: '/video/status', streams: { top: { id: 1, path: '/video/1.mjpg' }, close: { id: 2, path: '/video/2.mjpg' } } } } });
  const lan = V.urls(cfg('ws://192.168.219.101:8000/ws/hmi'));
  assert.equal(lan.status, 'http://192.168.219.101:8000/video/status');
  assert.deepEqual(lan.streams, { top: { id: 1, url: 'http://192.168.219.101:8000/video/1.mjpg' }, close: { id: 2, url: 'http://192.168.219.101:8000/video/2.mjpg' } });
  const outside = V.urls(cfg('wss://hmi.hypefree.net/ws/hmi'));
  assert.equal(outside.status, 'https://hmi.hypefree.net/video/status');
  assert.equal(outside.streams.close.url, 'https://hmi.hypefree.net/video/2.mjpg');
  assert.equal(V.urls({ wsUrl: 'ws://x/ws/hmi', cameras: { bridge: null } }), null);
});

test('classify: 안내 5장의 표 — 연결 대기 · 미수신 · 5초 넘게 새 영상 없음 · 영상 · 확인 불가, 카메라는 순서가 아니라 id로', () => {
  const status = (connected, cams) => ({ connected, freshnessMs: 5000, cameras: cams });
  assert.equal(V.classify(null, 1, null), 'checking');
  assert.equal(V.classify(null, 1, 'timeout'), 'unknown');
  assert.equal(V.classify(status(true, [cam(1, true, 'x')]), 1, 'unreachable'), 'unknown'); // 상태를 못 읽으면 지난 값을 믿지 않는다
  assert.equal(V.classify(status(false, [cam(1, false, null)]), 1, null), 'waiting');
  const st = status(true, [cam(2, true, '2026-10-17T06:00:00+00:00'), cam(1, false, null)]); // 배열 순서가 바뀌어도
  assert.equal(V.classify(st, 1, null), 'none');
  assert.equal(V.classify(st, 2, null), 'live');
  assert.equal(V.classify(st, '2', null), 'live');
  assert.equal(V.classify(status(true, [cam(1, false, '2026-10-17T06:00:00+00:00')]), 1, null), 'stale');
  assert.equal(V.classify(status(true, []), 1, null), 'none');
});

// 응답을 시험에서 정하는 fetch 흉내: 부를 때마다 기록하고, 정해 둔 약속을 돌려준다
function fakeFetch() {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let next = () => Promise.resolve({ ok: true, json: async () => ({ connected: true, cameras: [] }) });
  const fn = (url, init) => {
    calls.push({ url, init });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return next(init).finally(() => { inFlight -= 1; });
  };
  return { fn, calls, set(f) { next = f; }, get maxInFlight() { return maxInFlight; } };
}

test('createPoller: 앞 조회가 끝난 뒤 다음을 예약해 겹치지 않고, 결과를 알린다 (캐시 안 함)', async (t) => {
  const f = fakeFetch();
  f.set(() => sleep(30).then(() => ({ ok: true, json: async () => ({ connected: true, cameras: [cam(1, true, 'x')] }) })));
  const p = V.createPoller({ url: 'http://s/video/status', pollMs: 10, timeoutMs: 500, fetch: f.fn, document: { hidden: false } });
  const seen = [];
  p.subscribe((st) => seen.push(V.classify(st.status, 1, st.error)));
  p.start();
  t.after(() => p.stop());
  await sleep(200);
  assert.ok(f.calls.length >= 3, String(f.calls.length));
  assert.equal(f.maxInFlight, 1);
  assert.equal(f.calls[0].url, 'http://s/video/status');
  assert.equal(f.calls[0].init.cache, 'no-store');
  assert.ok(seen.length >= 2 && seen.every((s) => s === 'live'));
});

test('createPoller: 제한 시간을 넘거나 서버가 오류면 "확인 불가"로 알리고 계속 묻는다', async (t) => {
  const f = fakeFetch();
  f.set((init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  }));
  const p = V.createPoller({ url: 'http://s/video/status', pollMs: 10, timeoutMs: 40, fetch: f.fn, document: { hidden: false } });
  const seen = [];
  p.subscribe((st) => seen.push(st.error));
  p.start();
  t.after(() => p.stop());
  await sleep(150);
  assert.equal(seen[0], 'timeout');
  assert.equal(p.state.status, null);
  f.set(() => Promise.resolve({ ok: false, status: 503, json: async () => ({}) }));
  await sleep(120);
  assert.equal(seen.at(-1), 'unreachable');
  assert.ok(f.calls.length >= 3);
});

test('createPoller: 끄면 더 묻지 않고, 숨은 탭에서는 묻지 않고 쉰다', async (t) => {
  const f = fakeFetch();
  const doc = { hidden: true };
  const p = V.createPoller({ url: 'http://s/video/status', pollMs: 10, timeoutMs: 100, fetch: f.fn, document: doc });
  p.start();
  t.after(() => p.stop());
  await sleep(80);
  assert.equal(f.calls.length, 0); // 숨은 탭
  doc.hidden = false;
  await sleep(80);
  assert.ok(f.calls.length >= 1);
  p.stop();
  const n = f.calls.length;
  await sleep(80);
  assert.equal(f.calls.length, n);
  assert.equal(p.running, false);
});
