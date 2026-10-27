// 로그인 — 밖 주소(Cloudflare Worker, docs/cloudflare.md)에만 있습니다. 공용 비밀번호 하나로 로그인하고,
// 로그인으로 바뀌는 것은 원점 잡기뿐입니다. 로그인하지 않아도 다른 기능은 모두 씁니다 (사용자 2026-10-27).
// 화면을 내준 곳이 /auth/session에 JSON으로 답하지 않으면(장비망 안 dev-server.py · 개발 서버 · 파일로 열기) 로그인이 없는 HMI로 동작합니다.
// 로그인 쿠키(HttpOnly)는 Worker가 다루고, 여기서는 로그인했는지와 끝나는 시각만 압니다.
(function (root) {
  'use strict';

  const BASE = '/auth/';
  const RETRY_MS = [3000, 10000, 30000, 60000]; // 처음 확인이 네트워크 문제로 실패하면 다시 묻는 간격
  // checked: 이 주소에 로그인이 있는지 알았음 · available: 로그인이 있음(밖 주소) · loggedIn · until: 로그인이 끝나는 ISO 시각
  const state = { checked: false, available: false, loggedIn: false, until: null };
  const listeners = new Set();
  let expiry = null;
  let retry = null;
  let tries = 0;

  const failure = (code) => Object.assign(new Error(code), { code });

  function set(next) {
    Object.assign(state, next);
    if (!state.loggedIn) state.until = null;
    clearTimeout(expiry);
    // 끝나는 시각이 지나면 화면도 로그아웃으로 바꾼다 (쿠키는 브라우저가 지운다)
    const left = state.loggedIn && state.until ? Date.parse(state.until) - Date.now() : NaN;
    if (left > 0) expiry = setTimeout(() => set({ loggedIn: false }), Math.min(left, 2147483647));
    else if (state.loggedIn && state.until) { state.loggedIn = false; state.until = null; }
    const snapshot = Object.assign({}, state);
    listeners.forEach((fn) => fn(snapshot));
  }

  async function call(path, init) {
    const res = await root.fetch(BASE + path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init));
    let body = null;
    if ((res.headers.get('Content-Type') || '').includes('application/json')) {
      try { body = await res.json(); } catch (e) { body = null; }
    }
    return { status: res.status, body };
  }

  // 이 주소에 로그인이 있는지와 지금 로그인했는지. 화면을 열 때와 탭이 다시 보일 때 묻는다.
  // 답이 JSON이 아니면(개발 서버는 없는 주소에도 화면 HTML을 줌) 로그인이 없는 곳이다. 네트워크 실패면 조금 뒤 다시 묻는다
  async function check() {
    clearTimeout(retry);
    if (!/^https?:$/.test(root.location ? root.location.protocol : '')) {
      set({ checked: true, available: false, loggedIn: false });
      return state;
    }
    let r;
    try { r = await call('session'); } catch (e) { r = null; }
    if (!r) {
      if (!state.checked) retry = setTimeout(check, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
      return state;
    }
    tries = 0;
    const ok = r.status === 200 && !!r.body && typeof r.body.loggedIn === 'boolean';
    set({ checked: true, available: ok, loggedIn: ok && r.body.loggedIn, until: ok ? r.body.until || null : null });
    return state;
  }

  // 실패하면 code: LOGIN_WRONG(비밀번호 틀림) · LOGIN_TOO_MANY(시도가 많음) · LOGIN_NOT_CONFIGURED(Worker에 비밀번호 없음) ·
  // LOGIN_NETWORK(닿지 않음) · LOGIN_FAILED(그 밖)
  async function login(password) {
    let r;
    try {
      r = await call('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    } catch (e) { throw failure('LOGIN_NETWORK'); }
    if (r.status === 200 && r.body && r.body.loggedIn === true) {
      set({ checked: true, available: true, loggedIn: true, until: r.body.until || null });
      return state;
    }
    const code = { 401: 'LOGIN_WRONG', 429: 'LOGIN_TOO_MANY' }[r.status]
      || (r.status === 500 && r.body && r.body.error === 'NOT_CONFIGURED' ? 'LOGIN_NOT_CONFIGURED' : 'LOGIN_FAILED');
    throw failure(code);
  }

  // 로그아웃은 답을 기다리지 않고 화면부터 바꾼다 — 쿠키를 못 지웠어도 끝나는 시각이 지나면 무효
  async function logout() {
    set({ loggedIn: false });
    try { await call('logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { /* 위 설명 */ }
  }

  // Worker가 로그인이 필요하다고 답함(401) — 로그인이 끝났거나 다른 곳에서 비밀번호를 바꿈
  function expired() {
    if (state.loggedIn) set({ loggedIn: false });
  }

  root.HmiAuth = {
    state,
    check,
    login,
    logout,
    expired,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
