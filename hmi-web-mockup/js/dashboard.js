// 대시보드 — 라인이 지금 괜찮은지, 잘 고르고 있는지를 한눈에 보면서 조작 화면과 같은 기능도 쓰는 화면입니다.
// 조작(시작/정지·긴급정지 해제·원점·운전 모드·카메라·프로그램 종료)은 js/controls.js가 조작 화면과 같은 규칙으로 보냅니다.
// 서버 연결과 상태 모으기는 store.js, 영상은 camera.js가 맡습니다 (조작 화면과 같다).
(function () {
  const cfg = window.HMI_CONFIG;
  const robot = window.HMI_ROBOT || {};
  const api = window.HmiApi;
  const store = window.HmiStore;
  const ctl = window.HmiControls;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';

  const LAMP = { running: 'green', estop: 'red', connecting: 'amber', starting: 'amber', stopping: 'amber', homing: 'amber', shutdown: 'amber', unknown: 'amber' };
  const BLINKING = ['connecting', 'starting', 'stopping', 'homing', 'shutdown'];
  const NOTIFY_SKIP = ['defect_detected']; // 불량 검출은 정상 공정이라 경보 목록에 넣지 않는다 (조작 화면 알림 점과 같은 기준)
  const ALARM_KEEP = 4; // 1440×900에서 스크롤 없이 들어가는 만큼 (윗판 2단 조작 줄 포함, 지난 기록 전체는 조작 화면의 로그 창)
  const RECENT_ROWS = 4;
  const TREND_MINUTES = 30;
  const JOINTS = robot.joints || ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  const ARMS = ['arm', 'leader'];
  const LIMITS = Object.assign({ tempWarn: 55, tempAlarm: 65, loadWarn: 80 }, robot.limits);
  const TEMP_SCALE = [20, 80]; // °C
  const SUPPLY_SCALE = [0, 16]; // V — 두 팔을 같은 눈금으로: 리더에 12V가 들어오면 띠 밖으로 크게 벗어난다

  const el = {
    lamp: $('state-lamp'), word: $('state-word'), detail: $('state-detail'),
    estop: $('btn-estop'), estopLabel: $('estop-label'),
    total: $('t-total'), good: $('t-good'), defect: $('t-defect'), rate: $('t-rate'), pace: $('t-pace'), latency: $('t-latency'),
    cams: $('cams'), arms: $('arms'),
    trendPlot: $('trend-plot'), trendSvg: $('trend-svg'), trendTip: $('trend-tip'), trendRows: $('trend-rows'),
    recentBody: $('recent-body'), recentEmpty: $('recent-empty'),
    alarmList: $('alarm-list'), alarmEmpty: $('alarm-empty'),
    deviceList: $('device-list'), sim: $('sim'), simKeys: Array.from(document.querySelectorAll('[data-sim]')),
    themeBtn: $('btn-theme'), operatorLink: $('link-operator'),
  };

  const ui = { runSince: null, connectedOnce: false, estopError: null, alarms: [], camSig: null, cams: {}, arms: {}, devSig: '', hover: null, trend: [] };
  const sim = new window.CameraSim({ good: t('result.good'), defect: t('result.defect') });

  const S = () => store.state.status;
  const online = () => store.state.online;

  // ---------- 서버 메시지 ----------

  store.subscribe((kind, data) => {
    switch (kind) {
      case 'online':
        if (!data && ui.connectedOnce) pushAlarm({ code: 'server_lost', level: 'warning', at: new Date().toISOString() });
        if (data) ui.connectedOnce = true;
        ui.staleSince = data ? null : Date.now();
        render();
        break;
      case 'status':
        trackRun();
        render();
        break;
      case 'info':
        render();
        break;
      case 'inspection':
        if (cfg.useMock) sim.mark(data.result);
        Object.values(ui.cams).forEach((c) => c.view.showInspection(data));
        renderTally();
        renderRecent();
        renderTrend();
        break;
      case 'event':
        if (['warning', 'alarm'].includes(data.level) && !NOTIFY_SKIP.includes(data.code)) pushAlarm(data);
        break;
      case 'telemetry':
        renderArm(data.arm);
        break;
      case 'metrics':
        renderTally();
        renderCamFps();
        break;
      case 'frame':
        Object.values(ui.cams).forEach((c) => c.view.pushFrame(data));
        break;
      default:
        break;
    }
  });

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

  ctl.onRender(() => renderRail()); // 조작이 실패하거나 풀리면 윗판 안내를 바로 바꾼다

  // ---------- 그리기 ----------

  function render() {
    renderRail();
    renderTally();
    renderCams();
    renderArms();
    renderRecent();
    renderAlarms();
    renderDevices();
  }

  function renderRail() {
    const p = phase();
    document.body.dataset.phase = p;
    const st = S();
    const fault = p === 'stopped' && st.fault;
    el.word.textContent = t('state.' + p);
    let detail;
    let error = false;
    if (ui.estopError) { detail = ui.estopError; error = true; }
    else if (p === 'offline') {
      // 끊긴 동안 값이 멈춰 있다는 것은 흐리게 하지 않고 글로 알린다 (흐리면 글자 대비가 떨어진다)
      detail = t(robot.hardwareStop === 'button' ? 'estop.offline.button' : 'estop.offline.dc');
      if (ui.staleSince) detail += ' ' + t('db.detail.stale', { time: clock(ui.staleSince, true) });
      error = true;
    }
    else if (fault) { detail = t('detail.fault', { fault: store.faultText(st.fault) }); error = true; }
    else if (p === 'running') detail = t('db.detail.running', { mode: modeWord(), duration: duration() });
    else if (p === 'stopped') detail = t('db.detail.stopped', { mode: modeWord() });
    else if (p === 'estop') detail = t('db.detail.estop');
    else if (p === 'unknown') detail = t('detail.unknown', { state: st.lineRaw });
    else detail = t('detail.' + p);
    el.detail.textContent = detail;
    if (error) el.detail.dataset.kind = 'error';
    else delete el.detail.dataset.kind;
    el.lamp.dataset.color = fault ? 'amber' : LAMP[p] || 'off';
    el.lamp.dataset.blink = String(BLINKING.includes(p));
    el.estop.disabled = ['connecting', 'offline', 'shutdown'].includes(p);
    el.estop.setAttribute('aria-pressed', String(p === 'estop'));
    el.estopLabel.textContent = t(p === 'estop' ? 'estop.latched' : 'estop.press');
  }

  function renderTally() {
    const st = (S() && S().stats) || { total: 0, good: 0, defect: 0 };
    el.total.textContent = st.total.toLocaleString();
    el.good.textContent = st.good.toLocaleString();
    el.defect.textContent = st.defect.toLocaleString();
    el.rate.textContent = (st.total ? (st.defect / st.total) * 100 : 0).toFixed(1) + '%';
    // 분당 처리: 최근 60초 동안 받은 판정 수
    const list = store.state.inspections;
    const now = Date.now();
    el.pace.textContent = list.length ? t('db.unit.count', { n: list.filter((i) => now - i.receivedAt <= 60000).length }) : '–';
    // 판정 시간: 서버 성능 값(metrics), 없으면 최근 판정 10개의 평균
    const m = store.state.metrics;
    let ms = m && typeof m.inferenceMs === 'number' ? m.inferenceMs : null;
    if (ms === null) {
      const xs = list.slice(0, 10).map((i) => i.latencyMs).filter((v) => typeof v === 'number');
      if (xs.length) ms = xs.reduce((a, b) => a + b, 0) / xs.length;
    }
    el.latency.textContent = ms === null ? '–' : Math.round(ms) + 'ms';
  }

  // ---------- 카메라 ----------

  function renderCams() {
    const ids = store.cameraIds();
    if (ids.join() !== ui.camSig) buildCams(ids);
    ids.forEach((id) => {
      const c = ui.cams[id];
      const src = S() && online() ? store.cameraSource(id) : null;
      const streaming = !!(src && src.streaming);
      const lost = !!S() && S().devices['camera_' + id] === 'disconnected';
      c.empty.hidden = streaming;
      c.emptyTitle.textContent = t(lost ? 'db.camera.lost' : 'db.camera.off');
      c.emptyHint.hidden = lost;
      c.view.set(streaming && !ctl.ended ? src : null);
    });
    sim.setBelt(!!S() && S().line === 'running');
    renderCamFps();
  }

  function buildCams(ids) {
    Object.values(ui.cams).forEach((c) => c.view.destroy());
    ui.cams = {};
    el.cams.textContent = '';
    el.cams.style.setProperty('--cam-cols', String(Math.max(2, Math.min(3, ids.length))));
    ids.forEach((id, i) => {
      const fig = document.createElement('figure');
      fig.className = 'cam';
      const head = document.createElement('figcaption');
      head.className = 'cam__head';
      const name = document.createElement('span');
      name.className = 'sec__title';
      name.textContent = store.cameraName(id);
      const fps = document.createElement('span');
      fps.className = 'cam__fps';
      head.append(name, fps);
      const screen = document.createElement('div');
      screen.className = 'cam__screen';
      const stage = document.createElement('div');
      stage.className = 'camera__stage';
      const empty = document.createElement('div');
      empty.className = 'cam__empty';
      const emptyTitle = document.createElement('p');
      // 꺼져 있으면 이 카메라만 연결
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
      fig.append(head, screen);
      el.cams.appendChild(fig);
      // 가짜 영상에서 두 번째 카메라는 검사선 근처를 크게 보여 준다 (근접 카메라)
      const zoom = cfg.useMock && i > 0 ? 2.2 : 1;
      ui.cams[id] = { view: new window.CameraView(stage, { sim, zoom }), empty, emptyTitle, emptyHint, fps };
    });
    ui.camSig = ids.join();
    ctl.render();
  }

  function renderCamFps() {
    const fpsMap = (store.state.metrics && store.state.metrics.fps) || {};
    Object.entries(ui.cams).forEach(([id, c]) => {
      const live = c.view.state === 'live';
      const fps = typeof fpsMap[id] === 'number' ? fpsMap[id] : c.view.fps();
      c.fps.textContent = live && fps ? fps.toFixed(1) + 'fps' : '';
    });
  }

  // ---------- 로봇팔: ISA-101 아날로그 지시계 ----------

  const pct = (v, [lo, hi]) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) + '%';

  function meter(kind) {
    const m = document.createElement('span');
    m.className = 'meter meter--' + kind;
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

  // 지시계는 정상 범위가 있는 값(온도)에만 둔다 — 위치는 정상 범위가 없어 숫자만
  function cell(meterEl) {
    const td = document.createElement('td');
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = '–';
    if (!meterEl) {
      td.className = 'num';
      td.appendChild(val);
      return { td, meter: null, val };
    }
    const wrap = document.createElement('span');
    wrap.className = 'servo__cell';
    wrap.append(meterEl, val);
    td.appendChild(wrap);
    return { td, meter: meterEl, val };
  }

  function buildArms() {
    ARMS.forEach((id) => {
      const sec = document.createElement('section');
      sec.className = 'arm';
      sec.setAttribute('aria-labelledby', 'arm-title-' + id);
      const head = document.createElement('div');
      head.className = 'arm__head';
      const title = document.createElement('h2');
      title.className = 'sec__title';
      title.id = 'arm-title-' + id;
      title.textContent = store.armName(id);
      const sup = (robot.arms && robot.arms[id] && robot.arms[id].supply) || null;
      const supplyMeter = meter('supply');
      if (sup) {
        supplyMeter.style.setProperty('--lo', pct(sup.warnLow, SUPPLY_SCALE));
        supplyMeter.style.setProperty('--hi', pct(sup.warnHigh, SUPPLY_SCALE));
      }
      const supply = document.createElement('p');
      supply.className = 'arm__supply';
      const supplyVal = document.createElement('b');
      supplyVal.textContent = '–';
      supply.append(t('db.arm.supply') + ' ', supplyVal);
      head.append(title, supplyMeter, supply);

      const table = document.createElement('table');
      table.className = 'grid-table servo';
      const thead = table.createTHead().insertRow();
      [['db.servo.joint', ''], ['db.servo.pos', 'num'], ['db.servo.temp', ''], ['db.servo.load', 'num']].forEach(([key, cls]) => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = t(key);
        if (cls) th.className = cls;
        thead.appendChild(th);
      });
      const tbody = table.createTBody();
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
        const pos = cell(null);
        const temp = cell(meter('temp'));
        temp.meter.style.setProperty('--lo', '0%');
        temp.meter.style.setProperty('--hi', pct(LIMITS.tempWarn, TEMP_SCALE));
        tick(temp.meter, pct(LIMITS.tempWarn, TEMP_SCALE));
        tick(temp.meter, pct(LIMITS.tempAlarm, TEMP_SCALE));
        const load = document.createElement('td');
        load.className = 'num';
        load.textContent = '–';
        tr.append(name, pos.td, temp.td, load);
        rows[j] = { tr, flag, pos, temp, load };
      });
      sec.append(head, table);
      el.arms.appendChild(sec);
      ui.arms[id] = { supplyMeter, supply, supplyVal, rows, sup };
    });
  }

  function setMeter(m, v, scale, level) {
    if (typeof v !== 'number') { m.dataset.empty = 'true'; delete m.dataset.level; return; }
    m.dataset.empty = 'false';
    m.style.setProperty('--v', pct(v, scale));
    if (level) m.dataset.level = level;
    else delete m.dataset.level;
  }

  function setLevel(node, level) {
    if (level) node.dataset.level = level;
    else delete node.dataset.level;
  }

  function tempLevel(v) {
    if (typeof v !== 'number') return null;
    return v >= LIMITS.tempAlarm ? 'alarm' : v >= LIMITS.tempWarn ? 'warning' : null;
  }

  function supplyLevel(v, sup) {
    if (typeof v !== 'number' || !sup) return null;
    if ((sup.wrongAbove !== undefined && v > sup.wrongAbove) || (sup.wrongBelow !== undefined && v < sup.wrongBelow)) return 'alarm';
    return v < sup.warnLow || v > sup.warnHigh ? 'warning' : null;
  }

  function renderArms() { ARMS.forEach(renderArm); }

  function renderArm(id) {
    const a = ui.arms[id];
    if (!a) return;
    const connected = !!S() && online() && S().devices[id] !== 'disconnected';
    const tel = connected ? store.state.telemetry[id] : null;
    const motors = (tel && tel.motors) || {};
    const volts = Object.values(motors).map((m) => m.volt).filter((v) => typeof v === 'number').sort((x, y) => x - y);
    const volt = volts.length ? volts[Math.floor(volts.length / 2)] : null;
    const vLevel = supplyLevel(volt, a.sup);
    a.supplyVal.textContent = volt === null ? '–' : volt.toFixed(1) + 'V';
    setLevel(a.supply, vLevel);
    setMeter(a.supplyMeter, volt === null ? undefined : volt, SUPPLY_SCALE, vLevel);
    JOINTS.forEach((j) => {
      const r = a.rows[j];
      const m = motors[j] || {};
      const unit = m.posUnit || (j === 'gripper' ? 'pct' : 'deg');
      r.pos.val.textContent = typeof m.pos === 'number' ? Math.round(m.pos) + (unit === 'pct' ? '%' : '°') : '–';
      const tl = tempLevel(m.temp);
      r.temp.val.textContent = typeof m.temp === 'number' ? Math.round(m.temp) + '°C' : '–';
      setLevel(r.temp.val, tl);
      setMeter(r.temp.meter, m.temp, TEMP_SCALE, tl);
      const load = typeof m.load === 'number' ? Math.abs(m.load) : null;
      const ll = load !== null && load >= LIMITS.loadWarn ? 'warning' : null;
      r.load.textContent = load === null ? '–' : Math.round(load) + '%';
      setLevel(r.load, ll);
      // 색만으로 알리지 않도록 관절 이름 옆에 글자로도 쓴다 (서보 자체 이상 비트도 비상)
      const faulty = (m.faults || []).some((f) => ['sensor', 'current', 'overload'].includes(f));
      const level = faulty || tl === 'alarm' ? 'alarm' : tl || ll;
      r.flag.textContent = level ? t('db.level.' + level) : '';
      setLevel(r.flag, level);
    });
  }

  // ---------- 최근 판정 ----------

  function clock(ms, withSeconds) {
    const d = new Date(ms);
    const parts = [d.getHours(), d.getMinutes()].concat(withSeconds ? [d.getSeconds()] : []);
    return parts.map((n) => String(n).padStart(2, '0')).join(':');
  }

  function renderRecent() {
    const list = store.state.inspections.slice(0, RECENT_ROWS);
    el.recentEmpty.hidden = list.length > 0;
    el.recentBody.textContent = '';
    list.forEach((it) => {
      const tr = el.recentBody.insertRow();
      const cells = [
        it.id !== undefined ? '#' + it.id : '–',
        clock(it.at ? Date.parse(it.at) : it.receivedAt, true),
        it.result ? t('result.' + it.result) : '–',
        typeof it.confidence === 'number' ? Math.round(it.confidence * 100) + '%' : '–',
        typeof it.latencyMs === 'number' ? Math.round(it.latencyMs) + 'ms' : '–',
      ];
      cells.forEach((text, i) => {
        const td = tr.insertCell();
        td.textContent = text;
        if (i >= 3) td.className = 'num';
        if (i === 2 && it.result === 'defect') td.className = 'is-defect';
      });
    });
  }

  // ---------- 최근 경보 ----------

  function pushAlarm(evt) {
    ui.alarms.unshift({ at: evt.at ? Date.parse(evt.at) : Date.now(), level: evt.level, text: store.eventText(evt) });
    if (ui.alarms.length > ALARM_KEEP) ui.alarms.pop();
    renderAlarms();
  }

  function renderAlarms() {
    el.alarmEmpty.hidden = ui.alarms.length > 0;
    el.alarmList.textContent = '';
    ui.alarms.forEach((a) => {
      const li = document.createElement('li');
      li.dataset.level = a.level;
      const time = document.createElement('time');
      time.className = 'alarm__time';
      time.dateTime = new Date(a.at).toISOString();
      time.textContent = clock(a.at, true);
      const level = document.createElement('span');
      level.className = 'alarm__level';
      level.textContent = t('db.level.' + a.level);
      const msg = document.createElement('span');
      msg.className = 'alarm__msg';
      msg.textContent = a.text;
      li.append(time, level, msg);
      el.alarmList.appendChild(li);
    });
  }

  // ---------- 장치 ----------

  function deviceIds() {
    const ids = Object.keys((S() && S().devices) || {});
    const first = ['conveyor', 'arm', 'leader'].filter((d) => ids.includes(d))
      .concat(store.cameraIds().map((c) => 'camera_' + c).filter((d) => ids.includes(d)));
    return ['server'].concat(first, ids.filter((d) => !first.includes(d)).sort());
  }

  function renderDevices() {
    const ids = deviceIds();
    if (ids.join() !== ui.devSig) {
      el.deviceList.textContent = '';
      ui.devices = {};
      ids.forEach((id) => {
        const li = document.createElement('li');
        const lamp = document.createElement('span');
        lamp.className = 'lamp';
        const name = document.createElement('span');
        name.textContent = id === 'server' ? t('device.server') : store.deviceName(id);
        const state = document.createElement('span');
        state.className = 'devlist__state';
        state.textContent = t('devices.disconnected');
        li.append(lamp, name, state);
        el.deviceList.appendChild(li);
        ui.devices[id] = { li, lamp, state };
      });
      ui.devSig = ids.join();
    }
    ids.forEach((id) => {
      const d = ui.devices[id];
      const connected = id === 'server' ? online() : !!(S() && online() && S().devices[id] === 'connected');
      d.lamp.dataset.color = connected ? 'green' : 'off';
      d.li.dataset.state = connected ? 'connected' : 'disconnected';
      d.state.hidden = connected; // 색만으로 알리지 않도록 끊김은 글자로도 쓴다
    });
  }

  // ---------- 분당 판정 ----------

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 위쪽 모서리만 4px 둥글게, 바닥은 직각 (막대는 바닥선에서 자란다)
  function barPath(x, y, w, h, round) {
    const r = round ? Math.min(4, h, w / 2) : 0;
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // 눈금 위쪽 끝: 4 · 10 · 20 · 40 · 100 … — 절반 눈금도 늘 정수가 되게
  function niceMax(v) {
    if (v <= 4) return 4;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : 10) * p;
  }

  function trendData() {
    const now = Math.floor(Date.now() / 60000) * 60000;
    const byMinute = new Map(store.state.minutes.map((m) => [m.t, m]));
    const out = [];
    for (let i = TREND_MINUTES - 1; i >= 0; i -= 1) {
      const minute = now - i * 60000;
      const m = byMinute.get(minute);
      out.push({ t: minute, good: m ? m.good : 0, defect: m ? m.defect : 0 });
    }
    return out;
  }

  function renderTrend() {
    const box = el.trendPlot.getBoundingClientRect();
    const W = box.width;
    const H = box.height;
    if (!W || !H) return;
    const data = trendData();
    ui.trend = data;
    const M = { l: 36, r: 2, t: 6, b: 26 };
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const max = niceMax(Math.max(1, ...data.map((d) => d.good + d.defect)));
    const slot = pw / data.length;
    const bw = Math.max(2, Math.min(24, slot - 4));
    const y = (v) => M.t + ph - (v / max) * ph;
    const svg = el.trendSvg;
    svg.textContent = '';
    if (ui.hover !== null) svg.appendChild(svgEl('rect', { class: 'trend__hover', x: M.l + ui.hover * slot, y: M.t, width: slot, height: ph }));
    [max, max / 2].forEach((v) => {
      svg.appendChild(svgEl('line', { class: 'trend__grid', x1: M.l, x2: W - M.r, y1: Math.round(y(v)) + 0.5, y2: Math.round(y(v)) + 0.5 }));
    });
    [0, max / 2, max].forEach((v) => {
      svg.appendChild(svgEl('text', { x: M.l - 8, y: y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, String(v)));
    });
    const base = M.t + ph;
    data.forEach((d, i) => {
      const x = M.l + i * slot + (slot - bw) / 2;
      const hg = (d.good / max) * ph;
      const hd = (d.defect / max) * ph;
      if (d.good) svg.appendChild(svgEl('path', { class: 'trend__good', d: barPath(x, base - hg, bw, hg, !d.defect) }));
      // 겹쳐 쌓을 때는 바탕색 2px 틈으로 나눈다 (테두리를 긋지 않는다)
      if (d.defect) svg.appendChild(svgEl('path', { class: 'trend__defect', d: barPath(x, base - hg - (d.good ? 2 : 0) - hd, bw, hd, true) }));
    });
    svg.appendChild(svgEl('line', { class: 'trend__base', x1: M.l, x2: W - M.r, y1: Math.round(base) + 0.5, y2: Math.round(base) + 0.5 }));
    [[TREND_MINUTES - 21, t('db.trend.ago', { n: 20 })], [TREND_MINUTES - 11, t('db.trend.ago', { n: 10 })], [TREND_MINUTES - 1, t('db.trend.now')]].forEach(([i, label]) => {
      const last = i === TREND_MINUTES - 1;
      svg.appendChild(svgEl('text', { x: last ? W - M.r : M.l + i * slot + slot / 2, y: H - 4, 'text-anchor': last ? 'end' : 'middle' }, label));
    });
    renderTrendTable(data);
    if (ui.hover !== null) showTip(ui.hover, slot, M);
  }

  function renderTrendTable(data) {
    el.trendRows.textContent = '';
    data.forEach((d) => {
      const tr = el.trendRows.insertRow();
      [clock(d.t, false), String(d.good), String(d.defect)].forEach((text) => { tr.insertCell().textContent = text; });
    });
  }

  function showTip(i, slot, M) {
    const d = ui.trend[i];
    if (!d) return;
    const tip = el.trendTip;
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
    const rb = document.createElement('b');
    rb.textContent = total ? ((d.defect / total) * 100).toFixed(1) + '%' : '–';
    const rl = document.createElement('span');
    rl.textContent = t('db.trend.rate');
    rate.append(document.createElement('span'), rb, rl);
    rate.firstChild.className = 'tip__key';
    tip.appendChild(rate);
    tip.hidden = false;
    // 막대 옆에 띄우되 그림 밖으로 나가지 않게
    const W = el.trendPlot.clientWidth;
    const x = M.l + i * slot + slot / 2;
    const left = x + 12 + tip.offsetWidth > W ? x - 12 - tip.offsetWidth : x + 12;
    tip.style.left = Math.max(0, left) + 'px';
  }

  function setHover(i) {
    ui.hover = i;
    if (i === null) el.trendTip.hidden = true;
    renderTrend();
  }

  function slotAt(clientX) {
    const r = el.trendPlot.getBoundingClientRect();
    const slot = (r.width - 38) / TREND_MINUTES;
    const i = Math.floor((clientX - r.left - 36) / slot);
    return Math.min(TREND_MINUTES - 1, Math.max(0, i));
  }

  el.trendPlot.addEventListener('pointermove', (e) => { const i = slotAt(e.clientX); if (i !== ui.hover) setHover(i); });
  el.trendPlot.addEventListener('pointerleave', () => { if (document.activeElement !== el.trendPlot) setHover(null); });
  el.trendPlot.addEventListener('focus', () => setHover(TREND_MINUTES - 1));
  el.trendPlot.addEventListener('blur', () => setHover(null));
  el.trendPlot.addEventListener('keydown', (e) => {
    const cur = ui.hover === null ? TREND_MINUTES - 1 : ui.hover;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: TREND_MINUTES - 1 }[e.key];
    if (e.key === 'Escape') { setHover(null); return; }
    if (next === undefined) return;
    e.preventDefault();
    setHover(Math.min(TREND_MINUTES - 1, Math.max(0, next)));
  });
  new ResizeObserver(() => renderTrend()).observe(el.trendPlot);

  // ---------- 조작 ----------

  el.estop.addEventListener('click', () => {
    if (S() && S().estop) return;
    // 긴급정지는 다른 요청을 기다리지 않고 바로 보낸다 (조작 화면과 같다)
    api.estop()
      .then(() => { ui.estopError = null; renderRail(); })
      .catch((err) => { ui.estopError = store.errorText(err); renderRail(); });
  });

  // 테마 — 조작 화면과 같은 저장값(hmi.theme)을 쓴다
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => { const c = document.documentElement.dataset.theme; return c ? c === 'dark' : darkQuery.matches; };
  const renderTheme = () => el.themeBtn.setAttribute('aria-pressed', String(isDark()));
  el.themeBtn.addEventListener('click', () => {
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
  });
  darkQuery.addEventListener('change', renderTheme);

  // 개발용: 가짜 서버에 서보 과열 · 리더 12V · 판정 지연을 흉내 낸다
  el.sim.hidden = !(cfg.devMode && api.mock);
  el.simKeys.forEach((key) => key.addEventListener('click', () => {
    const on = key.getAttribute('aria-pressed') !== 'true';
    key.setAttribute('aria-pressed', String(on));
    api.mock.simulate(key.dataset.sim, on);
  }));

  el.operatorLink.href = 'index.html' + location.search; // ?dev=0, ?theme= 같은 주소 설정을 그대로 넘긴다

  // 가동 시간·분당 처리는 시간이 흐르면 바뀐다
  let lastMinute = 0;
  setInterval(() => {
    renderRail();
    renderTally();
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== lastMinute) { lastMinute = minute; renderTrend(); }
  }, 1000);

  window.I18N.apply();
  buildArms();
  ctl.render(); // 서버에 닿기 전에도 조작 단추가 지금 상태(연결 중)대로 보이게
  renderTheme();
  render();
  renderTrend();
  store.start();
})();
