// 화면 공통 상태 — 서버 연결을 하나 열고, 받은 메시지로 최신 상태를 모아 둡니다.
// 조작 화면(app.js)과 대시보드(dashboard.js)가 같은 규칙(연결 끊김 판단·상태 합치기·통계·서보 경고)을 쓰도록 여기에 둡니다.
(function () {
  const cfg = window.HMI_CONFIG;
  const api = window.HmiApi;
  const robot = window.HMI_ROBOT || {};
  const { t } = window.I18N;

  const INSPECTION_KEEP = 60;
  const MINUTES_KEEP = 120;
  const EMPTY_STATUS = { line: 'stopped', estop: false, mode: 'auto', devices: {}, stats: { total: 0, good: 0, defect: 0 }, cameras: {}, fault: null, startedAt: null };

  const listeners = new Set();
  const state = {
    online: false,
    everConnected: false,
    status: null, // 서버 상태 (adapter.js가 맞춘 모양)
    info: null, // 서버 정보 (GET /info). v0.1 서버면 null
    joints: { leader: null, arm: null, target: null },
    telemetry: { arm: null, leader: null },
    metrics: null,
    inspections: [], // 최근 판정, 새것이 앞
    minutes: [], // 분마다 판정 수 [{ t, good, defect }] — 받은 시각(이 PC 시계) 기준
    lastMessageAt: 0,
  };
  let started = false;
  let heartbeatSeen = false;
  let statusVersion = 0;
  let infoChecked = false;
  let serverServoEvents = false;
  const servoLevels = {};

  function emit(kind, data) {
    listeners.forEach((fn) => {
      try { fn(kind, data); } catch (err) { console.error(err); } // 한 화면 부분이 실패해도 나머지는 그린다
    });
  }

  // ---------- 연결 ----------

  function setOnline(next) {
    if (state.online === next) return;
    state.online = next;
    state.lastMessageAt = Date.now();
    if (next) state.everConnected = true;
    emit('online', next);
  }

  // 연결되면 서버 정보와 전체 상태를 한 번 묻는다 — 연결 직후 상태를 안 보내는 서버도 있어서
  async function refresh() {
    if (!infoChecked) {
      infoChecked = true;
      try {
        const info = await api.getInfo();
        if (info) setInfo(info);
      } catch (err) { infoChecked = false; }
    }
    const version = statusVersion;
    try {
      const st = await api.getStatus();
      if (version === statusVersion) applyStatus(st); // 그사이 실시간 상태가 왔으면 그것이 더 새것
    } catch (err) { /* 실시간 메시지로 받는다 */ }
  }

  function setInfo(info) {
    const before = api.adapter.primaryCamera();
    api.adapter.setInfo(info);
    state.info = info;
    // 주 카메라 id가 바뀌면(예: 'main' → 'top') 카메라·장치 목록을 새로 받는다
    if (state.status && before !== api.adapter.primaryCamera()) {
      state.status.devices = {};
      state.status.cameras = {};
    }
    emit('info', info);
  }

  function applyStatus(patch) {
    const next = Object.assign({}, state.status || EMPTY_STATUS);
    Object.entries(patch || {}).forEach(([key, value]) => {
      next[key] = (key === 'devices' || key === 'cameras') ? Object.assign({}, next[key], value) : value;
    });
    state.status = next;
    emit('status', next);
  }

  function onInspection(d) {
    const st = state.status || (state.status = Object.assign({}, EMPTY_STATUS));
    if (d.stats) st.stats = d.stats;
    else if (d.result) {
      // 서버가 판정마다 통계를 안 보내면 HMI가 센다. 다음 상태 메시지의 stats가 오면 그것이 맞는 값이다
      st.stats = Object.assign({}, st.stats);
      st.stats.total += 1;
      st.stats[d.result] += 1;
    }
    const item = Object.assign({ receivedAt: Date.now() }, d);
    state.inspections.unshift(item);
    if (state.inspections.length > INSPECTION_KEEP) state.inspections.pop();
    const minute = Math.floor(item.receivedAt / 60000) * 60000;
    let bucket = state.minutes[state.minutes.length - 1];
    if (!bucket || bucket.t !== minute) {
      bucket = { t: minute, good: 0, defect: 0 };
      state.minutes.push(bucket);
      if (state.minutes.length > MINUTES_KEEP) state.minutes.shift();
    }
    if (d.result === 'good' || d.result === 'defect') bucket[d.result] += 1;
    emit('inspection', item);
  }

  function onMessage(msg) {
    state.lastMessageAt = Date.now();
    if (!state.online) setOnline(true);
    const d = msg.data;
    switch (msg.type) {
      case 'status':
        statusVersion += 1;
        applyStatus(d);
        break;
      case 'inspection':
        if (d) onInspection(d);
        break;
      case 'event':
        if (d && /^servo_/.test(d.code)) serverServoEvents = true;
        emit('event', d);
        break;
      case 'joints':
        if (d) { state.joints[d.source] = d; emit('joints', d); }
        break;
      case 'telemetry':
        if (d) { state.telemetry[d.arm] = d; watchServos(d); emit('telemetry', d); }
        break;
      case 'metrics':
        state.metrics = Object.assign({ receivedAt: Date.now() }, d);
        emit('metrics', state.metrics);
        break;
      case 'frame':
        emit('frame', d);
        break;
      case 'heartbeat':
        heartbeatSeen = true;
        break;
      case 'info':
        setInfo(d);
        break;
      case 'home_complete':
      case 'shutdown_complete':
        emit(msg.type, d);
        break;
      default:
        break;
    }
  }

  // ---------- 서보 경고 (서버가 따로 알려 주지 않을 때) ----------
  // 서보 상태 값만 오고 servo_* 이벤트가 없으면 HMI가 기준(config/robot.js limits·supply)으로 판단해 기록을 남긴다

  function localAlarms() {
    if (robot.localAlarms === true) return true;
    if (robot.localAlarms === false) return false;
    return !serverServoEvents;
  }

  function changeLevel(key, level, makeEvent) {
    const was = servoLevels[key] || null;
    if (level === was) return;
    servoLevels[key] = level;
    const evt = makeEvent(level, was);
    if (evt) emit('event', Object.assign({ at: new Date().toISOString(), local: true, params: {} }, evt));
  }

  function watchServos(tel) {
    if (!localAlarms()) return;
    const lim = robot.limits || {};
    Object.entries(tel.motors || {}).forEach(([joint, m]) => {
      if (typeof m.temp === 'number' && lim.tempWarn) {
        const key = tel.arm + '.' + joint + '.temp';
        const was = servoLevels[key] || null;
        const level = m.temp >= lim.tempAlarm ? 'alarm' : m.temp >= lim.tempWarn ? 'warning' : was && m.temp >= lim.tempWarn - 3 ? was : null;
        changeLevel(key, level, (lv, prev) => {
          if (!lv) return { code: 'servo_recovered', level: 'info', params: { arm: tel.arm, joint } };
          if (lv === 'warning' && prev === 'alarm') return null; // 내려가는 중은 조용히
          return { code: 'servo_overheat', level: lv, params: { arm: tel.arm, joint, temp: m.temp, limit: lv === 'alarm' ? lim.tempAlarm : lim.tempWarn } };
        });
      }
      const faults = (m.faults || []).filter((f) => ['sensor', 'current', 'overload'].includes(f));
      changeLevel(tel.arm + '.' + joint + '.faults', faults.length ? faults.join(',') : null, (lv) => (lv
        ? { code: 'servo_error', level: 'alarm', params: { arm: tel.arm, joint, faults: faults.map((f) => t('fault.bit.' + f)).join(', ') } }
        : { code: 'servo_recovered', level: 'info', params: { arm: tel.arm, joint } }));
    });
    const sup = robot.arms && robot.arms[tel.arm] && robot.arms[tel.arm].supply;
    const volts = Object.values(tel.motors || {}).map((m) => m.volt).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (sup && volts.length) {
      const v = volts[Math.floor(volts.length / 2)];
      const wrong = (sup.wrongAbove !== undefined && v > sup.wrongAbove) || (sup.wrongBelow !== undefined && v < sup.wrongBelow);
      const level = wrong ? 'alarm' : v < sup.warnLow || v > sup.warnHigh ? 'warning' : null;
      changeLevel(tel.arm + '.voltage', level, (lv) => (lv
        ? { code: 'servo_voltage', level: lv, params: { arm: tel.arm, volt: v, nominal: sup.nominal } }
        : { code: 'servo_recovered', level: 'info', params: { arm: tel.arm } }));
    }
  }

  // ---------- 이름 ----------

  const known = (key, fallback) => { const s = t(key); return s === key ? fallback : s; };

  function cameraIds() {
    const ids = [];
    ((state.info && state.info.cameras) || []).forEach((c) => { if (!ids.includes(c.id)) ids.push(c.id); });
    Object.keys((state.status && state.status.cameras) || {}).forEach((id) => { if (!ids.includes(id)) ids.push(id); });
    return ids;
  }

  function primaryCamera() {
    if (cfg.cameras.primary && cfg.cameras.primary !== 'auto') return cfg.cameras.primary;
    return cameraIds()[0] || api.adapter.primaryCamera();
  }

  function cameraName(id) {
    if (cfg.cameras.labels && cfg.cameras.labels[id]) return cfg.cameras.labels[id];
    const fromInfo = state.info && state.info.cameras.find((c) => c.id === id);
    if (fromInfo && fromInfo.label) return fromInfo.label;
    return t('camera.fallback', { id });
  }

  function deviceName(id) {
    if (/^camera_/.test(id)) return cameraName(id.slice(7));
    return known('device.' + id, id);
  }

  const jointName = (id) => known('joint.' + id, id);
  const armName = (id) => known('arm.' + id, id);
  const reasonText = (code) => known('reason.' + code, code);

  // 서버는 문장 대신 코드와 값을 보낸다 — 화면 문구는 여기서 만든다 (모르는 코드는 서버 문장이나 코드 그대로)
  function eventText(evt) {
    const p = Object.assign({}, evt.params);
    if (p.device) p.device = deviceName(p.device);
    if (Array.isArray(p.devices)) p.devices = p.devices.map(deviceName).join(', ');
    if (p.mode) p.mode = known('mode.' + p.mode, p.mode);
    if (p.arm) p.arm = armName(p.arm);
    if (p.joint) p.joint = jointName(p.joint);
    if (p.reason) p.reason = reasonText(p.reason);
    if (p.camera) p.camera = cameraName(p.camera);
    const key = 'event.' + evt.code;
    const text = t(key, p);
    if (text !== key && !/\{\w+\}/.test(text)) return text;
    // 값이 빠져 문장을 다 채울 수 없으면 짧은 문장으로
    const bare = t(key + '.bare');
    if (bare !== key + '.bare') return bare;
    return evt.message || t('event.unknown', { code: evt.code });
  }

  // 값이 다 있으면 자세히, 빠진 값이 있으면 짧은 원인만
  function faultText(fault) {
    const p = Object.assign({}, fault.params);
    if (p.arm) p.arm = armName(p.arm);
    if (p.joint) p.joint = jointName(p.joint);
    const full = t('fault.' + fault.code, p);
    if (full !== 'fault.' + fault.code && !/\{\w+\}/.test(full)) return full;
    const short = t('reason.' + fault.code);
    if (short !== 'reason.' + fault.code) return t('fault.short', { reason: short });
    return fault.message || t('fault.unknown', { code: fault.code });
  }

  function errorText(err) {
    const code = err && err.code;
    const d = (err && err.details) || {};
    if (code === 'DEVICES_NOT_READY') return t('error.DEVICES_NOT_READY', { devices: (d.missing || []).map(deviceName).join(', ') });
    if (code === 'FAULT_ACTIVE') return t('error.FAULT_ACTIVE', { fault: faultText({ code: d.fault || d.code || 'FAULT', params: d.params || {} }) });
    if (code === 'POWER_ABNORMAL') return t('error.POWER_ABNORMAL', { arm: armName(d.arm || 'arm') });
    const known2 = t('error.' + code);
    if (known2 !== 'error.' + code) return known2;
    if (err && err.serverMessage) return t('error.server', { message: err.serverMessage });
    return t('error.unknown', { code });
  }

  // 카메라 상태 + 영상 받는 방식. 설정(cameras.transport)이 'auto'가 아니면 그것을 쓴다
  function cameraSource(id) {
    const st = state.status && state.status.cameras && state.status.cameras[id];
    const fromInfo = state.info && state.info.cameras.find((c) => c.id === id);
    const forced = cfg.cameras.transport && cfg.cameras.transport !== 'auto' ? cfg.cameras.transport : null;
    const url = (st && st.url) || (fromInfo && fromInfo.url) || null;
    const transport = forced || (st && st.transport) || (fromInfo && fromInfo.transport) || (cfg.useMock ? 'mock' : 'mjpeg');
    return {
      id,
      streaming: transport === 'local' ? true : !!(st && st.streaming),
      url,
      transport,
      width: fromInfo && fromInfo.width,
      height: fromInfo && fromInfo.height,
    };
  }

  // ---------- 시작 ----------

  setInterval(() => {
    const required = cfg.heartbeatRequired === true || (cfg.heartbeatRequired !== false && heartbeatSeen);
    if (state.online && required && cfg.heartbeatTimeoutMs > 0 && Date.now() - state.lastMessageAt > cfg.heartbeatTimeoutMs) setOnline(false);
  }, 1000);

  window.HmiStore = {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      api.connect({
        onOpen() { setOnline(true); refresh(); },
        onClose() { setOnline(false); },
        onMessage,
      });
    },
    refresh,
    cameraIds,
    primaryCamera,
    cameraName,
    cameraSource,
    deviceName,
    jointName,
    armName,
    eventText,
    faultText,
    errorText,
  };
})();
