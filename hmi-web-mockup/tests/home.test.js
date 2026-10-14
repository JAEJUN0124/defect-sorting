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
