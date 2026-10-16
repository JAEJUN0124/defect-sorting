// 서버 연결 — 명령을 보내고 실시간 메시지를 받아, adapter.js로 모양을 맞춰 화면에 넘깁니다.
// 실제 서버와는 XML로 주고받습니다 (D-002, config.js server.format: 'xml', 규약 docs/server-xml-v1.0.md · HMI 쪽 docs/xml-protocol.md):
//   같은 웹소켓 하나로 상태를 받고, 명령을 보내고, 명령마다 id로 서버의 답(Reply)을 찾습니다.
// server.format이 'json'이면 예전 방식(docs/API.md, 연결 방식은 config.js의 server.push·commands, transport.js)입니다.
// useMock이 true면 같은 모양의 가짜 서버(mock-server.js, 탭 사이 공유는 mock-hub.js)로 바꿔 끼웁니다.
(function () {
  const cfg = window.HMI_CONFIG;
  const T = window.HmiTransport;
  const XP = window.HmiXmlProtocol;
  const robot = window.HMI_ROBOT || {};
  const xml = !cfg.useMock && cfg.server.format === 'xml';
  const adapter = window.HmiAdapter.create({
    jointUnit: robot.jointUnit || 'auto',
    loadUnit: robot.loadUnit || 'auto',
    naiveTime: cfg.server.naiveTime,
    primaryCamera: cfg.cameras.primary,
    bboxFormat: cfg.cameras.bboxFormat,
    xml: cfg.server.xml,
  });

  class ApiError extends Error {
    constructor(code, status, details, serverMessage) {
      super(code);
      this.code = code;
      this.status = status;
      this.details = details || {};
      this.serverMessage = serverMessage || null;
    }
  }

  // 보내지 못했거나 답을 받지 못한 이유 (transport.js · 아래 xmlSend)
  const SEND_FAILURES = ['TIMEOUT', 'UNSUPPORTED', 'NO_REPLY', 'NOT_IN_PROTOCOL'];

  const mock = cfg.useMock ? window.MockHub.create() : null;
  let conn = null;
  let nextCommand = 1;
  // 답을 기다리는 요청: id → { resolve, reject, command, mode, kind }
  const pendingCommands = new Map();
  // XML 명령 id 앞부분 — 화면(창)마다 달라 세 화면이 같은 서버에 붙어도 겹치지 않는다
  const clientId = 'hmi-' + Math.random().toString(36).slice(2, 6);

  // GET 명령의 값은 주소 뒤에 붙인다 (?after=…). 실시간 연결로 보낼 때는 본문에 담는다 (docs/API.md 6장)
  function withQuery(path, params) {
    const q = Object.entries(params || {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&');
    return q ? path + (path.includes('?') ? '&' : '?') + q : path;
  }

  // 명령 하나를 보내고 { status, body }를 받는다
  function send(name, body) {
    if (mock) {
      const r = T.route({}, name); // 가짜 서버는 늘 기본 경로를 쓴다
      return r.method === 'GET' ? mock.request(r.method, withQuery(r.path, body)) : mock.request(r.method, r.path, body);
    }
    if (xml) return xmlSend(name, body);
    if (cfg.server.commands === 'ws') return wsCommand(name, body);
    const r = T.route(cfg.server, name);
    if (r.method === 'GET') return T.httpRequest(cfg, r.method, withQuery(r.path, body));
    return T.httpRequest(cfg, r.method, r.path, body);
  }

  // 답을 기다리는 요청을 적어 둔다. 끝나면(답·시간 초과·끊김) 목록에서 뺀다
  function waitFor(id, info, timeoutMs, timeoutCode) {
    return new Promise((resolve, reject) => {
      const entry = Object.assign({}, info);
      const finish = (fn) => (v) => { clearTimeout(entry.timer); pendingCommands.delete(id); fn(v); };
      entry.resolve = finish(resolve);
      entry.reject = finish(reject);
      entry.timer = setTimeout(() => entry.reject(new T.TransportError(timeoutCode)), timeoutMs);
      pendingCommands.set(id, entry);
    });
  }

  // push 연결로 명령 보내기: 소켓IO는 응답(ack)으로, WebSocket은 { type: 'command' } → { type: 'command_result' }로
  function wsCommand(name, body) {
    if (!conn) return Promise.reject(new T.TransportError('NETWORK'));
    const wire = (cfg.server.commandNames && cfg.server.commandNames[name]) || name;
    const payload = body === undefined ? {} : body;
    if (conn.emit) {
      return conn.emit(wire, payload, cfg.server.timeoutMs).then((ack) => {
        const r = adapter.commandResult(ack && typeof ack === 'object' && ('ok' in ack || 'status' in ack || 'error' in ack) ? ack : { status: 200, body: ack });
        return { status: r.status, body: r.body };
      });
    }
    const id = String(nextCommand++);
    const done = waitFor(id, { kind: 'command' }, cfg.server.timeoutMs, 'TIMEOUT');
    try {
      conn.send({ type: 'command', data: { id, name: wire, body: body === undefined ? null : body } });
    } catch (err) {
      pendingCommands.get(id).reject(err);
    }
    return done;
  }

  // XML: 같은 웹소켓으로 보내고, 서버가 같은 id로 돌려주는 답(Reply · Status · Error)을 기다린다.
  // 서버 규약 v1.0 "HMI 수신 처리 순서": 보내기 전에 대기 목록에 먼저 적고, 정해진 시간 안에 답이 없거나
  // 연결이 끊기면 실패가 아니라 "응답 미확인"(NO_REPLY)이다. 장비 명령은 자동으로 다시 보내지 않는다
  function xmlSend(name, body) {
    if (name === 'info' || name === 'history') return Promise.reject(new T.TransportError('UNSUPPORTED')); // 서버 규약에 없는 조회
    const id = clientId + '-' + name + '-' + nextCommand++;
    const wire = name === 'status'
      ? { text: XP.request('GetStatus', id, cfg.server.xml), command: null, mode: null }
      : XP.command(name, body, id, cfg.server.xml);
    if (!wire) return Promise.reject(new T.TransportError('NOT_IN_PROTOCOL'));
    if (!conn) return Promise.reject(new T.TransportError('NETWORK'));
    const timeoutMs = (cfg.server.xml && cfg.server.xml.replyTimeoutMs) || 5000;
    const done = waitFor(id, { kind: name === 'status' ? 'status' : 'command', command: wire.command, mode: wire.mode }, timeoutMs, 'NO_REPLY');
    try {
      conn.send(wire.text);
    } catch (err) {
      pendingCommands.get(id).reject(err); // 보내지 못했다 — 대기를 풀고 연결 문제로 알린다
    }
    return done;
  }

  async function call(name, body) {
    let res;
    try {
      res = await send(name, body);
    } catch (err) {
      const code = err && SEND_FAILURES.includes(err.code) ? err.code : 'NETWORK';
      throw new ApiError(code, 0, code === 'NOT_IN_PROTOCOL' ? { command: name } : {});
    }
    if (res.status >= 200 && res.status < 300) return res.body;
    const e = adapter.error(res.status, res.body);
    throw new ApiError(e.code, res.status, e.details, e.message);
  }

  // 받은 답이 기다리던 요청의 것인지: id로 찾고, 답에 명령 이름·목표 모드가 있으면 그것도 맞아야 한다 (다른 버튼의 답으로 쓰지 않는다).
  // 거절 답에는 mode가, 형식이 틀린 명령의 답에는 command가 없을 수 있다 — 없는 값은 비교하지 않는다 (서버 담당 회신 2026-10-16)
  function matches(entry, data) {
    if (entry.command && data.command && data.command !== entry.command) return false;
    if (entry.mode && data.mode && data.mode !== entry.mode) return false;
    return true;
  }

  function connect(handlers) {
    const wrapped = {
      onOpen: () => { if (handlers.onOpen) handlers.onOpen(); },
      onClose: () => {
        // 끊기면 답을 기다리던 XML 요청은 "응답 미확인"이다. 다시 붙은 뒤 상태를 다시 묻는다(store.js)
        if (xml) Array.from(pendingCommands.values()).forEach((p) => p.reject(new T.TransportError('NO_REPLY')));
        if (handlers.onClose) handlers.onClose();
      },
      onMessage: (raw) => {
        adapter.message(raw).forEach((msg) => {
          if (msg.type === 'command_result' && msg.data) {
            const p = pendingCommands.get(String(msg.data.id));
            if (p && matches(p, msg.data)) {
              // 형식이 틀린 명령의 거절에는 명령 이름이 없을 수 있다 — 보낸 이름으로 채운다 (오류 문구가 명령에 따라 다르다)
              const details = msg.data.body && msg.data.body.error && msg.data.body.error.details;
              if (details && !details.command && p.command) details.command = p.command;
              p.resolve({ status: msg.data.status, body: msg.data.body });
              return;
            }
            if (xml) return; // 모르는 id·이미 끝난 요청의 답은 쓰지 않는다
          }
          // GetStatus의 답: 같은 id의 상태. 화면에도 그대로 넘긴다
          if (msg.type === 'status' && msg.replyTo) {
            const p = pendingCommands.get(String(msg.replyTo));
            if (p && p.kind === 'status') p.resolve({ status: 200, body: msg.data });
          }
          if (handlers.onMessage) handlers.onMessage(msg);
        });
      },
    };
    if (xml) {
      // 연결 확인: server.xml.pingMs(기본 60초 — 사용자 2026-10-16)마다 Ping을 보내 Pong을 받는다. 서버의 상태 간격은 바뀔 수 있어
      // 상태만으로는 살아 있는지 알 수 없다 — Pong도 서버 메시지라 끊김 판단(statusTimeoutMs)을 채운다. 0이면 보내지 않음
      const x = cfg.server.xml && cfg.server.xml.pingMs;
      const pingMs = typeof x === 'number' ? x : 60000;
      wrapped.ping = () => XP.request('Ping', clientId + '-ping-' + nextCommand++, cfg.server.xml);
      conn = T.push(Object.assign({}, cfg, { server: Object.assign({}, cfg.server, { push: 'ws', clientPingMs: pingMs }) }), wrapped);
    } else {
      conn = mock ? mock.connect(wrapped) : T.push(cfg, wrapped);
    }
    return conn;
  }

  // 서버가 보내는 운전 모드 값이 다르면 config.js의 server.modeValues로 맞춘다 (예: { auto: 'AUTO' }). XML은 server.xml.modeValues
  const modeValue = (mode) => (cfg.server.modeValues && cfg.server.modeValues[mode]) || mode;

  window.HmiApi = {
    ApiError,
    adapter,
    mock,
    xml,
    connect,
    // 상태 메시지가 끊겼을 때 다시 붙기 (store.js가 부른다)
    reconnect() { if (conn && conn.reconnect) conn.reconnect(); },
    // 연결을 닫고 다시 붙지 않는다 (프로그램 종료 — 이 HMI만 끝낸다)
    close() {
      if (conn && conn.close) conn.close();
      conn = null;
    },
    // 서버 정보(v0.2). 없는 서버(v0.1)·XML 규약이면 null
    async getInfo() {
      if (xml) return null;
      try {
        return adapter.info(await call('info'));
      } catch (err) {
        if ([404, 405, 501].includes(err.status)) return null;
        throw err;
      }
    },
    // XML이면 답(Status)이 이미 HMI 모양이다
    getStatus: async () => {
      const body = await call('status');
      return xml ? body : adapter.status(body);
    },
    // 지난 기록(v0.3): { after, events, inspections, minutes }. 기록 조회가 없는 서버·XML 규약이면 null
    async getHistory(params) {
      if (xml) return null;
      try {
        return adapter.history(await call('history', params));
      } catch (err) {
        if ([404, 405, 501].includes(err.status) || err.code === 'UNSUPPORTED') return null;
        throw err;
      }
    },
    start: () => call('start', cfg.server.startBody || undefined),
    stop: () => call('stop'),
    estop: () => call('estop'),
    releaseEstop: () => call('release'),
    // 원점 복귀: HMI가 저장한 원점(home.js)으로 옮긴다 (자동 모드·정지 상태). 각도를 함께 보낸다 — 서버는 원점을 저장하지 않는다
    home: (pose) => call('home', pose ? { angles: pose.angles, units: pose.units, unit: 'deg' } : undefined),
    setMode: (mode) => call('mode', { mode: xml ? mode : modeValue(mode) }),
    startCamera: (camera) => call('cameraStart', camera ? { camera } : undefined),
    stopCamera: (camera) => call('cameraStop', camera ? { camera } : undefined),
  };
})();
