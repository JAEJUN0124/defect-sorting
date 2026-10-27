// 원점 저장(js/home.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 원점은 서버가 아니라 HMI가 브라우저 저장소에 둔다. 저장소가 막힌 브라우저에서도 이 창 안에서는 기억한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;

const POSE = { shoulder_pan: 1.5, shoulder_lift: -2, elbow_flex: 3, wrist_flex: 4, wrist_roll: 5, gripper: 60 };

function fresh(storage) {
  const full = path.join(__dirname, '..', 'js', 'home.js');
  delete require.cache[require.resolve(full)];
  if (storage === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { if (storage === 'blocked') throw new Error('SecurityError'); return storage; } });
  require(full);
  return window.HmiHome;
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('저장하고 다시 읽는다 (다른 창이 열어도 같은 값)', () => {
  const ls = memoryStorage();
  const H = fresh(ls);
  assert.equal(H.read(), null);
  const saved = H.save({ angles: POSE, units: { gripper: 'pct' }, source: 'leader' });
  assert.deepEqual(saved.angles, POSE);
  assert.deepEqual(saved.units, { shoulder_pan: 'deg', shoulder_lift: 'deg', elbow_flex: 'deg', wrist_flex: 'deg', wrist_roll: 'deg', gripper: 'pct' });
  assert.equal(saved.source, 'leader');
  assert.ok(Date.parse(saved.setAt));
  assert.equal(H.persisted(), true);
  const again = fresh(ls); // 새로 연 화면
  assert.deepEqual(again.read(), saved);
});

test('여섯 관절이 모두 숫자가 아니면 저장하지 않고, 망가진 저장값은 없는 것으로', () => {
  const ls = memoryStorage();
  const H = fresh(ls);
  assert.equal(H.save({ angles: Object.assign({}, POSE, { gripper: null }) }), null);
  assert.equal(H.read(), null);
  ls.setItem(H.KEY, '{망가짐');
  assert.equal(H.read(), null);
  ls.setItem(H.KEY, JSON.stringify({ angles: { shoulder_pan: 1 } }));
  assert.equal(H.read(), null);
});

test('저장소가 막힌 브라우저: 이 창에서만 기억하고 그렇다고 알린다', () => {
  const H = fresh('blocked');
  assert.equal(H.read(), null);
  const saved = H.save({ angles: POSE, source: 'arm' });
  assert.ok(saved);
  assert.equal(H.persisted(), false);
  assert.deepEqual(H.read(), saved);
});

// 밖 주소(Cloudflare Worker): 원점을 Worker 한 곳에 둔다 (사용자 2026-10-27). fetch를 흉내 낸다
function fakeWorker(t, answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
    const r = await answer(init.method || 'GET', init.body ? JSON.parse(init.body) : undefined);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

test('Worker에 둘 때: 읽어 오기 전에는 없고 이 브라우저에 저장한 원점은 쓰지 않으며, 다시 읽어 바뀌면 알린다', async (t) => {
  const ls = memoryStorage();
  const H = fresh(ls);
  H.save({ angles: POSE, source: 'arm' }); // 예전에 이 브라우저에 저장한 원점
  let stored = { angles: Object.assign({}, POSE, { gripper: 40 }), units: { gripper: 'pct' }, setAt: '2026-10-27T01:00:00.000Z', source: 'leader' };
  const calls = fakeWorker(t, () => ({ status: 200, body: { home: stored } }));
  const seen = [];
  H.subscribe((h) => seen.push(h && h.angles.gripper));
  H.useRemote('/home');
  assert.equal(H.remote(), true);
  assert.equal(H.read(), null);
  const h = await H.refresh();
  assert.equal(h.angles.gripper, 40);
  assert.deepEqual(H.read(), h);
  await H.refresh(); // 같으면 알리지 않는다
  stored = null; // 다른 곳에서 지움
  assert.equal(await H.refresh(), null);
  assert.deepEqual(seen, [null, 40, null]);
  assert.deepEqual(calls.map((c) => c.url + ' ' + c.method), ['/home GET', '/home GET', '/home GET']);
});

test('Worker에 둘 때: 저장은 PUT(JSON)이고 Worker의 저장 시각을 쓴다. 401 → LOGIN_REQUIRED, 400 → HOME_INVALID, 닿지 않음 → HOME_SAVE_FAILED', async (t) => {
  const H = fresh(memoryStorage());
  let status = 200;
  const calls = fakeWorker(t, (method, body) => {
    if (status === 'down') return new Error('offline');
    return { status, body: status === 200 ? { home: Object.assign({}, body.home, { setAt: '2026-10-27T02:00:00.000Z' }) } : { error: 'x' } };
  });
  H.useRemote('/home');
  const saved = await H.save({ angles: POSE, units: { gripper: 'pct' }, source: 'leader' });
  assert.equal(saved.setAt, '2026-10-27T02:00:00.000Z');
  assert.deepEqual(H.read(), saved);
  assert.equal(H.persisted(), true);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.deepEqual(calls[0].body.home.angles, POSE);
  for (const [s, code] of [[401, 'LOGIN_REQUIRED'], [400, 'HOME_INVALID'], [500, 'HOME_SAVE_FAILED'], ['down', 'HOME_SAVE_FAILED']]) {
    status = s;
    await assert.rejects(H.save({ angles: POSE }), (err) => err.code === code, String(s));
  }
  assert.deepEqual(H.read(), saved); // 실패한 저장은 원점을 바꾸지 않는다
  assert.equal(H.save({ angles: Object.assign({}, POSE, { gripper: null }) }), null); // 여섯 관절이 없으면 보내지도 않음
  status = 'down';
  await assert.rejects(H.refresh(), (err) => err.code === 'HOME_LOAD_FAILED');
  assert.deepEqual(H.read(), saved);
});
