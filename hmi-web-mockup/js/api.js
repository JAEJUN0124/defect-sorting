// 서버 연결 — 명령은 HTTP, 상태는 WebSocket (docs/API.md)
// useMock이 true면 같은 모양의 가짜 서버로 바꿔 끼웁니다.
(function () {
  const cfg = window.HMI_CONFIG;

  class ApiError extends Error {
    constructor(code, status, details) {
      super(code);
      this.code = code;
      this.status = status;
      this.details = details || {};
    }
  }

  function httpTransport() {
    return {
      mock: null,
      async request(method, path, body) {
        const res = await fetch(cfg.apiBase + path, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, body: data };
      },
      // 끊기면 0.5초부터 최대 5초 간격으로 다시 붙는다
      connect(handlers) {
        let ws = null;
        let closed = false;
        let retry = 0;
        const open = () => {
          ws = new WebSocket(cfg.wsUrl);
          ws.onopen = () => { retry = 0; if (handlers.onOpen) handlers.onOpen(); };
          ws.onmessage = (e) => {
            let msg;
            try { msg = JSON.parse(e.data); } catch (err) { return; }
            handlers.onMessage(msg);
          };
          ws.onclose = () => {
            if (handlers.onClose) handlers.onClose();
            if (!closed) setTimeout(open, Math.min(5000, 500 * 2 ** retry++));
          };
        };
        open();
        return { close() { closed = true; if (ws) ws.close(); } };
      },
    };
  }

  function mockTransport() {
    const mock = new window.MockServer();
    return {
      mock,
      request: (method, path, body) => mock.request(method, path, body),
      connect: (handlers) => mock.connect(handlers),
    };
  }

  const transport = cfg.useMock ? mockTransport() : httpTransport();

  async function call(method, path, body) {
    let res;
    try {
      res = await transport.request(method, path, body);
    } catch (err) {
      throw new ApiError('NETWORK', 0);
    }
    if (res.status >= 200 && res.status < 300) return res.body;
    const error = (res.body && res.body.error) || {};
    throw new ApiError(error.code || 'HTTP_' + res.status, res.status, error.details);
  }

  window.HmiApi = {
    ApiError,
    mock: transport.mock,
    connect: transport.connect,
    getStatus: () => call('GET', '/status'),
    start: () => call('POST', '/line/start'),
    stop: () => call('POST', '/line/stop'),
    estop: () => call('POST', '/estop'),
    releaseEstop: () => call('POST', '/estop/release'),
    home: (angles) => call('POST', '/robot/home', { angles }),
    setMode: (mode) => call('PUT', '/mode', { mode }),
    startCamera: () => call('POST', '/camera/start'),
    stopCamera: () => call('POST', '/camera/stop'),
    shutdown: () => call('POST', '/system/shutdown'),
  };
})();
