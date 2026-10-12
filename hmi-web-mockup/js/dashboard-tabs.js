// 대시보드 탭 시안 — 조작 화면의 기능과 감시 값을 영역별 탭으로 나눠, 한 영역을 한 화면에서 자세히 봅니다.
//   운전: 개요(공정 흐름) · 조작 · 생산 · 검사   설비: 로봇팔 · 리더암 · 장치   기록: 경보 · 시스템
// 윗판(상태·긴급정지·시작/정지·계수기)과 아래 줄(화면 이동·테마·장치 연결·마지막 경보·시각)은 어느 탭에서나 보입니다.
// 조작(시작/정지·긴급정지 해제·원점·운전 모드·카메라·프로그램 종료)은 js/controls.js가 조작 화면과 같은 규칙으로 보냅니다.
// 서버 연결과 상태 모으기는 store.js, 영상은 camera.js가 맡습니다 (조작 화면·원래 대시보드와 같다).
(function () {
  const cfg = window.HMI_CONFIG;
  const robot = window.HMI_ROBOT || {};
  const homeCfg = window.HMI_HOME_POSITION || null;
  const api = window.HmiApi;
  const store = window.HmiStore;
  const ctl = window.HmiControls;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  const TABS = ['overview', 'control', 'production', 'inspection', 'arm', 'leader', 'devices', 'alarms', 'system'];
  const LAMP = { running: 'green', estop: 'red', connecting: 'amber', starting: 'amber', stopping: 'amber', homing: 'amber', shutdown: 'amber', unknown: 'amber' };
  const BLINKING = ['connecting', 'starting', 'stopping', 'homing', 'shutdown'];
  const LOG_SKIP = ['defect_detected']; // 불량 검출은 정상 공정이라 기록·알림에 넣지 않는다 (원래 대시보드와 같은 기준)
  const LOG_KEEP = cfg.logLimit || 200;
  const DEVICE_CODES = ['device_disconnected', 'device_reconnected', 'server_lost', 'server_back', 'camera_started', 'camera_stopped', 'line_stopped_fault', 'start_rejected'];
  const JOINTS = robot.joints || ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  const ARMS = ['arm', 'leader'];
  const LIMITS = Object.assign({ tempWarn: 55, tempAlarm: 65, tempServo: 70, loadWarn: 80 }, robot.limits);
  const TEMP_SCALE = [20, 80]; // °C
  const SUPPLY_SCALE = [0, 16]; // V — 두 팔을 같은 눈금으로: 리더에 12V가 들어오면 띠 밖으로 크게 벗어난다
  const TEMP_WINDOW = 5 * 60000; // 온도 추이: 최근 5분, 1초에 하나
  const OV_MINUTES = 30;
  const OV_RECENT = 20; // 개요의 최근 판정: 판 높이만큼 보이고 나머지는 넘겨 본다
  const RECENT_KEEP = 60; // store.js가 남기는 판정 수와 같다
  const CONF_BINS = [0, 0.6, 0.7, 0.8, 0.9, Infinity];
  const RANK = { alarm: 2, warning: 1 };

  const S = () => store.state.status;
  const online = () => store.state.online;

  const ui = {
    tab: 'overview',
    openedAt: Date.now(),
    runSince: null,
    connectedOnce: false,
    staleSince: null,
    estopError: null,
    log: [], // { at, level, code, text, local } 새것이 앞
    unseen: { warning: 0, alarm: 0 },
    filter: 'all',
    range: 30,
    active: [], // 지금 이상: { key, level, text, area, since }
    activeSince: new Map(),
    dev: {}, // 장치 id → { connected, since, drops }
    temps: { arm: [], leader: [] }, // [{ t, v: { 관절: °C } }]
    supplySeen: { arm: null, leader: null },
    cams: {},
    camSig: null,
    armPages: {},
    pace: null,
    latency: null,
  };
  const sim = new window.CameraSim({ good: t('result.good'), defect: t('result.defect') });

  const el = {
    lamp: $('state-lamp'), word: $('state-word'), detail: $('state-detail'),
    estop: $('btn-estop'), estopLabel: $('estop-label'),
    total: $('t-total'), good: $('t-good'), defect: $('t-defect'), rate: $('t-rate'),
    tabList: document.querySelector('[role="tablist"]'),
    tabs: Object.fromEntries(TABS.map((id) => [id, $('tab-' + id)])),
    pages: Object.fromEntries(TABS.map((id) => [id, $('page-' + id)])),
    badges: Object.fromEntries(TABS.map((id) => [id, document.querySelector('[data-badge="' + id + '"]')])),
    canvas: $('canvas'),
    devstrip: $('devstrip'), lastalarm: $('lastalarm'), stale: $('stale'), clock: $('clock'),
    flow: $('flow'),
    st: { conveyor: $('st-conveyor'), camera: $('st-camera'), judge: $('st-judge'), arm: $('st-arm'), good: $('st-good'), defect: $('st-defect') },
    ovRecent: $('ov-recent'), ovRecentEmpty: $('ov-recent-empty'), ovRecentMeta: $('ov-recent-meta'),
    ovActive: $('ov-active'), ovActiveEmpty: $('ov-active-empty'), ovActiveMeta: $('ov-active-meta'),
    range: $('range'),
    ratioBar: $('pr-ratio-bar'), prGood: $('pr-good'), prDefect: $('pr-defect'), prRateValue: $('pr-rate-value'),
    prRuntime: $('pr-runtime'), prAvgPace: $('pr-avgpace'), prPeak: $('pr-peak'), prBlocks: $('pr-blocks'), rateChart: $('pr-rate-chart'),
    cams: $('cams'),
    inRecent: $('in-recent'), inRecentEmpty: $('in-recent-empty'), inRecentMeta: $('in-recent-meta'),
    latAvg: $('in-lat-avg'), latMax: $('in-lat-max'), latServer: $('in-lat-server'), latMeta: $('in-latency-meta'), latChart: $('in-latency'),
    conf: $('in-conf'), confNote: $('in-conf-note'),
    dvRows: $('dv-rows'), dvCount: $('dv-count'), dvLog: $('dv-log'), dvLogEmpty: $('dv-log-empty'),
    alActive: $('al-active'), alActiveEmpty: $('al-active-empty'), alActiveMeta: $('al-active-meta'),
    alLog: $('al-log'), alLogEmpty: $('al-log-empty'), logFilter: $('log-filter'),
    ctRunHint: $('ct-run-hint'), ctModeDesc: $('ct-mode-desc'), ctJoints: $('ct-joints'), ctJointsList: $('ct-joints-list'),
    ctConds: $('ct-conds'), ctCondMeta: $('ct-cond-meta'), ctCondSum: $('ct-cond-sum'),
    ctEstopState: $('ct-estop-state'), ctEstopHint: $('ct-estop-hint'), ctHomes: $('ct-homes'), ctCams: $('ct-cams'),
    sim: $('sim'), simKeys: Array.from(document.querySelectorAll('[data-sim]')),
  };

  // ---------- 도움 함수 ----------

  const fmt = (n) => Number(n).toLocaleString();
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (v, [lo, hi]) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) + '%';
  const worse = (a, b) => ((RANK[b] || 0) > (RANK[a] || 0) ? b : a);
  const f = (root, name) => root.querySelector('[data-f="' + name + '"]');

  function setLevel(node, level) {
    if (level) node.dataset.level = level;
    else delete node.dataset.level;
  }

  function clock(ms, withSeconds) {
    const d = new Date(ms);
    const parts = [d.getHours(), d.getMinutes()].concat(withSeconds ? [d.getSeconds()] : []);
    return parts.map((n) => String(n).padStart(2, '0')).join(':');
  }

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 눈금 위쪽 끝: 4 · 10 · 20 · 40 · 100 … — 절반 눈금도 늘 정수가 되게
  function niceMax(v) {
    if (v <= 4) return 4;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : 10) * p;
  }

  function tempLevel(v) {
    if (!num(v)) return null;
    return v >= LIMITS.tempAlarm ? 'alarm' : v >= LIMITS.tempWarn ? 'warning' : null;
  }

  const supplyCfg = (arm) => (robot.arms && robot.arms[arm] && robot.arms[arm].supply) || null;

  function supplyLevel(v, sup) {
    if (!num(v) || !sup) return null;
    if ((sup.wrongAbove !== undefined && v > sup.wrongAbove) || (sup.wrongBelow !== undefined && v < sup.wrongBelow)) return 'alarm';
    return v < sup.warnLow || v > sup.warnHigh ? 'warning' : null;
  }

  const armConnected = (arm) => !!S() && online() && S().devices[arm] !== 'disconnected';
  const liveMotors = (arm) => (armConnected(arm) && store.state.telemetry[arm] && store.state.telemetry[arm].motors) || {};

  // 팔 전원 전압: 서보 6개 값의 가운데 값 (원래 대시보드와 같다)
  function supplyOf(arm) {
    const volts = Object.values(liveMotors(arm)).map((m) => m.volt).filter(num).sort((a, b) => a - b);
    return volts.length ? volts[Math.floor(volts.length / 2)] : null;
  }

  function phase() {
    if (ctl.exiting) return 'shutdown';
    if (!store.state.everConnected) return 'connecting';
    if (!online() || !S()) return 'offline';
    if (S().estop) return 'estop';
    if (S().line === 'unknown') return 'unknown';
    return S().line;
  }

  // 가동 시작 시각: 서버가 알려 주면(started_at) 그것, 아니면 이 화면이 가동을 본 때
  function trackRun() {
    const st = S();
    const running = st && st.line === 'running';
    if (running && st.startedAt) ui.runSince = Date.parse(st.startedAt);
    else if (running && !ui.runSince) ui.runSince = Date.now();
    else if (!running) ui.runSince = null;
  }

  function duration() {
    const sec = Math.max(0, Math.floor((Date.now() - (ui.runSince || Date.now())) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h) return t('db.duration.h', { h, m });
    if (m) return t('db.duration.ms', { m, s: sec % 60 });
    return t('db.duration.s', { s: sec });
  }

  const modeWord = () => t('mode.' + (S() && S().mode === 'manual' ? 'manual' : 'auto'));

  // ---------- 서버 메시지 ----------

  store.subscribe((kind, data) => {
    switch (kind) {
      case 'online':
        if (!data && ui.connectedOnce) pushLog({ code: 'server_lost', level: 'warning', local: true });
        if (data && ui.staleSince && ui.connectedOnce) pushLog({ code: 'server_back', level: 'info', local: true });
        if (data) ui.connectedOnce = true;
        ui.staleSince = data ? null : Date.now();
        refresh();
        break;
      case 'status':
        trackRun();
        refresh();
        break;
      case 'info':
        refresh();
        break;
      case 'inspection':
        if (cfg.useMock) sim.mark(data.result);
        Object.values(ui.cams).forEach((c) => c.view.showInspection(data));
        renderTally();
        if (['overview', 'production', 'inspection'].includes(ui.tab)) renderPage();
        break;
      case 'event':
        if (data && !LOG_SKIP.includes(data.code)) pushLog(data);
        break;
      case 'history': // 지난 기록을 채웠다 (분당 판정은 서버 집계로 바뀜)
        renderTally();
        if (['overview', 'production', 'inspection', 'system'].includes(ui.tab)) renderPage();
        break;
      case 'telemetry':
        recordArm(data);
        updateActive();
        renderBadges();
        // 서보 상태는 팔마다 0.5초마다 온다 — 개요는 바뀌는 부분(공정 흐름·지금 이상)만 다시 그린다
        if (ui.tab === data.arm || (ui.tab === 'leader' && data.arm === 'arm')) renderPage();
        else if (ui.tab === 'overview') { renderFlow(); renderActive(el.ovActive, el.ovActiveEmpty, el.ovActiveMeta); }
        else if (ui.tab === 'alarms') renderActive(el.alActive, el.alActiveEmpty, el.alActiveMeta);
        else if (ui.tab === 'control') renderControlPage(); // 원점과 지금 각도, 전원 전압 조건
        break;
      case 'joints':
        if (ui.tab === 'control') renderControlJoints(); // 수동 모드의 리더암 각도
        break;
      case 'metrics':
        renderTally();
        if (['overview', 'inspection', 'system'].includes(ui.tab)) renderPage();
        break;
      case 'frame':
        Object.values(ui.cams).forEach((c) => c.view.pushFrame(data));
        break;
      default:
        break;
    }
  });

  // 상태가 바뀌면 늘 보이는 부분(윗판·탭·아래 줄)과 지금 탭을 다시 그린다
  function refresh() {
    trackDevices();
    updateActive();
    renderBanner();
    renderTally();
    renderBadges();
    renderFoot();
    renderCams();
    renderPage();
  }

  ctl.onRender(() => renderBanner());

  // ---------- 윗판 ----------

  function renderBanner() {
    const p = phase();
    document.body.dataset.phase = p;
    const st = S();
    const fault = p === 'stopped' && st.fault;
    el.word.textContent = t('state.' + p);
    let detail;
    let error = false;
    if (ui.estopError) { detail = ui.estopError; error = true; }
    else if (ctl.message()) { detail = ctl.message(); error = true; } // 시작·원점·모드 등이 실패한 이유
    else if (p === 'offline') {
      // 윗판에는 할 일(전원 케이블)만. 값이 멈춘 시각은 아래 줄 시계 옆에 쓴다 (흐리게 하지 않고 글로 알린다)
      detail = t(robot.hardwareStop === 'button' ? 'estop.offline.button' : 'estop.offline.dc');
      error = true;
    }
    else if (fault) { detail = store.faultDetail(st.fault); error = true; }
    else if (p === 'running') detail = t('db.detail.running', { mode: modeWord(), duration: duration() });
    else if (p === 'stopped' && st.homeRequired) detail = t('detail.homeRequired');
    else if (p === 'stopped') detail = t('db.detail.stopped', { mode: modeWord() });
    else if (p === 'estop') detail = t('db.detail.estop');
    else if (p === 'unknown') detail = t('detail.unknown', { state: st.lineRaw });
    else detail = t('detail.' + p);
    el.detail.textContent = detail;
    if (error) el.detail.dataset.kind = 'error';
    else delete el.detail.dataset.kind;
    el.lamp.dataset.color = fault ? 'amber' : LAMP[p] || 'off';
    el.lamp.dataset.blink = String(BLINKING.includes(p));
    el.stale.hidden = !(p === 'offline' && ui.staleSince);
    el.stale.textContent = ui.staleSince ? t('db.detail.stale', { time: clock(ui.staleSince, true) }) : '';
    el.estop.disabled = ['connecting', 'offline', 'shutdown'].includes(p);
    el.estop.setAttribute('aria-pressed', String(p === 'estop'));
    el.estopLabel.textContent = t(p === 'estop' ? 'estop.latched' : 'estop.press');
  }

  function renderTally() {
    const st = (S() && S().stats) || { total: 0, good: 0, defect: 0 };
    el.total.textContent = fmt(st.total);
    el.good.textContent = fmt(st.good);
    el.defect.textContent = fmt(st.defect);
    el.rate.textContent = (st.total ? (st.defect / st.total) * 100 : 0).toFixed(1) + '%';
    // 분당 처리: 최근 60초 동안 받은 판정 수
    const list = store.state.inspections;
    const now = Date.now();
    ui.pace = list.length ? list.filter((i) => now - i.receivedAt <= 60000).length : null;
    // 판정 시간: 서버 성능 값(metrics), 없으면 최근 판정 10개의 평균
    const m = store.state.metrics;
    let ms = m && num(m.inferenceMs) ? m.inferenceMs : null;
    if (ms === null) {
      const xs = list.slice(0, 10).map((i) => i.latencyMs).filter(num);
      if (xs.length) ms = xs.reduce((a, b) => a + b, 0) / xs.length;
    }
    ui.latency = ms;
  }

  // ---------- 탭 ----------

  function selectTab(id, opts) {
    if (!TABS.includes(id)) id = 'overview';
    const changed = ui.tab !== id;
    ui.tab = id;
    TABS.forEach((tid) => {
      const on = tid === id;
      el.tabs[tid].setAttribute('aria-selected', String(on));
      el.tabs[tid].tabIndex = on ? 0 : -1;
      el.pages[tid].hidden = !on;
    });
    if (opts && opts.focus) el.tabs[id].focus();
    if (changed) {
      el.canvas.scrollTop = 0;
      el.tabs[id].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      try { history.replaceState(null, '', '#' + id); } catch (e) { /* 파일로 연 화면 */ }
    }
    if (id === 'alarms') ui.unseen = { warning: 0, alarm: 0 }; // 경보 탭을 보면 확인한 것으로 (조작 화면 로그 창의 알림 점과 같다)
    renderBadges();
    renderCams(); // 영상은 검사 탭에서만 받는다
    renderPage();
  }

  TABS.forEach((id) => el.tabs[id].addEventListener('click', () => selectTab(id)));
  el.tabList.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(ui.tab);
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(TABS[(next + TABS.length) % TABS.length], { focus: true });
  });
  window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
  // 좁은 화면에서는 탭 줄이 윗판 아래 가로 줄이 된다 (dashboard-tabs.css 959px)
  const narrow = matchMedia('(max-width: 959px)');
  const setOrientation = () => el.tabList.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
  narrow.addEventListener('change', setOrientation);
  setOrientation();

  // 탭마다 그 영역에서 가장 나쁜 상태를 글자로 붙인다 (색만으로 알리지 않는다)
  // spoken: 숫자만 보이는 글자를 스크린 리더에는 문장으로 읽힌다 (예: "3" → "확인하지 않은 경고 3건")
  function setBadge(id, text, level, spoken) {
    const b = el.badges[id];
    b.textContent = '';
    setLevel(b, text ? level : null);
    if (!text) return;
    if (!spoken) { b.textContent = text; return; }
    const shown = document.createElement('span');
    shown.setAttribute('aria-hidden', 'true');
    shown.textContent = text;
    const said = document.createElement('span');
    said.className = 'sr-only';
    said.textContent = spoken;
    b.append(shown, said);
  }

  function renderBadges() {
    const worstIn = (pred) => ui.active.filter(pred).reduce((w, c) => worse(w, c.level), null);
    ARMS.forEach((arm) => {
      const lost = ui.active.some((c) => c.key === 'dev.' + arm);
      const level = worstIn((c) => c.area === arm && c.key !== 'dev.' + arm);
      if (lost) setBadge(arm, t('devices.disconnected'), 'warning');
      else setBadge(arm, level ? t('db.level.' + level) : '', level);
    });
    const camLost = ui.active.some((c) => /^dev\.camera_/.test(c.key));
    setBadge('inspection', camLost ? t('devices.disconnected') : '', 'warning');
    const lost = ui.active.filter((c) => c.key === 'server' || /^dev\./.test(c.key)).length;
    setBadge('devices', lost ? t('dbt.badge.lost', { n: lost }) : '', 'warning');
    const unseen = ui.unseen.warning + ui.unseen.alarm;
    setBadge('alarms', unseen ? String(unseen) : '', ui.unseen.alarm ? 'alarm' : 'warning', unseen ? t('dbt.badge.unseen', { n: unseen }) : '');
  }

  function renderPage() {
    switch (ui.tab) {
      case 'overview': renderOverview(); break;
      case 'control': renderControlPage(); break;
      case 'production': renderProduction(); break;
      case 'inspection': renderInspection(); break;
      case 'arm':
      case 'leader': renderArmPage(ui.tab); break;
      case 'devices': renderDevicesPage(); break;
      case 'alarms': renderAlarmsPage(); break;
      case 'system': renderSystem(); break;
      default: break;
    }
  }

  // ---------- 장치 연결 (아래 줄 · 장치 탭) ----------

  function deviceIds() {
    const ids = Object.keys((S() && S().devices) || {});
    const first = ['conveyor', 'arm', 'leader'].filter((d) => ids.includes(d))
      .concat(store.cameraIds().map((c) => 'camera_' + c).filter((d) => ids.includes(d)));
    return ['server'].concat(first, ids.filter((d) => !first.includes(d)).sort());
  }

  // 'connected' · 'disconnected' · 'unknown'(서버가 끊겨 알 수 없음)
  function deviceState(id) {
    if (id === 'server') return online() ? 'connected' : 'disconnected';
    if (!S() || !online()) return 'unknown';
    return S().devices[id] === 'connected' ? 'connected' : 'disconnected';
  }

  // 바뀐 시각과 끊긴 횟수 — 서버가 끊긴 동안은 장치 상태를 모르므로 세지 않는다
  function trackDevices() {
    const now = Date.now();
    deviceIds().forEach((id) => {
      const state = deviceState(id);
      if (state === 'unknown') return;
      const connected = state === 'connected';
      const d = ui.dev[id];
      if (!d) { ui.dev[id] = { connected, since: now, drops: 0 }; return; }
      if (d.connected !== connected) {
        d.connected = connected;
        d.since = now;
        if (!connected) d.drops += 1;
      }
    });
  }

  function deviceName(id) { return id === 'server' ? t('device.server') : store.deviceName(id); }

  function renderFoot() {
    const ids = deviceIds();
    if (ids.join() !== el.devstrip.dataset.sig) {
      el.devstrip.textContent = '';
      ids.forEach((id) => {
        const li = document.createElement('li');
        li.dataset.id = id;
        const lamp = document.createElement('span');
        lamp.className = 'lamp';
        const name = document.createElement('span');
        name.textContent = deviceName(id);
        const state = document.createElement('span');
        state.className = 'devstrip__state';
        li.append(lamp, name, state);
        el.devstrip.appendChild(li);
      });
      el.devstrip.dataset.sig = ids.join();
    }
    el.devstrip.querySelectorAll('li').forEach((li) => {
      const state = deviceState(li.dataset.id);
      li.dataset.state = state;
      li.firstChild.dataset.color = state === 'connected' ? 'green' : 'off';
      // 색만으로 알리지 않도록 끊김은 글자로도 쓴다
      li.lastChild.textContent = state === 'connected' ? '' : t(state === 'unknown' ? 'dbt.dev.unknown' : 'devices.disconnected');
    });
    // 마지막 경보: 경고·비상 중 가장 최근 것 하나. 누르면 경보 탭
    const last = ui.log.find((e) => e.level === 'warning' || e.level === 'alarm');
    el.lastalarm.textContent = '';
    el.lastalarm.disabled = !last;
    setLevel(el.lastalarm, last ? last.level : null);
    if (!last) {
      el.lastalarm.textContent = t('db.alarms.empty');
      return;
    }
    const time = document.createElement('span');
    time.className = 'lastalarm__time';
    time.textContent = clock(last.at, true);
    const level = document.createElement('span');
    level.className = 'lastalarm__level';
    level.textContent = t('db.level.' + last.level);
    const msg = document.createElement('span');
    msg.className = 'lastalarm__msg';
    msg.textContent = last.text;
    el.lastalarm.append(time, level, msg);
    el.lastalarm.title = t('dbt.foot.open');
  }

  el.lastalarm.addEventListener('click', () => selectTab('alarms', { focus: true }));

  // ---------- 지금 이상 (현재 상태에서 뽑는다) ----------

  function updateActive() {
    const out = [];
    const st = S();
    const add = (key, level, text, area) => out.push({ key, level, text, area });
    if (store.state.everConnected && !online()) add('server', 'warning', t('event.server_lost'), 'devices');
    if (st && online()) {
      if (st.estop) add('estop', 'alarm', t('dbt.active.estop'), 'line');
      if (st.fault) add('fault', 'warning', store.faultText(st.fault), 'line');
      Object.entries(st.devices || {}).forEach(([id, s]) => {
        if (s !== 'disconnected') return;
        const area = ARMS.includes(id) ? id : /^camera_/.test(id) ? 'inspection' : 'devices';
        add('dev.' + id, 'warning', t('event.device_disconnected', { device: store.deviceName(id) }), area);
      });
      ARMS.forEach((arm) => {
        Object.entries(liveMotors(arm)).forEach(([joint, m]) => {
          const tl = tempLevel(m.temp);
          if (tl) add(`servo.${arm}.${joint}.temp`, tl, store.eventText({ code: 'servo_overheat', params: { arm, joint, temp: Math.round(m.temp), limit: tl === 'alarm' ? LIMITS.tempAlarm : LIMITS.tempWarn } }), arm);
          const faults = (m.faults || []).filter((x) => ['sensor', 'current', 'overload'].includes(x));
          if (faults.length) add(`servo.${arm}.${joint}.fault`, 'alarm', store.eventText({ code: 'servo_error', params: { arm, joint, faults: faults.map((x) => t('fault.bit.' + x)).join(', ') } }), arm);
          const load = num(m.load) ? Math.abs(m.load) : null;
          if (load !== null && load >= LIMITS.loadWarn) add(`servo.${arm}.${joint}.load`, 'warning', t('dbt.active.load', { arm: store.armName(arm), joint: store.jointName(joint), load: Math.round(load), limit: LIMITS.loadWarn }), arm);
        });
        const volt = supplyOf(arm);
        const sup = supplyCfg(arm);
        const vl = supplyLevel(volt, sup);
        if (vl) add('supply.' + arm, vl, store.eventText({ code: 'servo_voltage', params: { arm, volt: volt.toFixed(1), nominal: sup.nominal } }), arm);
      });
    }
    // 처음 본 시각을 기억해 "몇 시부터"를 쓴다
    const now = Date.now();
    const keys = new Set(out.map((c) => c.key));
    Array.from(ui.activeSince.keys()).forEach((k) => { if (!keys.has(k)) ui.activeSince.delete(k); });
    out.forEach((c) => {
      if (!ui.activeSince.has(c.key)) ui.activeSince.set(c.key, now);
      c.since = ui.activeSince.get(c.key);
    });
    out.sort((a, b) => (RANK[b.level] - RANK[a.level]) || (b.since - a.since));
    ui.active = out;
  }

  function renderActive(list, empty, meta) {
    list.textContent = '';
    ui.active.forEach((c) => {
      const li = document.createElement('li');
      li.dataset.level = c.level;
      const level = document.createElement('span');
      level.className = 'alist__level';
      level.textContent = t('db.level.' + c.level);
      const msg = document.createElement('span');
      msg.className = 'alist__msg';
      msg.textContent = c.text;
      const since = document.createElement('span');
      since.className = 'alist__since';
      since.textContent = t('dbt.active.since', { time: clock(c.since, true) });
      li.append(level, msg, since);
      list.appendChild(li);
    });
    empty.hidden = ui.active.length > 0;
    if (meta) meta.textContent = ui.active.length ? t('dbt.count', { n: ui.active.length }) : '';
  }

  // ---------- 기록 ----------

  function pushLog(evt) {
    const at = evt.at ? Date.parse(evt.at) : Date.now();
    const entry = { at: Number.isNaN(at) ? Date.now() : at, level: evt.level || 'info', code: evt.code, text: store.eventText(evt), local: !!evt.local };
    // 시각 차례로 끼운다 — 다시 연결될 때 채운 기록이 끊겼던 동안의 자리에 들어가게 (새것이 앞)
    let i = 0;
    while (i < ui.log.length && ui.log[i].at > entry.at) i += 1;
    ui.log.splice(i, 0, entry);
    if (ui.log.length > LOG_KEEP) ui.log.pop();
    // 화면을 열며 채운 지난 기록(restored)은 확인하지 않은 경보로 세지 않는다
    if (ui.tab !== 'alarms' && RANK[entry.level] && !evt.restored) ui.unseen[entry.level] += 1;
    renderBadges();
    renderFoot();
    if (ui.tab === 'alarms') renderLog();
    if (ui.tab === 'devices' && DEVICE_CODES.includes(entry.code)) renderDeviceLog();
  }

  function logRow(body, e, withSource) {
    const tr = body.insertRow();
    const time = tr.insertCell();
    time.textContent = clock(e.at, true);
    time.className = 'dim';
    const level = tr.insertCell();
    level.textContent = t(e.level === 'info' ? 'dbt.level.info' : 'db.level.' + e.level);
    const msg = tr.insertCell();
    msg.textContent = e.text;
    if (RANK[e.level]) { level.dataset.level = e.level; msg.dataset.level = e.level; }
    if (withSource) {
      const src = tr.insertCell();
      src.textContent = t(e.local ? 'dbt.log.local' : 'dbt.log.server');
      src.className = 'dim';
    }
  }

  // ---------- 개요 ----------

  function renderOverview() {
    renderFlow();
    ovTrend.render();
    renderRecent(el.ovRecent, el.ovRecentEmpty, OV_RECENT, false);
    const n = Math.min(store.state.inspections.length, OV_RECENT);
    el.ovRecentMeta.textContent = n ? t('dbt.lastItems', { n }) : '';
    renderActive(el.ovActive, el.ovActiveEmpty, el.ovActiveMeta);
  }

  function renderFlow() {
    const st = S();
    const on = online() && !!st;
    const p = phase();
    const unknown = t('dbt.dev.unknown');
    // 서버가 공정 단계(cycle)를 알려 주면 지금 일하는 칸을 표시한다 (docs/line-sequence.md 1장). 모르면(v0.2) 가동 여부만
    const stage = on && p === 'running' && st.cycle ? st.cycle.stage : null;
    el.flow.dataset.flowing = String(p === 'running');
    el.flow.dataset.stage = stage || '';
    const active = { conveyor: stage === 'feeding' || stage === 'passing', camera: stage === 'inspecting', judge: stage === 'inspecting', arm: stage === 'sorting' };
    Object.entries(active).forEach(([k, on2]) => { el.st[k].dataset.active = String(on2); });

    // 컨베이어 — 부품마다 멈추는 운전이면 판정·분류하는 동안 서 있다
    let state = unknown;
    let level = null;
    if (on) {
      if (st.devices.conveyor === 'disconnected') { state = t('devices.disconnected'); level = 'warning'; }
      else if (p === 'estop') { state = t('dbt.flow.halted'); level = 'alarm'; }
      else if (stage) state = active.conveyor ? store.stageName(stage) : t('dbt.flow.halted');
      else state = t(p === 'running' ? 'state.running' : 'state.stopped');
    }
    f(el.st.conveyor, 'state').textContent = state;
    setLevel(f(el.st.conveyor, 'state'), level);
    setLevel(el.st.conveyor, level);
    f(el.st.conveyor, 'pace').textContent = ui.pace === null ? '–' : t('db.unit.count', { n: ui.pace });

    // 촬영: 서버가 알려 준 카메라마다 한 줄
    const body = f(el.st.camera, 'cams');
    const ids = store.cameraIds();
    if (body.dataset.sig !== ids.join() || !body.firstChild) {
      body.textContent = '';
      const head = document.createElement('p');
      head.className = 'st__state';
      body.appendChild(head);
      ids.forEach((id) => {
        const row = document.createElement('p');
        row.className = 'st__row';
        const name = document.createElement('span');
        name.textContent = store.cameraName(id);
        const b = document.createElement('b');
        b.dataset.cam = id;
        row.append(name, b);
        body.appendChild(row);
      });
      const way = document.createElement('p');
      way.className = 'st__row';
      const wayName = document.createElement('span');
      wayName.textContent = t('dbt.flow.transport');
      way.append(wayName, document.createElement('b'));
      body.appendChild(way);
      body.dataset.sig = ids.join();
    }
    const fpsMap = (store.state.metrics && store.state.metrics.fps) || {};
    let camLevel = null;
    let streaming = 0;
    ids.forEach((id) => {
      const b = body.querySelector('[data-cam="' + id + '"]');
      let text = unknown;
      let lv = null;
      if (on) {
        const src = store.cameraSource(id);
        if (st.devices['camera_' + id] === 'disconnected') { text = t('devices.disconnected'); lv = 'warning'; }
        else if (src.streaming) {
          streaming += 1;
          const fps = num(fpsMap[id]) ? fpsMap[id] : ui.cams[id] && ui.cams[id].view.fps();
          text = fps ? fps.toFixed(1) + 'fps' : t('dbt.cam.on');
        } else text = t('dbt.cam.off');
      }
      b.textContent = text;
      setLevel(b, lv);
      camLevel = worse(camLevel, lv);
    });
    body.firstChild.textContent = on ? t('dbt.cam.count', { total: ids.length, n: streaming }) : unknown;
    const ways = ids.map((id) => store.cameraSource(id).transport).filter((x, i, xs) => xs.indexOf(x) === i);
    body.lastChild.lastChild.textContent = ways.length ? ways.map((x) => (TRANSPORT[x] ? t(TRANSPORT[x]) : x)).join(', ') : '–';
    setLevel(el.st.camera, camLevel);

    // 판정
    const last = store.state.inspections[0];
    f(el.st.judge, 'state').textContent = on ? t((stage ? stage === 'inspecting' : p === 'running') ? 'dbt.flow.judging' : 'dbt.flow.idle') : unknown;
    f(el.st.judge, 'latency').textContent = ui.latency === null ? '–' : Math.round(ui.latency) + 'ms';
    const conf = f(el.st.judge, 'conf');
    conf.textContent = last && last.result
      ? t('result.' + last.result) + (num(last.confidence) ? ' ' + Math.round(last.confidence * 100) + '%' : '')
      : '–';
    conf.className = last && last.result === 'defect' ? 'is-defect' : '';

    // 분류 (로봇팔)
    const motors = liveMotors('arm');
    const ms = Object.values(motors);
    let armState = unknown;
    let armLevel = null;
    let stateLevel = null;
    if (on) {
      if (st.devices.arm === 'disconnected') { armState = t('devices.disconnected'); armLevel = 'warning'; stateLevel = 'warning'; }
      else if (!ms.length) armState = '–';
      else if (ms.every((m) => m.torque === false)) armState = t('dbt.arm.limp');
      else if (st.mode === 'manual' && p === 'running') armState = t('dbt.arm.follow'); // 수동: 사람이 움직이는 리더암을 따라간다
      else if (stage === 'sorting') armState = st.cycle.step ? store.stepName(st.cycle.step) : store.stageName(stage); // 작업의 지금 단계
      else if (ms.some((m) => m.moving)) armState = t('dbt.arm.moving');
      else armState = t('dbt.arm.idle');
      armLevel = worse(armLevel, ui.active.filter((c) => c.area === 'arm' && c.key !== 'dev.arm').reduce((w, c) => worse(w, c.level), null));
    }
    f(el.st.arm, 'state').textContent = armState;
    setLevel(f(el.st.arm, 'state'), stateLevel);
    setLevel(el.st.arm, armLevel);
    let hot = null;
    Object.entries(motors).forEach(([j, m]) => { if (num(m.temp) && (!hot || m.temp > hot.temp)) hot = { j, temp: m.temp }; });
    const temp = f(el.st.arm, 'temp');
    temp.textContent = hot ? store.jointName(hot.j) + ' ' + Math.round(hot.temp) + '°C' : '–';
    setLevel(temp, hot ? tempLevel(hot.temp) : null);
    const volt = supplyOf('arm');
    const supply = f(el.st.arm, 'supply');
    supply.textContent = volt === null ? '–' : volt.toFixed(1) + 'V';
    setLevel(supply, supplyLevel(volt, supplyCfg('arm')));

    // 출구
    const stats = (st && st.stats) || { good: 0, defect: 0 };
    f(el.st.good, 'n').textContent = fmt(stats.good);
    f(el.st.defect, 'n').textContent = fmt(stats.defect);
  }

  function renderRecent(body, empty, limit, withLatency) {
    const list = store.state.inspections.slice(0, limit);
    empty.hidden = list.length > 0;
    body.textContent = '';
    list.forEach((it) => {
      const tr = body.insertRow();
      const cells = [
        it.id !== undefined ? '#' + it.id : '–',
        clock(it.at ? Date.parse(it.at) : it.receivedAt, true),
        it.result ? t('result.' + it.result) : '–',
        num(it.confidence) ? Math.round(it.confidence * 100) + '%' : '–',
      ];
      if (withLatency) cells.push(num(it.latencyMs) ? Math.round(it.latencyMs) + 'ms' : '–');
      cells.forEach((text, i) => {
        const td = tr.insertCell();
        td.textContent = text;
        if (i >= 3) td.className = 'num';
        if (i === 1) td.className = 'dim';
        if (i === 2 && it.result === 'defect') td.className = 'is-defect';
      });
    });
  }

  // ---------- 분당 판정 막대 (개요 30분 · 생산 탭은 고른 범위) ----------

  function minuteData(n) {
    const now = Math.floor(Date.now() / 60000) * 60000;
    const byMinute = new Map(store.state.minutes.map((m) => [m.t, m]));
    const out = [];
    for (let i = n - 1; i >= 0; i -= 1) {
      const minute = now - i * 60000;
      const m = byMinute.get(minute);
      out.push({ t: minute, good: m ? m.good : 0, defect: m ? m.defect : 0 });
    }
    return out;
  }

  // 아래 눈금: 범위를 셋으로 나눈 자리에 "n분 전", 맨 끝에 "지금"
  function agoTicks(n) {
    const step = n / 3;
    return [[n - 1 - Math.round(step * 2), t('db.trend.ago', { n: Math.round(step * 2) })], [n - 1 - Math.round(step), t('db.trend.ago', { n: Math.round(step) })], [n - 1, t('db.trend.now')]];
  }

  // 위쪽 모서리 없이 각진 막대. 겹쳐 쌓을 때는 판 색 2px 틈으로 나눈다 (테두리를 긋지 않는다)
  function minuteChart(plot, minutes) {
    const svg = svgEl('svg', { 'aria-hidden': 'true' });
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    plot.append(svg, tip);
    // 그림과 같은 값을 표로 (스크린 리더용). 표에는 overflow가 듣지 않아 숨김은 감싸는 칸에 건다
    const sr = document.createElement('div');
    sr.className = 'sr-only';
    const table = document.createElement('table');
    table.id = plot.id + '-table';
    const caption = document.createElement('caption');
    const head = table.createTHead().insertRow();
    ['db.trend.minute', 'result.good', 'result.defect'].forEach((k) => { const th = document.createElement('th'); th.textContent = t(k); head.appendChild(th); });
    const rows = table.createTBody();
    table.prepend(caption);
    sr.appendChild(table);
    plot.after(sr);
    plot.setAttribute('aria-describedby', table.id);

    const c = { hover: null, data: [], M: { l: 36, r: 2, t: 6, b: 26 }, slot: 0 };

    function render() {
      const W = plot.clientWidth;
      const H = plot.clientHeight;
      if (!W || !H) return;
      const n = minutes();
      const data = minuteData(n);
      c.data = data;
      if (c.hover !== null && c.hover >= n) c.hover = n - 1;
      const M = c.M;
      const pw = W - M.l - M.r;
      const ph = H - M.t - M.b;
      const max = niceMax(Math.max(1, ...data.map((d) => d.good + d.defect)));
      const slot = pw / n;
      c.slot = slot;
      const bw = Math.max(2, Math.min(24, slot - (slot > 8 ? 4 : 1)));
      const y = (v) => M.t + ph - (v / max) * ph;
      svg.textContent = '';
      if (c.hover !== null) svg.appendChild(svgEl('rect', { class: 'c-hover', x: M.l + c.hover * slot, y: M.t, width: slot, height: ph }));
      [max, max / 2].forEach((v) => svg.appendChild(svgEl('line', { class: 'c-grid', x1: M.l, x2: W - M.r, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 })));
      [0, max / 2, max].forEach((v) => svg.appendChild(svgEl('text', { x: M.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, String(v))));
      const base = M.t + ph;
      data.forEach((d, i) => {
        const x = M.l + i * slot + (slot - bw) / 2;
        const hg = (d.good / max) * ph;
        const hd = (d.defect / max) * ph;
        if (d.good) svg.appendChild(svgEl('rect', { class: 'c-good', x, y: base - hg, width: bw, height: hg }));
        if (d.defect) svg.appendChild(svgEl('rect', { class: 'c-defect', x, y: base - hg - (d.good ? 2 : 0) - hd, width: bw, height: hd }));
      });
      svg.appendChild(svgEl('line', { class: 'c-base', x1: M.l, x2: W - M.r, y1: Math.round(base) + 0.5, y2: Math.round(base) + 0.5 }));
      agoTicks(n).forEach(([i, label]) => {
        const last = i === n - 1;
        svg.appendChild(svgEl('text', { x: last ? W - M.r : M.l + i * slot + slot / 2, y: H - 4, 'text-anchor': last ? 'end' : 'middle' }, label));
      });
      caption.textContent = t('dbt.trend.caption', { n });
      rows.textContent = '';
      data.forEach((d) => {
        const tr = rows.insertRow();
        [clock(d.t, false), String(d.good), String(d.defect)].forEach((text) => { tr.insertCell().textContent = text; });
      });
      if (c.hover !== null) showTip();
    }

    // 막대 옆에 띄우되 그림 밖으로 나가지 않게: 값이 먼저, 이름은 뒤
    function showTip() {
      const d = c.data[c.hover];
      if (!d) return;
      tip.textContent = '';
      const time = document.createElement('p');
      time.className = 'tip__time';
      time.textContent = clock(d.t, false);
      tip.appendChild(time);
      const total = d.good + d.defect;
      [['good', d.good], ['defect', d.defect]].forEach(([k, n]) => {
        const row = document.createElement('p');
        row.className = 'tip__row';
        const key = document.createElement('span');
        key.className = 'tip__key tip__key--' + k;
        const b = document.createElement('b');
        b.textContent = String(n);
        const label = document.createElement('span');
        label.textContent = t('result.' + k);
        row.append(key, b, label);
        tip.appendChild(row);
      });
      const rate = document.createElement('p');
      rate.className = 'tip__row';
      const key = document.createElement('span');
      key.className = 'tip__key';
      const rb = document.createElement('b');
      rb.textContent = total ? ((d.defect / total) * 100).toFixed(1) + '%' : '–';
      const rl = document.createElement('span');
      rl.textContent = t('db.trend.rate');
      rate.append(key, rb, rl);
      tip.appendChild(rate);
      tip.hidden = false;
      const W = plot.clientWidth;
      const x = c.M.l + c.hover * c.slot + c.slot / 2;
      const left = x + 12 + tip.offsetWidth > W ? x - 12 - tip.offsetWidth : x + 12;
      tip.style.left = Math.max(0, left) + 'px';
    }

    function setHover(i) {
      c.hover = i;
      if (i === null) tip.hidden = true;
      render();
    }

    function slotAt(clientX) {
      const r = plot.getBoundingClientRect();
      const n = minutes();
      const i = Math.floor((clientX - r.left - c.M.l) / ((r.width - c.M.l - c.M.r) / n));
      return Math.min(n - 1, Math.max(0, i));
    }

    plot.addEventListener('pointermove', (e) => { const i = slotAt(e.clientX); if (i !== c.hover) setHover(i); });
    plot.addEventListener('pointerleave', () => { if (document.activeElement !== plot) setHover(null); });
    plot.addEventListener('focus', () => setHover(minutes() - 1));
    plot.addEventListener('blur', () => setHover(null));
    plot.addEventListener('keydown', (e) => {
      const n = minutes();
      const cur = c.hover === null ? n - 1 : c.hover;
      const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 }[e.key];
      if (e.key === 'Escape') { setHover(null); return; }
      if (next === undefined) return;
      e.preventDefault();
      setHover(Math.min(n - 1, Math.max(0, next)));
    });
    new ResizeObserver(() => render()).observe(plot);
    return { render, reset() { c.hover = null; tip.hidden = true; } };
  }

  const ovTrend = minuteChart($('ov-trend'), () => OV_MINUTES);
  const prTrend = minuteChart($('pr-trend'), () => ui.range);

  // ---------- 조작 ----------

  // 시작 조건 (docs/API.md 4.1장): 서버 연결 · 긴급정지 풀림 · 고장 없음 · 필요한 장치 연결 · 전원 전압.
  // 서버가 시작을 거절하는 이유와 같은 목록이라, 막힌 것이 있으면 시작을 누르기 전에 보인다
  function startConditions() {
    const st = S();
    const on = !!st && online();
    const manual = on && st.mode === 'manual';
    const rows = [];
    // state: 'ok' · 'bad'(막힘) · 'unknown'(아직 모름 — 색을 입히지 않는다) · 'skip'(이 모드에서는 필요 없음)
    const add = (key, label, state, text, fix) => rows.push({ key, label, state, text, fix });
    const known = (ok, okText, badText) => (on ? [ok ? 'ok' : 'bad', ok ? okText : badText] : ['unknown', t('dbt.dev.unknown')]);
    // 왼쪽 줄: 상태 다섯 가지
    if (online()) add('server', t('ctl.cond.server'), 'ok', t('dbt.devices.connected'), '');
    else if (!store.state.everConnected) add('server', t('ctl.cond.server'), 'unknown', t('state.connecting'), '');
    else add('server', t('ctl.cond.server'), 'bad', t('devices.disconnected'), t('ctl.cond.fixServer'));
    add('estop', t('ctl.cond.estop'), ...known(on && !st.estop, t('ctl.cond.released'), t('ctl.cond.latched')), t('ctl.cond.fixEstop'));
    // 확인하고 시작하면 풀리는 고장(clear: start)은 시작을 막지 않는다 (docs/API.md 3.1)
    const ackOnStart = on && !!st.fault && st.fault.clear === 'start';
    add('fault', t('ctl.cond.fault'), ...known(on && (!st.fault || ackOnStart), ackOnStart ? t('ctl.cond.ackOnStart') : t('ctl.cond.none'), t('ctl.cond.some')),
      on && st.fault ? store.faultDetail(st.fault) : t('ctl.cond.fixFault'));
    const powerBad = ['arm'].concat(manual ? ['leader'] : []).some((arm) => supplyLevel(supplyOf(arm), supplyCfg(arm)) === 'alarm');
    add('power', t('ctl.cond.power'), ...known(!powerBad, t('ctl.cond.normal'), t('ctl.cond.abnormal')), t('ctl.cond.fixPower'));
    add('home', t('ctl.cond.home'), ...known(on && !st.homeRequired, t('ctl.cond.homeOk'), t('ctl.cond.homeNeeded')), t('ctl.cond.fixHome'));
    // 오른쪽 줄: 운전 모드에 필요한 장치 (리더암은 수동에서만). 서버가 아직 알려 주지 않은 장치도 '모름'
    const primary = 'camera_' + store.primaryCamera();
    ['conveyor', 'arm', primary, 'leader'].forEach((id) => {
      const name = id === primary ? t('ctl.cond.primaryCam', { camera: store.deviceName(id) }) : store.deviceName(id);
      const fix = t('ctl.cond.fixDevice', { device: store.deviceName(id) });
      if (id === 'leader' && !manual) { add('dev.' + id, name, 'skip', t('ctl.cond.manualOnly'), ''); return; }
      if (!on || !(id in (st.devices || {}))) { add('dev.' + id, name, 'unknown', t('dbt.dev.unknown'), fix); return; }
      const ok = st.devices[id] === 'connected';
      add('dev.' + id, name, ok ? 'ok' : 'bad', t(ok ? 'dbt.devices.connected' : 'devices.disconnected'), fix);
    });
    return rows;
  }

  function renderConditions(p) {
    const rows = startConditions();
    if (el.ctConds.dataset.sig !== rows.map((r) => r.key).join()) {
      el.ctConds.textContent = '';
      rows.forEach((r) => {
        const li = document.createElement('li');
        li.dataset.key = r.key;
        li.innerHTML = '<svg class="conds__mark" aria-hidden="true"><use href="#i-check"></use></svg><span class="conds__label"></span><span class="conds__state"></span>';
        el.ctConds.appendChild(li);
      });
      el.ctConds.dataset.sig = rows.map((r) => r.key).join();
    }
    rows.forEach((r, i) => {
      const li = el.ctConds.children[i];
      li.dataset.state = r.state;
      li.querySelector('use').setAttribute('href', r.state === 'bad' ? '#i-alert' : '#i-check');
      li.querySelector('.conds__label').textContent = r.label;
      li.querySelector('.conds__state').textContent = r.text;
    });
    const bad = rows.filter((r) => r.state === 'bad');
    const unknownCount = rows.filter((r) => r.state === 'unknown').length;
    el.ctCondMeta.textContent = bad.length ? t('ctl.cond.missing', { n: bad.length }) : unknownCount ? t('ctl.cond.checking') : t('ctl.cond.allOk');
    setLevel(el.ctCondMeta, bad.length ? 'warning' : null);
    let sum;
    if (p === 'running') sum = t('ctl.cond.running');
    else if (['starting', 'stopping', 'homing', 'shutdown'].includes(p)) sum = t('ctl.cond.busy');
    else if (bad.length) sum = bad[0].fix;
    else if (unknownCount) sum = t('ctl.cond.waiting');
    else sum = t('ctl.cond.ready');
    el.ctCondSum.textContent = sum;
    setLevel(el.ctCondSum, bad.length && !['running'].includes(p) ? 'warning' : null);
  }

  // 원점 각도(설정 파일)와 로봇팔의 지금 각도 — 원점 잡기가 얼마나 움직일지
  function renderHomes() {
    const joints = (homeCfg && homeCfg.joints) || [];
    if (!el.ctHomes.firstChild) {
      joints.forEach((j) => {
        const tr = el.ctHomes.insertRow();
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = store.jointName(j.id);
        tr.appendChild(th);
        const target = tr.insertCell();
        target.className = 'num';
        target.textContent = j.angle + (j.id === 'gripper' ? '%' : homeCfg.unit === 'norm' ? '' : '°');
        const now = tr.insertCell();
        now.className = 'num';
        now.textContent = '–';
      });
    }
    const motors = liveMotors('arm');
    joints.forEach((j, i) => {
      const m = motors[j.id] || {};
      const unit = m.posUnit || (j.id === 'gripper' ? 'pct' : 'deg');
      el.ctHomes.rows[i].cells[2].textContent = num(m.pos) ? m.pos.toFixed(1) + (unit === 'pct' ? '%' : '°') : '–';
    });
  }

  // 수동 모드에서만: 리더암 각도 (조작 화면의 운전 모드 아래와 같다)
  function renderControlJoints() {
    const manual = !!S() && online() && S().mode === 'manual';
    el.ctJoints.hidden = !manual;
    if (!manual) return;
    if (!el.ctJointsList.firstChild) {
      JOINTS.forEach((j) => {
        const box = document.createElement('div');
        box.className = 'readout';
        const dt = document.createElement('dt');
        dt.textContent = store.jointName(j);
        const dd = document.createElement('dd');
        dd.dataset.joint = j;
        dd.textContent = '–';
        box.append(dt, dd);
        el.ctJointsList.appendChild(box);
      });
    }
    const leader = store.state.joints.leader;
    const motors = liveMotors('leader');
    el.ctJointsList.querySelectorAll('dd').forEach((dd) => {
      const j = dd.dataset.joint;
      const v = leader && leader.angles && num(leader.angles[j]) ? leader.angles[j] : motors[j] && motors[j].pos;
      const pctUnit = (leader && leader.units && leader.units[j] === 'pct') || j === 'gripper';
      dd.textContent = num(v) ? Math.round(v) + (pctUnit ? '%' : '°') : '–';
    });
  }

  // 카메라마다 한 줄: 이름 · 상태 · 연결/끄기
  function renderControlCams() {
    const ids = store.cameraIds();
    if (el.ctCams.dataset.sig !== ids.join()) {
      el.ctCams.textContent = '';
      ids.forEach((id) => {
        const li = document.createElement('li');
        li.dataset.camera = id;
        const name = document.createElement('span');
        name.className = 'ctl__camname';
        name.textContent = store.cameraName(id);
        const state = document.createElement('span');
        state.className = 'ctl__camstate';
        const on = document.createElement('button');
        on.type = 'button';
        on.className = 'key';
        on.dataset.ctl = 'camera-on';
        on.dataset.camera = id;
        on.dataset.label = 'ctl.camera.on';
        const onLabel = document.createElement('span');
        onLabel.dataset.ctlLabel = '';
        onLabel.textContent = t('ctl.camera.on');
        on.appendChild(onLabel);
        const off = document.createElement('button');
        off.type = 'button';
        off.className = 'key key--quiet';
        off.dataset.ctl = 'camera-off';
        off.dataset.camera = id;
        off.textContent = t('ctl.camera.off');
        off.hidden = true;
        const note = document.createElement('p');
        note.className = 'note';
        note.dataset.note = 'camera';
        note.dataset.camera = id;
        note.hidden = true;
        li.append(name, state, on, off, note);
        el.ctCams.appendChild(li);
      });
      el.ctCams.dataset.sig = ids.join();
    }
    el.ctCams.querySelectorAll('li').forEach((li) => {
      const id = li.dataset.camera;
      const st = S();
      const state = li.querySelector('.ctl__camstate');
      let text = t('dbt.dev.unknown');
      let level = null;
      if (st && online()) {
        if (st.devices['camera_' + id] === 'disconnected') { text = t('devices.disconnected'); level = 'warning'; }
        else text = t(store.cameraSource(id).streaming ? 'dbt.cam.on' : 'dbt.cam.off');
      }
      state.textContent = text;
      setLevel(state, level);
    });
  }

  function renderControlPage() {
    const p = phase();
    const mode = S() && S().mode === 'manual' ? 'manual' : 'auto';
    // 운전 모드: 고른 모드가 하는 일 / 시작과 정지: 지금 누르면 하는 일 (조작 화면의 상태 설명과 같은 문장)
    el.ctModeDesc.textContent = t('detail.running.' + mode);
    el.ctRunHint.textContent = p === 'stopped' || p === 'running' ? t('detail.' + p + '.' + mode) : t('detail.' + (p === 'estop' ? 'estop' : p === 'unknown' ? 'connecting' : p));
    renderControlJoints();
    renderConditions(p);
    renderHomes();
    renderControlCams();
    // 긴급정지: 걸렸는지와 해제한 뒤 어떻게 되는지 (D-004)
    const latched = p === 'estop';
    el.ctEstopState.textContent = latched ? t('estop.latched') : p === 'offline' || p === 'connecting' ? t('dbt.dev.unknown') : t('ctl.estop.clear');
    setLevel(el.ctEstopState, latched ? 'alarm' : null);
    if (p === 'offline') {
      el.ctEstopHint.textContent = t(robot.hardwareStop === 'button' ? 'estop.offline.button' : 'estop.offline.dc');
      el.ctEstopHint.dataset.kind = 'error';
    } else {
      el.ctEstopHint.textContent = t(latched ? 'dialog.release.body' : 'ctl.estop.idle');
      delete el.ctEstopHint.dataset.kind;
    }
    ctl.render();
  }

  // ---------- 생산 ----------

  function renderProduction() {
    document.querySelectorAll('#page-production [data-f="range-meta"]').forEach((n) => { n.textContent = t('dbt.lastN', { n: ui.range }); });
    prTrend.render();
    renderRateChart();
    renderRatio();
    renderBlocks();
  }

  el.range.querySelectorAll('[data-range]').forEach((b) => {
    b.textContent = t('dbt.minutes', { n: b.dataset.range });
    b.addEventListener('click', () => {
      ui.range = Number(b.dataset.range);
      el.range.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      prTrend.reset();
      renderProduction();
    });
  });

  // 분마다 불량률: 판정이 없는 분은 끊어서 긋는다. 점선은 범위 전체 평균
  function renderRateChart() {
    const plot = el.rateChart;
    const W = plot.clientWidth;
    const H = plot.clientHeight;
    if (!W || !H) return;
    const n = ui.range;
    const data = minuteData(n);
    let sumT = 0;
    let sumD = 0;
    const pts = data.map((d, i) => {
      const total = d.good + d.defect;
      sumT += total;
      sumD += d.defect;
      return { i, rate: total ? (d.defect / total) * 100 : null };
    });
    const avg = sumT ? (sumD / sumT) * 100 : null;
    const maxRate = Math.max(0, ...pts.filter((p) => p.rate !== null).map((p) => p.rate));
    const top = [10, 20, 40, 100].find((v) => v >= maxRate) || 100;
    const M = { l: 44, r: 2, t: 6, b: 26 };
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const slot = pw / n;
    const x = (i) => M.l + i * slot + slot / 2;
    const y = (v) => M.t + ph - (v / top) * ph;
    let svg = plot.querySelector('svg');
    if (!svg) { svg = svgEl('svg', { 'aria-hidden': 'true' }); plot.appendChild(svg); }
    svg.textContent = '';
    [top, top / 2].forEach((v) => svg.appendChild(svgEl('line', { class: 'c-grid', x1: M.l, x2: W - M.r, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 })));
    [0, top / 2, top].forEach((v) => svg.appendChild(svgEl('text', { x: M.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, v + '%')));
    const base = M.t + ph;
    svg.appendChild(svgEl('line', { class: 'c-base', x1: M.l, x2: W - M.r, y1: Math.round(base) + 0.5, y2: Math.round(base) + 0.5 }));
    if (avg !== null) svg.appendChild(svgEl('line', { class: 'c-avg', x1: M.l, x2: W - M.r, y1: Math.round(y(avg)) + 0.5, y2: Math.round(y(avg)) + 0.5 }));
    let d = '';
    let run = [];
    const flush = () => {
      if (run.length === 1) svg.appendChild(svgEl('rect', { class: 'c-dot', x: x(run[0].i) - 2, y: y(run[0].rate) - 2, width: 4, height: 4 }));
      run = [];
    };
    pts.forEach((p, k) => {
      if (p.rate === null) { flush(); return; }
      d += (run.length ? 'L' : 'M') + x(p.i).toFixed(1) + ',' + y(p.rate).toFixed(1);
      run.push(p);
      if (k === pts.length - 1) flush();
    });
    if (d) svg.appendChild(svgEl('path', { class: 'c-line', d }));
    agoTicks(n).forEach(([i, label]) => {
      const last = i === n - 1;
      svg.appendChild(svgEl('text', { x: last ? W - M.r : x(i), y: H - 4, 'text-anchor': last ? 'end' : 'middle' }, label));
    });
    plot.setAttribute('aria-label', t('dbt.rateTrend.label', { n, avg: avg === null ? '–' : avg.toFixed(1) + '%' }));
  }

  function renderRatio() {
    const st = (S() && S().stats) || { total: 0, good: 0, defect: 0 };
    const g = st.total ? (st.good / st.total) * 100 : 0;
    const dfx = st.total ? 100 - g : 0;
    el.ratioBar.children[0].style.flex = '0 0 ' + g + '%';
    el.ratioBar.children[1].style.flex = '0 0 ' + dfx + '%';
    el.ratioBar.children[1].hidden = !st.defect;
    el.prGood.textContent = fmt(st.good);
    el.prDefect.textContent = fmt(st.defect);
    el.prRateValue.textContent = (st.total ? (st.defect / st.total) * 100 : 0).toFixed(1) + '%';
    el.prRuntime.textContent = ui.runSince ? duration() : '–';
    const data = minuteData(ui.range).filter((m) => m.good + m.defect > 0);
    if (!data.length) {
      el.prAvgPace.textContent = '–';
      el.prPeak.textContent = '–';
      return;
    }
    const totals = data.map((m) => m.good + m.defect);
    el.prAvgPace.textContent = t('db.unit.count', { n: (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) });
    const peak = data[totals.indexOf(Math.max(...totals))];
    el.prPeak.textContent = t('dbt.ratio.peakValue', { time: clock(peak.t, false), n: peak.good + peak.defect });
  }

  // 10분 단위: 지금 칸은 아직 채워지는 중. 이 화면을 열기 전 칸은 셀 수 없어 줄을 만들지 않는다
  function renderBlocks() {
    const BLOCK = 600000;
    const nowBlock = Math.floor(Date.now() / BLOCK) * BLOCK;
    const byMinute = new Map(store.state.minutes.map((m) => [m.t, m]));
    el.prBlocks.textContent = '';
    for (let i = 0; i < ui.range / 10; i += 1) {
      const start = nowBlock - i * BLOCK;
      if (start + BLOCK <= ui.openedAt) break;
      const tr = el.prBlocks.insertRow();
      const span = tr.insertCell();
      span.textContent = clock(start, false) + '–' + clock(start + BLOCK - 60000, false) + (i === 0 ? ' ' + t('dbt.blocks.now') : '');
      span.className = 'dim';
      let total = 0;
      let defect = 0;
      for (let k = 0; k < 10; k += 1) {
        const m = byMinute.get(start + k * 60000);
        if (m) { total += m.good + m.defect; defect += m.defect; }
      }
      [fmt(total), fmt(defect), total ? ((defect / total) * 100).toFixed(1) + '%' : '–'].forEach((text) => {
        const td = tr.insertCell();
        td.className = 'num';
        td.textContent = text;
      });
    }
  }

  // ---------- 검사 ----------

  const TRANSPORT = { mock: 'dbt.transport.mock', mjpeg: 'dbt.transport.mjpeg', snapshot: 'dbt.transport.snapshot', ws: 'dbt.transport.ws', webrtc: 'dbt.transport.webrtc', video: 'dbt.transport.video', local: 'dbt.transport.local' };

  function buildCams(ids) {
    Object.values(ui.cams).forEach((c) => c.view.destroy());
    ui.cams = {};
    el.cams.textContent = '';
    el.cams.style.setProperty('--cam-cols', String(Math.max(2, Math.min(3, ids.length))));
    ids.forEach((id, i) => {
      const sec = document.createElement('section');
      sec.className = 'pnl';
      const head = document.createElement('div');
      head.className = 'pnl__head';
      const title = document.createElement('h2');
      title.className = 'pnl__title';
      title.textContent = store.cameraName(id);
      const meta = document.createElement('p');
      meta.className = 'pnl__meta';
      head.append(title, meta);
      const screen = document.createElement('div');
      screen.className = 'cam__screen';
      const stage = document.createElement('div');
      stage.className = 'camera__stage';
      const empty = document.createElement('div');
      empty.className = 'cam__empty';
      const emptyTitle = document.createElement('p');
      const emptyHint = document.createElement('button');
      emptyHint.type = 'button';
      emptyHint.className = 'key cam__on';
      emptyHint.dataset.ctl = 'camera-on';
      emptyHint.dataset.camera = id;
      const onLabel = document.createElement('span');
      onLabel.dataset.ctlLabel = '';
      onLabel.textContent = t('camera.connect');
      emptyHint.appendChild(onLabel);
      const note = document.createElement('p');
      note.className = 'note note--screen';
      note.dataset.note = 'camera';
      note.dataset.camera = id;
      note.hidden = true;
      empty.append(emptyTitle, emptyHint, note);
      // 켜져 있으면 영상 오른쪽 위에 끄기 (js/controls.js가 보이고 숨긴다)
      const off = document.createElement('button');
      off.type = 'button';
      off.className = 'key cam__off';
      off.dataset.ctl = 'camera-off';
      off.dataset.camera = id;
      off.textContent = t('camera.disconnect');
      off.hidden = true;
      screen.append(stage, empty, off);
      sec.append(head, screen);
      el.cams.appendChild(sec);
      // 가짜 영상에서 두 번째 카메라는 검사선 근처를 크게 보여 준다 (근접 카메라)
      const zoom = cfg.useMock && i > 0 ? 2.2 : 1;
      ui.cams[id] = { view: new window.CameraView(stage, { sim, zoom }), empty, emptyTitle, emptyHint, meta };
    });
    ui.camSig = ids.join();
    ctl.render();
  }

  function renderCams() {
    const ids = store.cameraIds();
    if (ids.join() !== ui.camSig) buildCams(ids);
    const visible = ui.tab === 'inspection';
    const fpsMap = (store.state.metrics && store.state.metrics.fps) || {};
    const infoCams = (store.state.info && store.state.info.cameras) || [];
    ids.forEach((id) => {
      const c = ui.cams[id];
      const src = S() && online() ? store.cameraSource(id) : null;
      const streaming = !!(src && src.streaming);
      const lost = !!S() && S().devices['camera_' + id] === 'disconnected';
      c.empty.hidden = streaming;
      c.emptyTitle.textContent = t(lost ? 'db.camera.lost' : 'db.camera.off');
      c.emptyHint.hidden = lost;
      c.view.set(streaming && visible && !ctl.ended ? src : null);
      const info = infoCams.find((x) => x.id === id) || {};
      const parts = [];
      const fps = num(fpsMap[id]) ? fpsMap[id] : c.view.fps();
      if (streaming && fps) parts.push(fps.toFixed(1) + 'fps');
      if (info.width && info.height) parts.push(info.width + '×' + info.height);
      if (src && TRANSPORT[src.transport]) parts.push(t(TRANSPORT[src.transport]));
      c.meta.textContent = parts.join(', ');
    });
    sim.setLine(!!S() && S().line === 'running', S() && S().cycle ? S().cycle.stage : null);
  }

  function renderInspection() {
    renderCams();
    const n = Math.min(store.state.inspections.length, RECENT_KEEP);
    el.inRecentMeta.textContent = n ? t('dbt.lastItems', { n }) : '';
    renderRecent(el.inRecent, el.inRecentEmpty, RECENT_KEEP, true);
    renderLatency();
    renderConfidence();
  }

  function renderLatency() {
    const xs = store.state.inspections.slice(0, RECENT_KEEP).map((i) => i.latencyMs).filter(num).reverse();
    const m = store.state.metrics;
    el.latServer.textContent = m && num(m.inferenceMs) ? Math.round(m.inferenceMs) + 'ms' : '–';
    el.latMeta.textContent = xs.length ? t('dbt.lastItems', { n: xs.length }) : '';
    const avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const max = xs.length ? Math.max(...xs) : null;
    el.latAvg.textContent = avg === null ? '–' : Math.round(avg) + 'ms';
    el.latMax.textContent = max === null ? '–' : Math.round(max) + 'ms';
    const plot = el.latChart;
    const W = plot.clientWidth;
    const H = plot.clientHeight;
    if (!W || !H) return;
    let svg = plot.querySelector('svg');
    if (!svg) { svg = svgEl('svg', { 'aria-hidden': 'true' }); plot.appendChild(svg); }
    svg.textContent = '';
    const M = { l: 52, r: 2, t: 6, b: 8 };
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const top = niceMax(Math.max(1, max || 0));
    const y = (v) => M.t + ph - (v / top) * ph;
    [top, top / 2].forEach((v) => svg.appendChild(svgEl('line', { class: 'c-grid', x1: M.l, x2: W - M.r, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 })));
    [0, top / 2, top].forEach((v) => svg.appendChild(svgEl('text', { x: M.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, v + 'ms')));
    const slot = pw / RECENT_KEEP;
    const bw = Math.max(1, slot - 2);
    const off = RECENT_KEEP - xs.length; // 새것이 오른쪽 끝
    xs.forEach((v, i) => {
      const h = (v / top) * ph;
      svg.appendChild(svgEl('rect', { class: 'c-bar', x: M.l + (off + i) * slot + (slot - bw) / 2, y: M.t + ph - h, width: bw, height: h }));
    });
    const base = M.t + ph;
    svg.appendChild(svgEl('line', { class: 'c-base', x1: M.l, x2: W - M.r, y1: Math.round(base) + 0.5, y2: Math.round(base) + 0.5 }));
    plot.setAttribute('aria-label', xs.length ? t('dbt.latency.label', { n: xs.length, avg: Math.round(avg) + 'ms', max: Math.round(max) + 'ms' }) : t('db.recent.empty'));
  }

  function renderConfidence() {
    const list = store.state.inspections.filter((i) => num(i.confidence) && i.result);
    el.conf.textContent = '';
    if (!list.length) {
      el.confNote.textContent = t('dbt.conf.empty');
      return;
    }
    const bins = CONF_BINS.slice(0, -1).map((lo, k) => {
      const hi = CONF_BINS[k + 1];
      const items = list.filter((i) => i.confidence >= lo && i.confidence < hi);
      return { k, good: items.filter((i) => i.result === 'good').length, defect: items.filter((i) => i.result === 'defect').length };
    }).reverse(); // 높은 신뢰도가 위
    const max = Math.max(1, ...bins.map((b) => b.good + b.defect));
    bins.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'hist__row';
      const label = document.createElement('span');
      label.className = 'hist__label';
      label.textContent = t('dbt.conf.bin.' + b.k);
      const track = document.createElement('span');
      track.className = 'hist__track';
      track.setAttribute('aria-hidden', 'true');
      [['good', b.good], ['defect', b.defect]].forEach(([k, n]) => {
        if (!n) return;
        const seg = document.createElement('span');
        seg.className = 'hist__' + k;
        seg.style.flex = '0 0 ' + (n / max) * 100 + '%';
        track.appendChild(seg);
      });
      const n = document.createElement('span');
      n.className = 'hist__n';
      n.textContent = String(b.good + b.defect);
      row.append(label, track, n);
      el.conf.appendChild(row);
    });
    const low = list.filter((i) => i.confidence < 0.7).length;
    el.confNote.textContent = t('dbt.conf.note', { n: list.length, low });
  }

  // ---------- 로봇팔 · 리더암 ----------

  function meter(kind) {
    const m = document.createElement('span');
    m.className = 'meter' + (kind ? ' meter--' + kind : '');
    m.setAttribute('aria-hidden', 'true');
    m.dataset.empty = 'true';
    const band = document.createElement('span');
    band.className = 'meter__band';
    const ptr = document.createElement('span');
    ptr.className = 'meter__ptr';
    m.append(band, ptr);
    return m;
  }

  function tick(m, at) {
    const tk = document.createElement('span');
    tk.className = 'meter__tick';
    tk.style.setProperty('--at', at);
    m.insertBefore(tk, m.lastChild);
  }

  function setMeter(m, v, scale, level) {
    if (!num(v)) { m.dataset.empty = 'true'; delete m.dataset.level; return; }
    m.dataset.empty = 'false';
    m.style.setProperty('--v', pct(v, scale));
    setLevel(m, level);
  }

  function uniq(xs) { return xs.filter((x, i) => xs.indexOf(x) === i); }

  function buildArmPage(arm) {
    const page = el.pages[arm];
    const spec = (robot.arms && robot.arms[arm]) || {};
    const sup = spec.supply || null;
    const motorsCfg = spec.motors || {};
    const leader = arm === 'leader';
    const cols = ['db.servo.joint', 'dbt.servo.id', 'db.servo.pos', 'db.servo.temp', 'db.servo.load', 'dbt.servo.current', 'dbt.servo.torque'].concat(leader ? ['dbt.servo.diff'] : []);
    const numCols = ['dbt.servo.id', 'db.servo.pos', 'db.servo.load', 'dbt.servo.current', 'dbt.servo.diff'];
    page.innerHTML = `
      <div class="page__head">
        <h1 class="page__title">${esc(t('dbt.page.' + arm))}</h1>
        ${arm === 'arm' ? `<div class="page__tools">
          <p class="note" data-note="home" data-note-short hidden></p>
          <button type="button" class="key key--quiet ctl__inline" data-ctl="home">
            <svg class="key__icon" aria-hidden="true"><use href="#i-home"></use></svg><span>${esc(t('home.label'))}</span>
          </button>
        </div>` : ''}
      </div>
      <div class="grid grid--grow-last">
        <section class="pnl span-12" aria-labelledby="${arm}-servo-title">
          <div class="pnl__head">
            <h2 class="pnl__title" id="${arm}-servo-title">${esc(t('dbt.servo'))}</h2>
            <p class="pnl__meta" data-f="servo-meta"></p>
          </div>
          <div class="pnl__body pnl__body--flush">
            <table class="tbl servo">
              <thead><tr>${cols.map((k) => `<th scope="col"${numCols.includes(k) ? ' class="num"' : ''}>${esc(t(k))}</th>`).join('')}</tr></thead>
              <tbody data-f="rows"></tbody>
            </table>
          </div>
        </section>
        <section class="pnl span-6" aria-labelledby="${arm}-temps-title">
          <div class="pnl__head">
            <h2 class="pnl__title" id="${arm}-temps-title">${esc(t('dbt.temps'))}</h2>
            <p class="pnl__meta">${esc(t('dbt.temps.note', { limit: LIMITS.tempWarn }))}</p>
          </div>
          <div class="pnl__body"><div class="spark-grid" data-f="sparks"></div></div>
        </section>
        <section class="pnl span-3" aria-labelledby="${arm}-supply-title">
          <div class="pnl__head"><h2 class="pnl__title" id="${arm}-supply-title">${esc(t('dbt.supply'))}</h2></div>
          <div class="pnl__body supply">
            <p class="supply__value" data-f="volt">–</p>
            <div data-f="meter-wrap">
              <div class="scale"><span>${SUPPLY_SCALE[0]}V</span><span>${(SUPPLY_SCALE[0] + SUPPLY_SCALE[1]) / 2}V</span><span>${SUPPLY_SCALE[1]}V</span></div>
            </div>
            <dl class="facts">
              <dt>${esc(t('dbt.supply.nominal'))}</dt><dd>${sup ? esc(sup.nominal + 'V') : '–'}</dd>
              <dt>${esc(t('dbt.supply.range'))}</dt><dd>${sup ? esc(sup.warnLow + '–' + sup.warnHigh + 'V') : '–'}</dd>
              <dt>${esc(t('dbt.supply.seen'))}</dt><dd data-f="seen">–</dd>
            </dl>
          </div>
        </section>
        <section class="pnl span-3" aria-labelledby="${arm}-spec-title">
          <div class="pnl__head">
            <h2 class="pnl__title" id="${arm}-spec-title">${esc(t('dbt.spec'))}</h2>
            <p class="pnl__meta">config/robot.js</p>
          </div>
          <div class="pnl__body">
            <dl class="facts">
              <dt>${esc(t('dbt.spec.role'))}</dt><dd>${esc(t('dbt.spec.role.' + (spec.role || arm)))}</dd>
              <dt>${esc(t('dbt.spec.model'))}</dt><dd>${esc(uniq(JOINTS.map((j) => motorsCfg[j] && motorsCfg[j].model).filter(Boolean)).join(', ') || '–')}</dd>
              <dt>${esc(t('dbt.spec.gear'))}</dt><dd>${esc(uniq(JOINTS.map((j) => motorsCfg[j] && motorsCfg[j].gear).filter(Boolean)).map((g) => '1:' + g).join(', ') || '–')}</dd>
              <dt>${esc(t('dbt.spec.bus'))}</dt><dd>${robot.bus ? esc(robot.bus.baudRate / 1e6 + 'Mbps') : '–'}</dd>
              <dt>${esc(t('dbt.spec.power'))}</dt><dd>${sup ? esc('DC ' + sup.nominal + 'V') : '–'}</dd>
            </dl>
          </div>
        </section>
      </div>`;
    // 전원 지시계: 정상 범위 띠 + 바늘
    const supplyMeter = meter('l');
    if (sup) {
      supplyMeter.style.setProperty('--lo', pct(sup.warnLow, SUPPLY_SCALE));
      supplyMeter.style.setProperty('--hi', pct(sup.warnHigh, SUPPLY_SCALE));
    }
    f(page, 'meter-wrap').prepend(supplyMeter);

    const tbody = f(page, 'rows');
    const rows = {};
    JOINTS.forEach((j) => {
      const tr = tbody.insertRow();
      const name = document.createElement('th');
      name.scope = 'row';
      const nameText = document.createElement('span');
      nameText.textContent = store.jointName(j);
      const flag = document.createElement('span');
      flag.className = 'servo__flag';
      name.append(nameText, flag);
      tr.appendChild(name);
      const cell = (cls) => { const td = tr.insertCell(); if (cls) td.className = cls; td.textContent = '–'; return td; };
      const id = cell('num dim');
      id.textContent = motorsCfg[j] ? String(motorsCfg[j].id) : '–';
      const pos = cell('num');
      // 지시계는 정상 범위가 있는 값(온도)에만 둔다 — 위치는 정상 범위가 없어 숫자만
      const tempTd = tr.insertCell();
      const wrap = document.createElement('span');
      wrap.className = 'servo__cell';
      const tm = meter('');
      tm.style.setProperty('--lo', '0%');
      tm.style.setProperty('--hi', pct(LIMITS.tempWarn, TEMP_SCALE));
      tick(tm, pct(LIMITS.tempWarn, TEMP_SCALE));
      tick(tm, pct(LIMITS.tempAlarm, TEMP_SCALE));
      const tv = document.createElement('span');
      tv.className = 'val';
      tv.textContent = '–';
      wrap.append(tm, tv);
      tempTd.appendChild(wrap);
      const load = cell('num');
      const current = cell('num');
      const torque = cell('');
      const diff = leader ? cell('num') : null;
      rows[j] = { flag, pos, tm, tv, load, current, torque, diff };
    });

    const sparks = f(page, 'sparks');
    const sparkRefs = {};
    JOINTS.forEach((j) => {
      const box = document.createElement('div');
      const head = document.createElement('p');
      head.className = 'spark__head';
      const name = document.createElement('span');
      name.className = 'spark__name';
      name.textContent = store.jointName(j);
      const val = document.createElement('span');
      val.className = 'spark__val';
      val.textContent = '–';
      head.append(name, val);
      const svg = svgEl('svg', { class: 'spark', viewBox: '0 0 300 56', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      const yLimit = 56 - ((LIMITS.tempWarn - TEMP_SCALE[0]) / (TEMP_SCALE[1] - TEMP_SCALE[0])) * 56;
      svg.appendChild(svgEl('line', { class: 'c-limit', x1: 0, x2: 300, y1: yLimit, y2: yLimit, 'vector-effect': 'non-scaling-stroke' }));
      const line = svgEl('polyline', { class: 'c-line', points: '', 'vector-effect': 'non-scaling-stroke' });
      svg.appendChild(line);
      box.append(head, svg);
      sparks.appendChild(box);
      sparkRefs[j] = { val, line };
    });

    ui.armPages[arm] = { page, rows, sparkRefs, supplyMeter, volt: f(page, 'volt'), seen: f(page, 'seen'), meta: f(page, 'servo-meta'), sup };
  }

  // 서보 상태가 오면 온도 추이(1초에 하나)와 전원 범위를 남긴다
  function recordArm(tel) {
    const arm = tel && tel.arm;
    if (!ui.temps[arm]) return;
    const now = Date.now();
    const list = ui.temps[arm];
    if (!list.length || now - list[list.length - 1].t >= 1000) {
      const v = {};
      Object.entries(tel.motors || {}).forEach(([j, m]) => { if (num(m.temp)) v[j] = m.temp; });
      list.push({ t: now, v });
      while (list.length && now - list[0].t > TEMP_WINDOW) list.shift();
    }
    const volt = supplyOf(arm);
    if (volt !== null) {
      const s = ui.supplySeen[arm];
      ui.supplySeen[arm] = s ? { min: Math.min(s.min, volt), max: Math.max(s.max, volt) } : { min: volt, max: volt };
    }
  }

  function renderArmPage(arm) {
    const a = ui.armPages[arm];
    if (!a) return;
    const motors = liveMotors(arm);
    const follower = arm === 'leader' ? liveMotors('arm') : null;
    const manual = !!S() && S().mode === 'manual';
    const tel = store.state.telemetry[arm];
    if (!S() || !online()) a.meta.textContent = t('dbt.dev.unknown');
    else if (!armConnected(arm)) a.meta.textContent = t('devices.disconnected');
    else a.meta.textContent = tel && tel.at ? t('dbt.servo.meta', { time: clock(Date.parse(tel.at), true) }) : '';
    if (arm === 'leader' && !manual) a.meta.textContent += (a.meta.textContent ? ' ' : '') + t('dbt.servo.diffNote');

    JOINTS.forEach((j) => {
      const r = a.rows[j];
      const m = motors[j] || {};
      const unit = m.posUnit || (j === 'gripper' ? 'pct' : 'deg');
      const mark = unit === 'pct' ? '%' : '°';
      r.pos.textContent = num(m.pos) ? m.pos.toFixed(1) + mark : '–';
      const tl = tempLevel(m.temp);
      r.tv.textContent = num(m.temp) ? Math.round(m.temp) + '°C' : '–';
      setLevel(r.tv, tl);
      setMeter(r.tm, m.temp, TEMP_SCALE, tl);
      const load = num(m.load) ? Math.abs(m.load) : null;
      const ll = load !== null && load >= LIMITS.loadWarn ? 'warning' : null;
      r.load.textContent = load === null ? '–' : Math.round(load) + '%';
      setLevel(r.load, ll);
      r.current.textContent = num(m.current) ? Math.round(m.current) + 'mA' : '–';
      r.torque.textContent = typeof m.torque === 'boolean' ? t(m.torque ? 'dbt.servo.on' : 'dbt.servo.off') : '–';
      if (r.diff) {
        const fm = follower && follower[j];
        r.diff.textContent = manual && fm && num(fm.pos) && num(m.pos) ? (m.pos - fm.pos >= 0 ? '+' : '') + (m.pos - fm.pos).toFixed(1) + mark : '–';
      }
      // 색만으로 알리지 않도록 관절 이름 옆에 글자로도 쓴다 (서보 자체 이상 비트도 비상)
      const faulty = (m.faults || []).some((x) => ['sensor', 'current', 'overload'].includes(x));
      const level = faulty || tl === 'alarm' ? 'alarm' : tl || ll;
      r.flag.textContent = level ? t('db.level.' + level) : '';
      setLevel(r.flag, level);
    });

    const volt = supplyOf(arm);
    const vl = supplyLevel(volt, a.sup);
    a.volt.textContent = volt === null ? '–' : volt.toFixed(1) + 'V';
    setLevel(a.volt, vl);
    setMeter(a.supplyMeter, volt === null ? undefined : volt, SUPPLY_SCALE, vl);
    const seen = ui.supplySeen[arm];
    a.seen.textContent = seen ? seen.min.toFixed(1) + '–' + seen.max.toFixed(1) + 'V' : '–';

    // 온도 추이: 가로는 최근 5분(오른쪽 끝이 지금), 세로는 지시계와 같은 20~80°C
    const list = ui.temps[arm];
    const now = Date.now();
    JOINTS.forEach((j) => {
      const s = a.sparkRefs[j];
      const pts = list.filter((p) => num(p.v[j])).map((p) => {
        const x = 300 - ((now - p.t) / TEMP_WINDOW) * 300;
        const y = 56 - ((Math.min(TEMP_SCALE[1], Math.max(TEMP_SCALE[0], p.v[j])) - TEMP_SCALE[0]) / (TEMP_SCALE[1] - TEMP_SCALE[0])) * 56;
        return x.toFixed(1) + ',' + y.toFixed(1);
      });
      s.line.setAttribute('points', pts.join(' '));
      const m = motors[j] || {};
      s.val.textContent = num(m.temp) ? m.temp.toFixed(1) + '°C' : '–';
      setLevel(s.val, tempLevel(m.temp));
    });
  }

  // ---------- 장치 탭 ----------

  function deviceDetail(id) {
    if (id === 'server') return cfg.useMock ? t('dbt.dev.mockServer') : cfg.apiBase;
    if (id === 'conveyor') return t('dbt.dev.conveyor');
    if (ARMS.includes(id)) {
      const spec = robot.arms && robot.arms[id];
      return spec ? t('dbt.dev.armDetail', { n: Object.keys(spec.motors || {}).length, v: spec.supply ? spec.supply.nominal : '–' }) : '–';
    }
    if (/^camera_/.test(id)) {
      const cam = id.slice(7);
      const info = ((store.state.info && store.state.info.cameras) || []).find((x) => x.id === cam) || {};
      const src = store.cameraSource(cam);
      const parts = [];
      if (TRANSPORT[src.transport]) parts.push(t(TRANSPORT[src.transport]));
      if (info.width && info.height) parts.push(info.width + '×' + info.height);
      parts.push(t(src.streaming ? 'dbt.cam.on' : 'dbt.cam.off'));
      return parts.join(', ');
    }
    return '–';
  }

  function renderDevicesPage() {
    const ids = deviceIds();
    el.dvRows.textContent = '';
    let connected = 0;
    ids.forEach((id) => {
      const state = deviceState(id);
      if (state === 'connected') connected += 1;
      const d = ui.dev[id];
      const tr = el.dvRows.insertRow();
      const name = document.createElement('th');
      name.scope = 'row';
      const wrap = document.createElement('span');
      wrap.className = 'devname';
      const lamp = document.createElement('span');
      lamp.className = 'lamp';
      lamp.dataset.color = state === 'connected' ? 'green' : 'off';
      const label = document.createElement('span');
      label.textContent = deviceName(id);
      wrap.append(lamp, label);
      name.appendChild(wrap);
      tr.appendChild(name);
      const st = tr.insertCell();
      st.textContent = t(state === 'connected' ? 'dbt.devices.connected' : state === 'unknown' ? 'dbt.dev.unknown' : 'devices.disconnected');
      if (state === 'disconnected') st.dataset.level = 'warning';
      const since = tr.insertCell();
      since.className = 'dim';
      since.textContent = d ? clock(d.since, true) : '–';
      const drops = tr.insertCell();
      drops.className = 'num';
      drops.textContent = d ? String(d.drops) : '–';
      const detail = tr.insertCell();
      detail.className = 'dim';
      detail.textContent = deviceDetail(id);
    });
    el.dvCount.textContent = t('dbt.devices.count', { total: ids.length, n: connected });
    renderDeviceLog();
  }

  function renderDeviceLog() {
    const list = ui.log.filter((e) => DEVICE_CODES.includes(e.code));
    el.dvLog.textContent = '';
    list.forEach((e) => logRow(el.dvLog, e, false));
    el.dvLogEmpty.hidden = list.length > 0;
  }

  // ---------- 경보 탭 ----------

  function renderAlarmsPage() {
    renderActive(el.alActive, el.alActiveEmpty, el.alActiveMeta);
    renderLog();
  }

  function renderLog() {
    const counts = { all: ui.log.length, alarm: 0, warning: 0, info: 0 };
    ui.log.forEach((e) => { counts[RANK[e.level] ? e.level : 'info'] += 1; });
    el.logFilter.querySelectorAll('[data-filter]').forEach((b) => {
      b.textContent = t('dbt.filter.' + b.dataset.filter, { n: counts[b.dataset.filter] });
      b.setAttribute('aria-pressed', String(b.dataset.filter === ui.filter));
    });
    const list = ui.log.filter((e) => ui.filter === 'all' || (RANK[e.level] ? e.level : 'info') === ui.filter);
    el.alLog.textContent = '';
    list.forEach((e) => logRow(el.alLog, e, true));
    el.alLogEmpty.hidden = list.length > 0;
    el.alLogEmpty.textContent = t(ui.log.length ? 'dbt.log.emptyFilter' : 'dbt.log.empty');
  }

  el.logFilter.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    ui.filter = b.dataset.filter;
    renderLog();
  }));

  // ---------- 시스템 탭 ----------

  function facts(dl, rows, skipEmpty) {
    dl.textContent = '';
    rows.forEach(([label, value, kind]) => {
      if (skipEmpty && (value === null || value === undefined || value === '')) return;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value === null || value === undefined || value === '' ? '–' : String(value);
      if (kind) dd.dataset.kind = kind;
      dl.append(dt, dd);
    });
  }

  const PUSH = { ws: 'WebSocket', socketio: 'Socket.IO', sse: 'SSE', poll: 'dbt.sys.poll' };

  // 지난 기록(GET /history)을 서버가 주는지 — 주지 않으면 이 화면을 연 뒤 받은 것만 보인다
  function historyText() {
    const h = store.state.history;
    if (h.supported === true) return t('dbt.sys.historyOn', { n: h.restored });
    if (h.supported === false) return t('dbt.sys.historyOff');
    return t('dbt.sys.historyUnknown');
  }

  function renderSystem() {
    const push = cfg.server.push;
    const pushLabel = PUSH[push] && PUSH[push].startsWith('dbt.') ? t(PUSH[push]) : PUSH[push] || push;
    const pushUrl = push === 'sse' ? cfg.server.sseUrl : push === 'poll' ? cfg.apiBase : cfg.wsUrl;
    facts($('sy-conn'), [
      [t('dbt.sys.server'), t(cfg.useMock ? 'dbt.dev.mockServer' : 'dbt.sys.realServer')],
      [t('dbt.sys.state'), t(online() ? 'dbt.devices.connected' : 'devices.disconnected'), online() ? null : 'note'],
      [t('dbt.sys.api'), cfg.useMock ? t('dbt.sys.unused') : cfg.apiBase],
      [t('dbt.sys.push'), cfg.useMock ? t('dbt.sys.unused') : pushLabel + ', ' + pushUrl],
      [t('dbt.sys.commands'), cfg.useMock ? t('dbt.sys.unused') : t(cfg.server.commands === 'ws' ? 'dbt.sys.cmdWs' : 'dbt.sys.cmdHttp')],
      [t('dbt.sys.lastMessage'), store.state.lastMessageAt ? clock(store.state.lastMessageAt, true) : null],
      [t('dbt.sys.timeout'), t('dbt.sys.timeoutValue', { s: cfg.heartbeatTimeoutMs / 1000 })],
      [t('dbt.sys.history'), historyText()],
    ]);

    const info = store.state.info;
    if (!info) {
      facts($('sy-info'), [[t('dbt.sys.info'), t('dbt.sys.noInfo')]]);
    } else {
      const server = info.server || {};
      facts($('sy-info'), [
        [t('dbt.sys.name'), server.name],
        [t('dbt.sys.version'), server.version],
        [t('dbt.sys.apiVersion'), info.api],
        [t('dbt.sys.jointUnit'), info.jointUnit ? t('dbt.unit.' + info.jointUnit) : null],
        [t('dbt.sys.cameras'), info.cameras.length ? info.cameras.map((c) => store.cameraName(c.id)).join(', ') : null],
        [t('dbt.sys.features'), info.features.length ? info.features.join(', ') : null],
      ], true);
    }

    const m = store.state.metrics;
    $('sy-perf-meta').textContent = m && m.receivedAt ? t('dbt.servo.meta', { time: clock(m.receivedAt, true) }) : '';
    const perf = [
      [t('db.latency'), m && num(m.inferenceMs) ? m.inferenceMs.toFixed(1) + 'ms' : null],
      [t('dbt.sys.cpu'), m && num(m.cpu) ? Math.round(m.cpu) + '%' : null],
      [t('dbt.sys.gpu'), m && num(m.gpu) ? Math.round(m.gpu) + '%' : null],
      [t('dbt.sys.queue'), m && num(m.queue) ? t('db.unit.count', { n: m.queue }) : null],
      [t('dbt.sys.cycle'), m && num(m.cycleMs) ? m.cycleMs + 'ms' : null],
    ];
    if (perf.some((r) => r[1] !== null)) facts($('sy-perf'), perf, true);
    else facts($('sy-perf'), [[t('dbt.sys.perf'), t('dbt.sys.noPerf')]]);

    const sa = supplyCfg('arm');
    const sl = supplyCfg('leader');
    facts($('sy-limits'), [
      [t('dbt.sys.tempWarn'), LIMITS.tempWarn + '°C'],
      [t('dbt.sys.tempAlarm'), LIMITS.tempAlarm + '°C'],
      [t('dbt.sys.tempServo'), LIMITS.tempServo + '°C'],
      [t('dbt.sys.loadWarn'), LIMITS.loadWarn + '%'],
      [t('dbt.sys.supplyArm'), sa ? sa.warnLow + '–' + sa.warnHigh + 'V' : null],
      [t('dbt.sys.supplyLeader'), sl ? sl.warnLow + '–' + sl.warnHigh + 'V' : null],
    ]);

    const homeRows = [];
    if (homeCfg) {
      const unit = homeCfg.unit === 'norm' ? '' : '°';
      (homeCfg.joints || []).forEach((j) => homeRows.push([store.jointName(j.id), j.angle + (j.id === 'gripper' ? '%' : unit)]));
      homeRows.push([t('dbt.sys.homeState'), t(homeCfg.provisional ? 'dbt.sys.provisional' : 'dbt.sys.set'), homeCfg.provisional ? 'note' : null]);
    } else homeRows.push([t('home.label'), t('dbt.sys.noHome'), 'note']);
    facts($('sy-home'), homeRows);

    const themeSet = document.documentElement.dataset.theme;
    facts($('sy-screen'), [
      [t('dbt.sys.theme'), t(themeSet ? 'dbt.sys.theme.' + themeSet : 'dbt.sys.theme.auto')],
      [t('dbt.sys.devMode'), t(cfg.devMode ? 'dbt.servo.on' : 'dbt.servo.off')],
      [t('dbt.sys.locale'), t('dbt.sys.locale.' + cfg.locale)],
      [t('dbt.sys.camTransport'), cfg.cameras.transport === 'auto' ? t('dbt.sys.auto') : cfg.cameras.transport],
      [t('dbt.sys.logLimit'), t('dbt.count', { n: LOG_KEEP })],
    ]);
  }

  // ---------- 조작 ----------

  el.estop.addEventListener('click', () => {
    if (S() && S().estop) return;
    // 긴급정지는 다른 요청을 기다리지 않고 바로 보낸다 (조작 화면과 같다)
    api.estop()
      .then(() => { ui.estopError = null; renderBanner(); })
      .catch((err) => { ui.estopError = store.errorText(err); renderBanner(); });
  });

  // 테마 — 조작 화면과 같은 저장값(hmi.theme)을 쓴다
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const themeKeys = Array.from(document.querySelectorAll('[data-theme-toggle]'));
  const isDark = () => { const c = document.documentElement.dataset.theme; return c ? c === 'dark' : darkQuery.matches; };
  const renderTheme = () => themeKeys.forEach((k) => k.setAttribute('aria-pressed', String(isDark())));
  themeKeys.forEach((key) => key.addEventListener('click', () => {
    const root = document.documentElement;
    const next = isDark() ? 'light' : 'dark';
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    void root.offsetHeight;
    root.classList.remove('theme-switching');
    try { localStorage.setItem('hmi.theme', next); } catch (e) { /* 이번 화면에서만 바뀐다 */ }
    sim.readTheme();
    sim.draw();
    renderTheme();
    if (ui.tab === 'system') renderSystem();
  }));
  darkQuery.addEventListener('change', renderTheme);

  // 개발용: 가짜 서버에 서보 과열 · 리더 12V · 판정 지연을 흉내 낸다
  el.sim.hidden = !(cfg.devMode && api.mock);
  el.simKeys.forEach((key) => key.addEventListener('click', () => {
    const on = key.getAttribute('aria-pressed') !== 'true';
    key.setAttribute('aria-pressed', String(on));
    api.mock.simulate(key.dataset.sim, on);
  }));

  // ?dev=0, ?theme= 같은 주소 설정을 그대로 넘긴다
  document.querySelectorAll('[data-operator-link]').forEach((a) => { a.href = 'index.html' + location.search; });

  // 가동 시간·분당 처리·시각은 시간이 흐르면 바뀐다
  let lastMinute = Math.floor(Date.now() / 60000);
  function everySecond() {
    el.clock.textContent = clock(Date.now(), true);
    renderBanner();
    renderTally();
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== lastMinute || ['production', 'devices', 'system'].includes(ui.tab)) {
      lastMinute = minute;
      renderPage();
    } else if (ui.tab === 'overview') renderFlow();
  }
  setInterval(everySecond, 1000);
  ['arm', 'leader'].forEach((arm) => new ResizeObserver(() => { if (ui.tab === arm) renderArmPage(arm); }).observe(el.pages[arm]));
  new ResizeObserver(() => { if (ui.tab === 'production') renderRateChart(); if (ui.tab === 'inspection') renderLatency(); }).observe(el.canvas);

  window.I18N.apply();
  ARMS.forEach(buildArmPage);
  ctl.render(); // 서버에 닿기 전에도 조작 단추가 지금 상태(연결 중)대로 보이게
  renderTheme();
  selectTab(location.hash.slice(1) || 'overview');
  refresh();
  everySecond();
  store.start();
})();
