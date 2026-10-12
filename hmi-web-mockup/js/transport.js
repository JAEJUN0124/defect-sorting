// 서버 연결 방식 — 실시간 메시지를 받는 길(push)과 명령을 보내는 길(commands)을 설정으로 고릅니다.
//   push:     'ws'(기본, WebSocket) · 'socketio'(Flask-SocketIO, python-socketio) · 'sse'(EventSource) · 'poll'(상태를 주기적으로 물음)
//   commands: 'http'(기본, REST) · 'ws'(push 연결로 명령을 보냄)
// 받은 메시지는 그대로 넘기고, 모양 맞추기는 adapter.js가 합니다. 대응표: docs/server-cases.md
(function (root) {
  'use strict';

  // 명령 이름 → 기본 HTTP 경로 (docs/API.md 3장). config.js의 server.paths로 바꿀 수 있다
  const COMMANDS = {
    info: ['GET', '/info'],
    status: ['GET', '/status'],
    history: ['GET', '/history'],
    start: ['POST', '/line/start'],
    stop: ['POST', '/line/stop'],
    estop: ['POST', '/estop'],
    release: ['POST', '/estop/release'],
    home: ['POST', '/robot/home'],
    mode: ['PUT', '/mode'],
    cameraStart: ['POST', '/camera/start'],
    cameraStop: ['POST', '/camera/stop'],
    shutdown: ['POST', '/system/shutdown'],
  };
  // SSE에서 이름 붙은 이벤트로 올 수 있는 메시지 종류
  const SSE_TYPES = ['status', 'state', 'inspection', 'result', 'event', 'log', 'alarm', 'joints', 'telemetry', 'heartbeat', 'ping',
    'home_complete', 'shutdown_complete', 'metrics', 'frame', 'info', 'command_result'];

  class TransportError extends Error {
    constructor(code) { super(code); this.code = code; }
  }

  // 'POST /run' 처럼 방식까지 바꾸거나 '/run' 처럼 경로만 바꾼다
  function route(server, name) {
    const base = COMMANDS[name];
    if (!base) throw new Error('unknown command ' + name);
    const custom = server && server.paths && server.paths[name];
    if (!custom) return { method: base[0], path: base[1] };
    const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i.exec(String(custom).trim());
    return m ? { method: m[1].toUpperCase(), path: m[2].trim() } : { method: base[0], path: String(custom).trim() };
  }

  function joinUrl(base, path) {
    if (/^[a-z]+:\/\//i.test(path)) return path;
    return String(base).replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
  }

  // ws://서버/ws → ws://서버/socket.io/?EIO=4&transport=websocket
  function socketioUrl(cfg) {
    const s = cfg.server;
    if (s.socketioUrl) return s.socketioUrl;
    const u = new URL(cfg.wsUrl);
    return u.protocol + '//' + u.host + (s.socketioPath || '/socket.io/') + '?EIO=4&transport=websocket';
  }

  // ---------- HTTP 명령 ----------
  async function httpRequest(cfg, method, path, body) {
    const server = cfg.server || {};
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), server.timeoutMs || 8000) : 0;
    let res;
    try {
      const headers = Object.assign({}, server.headers);
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      res = await root.fetch(joinUrl(cfg.apiBase, path), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (err) {
      throw new TransportError(err && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; } // 글자·HTML 응답은 그대로 넘긴다
    }
    return { status: res.status, body: data };
  }

  // 끊기면 0.5초부터 최대 5초 간격으로 다시 붙는다
  const backoff = (n) => Math.min(5000, 500 * 2 ** n);

  // ---------- 실시간: WebSocket ----------
  function wsPush(cfg, handlers) {
    const server = cfg.server || {};
    let ws = null;
    let closed = false;
    let retry = 0;
    let opened = false;
    let pingTimer = 0;
    const send = (obj) => {
      if (!ws || ws.readyState !== 1) throw new TransportError('NETWORK');
      ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
    };
    const open = () => {
      if (closed) return; // 닫은 뒤에 다시 붙기 예약이 돌아도 열지 않는다
      ws = new root.WebSocket(cfg.wsUrl);
      ws.onopen = () => {
        retry = 0;
        opened = true;
        // 서버가 "HMI가 살아 있는지" 알아야 할 때만 보낸다 (기본 0 = 보내지 않음)
        if (server.clientPingMs > 0) pingTimer = setInterval(() => { try { send({ type: 'ping', data: { at: new Date().toISOString() } }); } catch (e) { /* 끊김은 onclose가 처리 */ } }, server.clientPingMs);
        handlers.onOpen();
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return; // 바이너리는 카메라 전용 연결(camera.js)에서만 받는다
        handlers.onMessage(e.data);
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (opened && handlers.onClose) handlers.onClose();
        opened = false;
        if (!closed) setTimeout(open, backoff(retry++));
      };
      ws.onerror = () => { /* 곧 onclose가 온다 */ };
    };
    open();
    return {
      kind: 'ws',
      send,
      close() { closed = true; clearInterval(pingTimer); if (ws) ws.close(); },
    };
  }

  // ---------- 실시간: Socket.IO (Engine.IO 4 / Socket.IO 5 프로토콜, 웹소켓 전송만) ----------
  // 서버가 Flask-SocketIO·python-socketio(5.x)면 이 방식. 라이브러리 없이 필요한 만큼만 직접 읽는다.
  function parseSocketio(s) {
    const type = Number(s[0]);
    if (!(type >= 0 && type <= 6)) return null;
    let i = 1;
    if (type === 5 || type === 6) i = s.indexOf('-', i) + 1; // 바이너리 첨부 개수 (지원하지 않음)
    let nsp = '/';
    if (s[i] === '/') {
      const comma = s.indexOf(',', i);
      nsp = comma === -1 ? s.slice(i) : s.slice(i, comma);
      i = comma === -1 ? s.length : comma + 1;
    }
    let id = '';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') id += s[i++];
    let data = null;
    if (i < s.length) {
      try { data = JSON.parse(s.slice(i)); } catch (e) { return null; }
    }
    return { type, nsp, id: id ? Number(id) : null, data };
  }

  function socketioPush(cfg, handlers) {
    const server = cfg.server || {};
    const nsp = server.socketioNamespace && server.socketioNamespace !== '/' ? server.socketioNamespace : '/';
    const prefix = nsp === '/' ? '' : nsp + ',';
    let ws = null;
    let closed = false;
    let retry = 0;
    let opened = false;
    let nextAck = 1;
    const acks = new Map();
    const raw = (s) => {
      if (!ws || ws.readyState !== 1) throw new TransportError('NETWORK');
      ws.send(s);
    };
    const failAcks = () => { acks.forEach((a) => a.reject(new TransportError('NETWORK'))); acks.clear(); };
    const open = () => {
      if (closed) return;
      ws = new root.WebSocket(socketioUrl(cfg));
      ws.onmessage = (e) => {
        const s = String(e.data);
        if (s[0] === '0') { raw('40' + prefix + (server.socketioAuth ? JSON.stringify(server.socketioAuth) : '')); return; } // 열림 → 네임스페이스 연결
        if (s[0] === '2') { raw('3'); return; } // 서버 ping → pong
        if (s[0] === '1') { ws.close(); return; }
        if (s[0] !== '4') return;
        const p = parseSocketio(s.slice(1));
        if (!p || p.nsp !== nsp) return;
        if (p.type === 0) { retry = 0; opened = true; handlers.onOpen(); return; }
        if (p.type === 2 && Array.isArray(p.data)) {
          const [name, ...args] = p.data;
          handlers.onMessage({ type: name, data: args.length > 1 ? args : args[0] });
          return;
        }
        if (p.type === 3 && acks.has(p.id)) {
          const a = acks.get(p.id);
          acks.delete(p.id);
          a.resolve(Array.isArray(p.data) ? p.data[0] : p.data);
          return;
        }
        if (p.type === 1 || p.type === 4) ws.close(); // 연결 끊음·연결 거절
      };
      ws.onclose = () => {
        failAcks();
        if (opened && handlers.onClose) handlers.onClose();
        opened = false;
        if (!closed) setTimeout(open, backoff(retry++));
      };
      ws.onerror = () => { /* 곧 onclose가 온다 */ };
    };
    open();
    return {
      kind: 'socketio',
      send(obj) { raw('42' + prefix + JSON.stringify(['message', obj])); },
      // 소켓IO의 응답(ack)으로 명령 결과를 받는다
      emit(name, data, timeoutMs) {
        return new Promise((resolve, reject) => {
          const id = nextAck++;
          const timer = setTimeout(() => { acks.delete(id); reject(new TransportError('TIMEOUT')); }, timeoutMs || 8000);
          acks.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
          try { raw('42' + prefix + id + JSON.stringify([name, data])); } catch (e) { acks.delete(id); clearTimeout(timer); reject(e); }
        });
      },
      close() { closed = true; failAcks(); if (ws) ws.close(); },
    };
  }

  // ---------- 실시간: SSE (Server-Sent Events) ----------
  // 서버 → HMI 한 방향만 된다. 명령은 HTTP로 보낸다. 끊기면 브라우저가 알아서 다시 붙는다.
  function ssePush(cfg, handlers) {
    const es = new root.EventSource(cfg.server.sseUrl);
    let opened = false;
    es.onopen = () => { if (!opened) { opened = true; handlers.onOpen(); } };
    es.onerror = () => { if (opened) { opened = false; if (handlers.onClose) handlers.onClose(); } };
    const deliver = (type) => (e) => {
      let data = e.data;
      try { data = JSON.parse(e.data); } catch (err) { /* 글자 그대로 */ }
      handlers.onMessage(type ? { type, data } : data);
    };
    es.onmessage = deliver(null);
    SSE_TYPES.forEach((type) => es.addEventListener(type, deliver(type)));
    return {
      kind: 'sse',
      send() { throw new TransportError('UNSUPPORTED'); },
      close() { es.close(); },
    };
  }

  // ---------- 실시간: 폴링 ----------
  // 서버에 실시간 연결이 없을 때. 상태만 받으므로 판정·이벤트 기록은 생기지 않는다(통계는 상태의 stats로 본다).
  function pollPush(cfg, handlers) {
    let timer = 0;
    let opened = false;
    let closed = false;
    const tick = async () => {
      try {
        const r = route(cfg.server, 'status');
        const res = await httpRequest(cfg, r.method, r.path);
        if (res.status < 200 || res.status >= 300) throw new TransportError('HTTP_' + res.status);
        if (!opened) { opened = true; handlers.onOpen(); }
        handlers.onMessage({ type: 'status', data: res.body });
      } catch (e) {
        if (opened) { opened = false; if (handlers.onClose) handlers.onClose(); }
      }
      if (!closed) timer = setTimeout(tick, cfg.server.pollMs || 500);
    };
    tick();
    return {
      kind: 'poll',
      send() { throw new TransportError('UNSUPPORTED'); },
      close() { closed = true; clearTimeout(timer); },
    };
  }

  function push(cfg, handlers) {
    switch ((cfg.server && cfg.server.push) || 'ws') {
      case 'socketio': return socketioPush(cfg, handlers);
      case 'sse': return ssePush(cfg, handlers);
      case 'poll': return pollPush(cfg, handlers);
      default: return wsPush(cfg, handlers);
    }
  }

  root.HmiTransport = { COMMANDS, TransportError, route, joinUrl, httpRequest, push, parseSocketio, socketioUrl };
})(typeof window !== 'undefined' ? window : globalThis);
