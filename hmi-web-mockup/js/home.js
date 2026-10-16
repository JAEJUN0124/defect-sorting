// 원점 저장 — 원점은 서버가 아니라 HMI가 이 브라우저에 저장합니다 (사용자 2026-10-14, docs/xml-protocol.md 3장).
// 수동 모드의 "원점 잡기"가 로봇팔의 지금 6축 각도를 여기에 저장하고, 자동 모드의 "원점 복귀"가 이 각도를 서버에 보냅니다.
// 조작 화면을 여러 창에 띄워도 같은 저장소를 쓰고, 다른 창에서 바꾸면 곧바로 따라갑니다.
// 브라우저 저장소(localStorage)가 막힌 환경이면 이 창에서만 기억하고 창을 닫으면 잊습니다.
// 저장 모양: { angles: { 관절: 값 }, units: { 관절: 'deg' | 'pct' }, setAt: ISO 시각, source: 'arm' | 'leader' }
(function (root) {
  'use strict';

  const KEY = 'hmi.home';
  const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  let memory = null;
  let persisted = null; // 마지막 저장이 브라우저 저장소에 들어갔는지 (null = 아직 저장 안 함)

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

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; } // 저장이 막힌 브라우저는 읽기만 해도 오류를 낸다
  }

  function read() {
    const ls = storage();
    if (ls) {
      try {
        const raw = ls.getItem(KEY);
        if (raw !== null) return valid(JSON.parse(raw));
      } catch (e) { /* 망가진 값은 없는 것으로 */ }
    }
    return memory;
  }

  // pose: { angles, units, source } → 저장한 원점 (setAt은 지금)
  function save(pose) {
    const h = valid(Object.assign({}, pose, { setAt: new Date().toISOString() }));
    if (!h) return null;
    memory = h;
    persisted = false;
    const ls = storage();
    if (ls) {
      try { ls.setItem(KEY, JSON.stringify(h)); persisted = true; } catch (e) { /* 이 창에서만 기억 */ }
    }
    return h;
  }

  // 다른 창(탭)에서 원점을 바꾸면 알린다. 같은 창의 저장은 save()를 부른 쪽이 알린다
  function subscribe(fn) {
    if (typeof root.addEventListener !== 'function') return () => {};
    const onStorage = (e) => { if (e.key === KEY || e.key === null) fn(read()); };
    root.addEventListener('storage', onStorage);
    return () => root.removeEventListener('storage', onStorage);
  }

  root.HmiHome = { KEY, JOINTS, read, save, subscribe, valid, persisted: () => persisted };
})(typeof window !== 'undefined' ? window : globalThis);
