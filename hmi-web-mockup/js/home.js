// 원점 저장 — 원점은 서버가 아니라 HMI가 이 브라우저에 저장합니다 (사용자 2026-10-14, docs/xml-protocol.md 3장).
// 수동 모드의 "원점 잡기"가 로봇팔의 지금 6축 각도를 여기에 저장하고, 자동 모드의 "원점 복귀"가 이 각도를 서버에 보냅니다.
// 조작 화면을 여러 창에 띄워도 같은 저장소를 쓰고, 다른 창에서 바꾸면 곧바로 따라갑니다.
// 브라우저 저장소(localStorage)가 막힌 환경이면 이 창에서만 기억하고 창을 닫으면 잊습니다.
// 밖 주소(Cloudflare Worker)에서는 useRemote('/home')로 원점을 Worker 한 곳에 둡니다 — 그 주소로 연 모든 브라우저가 같은 원점을 쓰고,
// 저장은 로그인한 사람만 합니다 (사용자 2026-10-27, docs/cloudflare.md). 이때 save()는 Promise를 돌려줍니다.
// 저장 모양: { angles: { 관절: 값 }, units: { 관절: 'deg' | 'pct' }, setAt: ISO 시각, source: 'arm' | 'leader' }
(function (root) {
  'use strict';

  const KEY = 'hmi.home';
  const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  let memory = null;
  let persisted = null; // 마지막 저장이 브라우저 저장소에 들어갔는지 (null = 아직 저장 안 함)
  let remoteUrl = null; // Worker에 둘 때 그 주소 (null = 이 브라우저)
  let remoteHome = null; // Worker에서 마지막으로 읽은 원점
  const listeners = new Set();

  // 여섯 관절이 모두 숫자인 것만 원점으로 본다
  function valid(h) {
    if (!h || typeof h !== 'object' || !h.angles) return null;
    if (!JOINTS.every((j) => typeof h.angles[j] === 'number' && Number.isFinite(h.angles[j]))) return null;
    const units = {};
    JOINTS.forEach((j) => { units[j] = h.units && h.units[j] === 'pct' ? 'pct' : 'deg'; });
    return {
      angles: Object.fromEntries(JOINTS.map((j) => [j, h.angles[j]])),
      units,
      setAt: typeof h.setAt === 'string' ? h.setAt : null,
      source: h.source === 'leader' ? 'leader' : 'arm',
    };
  }

  // 화면 문구로 바꿀 수 있는 실패 (store.js errorText가 code로 고른다)
  const failure = (code) => Object.assign(new Error(code), { code });

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; } // 저장이 막힌 브라우저는 읽기만 해도 오류를 낸다
  }

  function read() {
    if (remoteUrl) return remoteHome;
    const ls = storage();
    if (ls) {
      try {
        const raw = ls.getItem(KEY);
        if (raw !== null) return valid(JSON.parse(raw));
      } catch (e) { /* 망가진 값은 없는 것으로 */ }
    }
    return memory;
  }

  function changed(h) {
    if (JSON.stringify(h) === JSON.stringify(remoteHome)) return;
    remoteHome = h;
    listeners.forEach((fn) => fn(h));
  }

  // 원점을 Worker에 둔다 (밖 주소). 지금까지 이 브라우저에 저장한 원점은 쓰지 않는다 — 읽어 오기 전에는 없는 것으로
  function useRemote(url) {
    if (remoteUrl === url) return;
    remoteUrl = url;
    remoteHome = null;
    listeners.forEach((fn) => fn(null));
  }

  // Worker에 저장된 원점을 다시 읽는다. 바뀌었으면 알린다. 읽지 못하면 지금 값을 그대로 두고 실패를 던진다
  async function refresh() {
    if (!remoteUrl) return read();
    let body = null;
    try {
      const res = await root.fetch(remoteUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (res.ok) body = await res.json();
    } catch (e) { /* 아래에서 실패로 */ }
    if (!body || typeof body !== 'object') throw failure('HOME_LOAD_FAILED');
    changed(valid(body.home));
    return remoteHome;
  }

  async function saveRemote(h) {
    let res;
    try {
      res = await root.fetch(remoteUrl, {
        method: 'PUT',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home: h }),
      });
    } catch (e) { throw failure('HOME_SAVE_FAILED'); }
    if (res.status === 401) throw failure('LOGIN_REQUIRED'); // 로그인하지 않았거나 로그인이 끝남
    if (res.status === 400) throw failure('HOME_INVALID');
    if (!res.ok) throw failure('HOME_SAVE_FAILED');
    let body = null;
    try { body = await res.json(); } catch (e) { /* 저장은 됐다 — 보낸 값으로 */ }
    const saved = valid(body && body.home) || h; // 저장 시각은 Worker 시계
    persisted = true;
    changed(saved);
    return saved;
  }

  // pose: { angles, units, source } → 저장한 원점 (setAt은 지금). 여섯 관절이 다 없으면 null.
  // Worker에 둘 때는 Promise (로그인하지 않았으면 code 'LOGIN_REQUIRED'로 실패)
  function save(pose) {
    const h = valid(Object.assign({}, pose, { setAt: new Date().toISOString() }));
    if (!h) return null;
    if (remoteUrl) return saveRemote(h);
    memory = h;
    persisted = false;
    const ls = storage();
    if (ls) {
      try { ls.setItem(KEY, JSON.stringify(h)); persisted = true; } catch (e) { /* 이 창에서만 기억 */ }
    }
    return h;
  }

  // 다른 창(탭)에서 원점을 바꾸면 알린다. 같은 창의 저장은 save()를 부른 쪽이 알린다.
  // Worker에 둘 때는 다시 읽어(refresh) 바뀌었을 때와 저장했을 때 알린다
  function subscribe(fn) {
    listeners.add(fn);
    const onStorage = (e) => { if (!remoteUrl && (e.key === KEY || e.key === null)) fn(read()); };
    if (typeof root.addEventListener === 'function') root.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(fn);
      if (typeof root.removeEventListener === 'function') root.removeEventListener('storage', onStorage);
    };
  }

  root.HmiHome = {
    KEY, JOINTS, read, save, subscribe, valid, useRemote, refresh,
    remote: () => !!remoteUrl,
    persisted: () => persisted,
  };
})(typeof window !== 'undefined' ? window : globalThis);
