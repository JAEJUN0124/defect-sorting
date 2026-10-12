// 가짜 서버 — docs/API.md v0.2 의 동작을 브라우저 안에서 흉내 냅니다 (실제 서버가 준비되기 전 개발용).
// 로봇팔은 키트 구성(팔로워 12V · 리더 7.4V급, 서보 6개씩)대로 각도·온도·전압·부하를 만들어 보내고,
// 카메라 두 대(위·근접)와 판정 상자·신뢰도·판정 시간도 보냅니다. 실제 서버를 만들 때 동작 견본으로 쓸 수 있습니다.
// 실제 서버가 생기면 config.js의 useMock을 false로 바꾸면 이 파일은 쓰이지 않습니다.
(function (root) {
  'use strict';

  const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  const CAMERAS = ['top', 'close'];
  const REQUIRED = {
    auto: ['conveyor', 'arm', 'camera_top'],
    manual: ['conveyor', 'arm', 'leader', 'camera_top'],
  };
  const INSPECT_EVERY_MS = 1600;
  const DEFECT_RATE = 0.08;
  const TICK_MS = 50;

  // 불량품을 집어 상자에 넣는 자세 (각도는 도, 그리퍼는 %)
  const POSE = {
    ready: { shoulder_pan: 0, shoulder_lift: -35, elbow_flex: 70, wrist_flex: 45, wrist_roll: 0, gripper: 20 },
    above: { shoulder_pan: 18, shoulder_lift: -5, elbow_flex: 35, wrist_flex: 60, wrist_roll: 0, gripper: 70 },
    grip: { shoulder_pan: 18, shoulder_lift: 8, elbow_flex: 22, wrist_flex: 62, wrist_roll: 0, gripper: 70 },
    closed: { shoulder_pan: 18, shoulder_lift: 8, elbow_flex: 22, wrist_flex: 62, wrist_roll: 0, gripper: 12 },
    lift: { shoulder_pan: 18, shoulder_lift: -25, elbow_flex: 55, wrist_flex: 50, wrist_roll: 0, gripper: 12 },
    bin: { shoulder_pan: -70, shoulder_lift: -15, elbow_flex: 45, wrist_flex: 50, wrist_roll: 30, gripper: 12 },
    release: { shoulder_pan: -70, shoulder_lift: -15, elbow_flex: 45, wrist_flex: 50, wrist_roll: 30, gripper: 70 },
  };
  const PICK = ['above', 'grip', 'closed', 'lift', 'bin', 'release', 'ready'];
  // 관절별로 버티는 힘(%) — 어깨 들기·팔꿈치가 팔 무게를 받는다
  const HOLD_LOAD = { shoulder_pan: 4, shoulder_lift: 24, elbow_flex: 17, wrist_flex: 8, wrist_roll: 3, gripper: 2 };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date().toISOString();
  const r1 = (v) => Math.round(v * 10) / 10;
  const ok = (body) => ({ status: 200, body: body || { ok: true } });
  const accepted = () => ({ status: 202, body: { accepted: true } });
  const fail = (status, code, details) => ({ status, body: { error: { code, details: details || {} } } });
  const roundPose = (pose) => Object.fromEntries(JOINTS.map((j) => [j, r1(pose[j])]));

  class MockServer {
    constructor(options) {
      const robot = root.HMI_ROBOT || {};
      this.limits = Object.assign({ tempWarn: 55, tempAlarm: 65, tempServo: 70 }, robot.limits);
      this.supply = {
        arm: Object.assign({ nominal: 12, wrongBelow: 9, warnLow: 10.8, warnHigh: 13.2 }, robot.arms && robot.arms.arm && robot.arms.arm.supply),
        leader: Object.assign({ nominal: 7.5, wrongAbove: 10, warnLow: 6.5, warnHigh: 8.4 }, robot.arms && robot.arms.leader && robot.arms.leader.supply),
      };
      this.online = true;
      this.connections = new Set();
      this.timers = {};
      this.nextId = 1;
      this.sim = { overheat: false, voltage: false, slow: false, defect: false };
      this.state = {
        line: 'stopped',
        estop: false,
        mode: 'auto',
        fault: null,
        started_at: null,
        devices: { conveyor: 'connected', arm: 'connected', leader: 'connected', camera_top: 'connected', camera_close: 'connected' },
        stats: { total: 0, good: 0, defect: 0 },
        cameras: Object.fromEntries(CAMERAS.map((id) => [id, { streaming: false, url: null, transport: 'mock' }])),
      };
      this.arms = { arm: makeArm(POSE.ready, 33), leader: makeArm(POSE.ready, 30) };
      this.arms.leader.torque = false; // 리더는 힘을 빼 두고 사람이 움직인다
      this.pick = null;
      this.pendingPicks = 0;
      this.alarms = {};
      this.inferenceMs = 21;
      this.slowWarned = false;
      this.tickCount = 0;
      if (options && options.seed) this.restore(options.seed);
      if (options && options.telemetry) this.restoreArms(options.telemetry);
      this.timers.heartbeat = setInterval(() => this.emit('heartbeat', { at: now() }), 2000);
      // 실제로 흐른 시간으로 움직인다 — 숨은 탭에서 브라우저가 타이머를 초당 1번으로 줄여도 온도·각도가 같은 속도로 변한다
      this.lastTick = Date.now();
      this.timers.tick = setInterval(() => {
        const t = Date.now();
        this.tick(Math.min(1, Math.max(0.001, (t - this.lastTick) / 1000)));
        this.lastTick = t;
      }, TICK_MS);
      this.timers.telemetry = setInterval(() => this.sendTelemetry(), 500);
      this.timers.metrics = setInterval(() => this.sendMetrics(), 2000);
      if (this.state.line === 'running') this.startInspection();
    }

    destroy() {
      Object.values(this.timers).forEach((t) => { clearInterval(t); clearTimeout(t); });
      this.connections.clear();
    }

    // 다른 탭이 가짜 서버를 넘겨받을 때 마지막 상태에서 이어 간다 (mock-hub.js)
    restore(seed) {
      const s = this.state;
      ['line', 'estop', 'mode', 'fault', 'started_at'].forEach((k) => { if (seed[k] !== undefined) s[k] = seed[k]; });
      if (!['stopped', 'running'].includes(s.line)) s.line = 'stopped';
      if (seed.devices) Object.assign(s.devices, seed.devices);
      if (seed.stats) s.stats = Object.assign({}, seed.stats);
      if (seed.cameras) CAMERAS.forEach((c) => { if (seed.cameras[c]) s.cameras[c] = Object.assign({}, seed.cameras[c]); });
      this.nextId = s.stats.total + 1; // 판정 번호는 검사 수를 이어서 매긴다
      if (s.estop) this.arms.arm.torque = false;
    }

    // 넘겨받을 때 서보 각도·온도도 이어 간다 (telemetry 메시지 모양: { arm, motors: { 관절: { pos, temp } } })
    restoreArms(telemetry) {
      Object.entries(telemetry || {}).forEach(([id, tel]) => {
        const a = this.arms[id];
        if (!a || !tel || !tel.motors) return;
        JOINTS.forEach((j) => {
          const m = tel.motors[j];
          if (!m) return;
          if (typeof m.pos === 'number') { a.pos[j] = m.pos; a.target[j] = m.pos; }
          if (typeof m.temp === 'number') a.temp[j] = m.temp;
        });
      });
    }

    // ----- WebSocket 흉내 -----
    connect(handlers) {
      const conn = { handlers };
      this.connections.add(conn);
      setTimeout(() => {
        if (!this.online || !this.connections.has(conn)) return;
        if (handlers.onOpen) handlers.onOpen();
        this.sendTo(conn, 'status', this.snapshot());
      }, 150);
      return { kind: 'mock', send() {}, close: () => this.connections.delete(conn) };
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

    // ----- 판정 -----
    startInspection() {
      this.stopInspection();
      this.timers.inspect = setInterval(() => {
        const s = this.state;
        if (s.line !== 'running') return;
        const id = this.nextId++;
        const result = this.sim.defect || Math.random() < DEFECT_RATE ? 'defect' : 'good';
        this.sim.defect = false; // '다음 판정을 불량으로'는 한 번만
        s.stats.total += 1;
        s.stats[result] += 1;
        const confidence = result === 'defect' ? 0.82 + Math.random() * 0.16 : 0.9 + Math.random() * 0.095;
        this.emit('inspection', {
          id,
          result,
          at: now(),
          camera: 'top',
          confidence: Math.round(confidence * 1000) / 1000,
          latency_ms: r1(this.inferenceMs + (Math.random() - 0.5) * 4),
          bbox: [0.455, 0.36, 0.09, 0.28],
          stats: { ...s.stats },
        });
        if (result === 'defect') {
          this.event('defect_detected', 'warning', { id });
          if (s.mode === 'auto') this.pendingPicks += 1;
        }
      }, INSPECT_EVERY_MS);
    }

    stopInspection() { clearInterval(this.timers.inspect); }

    haltAll() {
      this.stopInspection();
      clearTimeout(this.timers.home);
      this.state.line = 'stopped';
      this.state.started_at = null;
      this.pick = null;
      this.pendingPicks = 0;
      const arm = this.arms.arm;
      JOINTS.forEach((j) => { arm.target[j] = arm.pos[j]; });
    }

    // ----- 로봇팔 움직임 -----
    tick(dt) {
      this.tickCount += 1;
      const s = this.state;
      const arm = this.arms.arm;
      const leader = this.arms.leader;
      if (s.mode === 'manual' && s.devices.leader === 'connected') wander(leader, dt);
      const powered = s.devices.arm === 'connected' && arm.torque && !s.estop;
      if (powered && s.line === 'running') {
        if (s.mode === 'manual' && s.devices.leader === 'connected') Object.assign(arm.target, leader.pos);
        if (s.mode === 'auto') this.stepPick();
      }
      move(arm, dt, powered, this.pick && ['closed', 'lift', 'bin'].includes(PICK[this.pick.step]));
      heat(arm, dt, this.sim.overheat ? { elbow_flex: 48 } : null);
      heat(leader, dt, null);
      if (this.tickCount % 2 === 0) this.sendJoints();
    }

    // 불량품이 생기면 집기 → 들기 → 상자로 → 놓기 → 대기 자세 순서로 움직인다
    stepPick() {
      const arm = this.arms.arm;
      if (!this.pick) {
        if (!this.pendingPicks) { Object.assign(arm.target, POSE.ready); return; }
        this.pendingPicks -= 1;
        this.pick = { step: 0, since: Date.now() };
        Object.assign(arm.target, POSE[PICK[0]]);
        return;
      }
      const reached = JOINTS.every((j) => Math.abs(arm.pos[j] - arm.target[j]) < 1.5);
      if (!reached && Date.now() - this.pick.since < 2500) return;
      this.pick.step += 1;
      this.pick.since = Date.now();
      if (this.pick.step >= PICK.length) { this.pick = null; return; }
      Object.assign(arm.target, POSE[PICK[this.pick.step]]);
    }

    sendJoints() {
      const s = this.state;
      if (s.mode === 'manual' && s.devices.leader === 'connected') {
        this.emit('joints', { source: 'leader', unit: 'deg', angles: roundPose(this.arms.leader.pos) });
      }
      if (s.devices.arm === 'connected') {
        const moving = JOINTS.some((j) => Math.abs(this.arms.arm.vel[j]) > 0.5);
        if (moving || this.tickCount % 20 === 0) this.emit('joints', { source: 'arm', unit: 'deg', angles: roundPose(this.arms.arm.pos) });
      }
    }

    voltageOf(id) {
      const a = this.arms[id];
      if (id === 'leader') return r1((this.sim.voltage ? 12.08 : 7.42) + (Math.random() - 0.5) * 0.04);
      const sag = JOINTS.reduce((sum, j) => sum + Math.abs(a.load[j]), 0) * 0.004;
      return r1(12.05 - sag + (Math.random() - 0.5) * 0.04);
    }

    // 서보 상태를 보내기 직전에 경고를 판단한다 — 경고 이벤트가 그 값을 담은 서보 상태보다 먼저 간다
    sendTelemetry() {
      ['arm', 'leader'].forEach((id) => {
        if (this.state.devices[id] !== 'connected') return;
        const a = this.arms[id];
        const volt = this.voltageOf(id);
        this.checkServos(id, volt);
        const powered = id === 'arm' && a.torque && !this.state.estop;
        const motors = {};
        JOINTS.forEach((j) => {
          let status = 0;
          if (a.temp[j] >= this.limits.tempServo) status |= 4;
          if (this.wrongVoltage(id, volt)) status |= 1;
          if (Math.abs(a.load[j]) > 95) status |= 32;
          motors[j] = {
            pos: r1(a.pos[j]),
            temp: r1(a.temp[j]),
            volt,
            load: r1(a.load[j]),
            current: Math.round(18 + Math.abs(a.load[j]) * 14),
            status,
            torque: powered,
            moving: Math.abs(a.vel[j]) > 0.5,
          };
        });
        this.emit('telemetry', { arm: id, unit: 'deg', at: now(), motors });
      });
    }

    wrongVoltage(id, volt) {
      const sup = this.supply[id];
      return (sup.wrongAbove !== undefined && volt > sup.wrongAbove) || (sup.wrongBelow !== undefined && volt < sup.wrongBelow);
    }

    checkServos(id, volt) {
      const a = this.arms[id];
      const lim = this.limits;
      JOINTS.forEach((j) => {
        const key = id + '.' + j;
        const t = a.temp[j];
        const was = this.alarms[key] || null;
        const level = t >= lim.tempAlarm ? 'alarm' : t >= lim.tempWarn ? 'warning' : was && t >= lim.tempWarn - 3 ? was : null;
        if (level === was) return;
        if (level) {
          if (level === 'alarm' || !was) this.event('servo_overheat', level, { arm: id, joint: j, temp: r1(t), limit: level === 'alarm' ? lim.tempAlarm : lim.tempWarn });
          if (level === 'alarm' && id === 'arm') this.trip('SERVO_OVERHEAT', { arm: id, joint: j, temp: r1(t) });
        } else {
          this.event('servo_recovered', 'info', { arm: id, joint: j });
        }
        this.alarms[key] = level;
      });
      // 과열이 풀리면 고장 표시도 지운다
      if (this.state.fault && this.state.fault.code === 'SERVO_OVERHEAT' && JOINTS.every((j) => this.arms.arm.temp[j] < lim.tempWarn)) {
        this.state.fault = null;
        this.pushStatus();
      }
      const vKey = id + '.voltage';
      const wrong = this.wrongVoltage(id, volt);
      if (wrong && !this.alarms[vKey]) this.event('servo_voltage', 'alarm', { arm: id, volt, nominal: this.supply[id].nominal });
      if (!wrong && this.alarms[vKey]) this.event('servo_recovered', 'info', { arm: id });
      this.alarms[vKey] = wrong ? 'alarm' : null;
    }

    // 고장으로 라인을 세운다 (서보 과열 등)
    trip(code, params) {
      const s = this.state;
      s.fault = { code, params };
      if (['running', 'starting', 'homing'].includes(s.line)) {
        this.haltAll();
        this.event('line_halted', 'warning', { reason: code });
      }
      this.pushStatus();
    }

    sendMetrics() {
      const s = this.state;
      this.inferenceMs += ((this.sim.slow ? 180 : 21) - this.inferenceMs) * 0.5 + (Math.random() - 0.5) * 3;
      const fps = {};
      CAMERAS.forEach((c) => { if (s.cameras[c].streaming) fps[c] = r1(29.4 + Math.random() * 0.6); });
      this.emit('metrics', { inference_ms: r1(this.inferenceMs), fps, cpu: Math.round(s.line === 'running' ? 38 + Math.random() * 8 : 9 + Math.random() * 4), queue: 0 });
      if (this.sim.slow && !this.slowWarned && this.inferenceMs > 100) { this.slowWarned = true; this.event('inference_slow', 'warning', { ms: Math.round(this.inferenceMs) }); }
      if (!this.sim.slow) this.slowWarned = false;
    }

    // ----- 개발용: 장치 연결 끊김 흉내 -----
    setDevice(name, connected) {
      if (name === 'server') { this.setOnline(connected); return; }
      const s = this.state;
      if (!(name in s.devices)) return;
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
        if (name.startsWith('camera_')) s.cameras[name.slice(7)] = { streaming: false, url: null, transport: 'mock' };
      }
      this.pushStatus();
    }

    // 개발용: 서보 과열('overheat') · 리더에 12V 어댑터('voltage') · 판정 지연('slow') · 다음 판정을 불량으로('defect') 흉내
    simulate(kind, on) {
      if (!(kind in this.sim)) return;
      this.sim[kind] = !!on;
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

  function makeArm(pose, temp) {
    const arm = { pos: {}, target: {}, temp: {}, load: {}, vel: {}, torque: true };
    JOINTS.forEach((j, i) => {
      arm.pos[j] = pose[j];
      arm.target[j] = pose[j];
      arm.temp[j] = temp + i * 0.4;
      arm.load[j] = 0;
      arm.vel[j] = 0;
    });
    return arm;
  }

  // 목표 각도로 관절마다 최대 속도(°/s, 그리퍼 %/s)까지 움직이고 부하를 계산한다
  function move(arm, dt, powered, holding) {
    JOINTS.forEach((j) => {
      const speed = j === 'gripper' ? 160 : 90;
      const diff = arm.target[j] - arm.pos[j];
      const step = powered ? Math.max(-speed * dt, Math.min(speed * dt, diff)) : 0;
      arm.pos[j] += step;
      arm.vel[j] = step / dt;
      let load = powered ? HOLD_LOAD[j] + Math.abs(arm.vel[j]) * 0.18 : 0;
      if (powered && holding && j === 'gripper') load += 34;
      arm.load[j] = Math.min(100, load) * (arm.vel[j] < 0 ? -1 : 1);
    });
  }

  // 온도는 부하를 따라 천천히 오른다. extra는 개발용 과열 흉내
  function heat(arm, dt, extra) {
    JOINTS.forEach((j) => {
      const add = extra && extra[j] ? extra[j] : 0;
      const target = 30 + Math.abs(arm.load[j]) * 0.32 + add;
      const tau = add ? 10 : 45;
      arm.temp[j] += (target - arm.temp[j]) * (dt / tau);
    });
  }

  // 사람이 리더암을 움직이는 것처럼 각도를 부드럽게 바꾼다
  function wander(arm, dt) {
    JOINTS.forEach((j) => {
      const limit = j === 'gripper' ? [0, 100] : [-90, 90];
      arm.vel[j] = arm.vel[j] * 0.92 + (Math.random() - 0.5) * 220 * dt;
      arm.pos[j] = Math.min(limit[1], Math.max(limit[0], arm.pos[j] + arm.vel[j] * dt));
    });
  }

  const ROUTES = {
    'GET /status'() { return ok(this.snapshot()); },

    'GET /info'() {
      return ok({
        api: '0.2',
        server: { name: 'mock-server', version: '0.2.0' },
        joint_unit: 'deg',
        cameras: [
          { id: 'top', transport: 'mock', width: 1280, height: 720, fps: 30 },
          { id: 'close', transport: 'mock', width: 1280, height: 720, fps: 30 },
        ],
        arms: { arm: { role: 'follower' }, leader: { role: 'leader' } },
        features: ['telemetry', 'metrics', 'inspection_bbox', 'multi_camera'],
      });
    },

    async 'POST /line/start'() {
      const s = this.state;
      if (s.estop) return fail(409, 'ESTOP_ACTIVE');
      if (s.line !== 'stopped') return fail(409, 'INVALID_STATE', { line: s.line });
      if (s.fault) return fail(409, 'FAULT_ACTIVE', { fault: s.fault.code });
      if (s.mode === 'manual' && this.wrongVoltage('leader', this.voltageOf('leader'))) return fail(409, 'POWER_ABNORMAL', { arm: 'leader' });
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
      s.started_at = now();
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
        this.haltAll();
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
      this.arms.arm.torque = false;
      this.pushStatus();
      if (!already) this.event('estop_pressed', 'alarm');
      return ok(this.snapshot());
    },

    'POST /estop/release'() {
      const s = this.state;
      if (!s.estop) return fail(409, 'ESTOP_NOT_ACTIVE');
      s.estop = false;
      const arm = this.arms.arm;
      JOINTS.forEach((j) => { arm.target[j] = arm.pos[j]; }); // 힘을 다시 줄 때 튀지 않도록 지금 자세를 목표로
      arm.torque = true;
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
      Object.assign(this.arms.arm.target, angles);
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

    // 본문이 없으면 모든 카메라, { camera: 'top' } 이면 그 카메라만
    'POST /camera/start'(body) {
      const s = this.state;
      if (body.camera !== undefined && !CAMERAS.includes(body.camera)) return fail(404, 'CAMERA_NOT_FOUND', { camera: body.camera });
      const ids = body.camera !== undefined ? [body.camera] : CAMERAS;
      const ready = ids.filter((c) => s.devices['camera_' + c] === 'connected');
      if (!ready.length) return fail(409, 'DEVICES_NOT_READY', { missing: ids.map((c) => 'camera_' + c) });
      ready.forEach((c) => { s.cameras[c] = { streaming: true, url: 'mock://camera/' + c, transport: 'mock' }; });
      this.pushStatus();
      this.event('camera_started', 'info', body.camera !== undefined ? { camera: body.camera } : {});
      return ok({ url: s.cameras[ready[0]].url, cameras: Object.fromEntries(ready.map((c) => [c, s.cameras[c]])) });
    },

    'POST /camera/stop'(body) {
      const s = this.state;
      const ids = body.camera !== undefined ? [body.camera] : CAMERAS;
      ids.forEach((c) => { if (s.cameras[c]) s.cameras[c] = { streaming: false, url: null, transport: 'mock' }; });
      this.pushStatus();
      this.event('camera_stopped', 'info', body.camera !== undefined ? { camera: body.camera } : {});
      return ok();
    },

    'POST /system/shutdown'() {
      this.haltAll();
      CAMERAS.forEach((c) => { this.state.cameras[c] = { streaming: false, url: null, transport: 'mock' }; });
      this.pushStatus();
      this.event('shutdown_started');
      setTimeout(() => this.emit('shutdown_complete', {}), 1200);
      return accepted();
    },
  };

  root.MockServer = MockServer;
})(typeof window !== 'undefined' ? window : globalThis);
