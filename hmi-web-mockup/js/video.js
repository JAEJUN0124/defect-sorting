// 브릿지 서버의 카메라 영상 (서버 담당 안내 2026-10-17 — docs/hmi-video-integration.md).
// XML 서버(/ws/hmi)와 같은 호스트·포트에서 HTTP로 받는다: 영상은 MJPEG(/video/1.mjpg 탑뷰 · /video/2.mjpg 그리퍼), 수신 상태는 JSON(/video/status).
// XML Status에는 Camera가 없고 CameraStart·CameraStop도 없다 — HMI가 주소를 직접 열고 닫는다. 카메라 상태는 /video/status로만 본다 (안내 7장).
//   urls(cfg)          웹소켓 주소에서 영상 주소를 만든다 (ws → http, wss → https, 같은 호스트·포트 — HMI 화면의 주소가 아니라)
//   classify(st, id)   상태 JSON + 서버 카메라 번호 → 화면에 보일 단계 (안내 5장의 표)
//   createPoller(opt)  앞 조회가 끝난 뒤 다음 조회를 예약한다 (요청이 겹치지 않게). 제한 시간을 넘으면 "확인 불가"
(function (root) {
  'use strict';

  // 영상 주소의 기준: 붙은 웹소켓 서버의 호스트·포트 (안내 2장)
  function origin(wsUrl) {
    const u = new URL(wsUrl);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.origin;
  }

  // config.js cameras.bridge → { status, streams: { HMI 카메라 이름: { id: 서버 카메라 번호, url } } }. 설정이 없으면 null
  function urls(cfg) {
    const b = cfg.cameras && cfg.cameras.bridge;
    if (!b) return null;
    const base = origin(cfg.wsUrl);
    const streams = {};
    Object.entries(b.streams || {}).forEach(([name, s]) => { streams[name] = { id: s.id, url: new URL(s.path, base).href }; });
    return { status: new URL(b.statusPath || '/video/status', base).href, streams };
  }

  // 안내 5장: 상태를 못 읽음 → 'unknown'(확인 불가) · 아직 한 번도 안 읽음 → 'checking' · connected=false → 'waiting'(설비 영상 연결 대기) ·
  // available=false이고 receivedAt 없음 → 'none'(미수신) · available=false이고 receivedAt 있음 → 'stale'(5초 넘게 새 영상 없음) · available=true → 'live'.
  // 카메라는 배열 순서가 아니라 id(숫자)로 찾는다
  function classify(status, videoId, error) {
    if (error) return 'unknown';
    if (!status) return 'checking';
    if (status.connected !== true) return 'waiting';
    const list = Array.isArray(status.cameras) ? status.cameras : [];
    const cam = list.find((c) => c && Number(c.id) === Number(videoId));
    if (!cam) return 'none';
    if (cam.available === true) return 'live';
    return cam.receivedAt ? 'stale' : 'none';
  }

  // 상태 조회: 한 번 끝난 뒤 pollMs 뒤에 다음을 묻는다. 숨은 탭에서는 묻지 않고 쉰다 —
  // 밖에서 여는 HMI(Cloudflare Worker)는 조회 하나가 Worker 요청 하나라서 쓸데없이 늘리지 않는다
  function createPoller(options) {
    const o = Object.assign({ pollMs: 1000, timeoutMs: 3000 }, options);
    const fetchFn = o.fetch || ((url, init) => root.fetch(url, init));
    const doc = o.document !== undefined ? o.document : root.document;
    const listeners = new Set();
    const state = { status: null, error: null, at: 0 };
    let running = false;
    let timer = 0;
    let controller = null;

    const emit = () => listeners.forEach((fn) => { try { fn(state); } catch (err) { /* 다른 구독자는 계속 */ } });

    async function once() {
      timer = 0;
      if (!running) return;
      if (doc && doc.hidden) { timer = setTimeout(once, o.pollMs); return; }
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      const giveUp = setTimeout(() => { if (controller) controller.abort(); }, o.timeoutMs);
      try {
        const res = await fetchFn(o.url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller ? controller.signal : undefined });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        state.status = await res.json();
        state.error = null;
      } catch (err) {
        state.status = null;
        state.error = err && err.name === 'AbortError' ? 'timeout' : 'unreachable';
      } finally {
        clearTimeout(giveUp);
        controller = null;
      }
      if (!running) return; // 그사이 껐다
      state.at = Date.now();
      emit();
      timer = setTimeout(once, o.pollMs);
    }

    return {
      state,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      start() {
        if (running) return;
        running = true;
        state.status = null;
        state.error = null;
        once();
      },
      stop() {
        running = false;
        clearTimeout(timer);
        timer = 0;
        if (controller) controller.abort();
      },
      get running() { return running; },
    };
  }

  root.HmiVideo = { origin, urls, classify, createPoller };
})(typeof window !== 'undefined' ? window : globalThis);
