// 가짜 서버 나눠 쓰기 — 조작 화면과 대시보드를 두 창(탭)에 띄워도 같은 가짜 서버를 보게 합니다.
// 한 탭만 가짜 서버(mock-server.js)를 돌리고, 다른 탭은 BroadcastChannel로 요청과 메시지를 주고받습니다.
// 서버는 화면에 보이는 탭이 맡습니다: 숨은 탭은 브라우저가 타이머를 크게 줄여(5분 뒤 1분에 한 번) 서버가 멈춘 것처럼 되기 때문입니다.
// 넘겨받는 탭은 마지막 상태·서보 값·지난 기록(순번·run_id)에서 이어 갑니다. 이 기능이 없는 환경(파일을 더블클릭해 연 경우 등)에서는 탭마다 따로 돌립니다.
(function (root) {
  'use strict';

  const CHANNEL = 'hmi-mock-v3';
  const LOCK = 'hmi-mock-server-v3';
  const REQUEST_TIMEOUT_MS = 5000;
  const HISTORY_KEEP = 500; // mock-server.js의 KEEP과 같게
  const MINUTES_KEEP = 180;
  const forever = () => new Promise(() => {});

  function local() {
    const server = new root.MockServer();
    return {
      mode: 'local',
      request: (method, path, body) => server.request(method, path, body),
      connect: (handlers) => server.connect(handlers),
      setDevice: (name, connected) => server.setDevice(name, connected),
      simulate: (kind, on) => server.simulate(kind, on),
    };
  }

  function shared() {
    const channel = new root.BroadcastChannel(CHANNEL);
    const locks = root.navigator.locks;
    const me = Math.random().toString(36).slice(2);
    let server = null; // 이 탭이 서버를 돌리면 여기에 있다
    let lastStatus = null; // 넘겨받을 때 이어 갈 마지막 상태
    const lastTelemetry = {}; // 넘겨받을 때 이어 갈 서보 값 { arm, leader }
    // 넘겨받을 때 이어 갈 지난 기록(GET /history) — run_id·순번이 이어져야 화면이 서버가 다시 켜진 것으로 보지 않는다
    let lastHistory = { runId: null, seq: 0, events: [], inspections: [], minutes: [] };
    let decided;
    const ready = new Promise((resolve) => { decided = resolve; });
    let welcomed;
    const welcome = new Promise((resolve) => { welcomed = resolve; });
    const local = []; // 이 탭의 연결 { handlers, conn, open }
    const pending = new Map();
    let nextReq = 1;

    const post = (msg) => channel.postMessage(Object.assign({ from: me }, msg));

    function remember(msg, runId) {
      if (!msg) return;
      if (runId) lastHistory.runId = runId;
      if (msg.type === 'status') lastStatus = msg.data;
      if (msg.type === 'telemetry' && msg.data) lastTelemetry[msg.data.arm] = msg.data;
      // 순번이 붙은 판정·이벤트는 기록으로 쌓는다 (판정은 분당 집계도)
      const d = msg.data;
      if ((msg.type === 'event' || msg.type === 'inspection') && d && typeof d.seq === 'number') {
        const list = msg.type === 'event' ? lastHistory.events : lastHistory.inspections;
        list.push(d);
        if (list.length > HISTORY_KEEP) list.shift();
        lastHistory.seq = Math.max(lastHistory.seq, d.seq);
        if (msg.type === 'inspection' && (d.result === 'good' || d.result === 'defect')) {
          const t = Math.floor((Date.parse(d.at) || Date.now()) / 60000) * 60000;
          let bucket = lastHistory.minutes[lastHistory.minutes.length - 1];
          if (!bucket || bucket.t !== t) { bucket = { t, good: 0, defect: 0 }; lastHistory.minutes.push(bucket); }
          bucket[d.result] += 1;
          if (lastHistory.minutes.length > MINUTES_KEEP) lastHistory.minutes.shift();
        }
      }
    }

    function becomeLeader() {
      if (server) return;
      server = new root.MockServer({ seed: lastStatus, telemetry: lastTelemetry, history: lastHistory.runId ? lastHistory : null });
      // 서버가 내보내는 모든 메시지를 다른 탭에 전한다
      server.connect({
        onOpen: () => post({ kind: 'online', on: true }),
        onClose: () => post({ kind: 'online', on: false }),
        onMessage: (msg) => { remember(msg, server.runId); post({ kind: 'msg', msg, runId: server.runId }); },
      });
      local.forEach((c) => { if (!c.conn) c.conn = server.connect(c.handlers); });
    }

    // 다른 탭이 서버를 가져가면(보이는 탭이 넘겨받음) 이 탭은 따라가는 쪽이 된다
    function demote() {
      if (!server) return;
      lastStatus = server.snapshot();
      lastHistory = server.historySnapshot();
      server.destroy();
      server = null;
      local.forEach((c) => { if (c.conn) { c.conn.close(); c.conn = null; } });
      post({ kind: 'hello' });
      queue();
    }

    // 서버 자리가 비면 맡도록 줄을 선다
    function queue() {
      locks.request(LOCK, () => { becomeLeader(); return forever(); }).catch(demote);
    }

    function steal() {
      locks.request(LOCK, { steal: true }, () => { becomeLeader(); return forever(); }).catch(demote);
    }

    function deliver(c, msg) {
      if (!c.open) { c.open = true; if (c.handlers.onOpen) c.handlers.onOpen(); }
      if (c.handlers.onMessage) c.handlers.onMessage(msg);
    }

    channel.onmessage = async (e) => {
      const m = e.data || {};
      if (m.from === me) return;
      if (server) {
        // 서버를 돌리는 탭: 다른 탭의 요청에 답한다
        if (m.kind === 'hello') post({ kind: 'welcome', to: m.from, online: server.online, status: server.snapshot(), telemetry: lastTelemetry, history: server.historySnapshot() });
        else if (m.kind === 'dev') server.setDevice(m.name, m.connected);
        else if (m.kind === 'sim') server.simulate(m.sim, m.on);
        else if (m.kind === 'req') {
          try {
            const res = await server.request(m.method, m.path, m.body);
            post({ kind: 'res', to: m.from, id: m.id, res });
          } catch (err) {
            post({ kind: 'res', to: m.from, id: m.id, error: 'NETWORK' });
          }
        }
        return;
      }
      // 따라가는 탭
      if (m.kind === 'msg') {
        remember(m.msg, m.runId);
        local.forEach((c) => deliver(c, m.msg));
      } else if (m.kind === 'welcome' && m.to === me) {
        lastStatus = m.status;
        Object.assign(lastTelemetry, m.telemetry);
        if (m.history) lastHistory = m.history;
        welcomed();
        if (m.online) local.forEach((c) => deliver(c, { type: 'status', data: m.status }));
      } else if (m.kind === 'online') {
        local.forEach((c) => {
          if (!m.on && c.open) { c.open = false; if (c.handlers.onClose) c.handlers.onClose(); }
        });
      } else if (m.kind === 'res' && m.to === me && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new TypeError('Failed to fetch'));
        else p.resolve(m.res);
      }
    };

    // 처음: 비어 있으면 맡고, 아니면 따라가며 줄을 선다
    locks.request(LOCK, { ifAvailable: true }, (lock) => {
      decided();
      if (lock) { becomeLeader(); return forever(); }
      post({ kind: 'hello' });
      // 보이는 탭인데 서버가 다른 탭에 있으면, 지금 상태를 받은 뒤(최대 0.8초) 넘겨받는다
      if (root.document && root.document.visibilityState === 'visible') {
        Promise.race([welcome, new Promise((resolve) => setTimeout(resolve, 800))]).then(() => { if (!server) steal(); });
      } else queue();
      return undefined;
    }).catch(demote);

    if (root.document) {
      root.document.addEventListener('visibilitychange', () => {
        if (root.document.visibilityState === 'visible' && !server) ready.then(() => { if (!server) steal(); });
      });
    }

    return {
      mode: 'shared',
      async request(method, path, body) {
        await ready;
        if (server) return server.request(method, path, body);
        return new Promise((resolve, reject) => {
          const id = nextReq++;
          const timer = setTimeout(() => { pending.delete(id); reject(new TypeError('Failed to fetch')); }, REQUEST_TIMEOUT_MS);
          pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (err) => { clearTimeout(timer); reject(err); } });
          post({ kind: 'req', id, method, path, body });
        });
      },
      connect(handlers) {
        const c = { handlers, conn: null, open: false };
        local.push(c);
        ready.then(() => {
          if (c.conn || !local.includes(c)) return; // 서버를 맡을 때 이미 붙었거나 그새 닫힘
          if (server) c.conn = server.connect(handlers);
          else post({ kind: 'hello' });
        });
        return {
          kind: 'mock',
          send() {},
          close() {
            const i = local.indexOf(c);
            if (i >= 0) local.splice(i, 1);
            if (c.conn) c.conn.close();
          },
        };
      },
      setDevice(name, connected) {
        ready.then(() => { if (server) server.setDevice(name, connected); else post({ kind: 'dev', name, connected }); });
      },
      simulate(kind, on) {
        ready.then(() => { if (server) server.simulate(kind, on); else post({ kind: 'sim', sim: kind, on }); });
      },
    };
  }

  function create() {
    try {
      if (root.BroadcastChannel && root.navigator && root.navigator.locks) return shared();
    } catch (e) { /* 파일로 연 페이지처럼 막힌 환경 */ }
    return local();
  }

  root.MockHub = { create };
})(typeof window !== 'undefined' ? window : globalThis);
