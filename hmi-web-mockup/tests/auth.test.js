// 로그인(js/auth.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 밖 주소(Cloudflare Worker)에만 로그인이 있고, 로그인으로 바뀌는 것은 원점 잡기뿐이다 (사용자 2026-10-27).
// /auth/session이 JSON으로 답하지 않는 곳(장비망 안 · 개발 서버 · 파일)은 로그인이 없는 HMI로 본다
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;

// auth.js를 새로 불러온다. answer(path, init) → { status, body, type } 또는 Error(닿지 않음)
function fresh(t, answer, protocol = 'https:') {
  const calls = [];
  const real = { fetch: globalThis.fetch, location: globalThis.location };
  globalThis.location = { protocol };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const r = await answer(url, init);
    if (r instanceof Error) throw r;
    const type = r.type || 'application/json; charset=utf-8';
    return { status: r.status, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) }, json: async () => r.body };
  };
  t.after(() => { globalThis.fetch = real.fetch; globalThis.location = real.location; });
  const full = path.join(__dirname, '..', 'js', 'auth.js');
  delete require.cache[require.resolve(full)];
  require(full);
  const A = window.HmiAuth;
  t.after(() => A.expired()); // 로그인이 끝나는 시각의 타이머가 시험 프로세스를 붙잡지 않게
  return { A, calls };
}

const soon = (ms) => new Date(Date.now() + ms).toISOString();

test('auth.js: Worker가 JSON으로 답하면 로그인이 있는 곳, 개발 서버(화면 HTML) · 404 · 파일로 열기는 로그인이 없는 곳', async (t) => {
  let r = await fresh(t, () => ({ status: 200, body: { loggedIn: false, until: null } })).A.check();
  assert.deepEqual({ ...r }, { checked: true, available: true, loggedIn: false, until: null });
  r = await fresh(t, () => ({ status: 200, type: 'text/html', body: null })).A.check(); // Vite는 없는 주소에도 index.html
  assert.equal(r.available, false);
  assert.equal(r.checked, true);
  r = await fresh(t, () => ({ status: 404, type: 'text/plain', body: null })).A.check(); // dev-server.py
  assert.equal(r.available, false);
  r = await fresh(t, () => ({ status: 200, body: { hello: 1 } })).A.check(); // 다른 JSON
  assert.equal(r.available, false);
  const file = fresh(t, () => ({ status: 200, body: { loggedIn: true } }), 'file:');
  r = await file.A.check();
  assert.equal(r.available, false);
  assert.equal(file.calls.length, 0); // 파일로 열면 묻지도 않는다
});

test('auth.js: 처음 확인이 닿지 않으면 아직 모름으로 두고 조금 뒤 다시 묻는다', async (t) => {
  let online = false;
  const timers = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0; };
  t.after(() => { globalThis.setTimeout = realSetTimeout; });
  const { A } = fresh(t, () => (online ? { status: 200, body: { loggedIn: true, until: soon(3600e3) } } : new Error('offline')));
  await A.check();
  assert.equal(A.state.checked, false);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 1000);
  online = true;
  await timers[0].fn();
  assert.equal(A.state.checked, true);
  assert.equal(A.state.loggedIn, true);
});

test('auth.js: 로그인하면 끝나는 시각과 함께 알리고, 실패는 이유 코드로 (401 · 429 · 설정 없음 · 닿지 않음)', async (t) => {
  let reply = { status: 200, body: { loggedIn: true, until: soon(3600e3) } };
  const { A, calls } = fresh(t, (url) => (url === '/auth/session' ? { status: 200, body: { loggedIn: false, until: null } } : reply));
  await A.check();
  const seen = [];
  A.subscribe((s) => seen.push(s.loggedIn));
  await A.login('team password');
  assert.equal(A.state.loggedIn, true);
  assert.ok(Date.parse(A.state.until) > Date.now());
  const sent = calls.find((c) => c.url === '/auth/login');
  assert.equal(sent.method, 'POST');
  assert.deepEqual(JSON.parse(sent.body), { password: 'team password' });
  for (const [r, code] of [
    [{ status: 401, body: { error: 'WRONG_PASSWORD' } }, 'LOGIN_WRONG'],
    [{ status: 429, body: { error: 'TOO_MANY' } }, 'LOGIN_TOO_MANY'],
    [{ status: 500, body: { error: 'NOT_CONFIGURED' } }, 'LOGIN_NOT_CONFIGURED'],
    [{ status: 502, type: 'text/html', body: null }, 'LOGIN_FAILED'],
    [new Error('offline'), 'LOGIN_NETWORK'],
  ]) {
    reply = r;
    await assert.rejects(A.login('x'), (err) => err.code === code, code);
  }
  assert.deepEqual(seen, [true]);
});

test('auth.js: 끝나는 시각이 지나면 로그아웃으로, Worker가 401로 답하면(expired) 로그아웃으로, 로그아웃은 답을 기다리지 않음', async (t) => {
  let until = soon(30);
  const { A, calls } = fresh(t, (url) => (url === '/auth/session' ? { status: 200, body: { loggedIn: true, until } } : new Error('offline')));
  await A.check();
  assert.equal(A.state.loggedIn, true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(A.state.loggedIn, false);
  assert.equal(A.state.until, null);

  until = new Date(Date.now() - 1000).toISOString(); // 이미 끝난 시각을 받음
  await A.check();
  assert.equal(A.state.loggedIn, false);

  until = soon(3600e3);
  await A.check();
  A.expired();
  assert.equal(A.state.loggedIn, false);

  await A.check();
  const done = A.logout(); // 닿지 않아도 화면은 곧바로 로그아웃
  assert.equal(A.state.loggedIn, false);
  await done;
  assert.equal(calls.filter((c) => c.url === '/auth/logout').length, 1);
});
