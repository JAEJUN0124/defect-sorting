// 화면 공통 상태 — 서버 연결을 하나 열고, 받은 메시지로 최신 상태를 모아 둡니다.
// 화면(React 조작 화면, react/src/App.jsx)이 쓰는 규칙(연결 끊김 판단·상태 합치기·통계·서보 경고·원점)을 여기에 둡니다.
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
  const POSE_FRESH_MS = 3000; // 원점 잡기에 쓰는 각도는 이보다 최근에 받은 것만
  const STATUS_POLL_TICK_MS = 250; // 상태가 늦었는지 보는 간격 (XML)
  const SORT_KEY = 'hmi.sortTarget'; // 서버가 받은 "로봇팔이 옮길 부품" — 서버가 지금 값을 알려 주기 전까지 보이는 값 (이 브라우저)
  // 서버가 처음 보낸 상태에 없는 값의 기본. XML 규약 v1.0은 라인 상태·긴급정지·운전 모드·고장·원점 필요를 보내지 않는다 —
  // null·undefined(모름). 검사 개수도 서버가 무효(valid="false")라고 하면 null이고, 화면은 '–'로 보인다
  const EMPTY_STATUS = api.xml
    ? { line: null, estop: null, mode: null, devices: {}, stats: null, cameras: {}, fault: undefined, startedAt: null, homeRequired: undefined, cycle: null, sortTarget: null }
    : { line: 'stopped', estop: false, mode: 'auto', devices: {}, stats: { total: 0, good: 0, defect: 0 }, cameras: {}, fault: null, startedAt: null, homeRequired: false, cycle: null, sortTarget: null };
  // 브릿지 서버의 영상 (js/video.js, 서버 담당 안내 2026-10-17): XML 서버이고 config.js cameras.bridge가 있으면
  // 카메라 켜기·끄기를 서버 명령 없이 이 HMI에서 하고(영상 주소를 열고 닫음), 카메라 상태는 /video/status로 본다
  const videoUrls = api.xml && window.HmiVideo && cfg.cameras && cfg.cameras.bridge ? window.HmiVideo.urls(cfg) : null;
  const videoPoller = videoUrls
    ? window.HmiVideo.createPoller({ url: videoUrls.status, pollMs: cfg.cameras.bridge.pollMs, timeoutMs: cfg.cameras.bridge.timeoutMs })
    : null;
  const JOINTS = window.HmiHome.JOINTS;

  const listeners = new Set();
  const state = {
    online: false,
    everConnected: false,
    status: null, // 서버 상태 (adapter.js가 맞춘 모양)
    info: null, // 서버 정보 (GET /info). v0.1 서버면 null
    home: window.HmiHome.read(), // 이 HMI에 저장한 원점 (home.js). 없으면 null
    joints: { leader: null, arm: null, target: null },
    telemetry: { arm: null, leader: null },
    metrics: null,
    inspections: [], // 최근 판정, 새것이 앞
    minutes: [], // 분마다 판정 수 [{ t, good, defect }] — 이 PC 시계 기준 (서버 분당 집계는 시계 차이를 빼서 옮김)
    history: { supported: null, runId: null, restored: 0 }, // 기록 조회(GET /history): 서버가 주는지, 처음에 채운 기록 수
    lastMessageAt: 0,
    // 브릿지 영상: on = 이 HMI가 영상을 보고 있음, camera = 보이는 카메라 (탑뷰/그리퍼 바꾸기)
    video: { on: false, camera: videoUrls ? Object.keys(videoUrls.streams)[0] || null : null },
    sortTargetSent: readSortTarget(), // 이 HMI에서 마지막으로 서버가 받은 "로봇팔이 옮길 부품" ('good' · 'defect' · null)
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
  let lastStatusAt = 0; // 마지막으로 상태를 받은 때 (서버가 보낸 것이든 HMI가 물은 답이든)
  let askingStatus = false; // HMI가 상태를 묻고 답을 기다리는 중
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

  if (videoPoller) videoPoller.subscribe(() => emit('video', state.video));

  function readSortTarget() {
    try {
      const v = localStorage.getItem(SORT_KEY);
      return v === 'good' || v === 'defect' ? v : null;
    } catch (err) { return null; } // 저장소가 막힌 브라우저
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
        forgetSeq();
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

  function forgetSeq() {
    sync.seen.clear();
    sync.lastSeq = 0;
    sync.minutesSeq = 0;
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
    else if (d.stats) { if (!o.late || !st.stats || d.stats.total >= st.stats.total) st.stats = d.stats; }
    else if (d.result) {
      // 서버가 판정마다 통계를 안 보내면 HMI가 센다. 다음 상태 메시지의 stats가 오면 그것이 맞는 값이다
      st.stats = Object.assign({ total: 0, good: 0, defect: 0 }, st.stats);
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
        lastStatusAt = Date.now();
        applyStatus(d);
        break;
      case 'inspection':
      case 'event':
        if (!d) break;
        if (sync.syncing) sync.queue.push(msg);
        else deliver(msg);
        break;
      case 'joints':
        if (d) { state.joints[d.source] = Object.assign({ receivedAt: Date.now() }, d); emit('joints', state.joints[d.source]); }
        break;
      case 'telemetry':
        if (d) { state.telemetry[d.arm] = Object.assign({ receivedAt: Date.now() }, d); watchServos(d); emit('telemetry', state.telemetry[d.arm]); }
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
    if (videoUrls) return Object.keys(videoUrls.streams);
    const ids = [];
    ((state.info && state.info.cameras) || []).forEach((c) => { if (!ids.includes(c.id)) ids.push(c.id); });
    Object.keys((state.status && state.status.cameras) || {}).forEach((id) => { if (!ids.includes(id)) ids.push(id); });
    return ids;
  }

  function primaryCamera() {
    if (videoUrls) return state.video.camera;
    if (cfg.cameras.primary && cfg.cameras.primary !== 'auto') return cfg.cameras.primary;
    return cameraIds()[0] || api.adapter.primaryCamera();
  }

  // ---------- 브릿지 서버 영상 (js/video.js) ----------

  const videoBridge = () => !!videoPoller;

  // 탑뷰/그리퍼 바꾸기 — 한 화면에 고른 카메라 하나를 보인다 (사용자 2026-10-17)
  function selectCamera(id) {
    if (!videoUrls || !videoUrls.streams[id] || state.video.camera === id) return;
    state.video.camera = id;
    emit('video', state.video);
  }

  // 카메라 켜기·끄기: 브릿지 영상이면 이 HMI에서만 — 영상 주소를 열고 닫을 뿐 설비의 촬영은 그대로다 (안내 7장). 아니면 서버 명령
  function startCamera() {
    if (!videoPoller) return api.startCamera();
    state.video.on = true;
    videoPoller.start();
    emit('video', state.video);
    return Promise.resolve(null);
  }

  function stopCamera() {
    if (!videoPoller) return api.stopCamera();
    state.video.on = false;
    videoPoller.stop();
    emit('video', state.video);
    return Promise.resolve(null);
  }

  // 브릿지 카메라 하나의 단계 (video.js classify): 'checking' · 'unknown' · 'waiting' · 'none' · 'stale' · 'live'. 브릿지가 아니거나 꺼져 있으면 null
  function videoPhase(id) {
    if (!videoPoller || !state.video.on || !videoUrls.streams[id]) return null;
    return window.HmiVideo.classify(videoPoller.state.status, videoUrls.streams[id].id, videoPoller.state.error);
  }

  // ---------- 로봇팔이 옮길 부품 (양품 · 불량품, 사용자 2026-10-17) ----------
  // 서버가 지금 값을 알려 주면(상태 sortTarget — XML은 요청안 Line/@sortTarget) 그것을, 아니면 이 HMI에서 마지막으로 서버가 받은 값을 보인다
  function sortTarget() {
    const v = state.status && state.status.sortTarget;
    if (v === 'good' || v === 'defect') return { value: v, from: 'server' };
    return { value: state.sortTargetSent, from: state.sortTargetSent ? 'local' : null };
  }

  // 서버에 보낸다 (XML SetSortTarget target="Good|Defect" · JSON PUT /sort-target). 서버가 받으면(거절이 아니면) 이 HMI에 기억한다
  async function setSortTarget(target) {
    const res = await api.setSortTarget(target);
    state.sortTargetSent = target;
    try { localStorage.setItem(SORT_KEY, target); } catch (err) { /* 저장이 막힌 브라우저면 이번 화면에서만 */ }
    emit('sortTarget', target);
    return res;
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
  // 화면에 보일 관절 각도(도). 퍼센트로 온 값(그리퍼 0~100)은 config/robot.js percentToDeg의 범위로 바꾼다 — 임의 범위 (사용자 2026-10-17).
  // 화면 표시에만 쓴다. 원점 저장·원점 복귀는 서버가 보낸 값과 단위 그대로
  function shownAngle(joint, value, unit) {
    if (typeof value !== 'number' || unit !== 'pct') return value;
    const range = (robot.percentToDeg && robot.percentToDeg[joint]) || [0, 100];
    return range[0] + (range[1] - range[0]) * value / 100;
  }
  // 멈춘 이유: 고장 코드(GRIP_FAILED — XML 서버는 GripFailed처럼 보내도 됨)나 컨베이어가 멈춘 이유(watchdog 등)
  const reasonText = (code) => known('reason.' + code, known('reason.' + String(code).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase(), code));

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
    if (evt.code === 'sort_target_changed' && p.target) p.target = known('sort.' + String(p.target).toLowerCase(), p.target);
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

  // ---------- 라인 상태 단계 ----------
  // 'connecting' · 'offline' · 'estop' · 'unknown'(모르는 값) · 'unreported'(서버가 라인 상태를 보내지 않음 — XML v1.0) · 라인 상태.
  // 'unreported'일 때 화면은 키를 막지 않는다: 할 수 있는지는 서버가 답(받음·거절)으로 알린다
  function linePhase() {
    const st = state.status;
    if (!state.everConnected) return 'connecting';
    if (!state.online || !st) return 'offline';
    if (st.estop) return 'estop';
    if (st.line === 'unknown') return 'unknown';
    if (!st.line) return 'unreported';
    return st.line;
  }

  // 서버가 라인 상태를 보내지 않을 때의 설명 — 화면 값이 어디서 왔는지(시험용 가상 데이터·장비 없음)도 함께
  function unreportedDetail() {
    const src = state.status && state.status.source;
    const from = src === 'simulation' || src === 'unavailable' ? ' ' + t('detail.source.' + src) : '';
    return t('detail.unreported') + from;
  }

  // ---------- 원점 (HMI가 저장 — home.js, docs/xml-protocol.md 3장) ----------
  // 원점은 서버가 아니라 이 HMI가 가진다. state.home: 객체 = 저장됨 · null = 아직 없음

  // 자동 시작을 막는 원점 문제: 'unset'(저장된 원점 없음) · 'required'(긴급정지·고장 뒤 원점 복귀 필요) · null.
  // 원점은 자동 모드에만 필요하다 — 수동 모드는 사람이 리더암으로 팔을 움직인다. 운전 모드를 모르면(XML v1.0) 막지 않는다
  function homeBlock() {
    const st = state.status;
    if (!st || st.mode !== 'auto') return null;
    if (!state.home) return 'unset';
    return st.homeRequired ? 'required' : null;
  }

  // 로봇팔의 지금 자세: 로봇팔(팔로워)의 실제 각도 → 없으면 리더암 각도 (수동 모드에서 로봇팔은 리더암을 따라간다).
  // XML v1.0 서버는 리더암 각도만 보낸다. 여섯 관절이 모두 있고 최근(3초 안)에 받은 것만 쓴다
  function currentPose() {
    const fresh = (x) => !!x && Date.now() - (x.receivedAt || 0) <= POSE_FRESH_MS;
    const full = (angles) => !!angles && JOINTS.every((j) => typeof angles[j] === 'number' && Number.isFinite(angles[j]));
    const fromTelemetry = (arm) => {
      const tel = state.telemetry[arm];
      if (!fresh(tel)) return null;
      const angles = {};
      const units = {};
      JOINTS.forEach((j) => {
        const m = tel.motors && tel.motors[j];
        if (m && typeof m.pos === 'number') { angles[j] = m.pos; units[j] = m.posUnit || (j === 'gripper' ? 'pct' : 'deg'); }
      });
      return full(angles) ? { angles, units, source: arm } : null;
    };
    const fromJoints = (arm) => {
      const jn = state.joints[arm];
      return fresh(jn) && full(jn.angles) ? { angles: jn.angles, units: jn.units || {}, source: arm } : null;
    };
    return fromTelemetry('arm') || fromJoints('arm') || fromJoints('leader') || fromTelemetry('leader');
  }

  // 원점 잡기: 지금 자세를 이 HMI에 원점으로 저장한다 (수동 모드). 서버에는 보내지 않는다
  async function saveHome() {
    const st = state.status;
    if (!state.online || !st) throw new api.ApiError('NETWORK', 0);
    if (st.estop) throw new api.ApiError('ESTOP_ACTIVE', 0); // 힘이 빠져 처진 자세가 원점이 되지 않게
    if (st.mode === 'auto') throw new api.ApiError('NOT_MANUAL', 0);
    if (st.line && !['stopped', 'running'].includes(st.line)) throw new api.ApiError('INVALID_STATE', 0);
    let pose = currentPose();
    // 서버가 상태를 드물게 보내면(XML, 간격은 서버 설정 — 60초 등) 각도가 오래됐을 수 있다. 한 번 물어 지금 각도를 받는다
    if (!pose && api.xml) {
      try { await api.getStatus(); } catch (err) { /* 아래에서 "각도를 받지 못함"으로 알린다 */ }
      pose = currentPose();
    }
    const saved = pose && window.HmiHome.save(pose);
    if (!saved) throw new api.ApiError('POSE_UNAVAILABLE', 0);
    state.home = saved;
    emit('home', saved);
    emit('event', { code: 'home_set', level: 'info', params: {}, at: saved.setAt, local: true });
    return { home: saved, persisted: window.HmiHome.persisted() };
  }

  // 원점 복귀: 저장된 원점 각도를 서버에 보낸다 (자동 모드·정지 상태)
  function goHome() {
    if (!state.home) return Promise.reject(new api.ApiError('HOME_NOT_SET', 0));
    return api.home(state.home);
  }

  // 라인 시작: 자동 모드에서는 저장된 원점이 있어야 한다 — 원점을 HMI가 가져 서버는 이 조건을 보지 못한다
  function startLine() {
    if (homeBlock() === 'unset') return Promise.reject(new api.ApiError('HOME_NOT_SET', 0));
    return api.start();
  }

  // 명령이 성공한 뒤 그 자리에 남길 안내: 서버가 받기만 하고 장비는 움직이지 않았다(XML v1.0 Reply executed="false") ·
  // 원점을 브라우저 저장소에 넣지 못해 창을 닫으면 잊는다
  function resultNote(name, res) {
    if (res && res.persisted === false) return { text: t('home.notPersisted'), kind: 'error' };
    const r = res && res.reply;
    if (!r || r.executed !== false) return null;
    if (name !== 'estop') return { text: t('reply.received') };
    return { text: t(robot.hardwareStop === 'button' ? 'reply.estop.notExecuted.button' : 'reply.estop.notExecuted'), kind: 'error' };
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
    const h = state.home;
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
    // XML 규약: 원점 각도를 붙인 원점 복귀를 서버(v1.0)가 아직 받지 않음 · 카메라 명령을 서버가 아직 받지 않음(카메라 이름을 붙이면
    // InvalidCommand — 서버 담당 회신 2026-10-16) · 서버가 모르는 명령 · 서버 규약에 없는 명령
    if (code === 'XML_INVALID_COMMAND' && d.command === 'Home' && cfg.server.xml && cfg.server.xml.homePose !== false) return t('error.XML_INVALID_COMMAND.homePose');
    if (code === 'XML_INVALID_COMMAND' && /^Camera(Start|Stop)$/.test(d.command || '')) return t('error.XML_INVALID_COMMAND.camera');
    // 로봇팔이 옮길 부품: v1.0 서버는 이 명령을 모른다 — 속성(target)을 먼저 보므로 InvalidCommand, 속성이 없으면 UnknownCommand
    if ((code === 'XML_INVALID_COMMAND' || code === 'XML_UNKNOWN_COMMAND') && d.command === 'SetSortTarget') return t('error.sortTarget.unsupported');
    if (code === 'XML_UNKNOWN_COMMAND') return t('error.XML_UNKNOWN_COMMAND', { command: d.command || '?' });
    if (code === 'NOT_IN_PROTOCOL') return t('error.NOT_IN_PROTOCOL', { command: known('cmd.' + d.command, d.command || '?') });
    const known2 = t('error.' + code);
    if (known2 !== 'error.' + code) return known2;
    if (err && err.serverMessage) return t('error.server', { message: err.serverMessage });
    return t('error.unknown', { code });
  }

  // 카메라 상태 + 영상 받는 방식. 설정(cameras.transport)이 'auto'가 아니면 그것을 쓴다.
  // 브릿지 영상이면 켜기는 이 HMI가 정하고(state.video.on), camera.js가 상태 조회(poller)를 보며 영상을 열고 닫는다
  function cameraSource(id) {
    if (videoUrls) {
      const s = videoUrls.streams[id];
      return s
        ? { id, streaming: state.video.on, url: s.url, transport: 'bridge', videoId: s.id, poller: videoPoller }
        : { id, streaming: false, url: null, transport: 'bridge' };
    }
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

  // 끊김 판단: 서버 메시지가 정해진 시간 동안 없으면 끊김. XML은 3초(server.xml.statusTimeoutMs) 넘게 없으면 끊김으로 보고
  // 다시 붙는다 (서버 규약 v1.0 "오류와 연결 처리"). 서버가 상태를 드물게 보내도 HMI의 Ping에 대한 Pong이 pingMs마다 오므로 끊김으로 보지 않는다.
  // 끊김 시간이 Ping 간격보다 짧으면 Pong을 기다리다 끊김으로 잘못 보므로, 그때는 Ping 간격 + 5초로 쓴다
  // (사용자 2026-10-16: 연결 확인 60초 — 조용히 끊기면 그만큼 늦게 앎. 서버가 연결을 닫으면 바로 앎)
  setInterval(() => {
    const xml = cfg.server.xml || {};
    const ping = typeof xml.pingMs === 'number' ? xml.pingMs : 60000;
    const limit = api.xml ? Math.max(xml.statusTimeoutMs || 65000, ping > 0 ? ping + 5000 : 0) : cfg.heartbeatTimeoutMs;
    const required = api.xml || cfg.heartbeatRequired === true || (cfg.heartbeatRequired !== false && heartbeatSeen);
    if (state.online && required && limit > 0 && Date.now() - state.lastMessageAt > limit) {
      setOnline(false);
      if (api.xml) api.reconnect();
    }
  }, 1000);

  // 상태가 오래 안 오면 HMI가 묻는다 (XML): 서버의 상태 간격은 바뀔 수 있다 (사용자 2026-10-16 — 그날 60초로 바뀜).
  // 끊김은 Ping/Pong으로 따로 안다(api.js, server.xml.pingMs). 상태는 server.xml.statusPollMs(기본 60초)보다 오래 오지 않을 때만 묻는다.
  // 서버가 그보다 자주 보내면 묻지 않는다. 답을 기다리는 동안은 다시 묻지 않는다
  setInterval(() => {
    const x = cfg.server.xml && cfg.server.xml.statusPollMs;
    const every = typeof x === 'number' ? x : 60000;
    if (!api.xml || !(every > 0) || !state.online || askingStatus || Date.now() - lastStatusAt < every) return;
    askingStatus = true;
    api.getStatus()
      .catch(() => { /* 답은 상태 메시지로도 오고, 답이 없으면 끊김 판단이 맡는다 */ })
      .finally(() => { askingStatus = false; });
  }, STATUS_POLL_TICK_MS);

  // 다른 창에서 원점을 바꾸면 따라간다
  window.HmiHome.subscribe((h) => { state.home = h; emit('home', h); });

  window.HmiStore = {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      api.connect({
        onOpen() {
          // 기록 조회가 없는 서버(XML 등)는 다시 켜졌는지 알 수 없고, 순번은 서버를 켤 때부터 다시 센다 (XML 회신 2026-10-16) —
          // 다시 붙으면 지난 순번을 잊는다. 그러지 않으면 재시작한 서버의 판정·이벤트를 이미 본 것으로 버린다
          if (state.history.supported === false) forgetSeq();
          lastStatusAt = Date.now(); // 서버가 접속 직후 보내는 상태를 기다린다 (곧바로 묻지 않게)
          setOnline(true);
          beginSync();
          refresh();
        },
        onClose() { setOnline(false); },
        onMessage,
      });
    },
    // 서버 연결과 영상 상태 조회를 닫는다 (프로그램 종료 — 이 HMI만 끝낸다). 다시 붙지 않는다
    stop() {
      if (videoPoller) videoPoller.stop();
      api.close();
    },
    refresh,
    cameraIds,
    primaryCamera,
    cameraName,
    cameraSource,
    videoBridge,
    selectCamera,
    startCamera,
    stopCamera,
    videoPhase,
    sortTarget,
    setSortTarget,
    deviceName,
    jointName,
    shownAngle,
    armName,
    eventText,
    faultText,
    faultDetail,
    errorText,
    stageName,
    stepName,
    linePhase,
    unreportedDetail,
    homeBlock,
    homeSetHint,
    currentPose,
    saveHome,
    goHome,
    startLine,
    resultNote,
    shortTime,
  };
})();
