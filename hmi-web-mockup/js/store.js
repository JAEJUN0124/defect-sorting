// 화면 공통 상태 — 서버 연결을 하나 열고, 받은 메시지로 최신 상태를 모아 둡니다.
// 조작 화면(app.js)과 대시보드(dashboard.js)가 같은 규칙(연결 끊김 판단·상태 합치기·통계·서보 경고)을 쓰도록 여기에 둡니다.
(function () {
  const cfg = window.HMI_CONFIG;
  const api = window.HmiApi;
  const robot = window.HMI_ROBOT || {};
  const { t } = window.I18N;

  const INSPECTION_KEEP = 60;
  const MINUTES_KEEP = 120;
  const SYNC_WAIT_MS = 2000; // 기록 조회가 이보다 늦으면 기다리지 않고 실시간 것을 먼저 보인다
  const POLL_HISTORY_MS = 2000; // 실시간 연결이 없는 서버(push 'poll')면 이 간격으로 기록을 물어 판정·이벤트를 받는다
  const SEEN_KEEP = 2000;
  const EMPTY_STATUS = { line: 'stopped', estop: false, mode: 'auto', devices: {}, stats: { total: 0, good: 0, defect: 0 }, cameras: {}, fault: null, startedAt: null, homeRequired: false, cycle: null };

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
    minutes: [], // 분마다 판정 수 [{ t, good, defect }] — 이 PC 시계 기준 (서버 분당 집계는 시계 차이를 빼서 옮김)
    history: { supported: null, runId: null, restored: 0 }, // 기록 조회(GET /history): 서버가 주는지, 처음에 채운 기록 수
    lastMessageAt: 0,
  };
  // 지난 기록 맞추기 (docs/API.md 5.2): 화면을 열 때와 다시 연결될 때 빈 곳을 채운다
  const sync = {
    lastSeq: 0, // 마지막으로 받은 순번 — 다시 붙을 때 이 뒤만 묻는다
    seen: new Set(), // 이미 쓴 순번 (기록 응답과 실시간 메시지가 겹쳐도 한 번만)
    minutesSeq: 0, // 서버 분당 집계에 들어간 마지막 순번 — 그 뒤 판정만 화면이 센다
    syncing: false, // 기록을 묻는 동안 실시간 판정·이벤트는 줄 세워 둔다 (지난 것 → 새것 차례로 보이게)
    queue: [],
    timer: 0,
    busy: false,
    pollTimer: 0,
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
    await syncHistory();
  }

  // ---------- 지난 기록 ----------

  function beginSync() {
    if (state.history.supported === false) return;
    sync.syncing = true;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(flushQueue, SYNC_WAIT_MS);
  }

  function flushQueue() {
    clearTimeout(sync.timer);
    sync.syncing = false;
    sync.queue.splice(0).forEach((msg) => deliver(msg, { late: true }));
  }

  // 처음 열 때는 최근 기록을, 다시 붙을 때는 마지막으로 받은 순번 뒤만 묻는다.
  // 처음 채우는 기록은 restored(예전 기록 — 알림을 켜지 않음), 빈 곳 채우기는 실시간과 같게 다룬다
  async function syncHistory() {
    if (sync.busy) return; // 앞서 묻는 중인 것이 끝나며 줄 세운 것을 내보낸다
    if (state.history.supported === false) { flushQueue(); return; }
    sync.busy = true;
    const initial = state.history.runId === null;
    const ask = (after) => api.getHistory({ after, events: cfg.logLimit || 200, inspections: INSPECTION_KEEP, minutes: MINUTES_KEEP });
    try {
      let h = await ask(initial ? undefined : sync.lastSeq);
      if (!h) {
        state.history.supported = false;
        emit('history', state.history);
        return;
      }
      // 서버가 다시 켜졌으면 순번이 처음부터다: 지난 순번은 잊고 새 기록을 처음부터 받는다
      if (!initial && h.runId && h.runId !== state.history.runId) {
        sync.seen.clear();
        sync.lastSeq = 0;
        sync.minutesSeq = 0;
        h = (await ask(undefined)) || h;
      }
      state.history.supported = true;
      state.history.runId = h.runId || state.history.runId || '';
      // 서버와 이 PC의 시계 차이 — 5초 안쪽이면 같은 시계로 본다 (응답이 오는 데 걸린 시간)
      const raw = h.now ? Date.now() - Date.parse(h.now) : 0;
      const offset = Number.isFinite(raw) && Math.abs(raw) >= 5000 ? raw : 0;
      if (h.minutes) applyMinutes(h.minutes, offset, h.lastSeq);
      const items = h.events.map((data) => ({ type: 'event', data })).concat(h.inspections.map((data) => ({ type: 'inspection', data })));
      items.sort((a, b) => (a.data.seq || 0) - (b.data.seq || 0));
      items.forEach((msg) => deliver(msg, { restored: initial, fromHistory: true, offset, serverMinutes: !!h.minutes }));
      if (initial) state.history.restored = items.length;
      emit('history', state.history);
      if (cfg.server.push === 'poll' && !sync.pollTimer) {
        sync.pollTimer = setInterval(() => { if (state.online) syncHistory(); }, POLL_HISTORY_MS);
      }
    } catch (err) {
      /* 다음 연결 때 다시 묻는다 */
    } finally {
      sync.busy = false;
      flushQueue();
    }
  }

  // 서버 분당 집계를 이 PC 시계로 옮겨 쓴다
  function applyMinutes(list, offset, lastSeq) {
    const byMinute = new Map();
    list.forEach((b) => {
      const t = Math.floor((Date.parse(b.t) + offset) / 60000) * 60000;
      if (!Number.isFinite(t)) return;
      const x = byMinute.get(t) || { t, good: 0, defect: 0 };
      x.good += b.good;
      x.defect += b.defect;
      byMinute.set(t, x);
    });
    state.minutes = Array.from(byMinute.values()).sort((a, b) => a.t - b.t).slice(-MINUTES_KEEP);
    if (typeof lastSeq === 'number') sync.minutesSeq = lastSeq;
  }

  // 순번이 있는 판정·이벤트는 한 번만 쓴다
  function deliver(msg, opts) {
    const d = msg.data;
    if (d && typeof d.seq === 'number') {
      if (sync.seen.has(d.seq)) return;
      sync.seen.add(d.seq);
      if (sync.seen.size > SEEN_KEEP) sync.seen.delete(sync.seen.values().next().value);
      if (d.seq > sync.lastSeq) sync.lastSeq = d.seq;
    }
    if (msg.type === 'inspection') onInspection(d, opts || {});
    else onEvent(d, opts || {});
  }

  function onEvent(d, opts) {
    if (/^servo_/.test(d.code)) serverServoEvents = true;
    emit('event', opts.restored ? Object.assign({ restored: true }, d) : d);
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

  // opts.restored: 처음 채우는 지난 판정 — 통계는 상태(stats)가 맞는 값이라 건드리지 않는다
  // opts.late: 기록을 묻는 동안 줄 세웠던 실시간 판정 — 그사이 온 상태보다 오래된 통계로 되돌리지 않는다
  function onInspection(d, opts) {
    const o = opts || {};
    const st = state.status || (state.status = Object.assign({}, EMPTY_STATUS));
    if (o.restored) { /* 통계는 상태가 이미 알려 줬다 */ }
    else if (d.stats) { if (!o.late || d.stats.total >= st.stats.total) st.stats = d.stats; }
    else if (d.result) {
      // 서버가 판정마다 통계를 안 보내면 HMI가 센다. 다음 상태 메시지의 stats가 오면 그것이 맞는 값이다
      st.stats = Object.assign({}, st.stats);
      st.stats.total += 1;
      st.stats[d.result] += 1;
    }
    // 지난 판정은 판정 시각을 이 PC 시계로 옮겨 "받은 때"로 쓴다 (분당 처리를 셀 때 최근 것으로 잘못 세지 않게)
    const at = Date.parse(d.at);
    const receivedAt = o.restored && Number.isFinite(at) ? at + (o.offset || 0) : Date.now();
    const item = Object.assign({ receivedAt }, d);
    insertInspection(item);
    // 분당 집계: 서버 집계에 이미 들어간 판정은 다시 세지 않는다
    const counted = (o.restored && o.serverMinutes) || (typeof d.seq === 'number' && d.seq <= sync.minutesSeq);
    if (!counted && (d.result === 'good' || d.result === 'defect')) countMinute(receivedAt, d.result);
    // 기록 조회로 채운 판정은 하나씩 알리지 않는다 — 영상 위 판정 상자는 지금 판정에만 그리고, 목록·그래프는 'history' 알림 때 다시 그린다
    if (!o.fromHistory) emit('inspection', item);
  }

  // 새것이 앞. 늦게 온 지난 판정은 순번 자리에 끼운다
  function insertInspection(item) {
    const list = state.inspections;
    let i = 0;
    if (typeof item.seq === 'number') while (i < list.length && typeof list[i].seq === 'number' && list[i].seq > item.seq) i += 1;
    list.splice(i, 0, item);
    if (list.length > INSPECTION_KEEP) list.pop();
  }

  function countMinute(ms, result) {
    const minute = Math.floor(ms / 60000) * 60000;
    let bucket = state.minutes.find((b) => b.t === minute);
    if (!bucket) {
      bucket = { t: minute, good: 0, defect: 0 };
      state.minutes.push(bucket);
      state.minutes.sort((a, b) => a.t - b.t);
      if (state.minutes.length > MINUTES_KEEP) state.minutes.shift();
    }
    bucket[result] += 1;
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
      case 'event':
        if (!d) break;
        if (sync.syncing) sync.queue.push(msg);
        else deliver(msg);
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
    if (p.step) p.step = stepName(p.step);
    const key = 'event.' + evt.code;
    const text = t(key, p);
    if (text !== key && !/\{\w+\}/.test(text)) return text;
    // 값이 빠져 문장을 다 채울 수 없으면 짧은 문장으로
    const bare = t(key + '.bare');
    if (bare !== key + '.bare') return bare;
    return evt.message || t('event.unknown', { code: evt.code });
  }

  // 고장 안내 한 줄: 멈춘 이유 + 풀리는 방법(clear: auto · home · start, docs/API.md 3.1)
  function faultDetail(fault) {
    const clear = fault.clear === 'home' || fault.clear === 'start' ? fault.clear : 'auto';
    return t('detail.fault.' + clear, { fault: faultText(fault) });
  }

  // 공정 단계·로봇팔 단계 이름 (모르는 이름은 서버가 보낸 그대로)
  const stageName = (stage) => known('stage.' + stage, stage);
  const stepName = (step) => known('step.' + step, step);

  // ---------- 원점 (docs/API.md v0.4) ----------
  // 원점은 서버가 저장한다. 상태의 home: 객체 = 저장됨 · null = 아직 없음 · undefined = 서버가 알려 주지 않음(모름)

  // 자동 시작을 막는 원점 문제: 'unset'(저장된 원점 없음) · 'required'(긴급정지·고장 뒤 원점 복귀 필요) · null.
  // 원점은 자동 모드에만 필요하다 — 수동 모드는 사람이 리더암으로 팔을 움직인다
  function homeBlock() {
    const st = state.status;
    if (!st || st.mode !== 'auto') return null;
    if (st.home === null) return 'unset';
    return st.homeRequired ? 'required' : null;
  }

  // 시각을 짧게: 오늘이면 시:분:초, 아니면 날짜와 시:분
  function shortTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '–';
    const p2 = (n) => String(n).padStart(2, '0');
    const clock = p2(d.getHours()) + ':' + p2(d.getMinutes());
    if (d.toDateString() === new Date().toDateString()) return clock + ':' + p2(d.getSeconds());
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + clock;
  }

  // 수동 모드의 원점 잡기 안내 — 마지막으로 저장한 때를 알면 함께 쓴다 (누른 뒤 저장됐는지 여기서 보인다)
  function homeSetHint() {
    const h = state.status && state.status.home;
    return h && h.setAt ? t('home.setHint.saved', { time: shortTime(h.setAt) }) : t('home.setHint');
  }

  // 값이 다 있으면 자세히, 빠진 값이 있으면 짧은 원인만
  function faultText(fault) {
    const p = Object.assign({}, fault.params);
    if (p.arm) p.arm = armName(p.arm);
    if (p.joint) p.joint = jointName(p.joint);
    if (p.reason) p.reason = reasonText(p.reason);
    if (p.step) p.step = stepName(p.step);
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
        onOpen() { setOnline(true); beginSync(); refresh(); },
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
    faultDetail,
    errorText,
    stageName,
    stepName,
    homeBlock,
    homeSetHint,
    shortTime,
  };
})();
