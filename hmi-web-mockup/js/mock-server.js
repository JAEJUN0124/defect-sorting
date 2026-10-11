// 가짜 서버 — docs/API.md 의 동작을 브라우저 안에서 흉내 냅니다 (실제 서버가 준비되기 전 개발용).
// 실제 서버가 생기면 config.js의 useMock을 false로 바꾸면 이 파일은 쓰이지 않습니다.
(function () {
  const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  const REQUIRED = {
    auto: ['conveyor', 'arm', 'camera'],
    manual: ['conveyor', 'arm', 'leader', 'camera'],
  };
  const INSPECT_EVERY_MS = 1600;
  const DEFECT_RATE = 0.08;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date().toISOString();
  const ok = (body) => ({ status: 200, body: body || { ok: true } });
  const accepted = () => ({ status: 202, body: { accepted: true } });
  const fail = (status, code, details) => ({ status, body: { error: { code, details: details || {} } } });

  class MockServer {
    constructor() {
      this.online = true;
      this.connections = new Set();
      this.timers = {};
      this.nextId = 1;
      this.state = {
        line: 'stopped',
        estop: false,
        mode: 'auto',
        devices: { conveyor: 'connected', arm: 'connected', leader: 'connected', camera: 'connected' },
        stats: { total: 0, good: 0, defect: 0 },
        camera: { streaming: false, url: null },
      };
      this.leader = Object.fromEntries(JOINTS.map((j) => [j, 0]));
      this.timers.heartbeat = setInterval(() => this.emit('heartbeat', { at: now() }), 2000);
      this.timers.joints = setInterval(() => this.tickLeader(), 100);
    }

    // ----- WebSocket 흉내 -----
    connect(handlers) {
      const conn = { handlers };
      this.connections.add(conn);
      setTimeout(() => {
        if (!this.online) return;
        if (handlers.onOpen) handlers.onOpen();
        this.sendTo(conn, 'status', this.snapshot());
      }, 150);
      return { close: () => this.connections.delete(conn) };
    }

    sendTo(conn, type, data) {
      if (conn.handlers.onMessage) conn.handlers.onMessage({ type, data });
    }

    emit(type, data) {
      if (!this.online) return;
      this.connections.forEach((conn) => this.sendTo(conn, type, data));
    }

    pushStatus() { this.emit('status', this.snapshot()); }

    event(code, level, params) {
      this.emit('event', { code, level: level || 'info', params: params || {}, at: now() });
    }

    snapshot() { return JSON.parse(JSON.stringify(this.state)); }

    // ----- HTTP 흉내 -----
    async request(method, path, body) {
      await sleep(120 + Math.random() * 120);
      if (!this.online) throw new TypeError('Failed to fetch');
      const route = ROUTES[method + ' ' + path];
      if (!route) return fail(404, 'NOT_FOUND');
      return route.call(this, body || {});
    }

    // ----- 내부 동작 -----
    startInspection() {
      this.stopInspection();
      this.timers.inspect = setInterval(() => {
        const s = this.state;
        if (s.line !== 'running') return;
        const id = this.nextId++;
        const result = Math.random() < DEFECT_RATE ? 'defect' : 'good';
        s.stats.total += 1;
        s.stats[result] += 1;
        this.emit('inspection', { id, result, at: now(), stats: { ...s.stats } });
        if (result === 'defect') this.event('defect_detected', 'warning', { id });
      }, INSPECT_EVERY_MS);
    }

    stopInspection() { clearInterval(this.timers.inspect); }

    haltAll() {
      this.stopInspection();
      clearTimeout(this.timers.home);
      this.state.line = 'stopped';
    }

    // 사람이 리더암을 움직이는 것처럼 각도를 조금씩 바꾼다
    tickLeader() {
      const s = this.state;
      if (s.mode !== 'manual' || s.devices.leader !== 'connected') return;
      JOINTS.forEach((j) => {
        const limit = j === 'gripper' ? [0, 100] : [-90, 90];
        const next = this.leader[j] + (Math.random() - 0.5) * 3;
        this.leader[j] = Math.min(limit[1], Math.max(limit[0], next));
      });
      this.emit('joints', { source: 'leader', angles: { ...this.leader } });
    }

    // ----- 개발용: 장치 연결 끊김 흉내 -----
    setDevice(name, connected) {
      if (name === 'server') { this.setOnline(connected); return; }
      const s = this.state;
      const next = connected ? 'connected' : 'disconnected';
      if (s.devices[name] === next) return;
      s.devices[name] = next;
      if (connected) {
        this.event('device_reconnected', 'info', { device: name });
      } else {
        this.event('device_disconnected', 'warning', { device: name });
        const needed = REQUIRED[s.mode].includes(name);
        if (needed && (s.line === 'running' || s.line === 'starting')) {
          this.haltAll();
          this.event('line_stopped_fault', 'warning', { device: name });
        }
        if (name === 'arm' && s.line === 'homing') this.haltAll();
        if (name === 'camera') s.camera = { streaming: false, url: null };
      }
      this.pushStatus();
    }

    setOnline(on) {
      if (this.online === on) return;
      this.online = on;
      this.connections.forEach((conn) => {
        if (!on) { if (conn.handlers.onClose) conn.handlers.onClose(); return; }
        if (conn.handlers.onOpen) conn.handlers.onOpen();
        this.sendTo(conn, 'status', this.snapshot());
      });
    }
  }

  const ROUTES = {
    'GET /status'() { return ok(this.snapshot()); },

    async 'POST /line/start'() {
      const s = this.state;
      if (s.estop) return fail(409, 'ESTOP_ACTIVE');
      if (s.line !== 'stopped') return fail(409, 'INVALID_STATE', { line: s.line });
      s.line = 'starting';
      this.pushStatus();
      await sleep(800);
      if (s.estop) return fail(409, 'ESTOP_ACTIVE');
      const missing = REQUIRED[s.mode].filter((d) => s.devices[d] !== 'connected');
      if (missing.length || s.line !== 'starting') {
        s.line = 'stopped';
        this.pushStatus();
        this.event('start_rejected', 'warning', { devices: missing });
        return fail(409, 'DEVICES_NOT_READY', { missing });
      }
      s.line = 'running';
      this.pushStatus();
      this.event('line_started');
      this.startInspection();
      return ok(this.snapshot());
    },

    async 'POST /line/stop'() {
      const s = this.state;
      if (s.line !== 'running') return fail(409, 'INVALID_STATE', { line: s.line });
      s.line = 'stopping';
      this.stopInspection();
      this.pushStatus();
      await sleep(600);
      if (s.line === 'stopping') {
        s.line = 'stopped';
        this.pushStatus();
        this.event('line_stopped');
      }
      return ok(this.snapshot());
    },

    'POST /estop'() {
      const s = this.state;
      const already = s.estop;
      s.estop = true;
      this.haltAll();
      this.pushStatus();
      if (!already) this.event('estop_pressed', 'alarm');
      return ok(this.snapshot());
    },

    'POST /estop/release'() {
      const s = this.state;
      if (!s.estop) return fail(409, 'ESTOP_NOT_ACTIVE');
      s.estop = false;
      this.pushStatus();
      this.event('estop_released');
      return ok(this.snapshot());
    },

    'POST /robot/home'(body) {
      const s = this.state;
      if (s.estop) return fail(409, 'ESTOP_ACTIVE');
      if (s.line !== 'stopped') return fail(409, 'NOT_STOPPED');
      if (s.devices.arm !== 'connected') return fail(409, 'DEVICES_NOT_READY', { missing: ['arm'] });
      const angles = body.angles || {};
      const bad = JOINTS.filter((j) => typeof angles[j] !== 'number');
      if (bad.length) return fail(422, 'INVALID_ANGLES', { joints: bad });
      s.line = 'homing';
      this.pushStatus();
      this.event('home_started');
      this.timers.home = setTimeout(() => {
        if (s.line !== 'homing') return;
        s.line = 'stopped';
        this.pushStatus();
        this.event('home_completed');
        this.emit('home_complete', {});
      }, 2400);
      return accepted();
    },

    'PUT /mode'(body) {
      const s = this.state;
      if (body.mode !== 'auto' && body.mode !== 'manual') return fail(422, 'INVALID_MODE');
      if (s.estop) return fail(409, 'ESTOP_ACTIVE');
      if (s.line !== 'stopped') return fail(409, 'NOT_STOPPED');
      if (s.mode !== body.mode) {
        s.mode = body.mode;
        this.pushStatus();
        this.event('mode_changed', 'info', { mode: body.mode });
      }
      return ok(this.snapshot());
    },

    'POST /camera/start'() {
      const s = this.state;
      if (s.devices.camera !== 'connected') return fail(409, 'DEVICES_NOT_READY', { missing: ['camera'] });
      s.camera = { streaming: true, url: 'mock://camera' };
      this.pushStatus();
      this.event('camera_started');
      return ok({ url: s.camera.url });
    },

    'POST /camera/stop'() {
      this.state.camera = { streaming: false, url: null };
      this.pushStatus();
      this.event('camera_stopped');
      return ok();
    },

    'POST /system/shutdown'() {
      this.haltAll();
      this.state.camera = { streaming: false, url: null };
      this.pushStatus();
      this.event('shutdown_started');
      setTimeout(() => this.emit('shutdown_complete', {}), 1200);
      return accepted();
    },
  };

  window.MockServer = MockServer;
})();
