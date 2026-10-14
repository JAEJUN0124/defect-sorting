// 가짜 서버 — docs/API.md v0.4 의 동작을 브라우저 안에서 흉내 냅니다 (실제 서버가 준비되기 전 개발용).
// 공정 순서는 docs/line-sequence.md의 "부품마다 멈춤"입니다. 컨베이어는 가짜 아두이노(js/conveyor.js)를 규약 그대로 써서 움직이고,
// 불량품은 로봇팔 작업(docs/arm-control.md — 정해 둔 자세와 학습 정책을 섞은 예)으로 불량 상자에 옮깁니다.
// 로봇팔은 키트 구성(팔로워 12V · 리더 7.4V급, 서보 6개씩)대로 각도·온도·전압·부하를 만들어 보내고,
// 카메라 두 대(위·근접)와 판정 상자·신뢰도·판정 시간, 지난 기록(GET /history)도 냅니다. 실제 서버를 만들 때 동작 견본으로 쓸 수 있습니다.
// 실제 서버가 생기면 config.js의 useMock을 false로 바꾸면 이 파일은 쓰이지 않습니다.
(function (root) {
  'use strict';

  const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  const ARM_JOINTS = JOINTS.slice(0, 5); // 그리퍼를 뺀 관절 — 자세 이동은 그리퍼를 움직이지 않는다
  const CAMERAS = ['top', 'close'];
  const REQUIRED = {
    auto: ['conveyor', 'arm', 'camera_top'],
    manual: ['conveyor', 'arm', 'leader', 'camera_top'],
  };
  const DEFECT_RATE = 0.08;
  const TICK_MS = 50;
  // 공정 순서 설정값 (docs/line-sequence.md 7장)
  const LINE = { settleMs: 300, passTimeoutMs: 3000, conveyorSpeed: 50 };
  // 지난 기록을 남기는 양 (GET /history)
  const KEEP = { events: 500, inspections: 500, minutes: 180 };

  // 로봇팔 자세 (각도는 도, 그리퍼는 %) — docs/arm-control.md 3장의 설정 모양
  const POSE = {
    wait: { shoulder_pan: 0, shoulder_lift: -35, elbow_flex: 70, wrist_flex: 45, wrist_roll: 0, gripper: 20 },
    above_pick: { shoulder_pan: 18, shoulder_lift: -5, elbow_flex: 35, wrist_flex: 60, wrist_roll: 0, gripper: 70 },
    pick: { shoulder_pan: 18, shoulder_lift: 8, elbow_flex: 22, wrist_flex: 62, wrist_roll: 0, gripper: 70 },
    above_bin: { shoulder_pan: -70, shoulder_lift: -15, elbow_flex: 45, wrist_flex: 50, wrist_roll: 30, gripper: 12 },
    rest: { shoulder_pan: 0, shoulder_lift: -95, elbow_flex: 95, wrist_flex: 70, wrist_roll: 0, gripper: 10 },
  };
  // 그리퍼: 여는 값·닫는 값, 이보다 더 닫히면 빈손(holdingMin), 부품 폭(닫히다가 부품에 막히는 값)
  const GRIP = { open: 70, close: 5, holdingMin: 12, partWidth: 18 };
  // 작업 = 단계 목록. 다가가기·옮기기는 정해 둔 자세로, 집기만 학습 정책으로 하는 예
  const TASKS = {
    sort_defect: {
      retry: { times: 1, from: 0 },
      steps: [
        { pose: 'above_pick' },
        { policy: 'grasp_part', timeout_s: 5, until: 'holding' },
        { pose: 'above_bin' },
        { gripper: 'open' },
        { pose: 'wait' },
      ],
    },
  };
  // 관절별로 버티는 힘(%) — 어깨 들기·팔꿈치가 팔 무게를 받는다
  const HOLD_LOAD = { shoulder_pan: 4, shoulder_lift: 24, elbow_flex: 17, wrist_flex: 8, wrist_roll: 3, gripper: 2 };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const now = () => new Date().toISOString();
  const r1 = (v) => Math.round(v * 10) / 10;
  const ok = (body) => ({ status: 200, body: body || { ok: true } });
  const accepted = () => ({ status: 202, body: { accepted: true } });
  const fail = (status, code, details) => ({ status, body: { error: { code, details: details || {} } } });
  const roundPose = (pose) => Object.fromEntries(JOINTS.map((j) => [j, r1(pose[j])]));
  const makeRunId = () => now().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);

  // HMI에 보이는 단계 이름 (상태 cycle.step)
  function stepName(def) {
    if (def.pose) return def.pose;
    if (def.policy) return def.policy;
    if (def.gripper) return 'gripper_' + def.gripper;
    if (def.check) return 'check_' + def.check;
    return 'pause';
  }

  class MockServer {
    constructor(options) {
      const opt = Object.assign({}, options);
      const robot = root.HMI_ROBOT || {};
      this.limits = Object.assign({ tempWarn: 55, tempAlarm: 65, tempServo: 70 }, robot.limits);
      this.supply = {
        arm: Object.assign({ nominal: 12, wrongBelow: 9, warnLow: 10.8, warnHigh: 13.2 }, robot.arms && robot.arms.arm && robot.arms.arm.supply),
        leader: Object.assign({ nominal: 7.5, wrongAbove: 10, warnLow: 6.5, warnHigh: 8.4 }, robot.arms && robot.arms.leader && robot.arms.leader.supply),
      };
      this.lineCfg = Object.assign({}, LINE, opt.line);
      this.armSpeed = opt.armSpeed || 60; // 자세 이동 최대 속도 °/s (docs/arm-control.md 5장)
      this.defectRate = opt.defectRate !== undefined ? opt.defectRate : DEFECT_RATE;
      this.tasks = Object.assign({}, TASKS, opt.tasks); // 시험에서 작업 단계·시간을 바꿔 끼울 수 있다
      this.online = true;
      this.destroyed = false;
      this.connections = new Set();
      this.timers = {};
      this.nextId = 1;
      this.sim = { overheat: false, voltage: false, slow: false, defect: false, gripFail: false, jam: false, conveyorButton: false };
      this.state = {
        line: 'stopped',
        estop: false,
        mode: 'auto',
        fault: null,
        started_at: null,
        // 원점은 서버가 아니라 HMI가 저장한다 (v0.5) — 원점 복귀 명령이 각도를 함께 가져온다.
        // 원점 복귀가 필요한지(긴급정지·로봇팔 고장 뒤)는 서버가 안다. 가짜 서버는 팔이 대기 자세로 켜진다고 본다
        home_required: false,
        cycle: null,
        devices: { conveyor: 'connected', arm: 'connected', leader: 'connected', camera_top: 'connected', camera_close: 'connected' },
        stats: { total: 0, good: 0, defect: 0 },
        cameras: Object.fromEntries(CAMERAS.map((id) => [id, { streaming: false, url: null, transport: 'mock' }])),
      };
      this.arms = { arm: makeArm(POSE.wait, 33), leader: makeArm(POSE.wait, 30) };
      this.arms.leader.torque = false; // 리더는 힘을 빼 두고 사람이 움직인다
      this.task = null; // 로봇팔이 하는 작업 { name, part, steps, retry, i, retries, step }
      this.holding = false; // 그리퍼가 부품을 쥐고 있음
      this.homeTarget = null;
      this.deferredTrip = null; // 로봇팔 작업이 끝난 뒤 세울 고장
      this.alarms = {};
      this.inferenceMs = 21;
      this.slowWarned = false;
      this.tickCount = 0;
      // 지난 기록 (GET /history) — 서버를 켤 때마다 run_id가 바뀌고 순번(seq)은 1부터
      this.runId = makeRunId();
      this.seq = 0;
      this.log = { events: [], inspections: [], minutes: [] };
      if (opt.seed) this.restore(opt.seed);
      if (opt.telemetry) this.restoreArms(opt.telemetry);
      if (opt.history) this.restoreHistory(opt.history);
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
      // 컨베이어: 정지 단추가 달린 가짜 아두이노 (센서·스스로 멈추기·속도 조절 있음)
      this.conv = { link: root.Conveyor.fakeLink(Object.assign({ button: true }, opt.conveyor)), client: null, opened: false };
      this.openConveyor();
    }

    destroy() {
      this.destroyed = true;
      Object.values(this.timers).forEach((t) => { clearInterval(t); clearTimeout(t); });
      this.connections.clear();
      if (this.conv.client) this.conv.client.close();
    }

    // 다른 탭이 가짜 서버를 넘겨받을 때 마지막 상태에서 이어 간다 (mock-hub.js)
    restore(seed) {
      const s = this.state;
      ['line', 'estop', 'mode', 'fault', 'started_at', 'home_required'].forEach((k) => { if (seed[k] !== undefined) s[k] = seed[k]; });
      if (!['stopped', 'running'].includes(s.line)) s.line = 'stopped';
      if (s.line === 'running') s.cycle = { stage: 'feeding', part: null, step: null }; // 다루던 부품은 이어 가지 않는다
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

    // 넘겨받을 때 지난 기록·순번·run_id도 이어 간다 — 화면이 서버가 다시 켜진 것으로 보지 않게
    restoreHistory(h) {
      if (h.runId) this.runId = h.runId;
      this.seq = Math.max(this.seq, Number(h.seq) || 0);
      ['events', 'inspections'].forEach((k) => { if (Array.isArray(h[k])) this.log[k] = h[k].slice(-KEEP[k]); });
      if (Array.isArray(h.minutes)) this.log.minutes = h.minutes.map((b) => ({ t: b.t, good: b.good, defect: b.defect })).slice(-KEEP.minutes);
    }

    historySnapshot() {
      return {
        runId: this.runId,
        seq: this.seq,
        events: this.log.events.slice(),
        inspections: this.log.inspections.slice(),
        minutes: this.log.minutes.map((b) => Object.assign({}, b)),
      };
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

    // 이벤트는 순번을 붙여 기록에 남긴 뒤 보낸다 — 서버 연결이 끊긴 동안 생긴 것도 다시 붙으면 기록 조회로 받는다
    event(code, level, params) {
      const e = { seq: this.nextSeq(), code, level: level || 'info', params: params || {}, at: now() };
      this.record('events', e);
      this.emit('event', e);
    }

    nextSeq() {
      this.seq += 1;
      return this.seq;
    }

    record(kind, item) {
      const list = this.log[kind];
      list.push(item);
      if (list.length > KEEP[kind]) list.shift();
    }

    countMinute(result) {
      const t = Math.floor(Date.now() / 60000) * 60000;
      let bucket = this.log.minutes[this.log.minutes.length - 1];
      if (!bucket || bucket.t !== t) {
        bucket = { t, good: 0, defect: 0 };
        this.log.minutes.push(bucket);
        if (this.log.minutes.length > KEEP.minutes) this.log.minutes.shift();
      }
      bucket[result] += 1;
    }

    snapshot() { return JSON.parse(JSON.stringify(this.state)); }

    // ----- HTTP 흉내 -----
    // GET의 값은 주소 뒤(?after=…)로, 실시간 연결로 보낸 명령은 본문으로 온다 — 둘 다 같은 자리에서 받는다
    async request(method, path, body) {
      await sleep(120 + Math.random() * 120);
      if (!this.online) throw new TypeError('Failed to fetch');
      const [p, qs] = String(path).split('?');
      const route = ROUTES[method + ' ' + p];
      if (!route) return fail(404, 'NOT_FOUND');
      const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
      return route.call(this, Object.assign({}, query, body || {}));
    }

    // ----- 컨베이어 (docs/conveyor-protocol.md) -----
    // 연결 순서는 서버 쪽 견본(Conveyor.Client.open)이 한다: !READY → INFO → STOP → STATUS → SPEED·AUTOSTOP → PING
    async openConveyor() {
      const client = new root.Conveyor.Client(this.conv.link, { readyWaitMs: 1000 });
      this.conv.client = client;
      client.on((kind, data) => this.onConveyor(kind, data));
      try {
        await client.open({ speed: this.lineCfg.conveyorSpeed, autostop: this.state.mode === 'auto' });
        if (this.destroyed) return;
        this.conv.opened = true;
        if (this.state.line === 'running') this.conveyor('run'); // 다른 탭에서 넘겨받은 가동 상태
      } catch (err) {
        if (!this.destroyed) this.setDeviceState('conveyor', 'disconnected');
      }
    }

    // 명령 하나 (실패해도 공정은 알림·응답 없음 판단으로 처리한다)
    conveyor(name, arg) {
      const c = this.conv.client;
      if (!c || !this.conv.opened) return Promise.resolve(null);
      return c[name](arg).catch(() => null);
    }

    onConveyor(kind, data) {
      if (this.destroyed) return;
      switch (kind) {
        case 'lost': // 응답이 3번 이어서 없음 (USB가 빠짐 등)
          this.setDeviceState('conveyor', 'disconnected');
          break;
        case 'back':
          if (this.conv.opened) this.setDeviceState('conveyor', 'connected');
          break;
        case 'ready': // 처음 켜질 때의 알림은 open()이 받는다. 그 뒤에 오면 아두이노가 리셋된 것
          if (this.conv.opened) this.conveyorRebooted();
          break;
        case 'state':
          if (data.state === 'halted' && ['watchdog', 'button', 'fault'].includes(data.reason)) this.conveyorHalted(data.reason, data.code);
          break;
        case 'part':
          this.onPart(data);
          break;
        default:
          break;
      }
    }

    // 리셋된 컨베이어는 설정이 처음 값이다: 다시 넣고, 가동 중이었으면 고장으로 세운다 (docs/line-sequence.md 3장)
    async conveyorRebooted() {
      const s = this.state;
      const wasRunning = ['running', 'starting', 'stopping'].includes(s.line);
      const c = this.conv.client;
      await c.stop().catch(() => {});
      await c.configure({ speed: this.lineCfg.conveyorSpeed, autostop: s.mode === 'auto' }).catch(() => {});
      if (this.destroyed) return;
      this.setDeviceState('conveyor', 'connected');
      if (wasRunning) this.conveyorHalted('reset');
    }

    // 컨베이어가 스스로 멈추고 잠김 (감시 타이머·정지 단추·이상·리셋)
    conveyorHalted(reason, code) {
      const s = this.state;
      const params = code ? { reason, code } : { reason };
      if (!['running', 'starting', 'stopping'].includes(s.line)) { this.event('conveyor_halted', 'warning', params); return; }
      // 로봇팔이 불량품을 옮기는 중이면 그 작업은 끝낸 뒤 세운다 (벨트는 이미 멈춰 있다)
      if (this.task) { this.deferredTrip = { code: 'CONVEYOR_HALTED', params, clear: 'start' }; return; }
      this.trip('CONVEYOR_HALTED', params, 'start');
    }

    // ----- 공정 순서: 부품마다 멈춤 (docs/line-sequence.md 2장) -----
    setCycle(stage, part) {
      this.state.cycle = stage ? { stage, part: part === undefined ? null : part, step: null } : null;
      this.pushStatus();
    }

    setStep(name) {
      if (!this.state.cycle) return;
      this.state.cycle = Object.assign({}, this.state.cycle, { step: name });
      this.pushStatus();
    }

    onPart(on) {
      const s = this.state;
      if (s.line !== 'running' || !s.cycle) return;
      if (on && s.mode === 'manual') { this.judge(); return; } // 수동: 멈추지 않고 판정만 (5장)
      if (on && s.cycle.stage === 'feeding') {
        const c = this.conv.client;
        if (!(c && c.state && c.state.autostop)) this.conveyor('stop'); // 스스로 멈추기가 없으면 서버가 세운다
        this.setCycle('inspecting', this.nextId);
        clearTimeout(this.timers.judge);
        this.timers.judge = setTimeout(() => this.judge(), this.lineCfg.settleMs + this.inferenceMs);
      } else if (!on && s.cycle.stage === 'passing') {
        clearTimeout(this.timers.pass);
        this.setCycle('feeding', null);
      }
    }

    judge() {
      const s = this.state;
      if (s.line !== 'running') return;
      const id = this.nextId++;
      const result = this.sim.defect || Math.random() < this.defectRate ? 'defect' : 'good';
      this.sim.defect = false; // '다음 판정을 불량으로'는 한 번만
      s.stats.total += 1;
      s.stats[result] += 1;
      const confidence = result === 'defect' ? 0.82 + Math.random() * 0.16 : 0.9 + Math.random() * 0.095;
      const data = {
        seq: this.nextSeq(),
        id,
        result,
        at: now(),
        camera: 'top',
        confidence: Math.round(confidence * 1000) / 1000,
        latency_ms: r1(this.inferenceMs + (Math.random() - 0.5) * 4),
        bbox: [0.455, 0.36, 0.09, 0.28],
        stats: { ...s.stats },
      };
      this.record('inspections', data);
      this.countMinute(result);
      this.emit('inspection', data);
      if (result === 'defect') this.event('defect_detected', 'warning', { id });
      if (s.mode !== 'auto' || !s.cycle) return; // 수동 모드는 사람이 리더암으로 집는다
      if (result === 'defect') {
        this.setCycle('sorting', id);
        this.startTask('sort_defect', id);
      } else {
        this.setCycle('passing', id);
        this.conveyor('run');
        clearTimeout(this.timers.pass);
        this.timers.pass = setTimeout(() => this.partStuck(id), this.lineCfg.passTimeoutMs);
      }
    }

    // 양품이 검사 자리를 지나가지 않음 (걸림)
    partStuck(id) {
      const s = this.state;
      if (s.line !== 'running' || !s.cycle || s.cycle.stage !== 'passing') return;
      this.trip('PART_STUCK', { part: id }, 'start');
    }

    // 불량품을 옮긴 뒤: 내보낼 부품이 없으니 바로 다음 부품을 기다린다. 정지를 눌렀으면 여기서 멈춘다
    afterSort() {
      const s = this.state;
      if (s.line === 'stopping') { this.finishStop(); return; }
      if (s.line !== 'running') return;
      this.setCycle('feeding', null);
      this.conveyor('run');
    }

    finishStop() {
      const s = this.state;
      clearTimeout(this.timers.stopWait);
      if (s.line !== 'stopping') return;
      s.line = 'stopped';
      s.started_at = null;
      s.cycle = null;
      this.holdArm();
      this.pushStatus();
      this.event('line_stopped');
    }

    // ----- 로봇팔 작업 (docs/arm-control.md 3장) -----
    startTask(name, part) {
      const def = this.tasks[name];
      this.task = { name, part, steps: def.steps, retry: def.retry || { times: 0, from: 0 }, i: -1, retries: 0, step: null };
      this.nextStep();
    }

    nextStep() {
      const t = this.task;
      const arm = this.arms.arm;
      // 쥔 부품을 들어 올리면 센서 위에서 빠진다
      if (this.holding && this.conv.link.device.partOn) this.conv.link.device.removePart();
      t.i += 1;
      if (t.i >= t.steps.length) { this.finishTask(); return; }
      const def = t.steps[t.i];
      const step = { def, since: Date.now(), phase: 0, timeoutMs: 0 };
      t.step = step;
      if (def.pose) {
        const pose = POSE[def.pose];
        const far = Math.max(...ARM_JOINTS.map((j) => Math.abs(pose[j] - arm.pos[j])));
        step.timeoutMs = def.timeout_s ? def.timeout_s * 1000 : (far / this.armSpeed) * 1000 + 2000;
        ARM_JOINTS.forEach((j) => { arm.target[j] = pose[j]; });
      } else if (def.gripper) {
        arm.target.gripper = typeof def.gripper === 'number' ? def.gripper : GRIP[def.gripper];
      } else if (def.policy) {
        this.policyReach(step);
      }
      this.setStep(stepName(def));
    }

    // 학습 정책 흉내: 집는 자리로 다가가며 그리퍼를 연다 (조금씩 다른 자리로 — 정책은 매번 같지 않다)
    policyReach(step) {
      const arm = this.arms.arm;
      step.phase = 0;
      ARM_JOINTS.forEach((j) => { arm.target[j] = POSE.pick[j] + (Math.random() - 0.5) * 2; });
      arm.target.gripper = GRIP.open;
    }

    stepTask() {
      const t = this.task;
      const step = t.step;
      const def = step.def;
      const arm = this.arms.arm;
      const elapsed = Date.now() - step.since;
      if (def.pose) {
        if (reached(arm, POSE[def.pose], ARM_JOINTS, 1.5)) this.nextStep();
        else if (elapsed > step.timeoutMs) this.failTask('ARM_MOTION_TIMEOUT');
      } else if (def.gripper) {
        if (elapsed < 150 || Math.abs(arm.vel.gripper) > 0.5) return;
        if (def.expect === 'holding' && !this.holding) this.failTask('GRIP_FAILED');
        else this.nextStep();
      } else if (def.policy) {
        if (def.until === 'holding' && this.holding) { this.nextStep(); return; }
        if (elapsed > def.timeout_s * 1000) { this.failTask(def.until === 'holding' ? 'GRIP_FAILED' : 'ARM_MOTION_TIMEOUT'); return; }
        if (step.phase === 0 && reached(arm, arm.target, ARM_JOINTS, 1.5) && arm.pos.gripper > GRIP.open - 3) {
          step.phase = 1;
          arm.target.gripper = GRIP.close;
        } else if (step.phase === 1 && Math.abs(arm.vel.gripper) < 0.5 && arm.pos.gripper < GRIP.holdingMin) {
          this.policyReach(step); // 빈손이면 다시 열고 다가간다
        }
      } else if (def.wait !== undefined) {
        if (elapsed >= def.wait) this.nextStep();
      } else if (def.check) {
        if ((def.check === 'holding') !== this.holding) this.failTask('GRIP_FAILED');
        else this.nextStep();
      }
    }

    // 실패: 그리퍼를 열고 retry.from 단계부터 다시. 그래도 안 되면 라인을 세우고 원점이 필요하다
    failTask(code) {
      const t = this.task;
      const name = stepName(t.step.def);
      if (t.retries < t.retry.times) {
        t.retries += 1;
        this.event('sort_retry', 'warning', { part: t.part, step: name });
        this.arms.arm.target.gripper = GRIP.open;
        t.i = t.retry.from - 1;
        this.nextStep();
        return;
      }
      this.task = null;
      this.deferredTrip = null;
      this.trip(code, { step: name, part: t.part }, 'home');
    }

    finishTask() {
      this.task = null;
      if (this.deferredTrip) {
        const d = this.deferredTrip;
        this.deferredTrip = null;
        this.trip(d.code, d.params, d.clear);
        return;
      }
      this.afterSort();
    }

    // 작업 중에 멈춘 팔은 어디에 있는지 알 수 없다 — 원점 복귀를 해야 자동으로 다시 시작 (docs/arm-control.md 6장)
    abortTask() {
      if (!this.task) return;
      this.task = null;
      this.state.home_required = true;
    }

    holdArm() {
      const arm = this.arms.arm;
      JOINTS.forEach((j) => { arm.target[j] = arm.pos[j]; });
    }

    // 집는 자리에서 닫히는 그리퍼가 부품 폭에 닿으면 거기서 멈춘다(쥠). 다시 열려 부품 폭을 넘으면 놓는다
    gripContact() {
      const arm = this.arms.arm;
      if (this.holding) {
        if (arm.pos.gripper > GRIP.partWidth + 3) this.holding = false;
        return;
      }
      if (this.sim.gripFail || !this.conv.link.device.partOn || !reached(arm, POSE.pick, ARM_JOINTS, 4)) return;
      if (arm.target.gripper < GRIP.partWidth && arm.pos.gripper <= GRIP.partWidth) {
        arm.pos.gripper = GRIP.partWidth;
        arm.target.gripper = GRIP.partWidth;
        arm.vel.gripper = 0;
        this.holding = true;
      }
    }

    haltAll() {
      ['judge', 'pass', 'home', 'stopWait'].forEach((k) => clearTimeout(this.timers[k]));
      this.abortTask();
      this.deferredTrip = null;
      this.homeTarget = null;
      const s = this.state;
      s.line = 'stopped';
      s.started_at = null;
      s.cycle = null;
      this.holdArm();
    }

    // ----- 로봇팔 움직임 -----
    tick(dt) {
      this.tickCount += 1;
      const s = this.state;
      const arm = this.arms.arm;
      const leader = this.arms.leader;
      if (s.mode === 'manual' && s.devices.leader === 'connected') wander(leader, dt);
      const powered = s.devices.arm === 'connected' && arm.torque && !s.estop;
      if (powered && s.line === 'running' && s.mode === 'manual' && s.devices.leader === 'connected') Object.assign(arm.target, leader.pos);
      if (powered && this.task) this.stepTask();
      move(arm, dt, powered, this.holding, this.armSpeed);
      if (powered) this.gripContact();
      heat(arm, dt, this.sim.overheat ? { elbow_flex: 48 } : null);
      heat(leader, dt, null);
      if (s.line === 'homing' && this.homeTarget && reached(arm, this.homeTarget, JOINTS, 1.5)) this.finishHome(true);
      if (this.tickCount % 2 === 0) this.sendJoints();
    }

    // 원점 복귀: 관절이 다 닿으면 끝. 제시간에 못 닿으면 고장 (docs/arm-control.md 4장)
    finishHome(arrived) {
      const s = this.state;
      clearTimeout(this.timers.home);
      this.homeTarget = null;
      if (s.line !== 'homing') return;
      if (!arrived) { this.trip('ARM_MOTION_TIMEOUT', { step: 'home' }, 'home'); return; }
      s.line = 'stopped';
      s.home_required = false;
      if (s.fault && s.fault.clear === 'home') s.fault = null;
      this.pushStatus();
      this.event('home_completed');
      this.emit('home_complete', {});
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
      // 과열이 풀리면 고장 표시도 지운다 (clear: auto)
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

    // 고장으로 라인을 세운다. clear는 풀리는 방법: auto(원인이 사라지면) · home(원점 복귀 또는 원점 잡기) · start(확인하고 시작) — docs/API.md 3.1
    trip(code, params, clear) {
      const s = this.state;
      s.fault = { code, params: params || {}, clear: clear || 'auto' };
      if (clear === 'home') s.home_required = true;
      if (['running', 'starting', 'stopping', 'homing'].includes(s.line)) {
        this.conveyor('stop');
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

    // ----- 장치 연결 -----
    setDeviceState(name, next) {
      const s = this.state;
      if (!(name in s.devices) || s.devices[name] === next) return;
      s.devices[name] = next;
      if (next === 'connected') {
        this.event('device_reconnected', 'info', { device: name });
      } else {
        this.event('device_disconnected', 'warning', { device: name });
        const needed = REQUIRED[s.mode].includes(name);
        if (needed && ['running', 'starting', 'stopping'].includes(s.line)) {
          this.conveyor('stop');
          this.haltAll();
          this.event('line_stopped_fault', 'warning', { device: name });
        }
        if (name === 'arm' && s.line === 'homing') this.haltAll();
        if (name.startsWith('camera_')) s.cameras[name.slice(7)] = { streaming: false, url: null, transport: 'mock' };
      }
      this.pushStatus();
    }

    // 개발용: 장치 연결 끊김 흉내. 컨베이어는 USB를 뽑은 것처럼 해서, 서버 쪽 견본이 응답 없음 3번으로 알아채게 한다
    setDevice(name, connected) {
      if (name === 'server') { this.setOnline(connected); return; }
      if (name === 'conveyor') { this.conv.link.device.setUnplugged(!connected); return; }
      this.setDeviceState(name, connected ? 'connected' : 'disconnected');
    }

    // 개발용: 서보 과열('overheat') · 리더에 12V 어댑터('voltage') · 판정 지연('slow') · 다음 판정을 불량으로('defect')
    //         집기 실패('gripFail') · 부품 걸림('jam') · 컨베이어 정지 단추('conveyorButton') 흉내
    simulate(kind, on) {
      if (!(kind in this.sim)) return;
      this.sim[kind] = !!on;
      const device = this.conv.link.device;
      if (kind === 'jam') device.setJam(on);
      if (kind === 'conveyorButton') device.pressButton(on);
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

  // 관절들이 목표 자세에서 tol(°) 안에 있는지
  function reached(arm, pose, joints, tol) {
    return joints.every((j) => Math.abs(arm.pos[j] - pose[j]) < tol);
  }

  // 목표 각도로 관절마다 최대 속도(°/s, 그리퍼는 두 배 %/s)까지 움직이고 부하를 계산한다
  function move(arm, dt, powered, holding, speed) {
    JOINTS.forEach((j) => {
      const max = j === 'gripper' ? speed * 2 : speed;
      const diff = arm.target[j] - arm.pos[j];
      const step = powered ? Math.max(-max * dt, Math.min(max * dt, diff)) : 0;
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
        api: '0.5',
        server: { name: 'mock-server', version: '0.5.0' },
        joint_unit: 'deg',
        cameras: [
          { id: 'top', transport: 'mock', width: 1280, height: 720, fps: 30 },
          { id: 'close', transport: 'mock', width: 1280, height: 720, fps: 30 },
        ],
        arms: { arm: { role: 'follower' }, leader: { role: 'leader' } },
        features: ['telemetry', 'metrics', 'inspection_bbox', 'multi_camera', 'history', 'cycle', 'home'],
      });
    },

    // 지난 기록 (docs/API.md 5.2) — after 뒤의 이벤트·판정과 최근 몇 분의 분당 집계
    'GET /history'(q) {
      const after = Number(q.after) || 0;
      const count = (v, d) => (v === undefined || v === '' ? d : Math.max(0, Math.floor(Number(v)) || 0));
      const take = (list, n) => (n ? list.filter((x) => x.seq > after).slice(-n) : []);
      const minutes = count(q.minutes, 120);
      const since = Math.floor(Date.now() / 60000) * 60000 - (minutes - 1) * 60000;
      return ok({
        run_id: this.runId,
        now: now(),
        last_seq: this.seq,
        events: take(this.log.events, count(q.events, 200)),
        inspections: take(this.log.inspections, count(q.inspections, 60)),
        minutes: minutes ? this.log.minutes.filter((b) => b.t >= since).map((b) => ({ t: new Date(b.t).toISOString(), good: b.good, defect: b.defect })) : [],
      });
    },

    // 시작 (docs/API.md 4.1): 거절할 것을 차례로 본 뒤 장치 확인 → 컨베이어 잠금 풀기·설정 → 가동
    async 'POST /line/start'() {
      const s = this.state;
      if (s.estop) return fail(409, 'ESTOP_ACTIVE');
      if (s.line !== 'stopped') return fail(409, 'INVALID_STATE', { line: s.line });
      if (s.fault && (s.fault.clear || 'auto') === 'auto') return fail(409, 'FAULT_ACTIVE', { fault: s.fault.code, params: s.fault.params });
      // 원점 복귀 필요는 자동 모드에만 — 수동 모드는 사람이 리더암으로 팔을 움직인다. 저장된 원점이 있는지는 HMI가 본다(v0.5)
      if (s.mode === 'auto' && s.home_required) return fail(409, 'HOME_REQUIRED');
      if (s.mode === 'manual' && this.wrongVoltage('leader', this.voltageOf('leader'))) return fail(409, 'POWER_ABNORMAL', { arm: 'leader' });
      // clear: start — 시작이 곧 확인. 수동 모드면 clear: home 고장도 사람이 팔을 넘겨받은 것으로 본다 (원점 복귀 필요는 남아 자동 시작을 막는다)
      if (s.fault) s.fault = null;
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
      const c = this.conv.client;
      try {
        await c.reset();
        await c.configure({ speed: this.lineCfg.conveyorSpeed, autostop: s.mode === 'auto' });
      } catch (err) {
        if (s.line !== 'starting') return fail(409, s.estop ? 'ESTOP_ACTIVE' : 'INVALID_STATE', { line: s.line });
        // 정지 단추가 눌려 있거나 이상이 남아 잠금을 풀 수 없음
        s.line = 'stopped';
        s.fault = { code: 'CONVEYOR_HALTED', params: { reason: (c.state && c.state.reason) || 'fault' }, clear: 'start' };
        this.pushStatus();
        return fail(409, 'FAULT_ACTIVE', { fault: 'CONVEYOR_HALTED', params: s.fault.params });
      }
      if (s.line !== 'starting') return fail(409, s.estop ? 'ESTOP_ACTIVE' : 'INVALID_STATE', { line: s.line });
      s.line = 'running';
      s.started_at = now();
      s.cycle = { stage: 'feeding', part: null, step: null };
      if (s.mode === 'auto') Object.assign(this.arms.arm.target, POSE.wait); // 카메라를 가리지 않는 대기 자세로
      this.pushStatus();
      this.event('line_started');
      this.conveyor('run');
      return ok(this.snapshot());
    },

    // 정지: 컨베이어를 세우고, 로봇팔이 불량품을 옮기는 중이면 그 작업을 끝낸 뒤 정지 (docs/line-sequence.md 6장)
    async 'POST /line/stop'() {
      const s = this.state;
      if (s.line !== 'running') return fail(409, 'INVALID_STATE', { line: s.line });
      s.line = 'stopping';
      clearTimeout(this.timers.judge);
      clearTimeout(this.timers.pass);
      this.conveyor('stop');
      this.pushStatus();
      if (this.task) return ok(this.snapshot()); // 작업이 끝나면 afterSort가 정지로 바꾼다
      await sleep(400);
      this.finishStop();
      return ok(this.snapshot());
    },

    // 긴급정지: 컨베이어를 가장 먼저 잠그고, 로봇팔은 힘을 뺀다(팔이 처짐). 해제한 뒤 자동으로 시작하려면 원점 복귀가 필요하다
    'POST /estop'() {
      const s = this.state;
      const already = s.estop;
      s.estop = true;
      this.conveyor('halt');
      this.haltAll();
      this.arms.arm.torque = false;
      s.home_required = true;
      this.pushStatus();
      if (!already) this.event('estop_pressed', 'alarm');
      return ok(this.snapshot());
    },

    'POST /estop/release'() {
      const s = this.state;
      if (!s.estop) return fail(409, 'ESTOP_NOT_ACTIVE');
      s.estop = false;
      this.conveyor('reset');
      const arm = this.arms.arm;
      JOINTS.forEach((j) => { arm.target[j] = arm.pos[j]; }); // 힘을 다시 줄 때 튀지 않도록 지금 자세를 목표로
      arm.torque = true;
      this.pushStatus();
      this.event('estop_released');
      return ok(this.snapshot());
    },

    // 원점 복귀 (v0.5): HMI가 보낸 원점 각도로 천천히 옮긴다. 자동 모드·정지 상태에서만 — 수동 모드는 리더암이 팔을 움직인다.
    // 원점은 HMI가 저장한다 — 각도가 없으면 HOME_NOT_SET, 숫자가 아닌 관절이 있으면 INVALID_ANGLES
    'POST /robot/home'(body) {
      const s = this.state;
      if (s.estop) return fail(409, 'ESTOP_ACTIVE');
      if (s.mode !== 'auto') return fail(409, 'NOT_AUTO');
      if (s.line !== 'stopped') return fail(409, 'NOT_STOPPED');
      if (!body || !body.angles) return fail(409, 'HOME_NOT_SET');
      const bad = JOINTS.filter((j) => typeof body.angles[j] !== 'number' || !Number.isFinite(body.angles[j]));
      if (bad.length) return fail(422, 'INVALID_ANGLES', { joints: bad });
      if (s.devices.arm !== 'connected') return fail(409, 'DEVICES_NOT_READY', { missing: ['arm'] });
      const angles = body.angles;
      s.line = 'homing';
      this.homeTarget = Object.fromEntries(JOINTS.map((j) => [j, angles[j]]));
      Object.assign(this.arms.arm.target, this.homeTarget);
      this.pushStatus();
      this.event('home_started');
      const far = Math.max(...JOINTS.map((j) => Math.abs(angles[j] - this.arms.arm.pos[j])));
      this.timers.home = setTimeout(() => this.finishHome(false), (far / this.armSpeed) * 1000 + 3000);
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

    // 종료: 컨베이어를 세우고, 로봇팔은 접은 자세로 옮긴 뒤 힘을 뺀다 (docs/arm-control.md 6장)
    'POST /system/shutdown'() {
      this.conveyor('stop');
      this.haltAll();
      CAMERAS.forEach((c) => { this.state.cameras[c] = { streaming: false, url: null, transport: 'mock' }; });
      ARM_JOINTS.forEach((j) => { this.arms.arm.target[j] = POSE.rest[j]; });
      this.pushStatus();
      this.event('shutdown_started');
      setTimeout(() => {
        this.arms.arm.torque = false;
        this.emit('shutdown_complete', {});
      }, 1200);
      return accepted();
    },
  };

  root.MockServer = MockServer;
})(typeof window !== 'undefined' ? window : globalThis);
