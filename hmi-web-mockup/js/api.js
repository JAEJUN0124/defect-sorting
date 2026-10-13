// 서버 연결 — 명령을 보내고 실시간 메시지를 받아, adapter.js로 모양을 맞춰 화면에 넘깁니다 (docs/API.md v0.4).
// 연결 방식(push·commands)은 config.js의 server 설정으로 고릅니다 (transport.js).
// useMock이 true면 같은 모양의 가짜 서버(mock-server.js, 탭 사이 공유는 mock-hub.js)로 바꿔 끼웁니다.
(function () {
  const cfg = window.HMI_CONFIG;
  const T = window.HmiTransport;
  const robot = window.HMI_ROBOT || {};
  const adapter = window.HmiAdapter.create({
    jointUnit: robot.jointUnit || 'auto',
    loadUnit: robot.loadUnit || 'auto',
    naiveTime: cfg.server.naiveTime,
    primaryCamera: cfg.cameras.primary,
    bboxFormat: cfg.cameras.bboxFormat,
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

  const mock = cfg.useMock ? window.MockHub.create() : null;
  let conn = null;
  let nextCommand = 1;
  const pendingCommands = new Map();

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
    if (cfg.server.commands === 'ws') return wsCommand(name, body);
    const r = T.route(cfg.server, name);
    if (r.method === 'GET') return T.httpRequest(cfg, r.method, withQuery(r.path, body));
    return T.httpRequest(cfg, r.method, r.path, body);
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
    return new Promise((resolve, reject) => {
      const id = String(nextCommand++);
      const timer = setTimeout(() => { pendingCommands.delete(id); reject(new T.TransportError('TIMEOUT')); }, cfg.server.timeoutMs);
      pendingCommands.set(id, (res) => { clearTimeout(timer); resolve(res); });
      try {
        conn.send({ type: 'command', data: { id, name: wire, body: body === undefined ? null : body } });
      } catch (err) {
        clearTimeout(timer);
        pendingCommands.delete(id);
        reject(err);
      }
    });
  }

  async function call(name, body) {
    let res;
    try {
      res = await send(name, body);
    } catch (err) {
      throw new ApiError(err && err.code === 'TIMEOUT' ? 'TIMEOUT' : err && err.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'NETWORK', 0);
    }
    if (res.status >= 200 && res.status < 300) return res.body;
    const e = adapter.error(res.status, res.body);
    throw new ApiError(e.code, res.status, e.details, e.message);
  }

  function connect(handlers) {
    const wrapped = {
      onOpen: () => { if (handlers.onOpen) handlers.onOpen(); },
      onClose: () => { if (handlers.onClose) handlers.onClose(); },
      onMessage: (raw) => {
        adapter.message(raw).forEach((msg) => {
          if (msg.type === 'command_result' && msg.data && pendingCommands.has(String(msg.data.id))) {
            const done = pendingCommands.get(String(msg.data.id));
            pendingCommands.delete(String(msg.data.id));
            done({ status: msg.data.status, body: msg.data.body });
            return;
          }
          if (handlers.onMessage) handlers.onMessage(msg);
        });
      },
    };
    conn = mock ? mock.connect(wrapped) : T.push(cfg, wrapped);
    return conn;
  }

  // 서버가 보내는 운전 모드 값이 다르면 config.js의 server.modeValues로 맞춘다 (예: { auto: 'AUTO' })
  const modeValue = (mode) => (cfg.server.modeValues && cfg.server.modeValues[mode]) || mode;

  window.HmiApi = {
    ApiError,
    adapter,
    mock,
    connect,
    // 서버 정보(v0.2). 없는 서버(v0.1)면 null
    async getInfo() {
      try {
        return adapter.info(await call('info'));
      } catch (err) {
        if ([404, 405, 501].includes(err.status)) return null;
        throw err;
      }
    },
    getStatus: async () => adapter.status(await call('status')),
    // 지난 기록(v0.3): { after, events, inspections, minutes }. 기록 조회가 없는 서버면 null
    async getHistory(params) {
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
    // 원점 복귀: 서버가 저장한 원점으로 옮긴다 (자동 모드·정지 상태). 원점 잡기: 로봇팔의 지금 자세를 원점으로 저장한다 (수동 모드)
    home: () => call('home'),
    setHome: () => call('setHome'),
    setMode: (mode) => call('mode', { mode: modeValue(mode) }),
    startCamera: (camera) => call('cameraStart', camera ? { camera } : undefined),
    stopCamera: (camera) => call('cameraStop', camera ? { camera } : undefined),
    shutdown: () => call('shutdown'),
  };
})();
