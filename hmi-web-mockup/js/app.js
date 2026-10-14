// 조작 화면 — 서버 상태를 받아 그리고, 버튼 누름을 서버 명령으로 바꿉니다.
// 서버 연결과 상태 모으기는 store.js, 영상은 camera.js가 맡습니다.
(function () {
  const cfg = window.HMI_CONFIG;
  const robot = window.HMI_ROBOT || {};
  const JOINTS = robot.joints || ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
  const api = window.HmiApi;
  const store = window.HmiStore;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);

  const DEVICE_ORDER = ['conveyor', 'arm', 'leader'];
  const LAMP = { running: 'green', estop: 'red', connecting: 'amber', starting: 'amber', stopping: 'amber', homing: 'amber', shutdown: 'amber', unknown: 'amber' };
  const BLINKING = ['connecting', 'starting', 'stopping', 'homing', 'shutdown'];
  // 로그 버튼의 빨간 점을 켜는 기록. 불량 검출은 정상 공정에서 늘 생기는 일이라 통계로 보고 점은 켜지 않는다
  const NOTIFY_LEVELS = ['warning', 'alarm'];
  const NOTIFY_SKIP = ['defect_detected'];

  const el = {
    stateLamp: $('state-lamp'), stateWord: $('state-word'), stateDetail: $('state-detail'),
    estop: $('btn-estop'), estopLabel: $('estop-label'), estopNote: $('estop-note'), release: $('btn-release'),
    run: $('btn-run'), runIcon: $('run-icon'), runLabel: $('run-label'), runNote: $('run-note'),
    home: $('btn-home'), setHome: $('btn-sethome'), homeNote: $('home-note'),
    modeKeys: Array.from(document.querySelectorAll('.key--mode')), modeNote: $('mode-note'),
    joints: $('joints'), jointsList: $('joints-list'),
    exit: $('btn-exit'), exitNote: $('exit-note'),
    cameraStage: $('camera-stage'), cameraEmpty: $('camera-empty'),
    camera: $('btn-camera'), cameraLabel: $('camera-btn-label'), cameraNote: $('camera-note'), cameraOff: $('btn-camera-off'),
    total: $('stat-total'), good: $('stat-good'), defect: $('stat-defect'), rate: $('stat-rate'),
    logBtn: $('btn-log'), logWin: $('logwin'), logClose: $('btn-log-close'), logList: $('log-list'), logEmpty: $('log-empty'),
    logDot: $('log-dot'), logDotText: $('log-dot-text'), themeBtn: $('btn-theme'), dashLink: $('link-dashboard'),
    devices: $('devices'), deviceList: $('device-list'),
    dlg: $('dlg'), dlgTitle: $('dlg-title'), dlgBody: $('dlg-body'), dlgConfirm: $('dlg-confirm'), dlgCancel: $('dlg-cancel'),
    ended: $('ended'),
  };

  const ui = { busy: new Set(), notes: {}, exiting: false, ended: false, exitTimer: 0, connectedOnce: false };
  const jointCells = {};
  let deviceKeys = {};
  let deviceSig = '';
  const sim = new window.CameraSim({ good: t('result.good'), defect: t('result.defect') });
  const camera = new window.CameraView(el.cameraStage, { sim });

  const S = () => store.state.status;
  const online = () => store.state.online;

  // ---------- 서버 메시지 ----------

  store.subscribe((kind, data) => {
    switch (kind) {
      case 'online':
        if (ui.connectedOnce) addLog({ code: data ? 'server_back' : 'server_lost', level: data ? 'info' : 'warning', at: new Date().toISOString() });
        if (data) ui.connectedOnce = true;
        render();
        break;
      case 'status':
        clearSolvedNotes();
        render();
        break;
      case 'info':
      case 'home':
        render();
        break;
      case 'inspection':
        if (camera.current && camera.current.source.transport === 'mock') sim.mark(data.result);
        camera.showInspection(data);
        renderStats();
        break;
      case 'event':
        addLog(data);
        break;
      case 'joints':
        if (data.source === 'leader') renderJoints();
        break;
      case 'frame':
        camera.pushFrame(data);
        break;
      case 'shutdown_complete':
        finishExit();
        break;
      default:
        break;
    }
  });

  // ---------- 그리기 ----------

  // connecting · offline · estop · unknown · unreported(서버가 라인 상태를 보내지 않음) · stopped · starting · running · stopping · homing
  function phase() {
    if (ui.exiting) return 'shutdown';
    return store.linePhase();
  }

  const modeKey = () => (S() && S().mode === 'manual' ? 'manual' : 'auto');
  const modeKnown = () => !!S() && (S().mode === 'auto' || S().mode === 'manual');

  function render() {
    const p = phase();
    document.body.dataset.phase = p;
    renderState(p);
    renderControls(p);
    renderCamera();
    renderStats();
    renderJoints();
    renderDevices();
  }

  function renderState(p) {
    const fault = p === 'stopped' && S().fault;
    el.stateWord.textContent = t('state.' + p);
    const homeBlock = p === 'stopped' ? store.homeBlock() : null; // 자동 시작을 막는 원점 문제 (수동 모드에서는 없음)
    if (fault) el.stateDetail.textContent = store.faultDetail(S().fault);
    else if (homeBlock) el.stateDetail.textContent = t(homeBlock === 'unset' ? 'detail.homeNotSet' : 'detail.homeRequired');
    else if ((p === 'stopped' || p === 'running') && modeKnown()) el.stateDetail.textContent = t('detail.' + p + '.' + modeKey());
    else if (p === 'unknown') el.stateDetail.textContent = t('detail.unknown', { state: S().lineRaw });
    else if (p === 'unreported') el.stateDetail.textContent = store.unreportedDetail();
    else if (p === 'stopped' || p === 'running') el.stateDetail.textContent = t('detail.' + p + '.unknownMode');
    else el.stateDetail.textContent = t('detail.' + p);
    // 고장으로 멈춘 정지는 노랑(IEC 60073: 이상 상태)
    el.stateLamp.dataset.color = fault ? 'amber' : LAMP[p] || 'off';
    el.stateLamp.dataset.blink = String(BLINKING.includes(p));
  }

  function renderControls(p) {
    const ready = !['connecting', 'offline', 'shutdown'].includes(p);
    const latched = p === 'estop';
    // 서버가 라인 상태를 보내지 않으면(XML v1.0) 정지 상태처럼 키를 열어 둔다 — 할 수 있는지는 서버의 답으로 알린다
    const stopped = p === 'stopped' || p === 'unreported';
    const running = p === 'running';

    // 긴급정지 — 서버와 이어져 있으면 언제나 누를 수 있다
    el.estop.disabled = !ready;
    el.estop.setAttribute('aria-pressed', String(latched));
    el.estopLabel.textContent = t(latched ? 'estop.latched' : 'estop.press');
    el.release.hidden = !latched;
    el.release.disabled = ui.busy.has('release');
    const offlineNote = { text: t(robot.hardwareStop === 'button' ? 'estop.offline.button' : 'estop.offline.dc'), kind: 'error' };
    setNote(el.estopNote, p === 'offline' ? offlineNote : (ui.notes.estop || ui.notes.release));

    // 시작 / 정지 — 하나의 키가 지금 할 수 있는 동작을 보여 준다
    el.runLabel.textContent = t(running ? 'run.stop' : 'run.start');
    el.runIcon.setAttribute('href', running ? '#i-stop' : '#i-play');
    el.run.disabled = !(stopped || running) || ui.busy.has('run');
    // 누르기 전에 알 수 있는 이유: 가동 중이면 잠긴 조작, 자동 모드에서 원점이 없거나 원점 복귀가 필요하면 그것 먼저
    const homeBlock = stopped ? store.homeBlock() : null;
    const runHint = running ? { text: t('run.locked') } : homeBlock ? { text: t(homeBlock === 'unset' ? 'run.homeNotSet' : 'run.homeFirst') } : null;
    setNote(el.runNote, ui.notes.run || runHint);

    // 원점 — 복귀는 자동 모드·정지 상태(저장된 원점이 있을 때), 잡기는 수동 모드(정지·가동 중 — 리더암으로 자세를 잡는 동안).
    // 긴급정지 중(팔에 힘이 빠짐)에는 둘 다 잠긴다. 모드 때문에 못 누르는 키는 마우스를 올리면 이유가 보인다.
    // 운전 모드를 모르면(XML v1.0) 모드로는 막지 않는다. 원점은 이 HMI에 저장한다 (store.js)
    const manual = modeKey() === 'manual';
    const auto = modeKnown() && !manual;
    const home = store.state.home;
    el.home.disabled = !stopped || manual || !home || ui.busy.has('home');
    el.home.title = manual ? t('home.go.autoOnly') : '';
    el.setHome.disabled = !(stopped || running) || auto || ui.busy.has('setHome');
    el.setHome.title = auto ? t('home.set.manualOnly') : '';
    let homeHint = null;
    if (homeBlock) homeHint = { text: t(homeBlock === 'unset' ? 'home.notSet' : 'home.needed') };
    else if (!auto && (stopped || running)) homeHint = { text: home || manual ? store.homeSetHint() : t('home.notSet.short') };
    setNote(el.homeNote, ui.notes.setHome || ui.notes.home || homeHint);

    // 운전 모드 — 정지 상태에서만
    el.modeKeys.forEach((key) => {
      key.setAttribute('aria-pressed', String(!!S() && S().mode === key.dataset.mode));
      key.disabled = !stopped || ui.busy.has('mode');
    });
    setNote(el.modeNote, ui.notes.mode);

    el.exit.disabled = ui.exiting;
    setNote(el.exitNote, ui.notes.exit);
  }

  function renderCamera() {
    const st = S();
    const src = st && online() ? store.cameraSource(store.primaryCamera()) : null;
    const streaming = !!(src && src.streaming);
    const busy = ui.busy.has('camera');
    el.cameraEmpty.hidden = streaming;
    el.cameraOff.hidden = !streaming || src.transport === 'local'; // 이 PC 카메라는 서버가 켜고 끄지 않는다
    el.cameraOff.disabled = busy;
    el.camera.disabled = !online() || !st || busy || ui.exiting;
    el.cameraLabel.textContent = t(busy ? 'camera.connecting' : 'camera.connect');
    setNote(el.cameraNote, ui.notes.camera);
    sim.setLine(!!st && st.line === 'running', st && st.cycle ? st.cycle.stage : null);
    camera.set(streaming ? src : null);
  }

  // 서버가 검사 개수를 무효라고 하면(stats: null — XML v1.0 valid="false") 0 대신 '–'
  function renderStats() {
    const st = S() && S().stats;
    el.total.textContent = st ? st.total.toLocaleString() : '–';
    el.good.textContent = st ? st.good.toLocaleString() : '–';
    el.defect.textContent = st ? st.defect.toLocaleString() : '–';
    el.rate.textContent = st ? (st.total ? (st.defect / st.total) * 100 : 0).toFixed(1) + '%' : '–';
  }

  // 리더암 각도: 수동 모드에서. 운전 모드를 모르면(XML v1.0) 서버가 각도를 보내는 동안 늘 보인다
  function renderJoints() {
    const leader = store.state.joints.leader;
    const show = !!S() && online() && (S().mode === 'manual' || (!modeKnown() && !!leader));
    el.joints.hidden = !show;
    if (!show) return;
    JOINTS.forEach((j) => {
      const v = leader && leader.angles ? leader.angles[j] : undefined;
      const unit = leader && leader.units && leader.units[j] === 'pct' ? '%' : '°';
      jointCells[j].textContent = typeof v === 'number' ? Math.round(v) + unit : '–';
    });
  }

  // 서버가 알려 준 장치 목록을 그대로 보인다 (서버 → 컨베이어 → 로봇팔 → 리더암 → 카메라들(서버 목록 순) → 그 밖)
  function deviceIds() {
    const ids = Object.keys((S() && S().devices) || {});
    const cams = store.cameraIds().map((c) => 'camera_' + c).filter((d) => ids.includes(d));
    const first = DEVICE_ORDER.filter((d) => ids.includes(d)).concat(cams);
    const ordered = first.concat(ids.filter((d) => !first.includes(d)).sort());
    return ['server'].concat(ordered.length ? ordered : DEVICE_ORDER);
  }

  function renderDevices() {
    el.devices.hidden = !cfg.devMode;
    if (!cfg.devMode) return;
    const ids = deviceIds();
    if (ids.join() !== deviceSig) { buildDevices(ids); deviceSig = ids.join(); }
    ids.forEach((name) => {
      const key = deviceKeys[name];
      const connected = name === 'server' ? online() : !!(S() && S().devices[name] === 'connected');
      key.lamp.dataset.color = connected ? 'green' : 'off';
      key.state.hidden = connected; // 색만으로 알리지 않도록 끊김은 글자로도 쓴다
    });
  }

  // "장치가 끊겨 실패" 안내는 그 장치들이 다시 연결되면 지운다
  function clearSolvedNotes() {
    Object.keys(ui.notes).forEach((key) => {
      const missing = ui.notes[key].missing;
      if (missing && missing.every((d) => S().devices[d] === 'connected')) delete ui.notes[key];
    });
  }

  function setNote(node, note) {
    node.hidden = !note;
    if (!note) return;
    node.textContent = note.text;
    if (note.kind) node.dataset.kind = note.kind;
    else delete node.dataset.kind;
  }

  // ---------- 테마 ----------
  // 처음에는 config.js가 정한 값(기본: PC 설정)을 따르고, 버튼을 누르면 그 선택을 브라우저에 기억한다.

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  function isDark() {
    const chosen = document.documentElement.dataset.theme;
    return chosen ? chosen === 'dark' : darkQuery.matches;
  }

  function renderTheme() {
    el.themeBtn.setAttribute('aria-pressed', String(isDark()));
  }

  function toggleTheme() {
    const root = document.documentElement;
    const next = isDark() ? 'light' : 'dark';
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    void root.offsetHeight; // 전환 효과가 꺼진 상태로 새 색을 바로 계산시킨 뒤
    root.classList.remove('theme-switching'); // 다시 켠다 — 바뀐 색이 천천히 번지지 않는다
    try { localStorage.setItem('hmi.theme', next); } catch (e) { /* 저장이 막힌 브라우저면 이번 화면에서만 바뀐다 */ }
    sim.readTheme();
    sim.draw();
    renderTheme();
  }

  // ---------- 로그 ----------
  // 기록은 늘 쌓아 두고, 보는 것은 로그 창에서만 한다.

  function setLogOpen(open) {
    if (el.logWin.open === open) return;
    if (open) {
      el.logWin.show(); // 모달이 아니다: 창이 열려 있어도 조작반(긴급정지)은 그대로 누를 수 있다
      el.logClose.focus();
      setUnread(false);
    } else {
      const focusInside = el.logWin.contains(document.activeElement);
      el.logWin.close();
      if (focusInside) el.logBtn.focus();
    }
    el.logBtn.setAttribute('aria-expanded', String(open));
  }

  function setUnread(on) {
    el.logDot.hidden = !on;
    el.logDotText.hidden = !on;
  }

  function addLog(evt) {
    const li = document.createElement('li');
    li.className = 'log__item';
    li.dataset.level = evt.level || 'info';
    const at = evt.at || new Date().toISOString();
    const time = document.createElement('time');
    time.className = 'log__time';
    time.dateTime = at;
    time.textContent = clock(at);
    const msg = document.createElement('span');
    msg.className = 'log__msg';
    msg.textContent = store.eventText(evt);
    li.append(time, msg);
    // 시각 차례로 끼운다 — 다시 연결될 때 채운 기록이 끊겼던 동안의 자리에 들어가게 (새것이 위)
    const ms = Date.parse(at);
    let next = el.logList.firstElementChild;
    while (next && Date.parse(next.querySelector('time').dateTime) > ms) next = next.nextElementSibling;
    el.logList.insertBefore(li, next);
    while (el.logList.children.length > cfg.logLimit) el.logList.lastElementChild.remove();
    el.logEmpty.hidden = true;
    // 화면을 열며 채운 지난 기록(restored)은 이미 지난 일이라 알림 점을 켜지 않는다
    if (!evt.restored && !el.logWin.open && NOTIFY_LEVELS.includes(li.dataset.level) && !NOTIFY_SKIP.includes(evt.code)) setUnread(true);
  }

  function clock(iso) {
    const d = new Date(iso);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  // ---------- 명령 ----------

  // 같은 명령은 응답이 올 때까지 한 번만. 실패하면 그 버튼 아래에 이유와 다음 행동을 쓴다.
  // 서버가 받기만 하고 장비는 움직이지 않았다는 답(XML v1.0)도 그 자리에 쓴다
  async function act(key, command) {
    if (ui.busy.has(key)) return;
    ui.busy.add(key);
    delete ui.notes[key];
    render();
    try {
      const note = store.resultNote(key, await command());
      if (note) ui.notes[key] = note;
    } catch (err) {
      ui.notes[key] = { text: errorText(err), kind: 'error', missing: err.details && err.details.missing };
    } finally {
      ui.busy.delete(key);
      render();
    }
  }

  const errorText = store.errorText;

  function confirmDialog(kind) {
    return new Promise((resolve) => {
      const opener = document.activeElement;
      el.dlgTitle.textContent = t('dialog.' + kind + '.title');
      el.dlgBody.textContent = t('dialog.' + kind + '.body');
      el.dlgConfirm.textContent = t('dialog.' + kind + '.confirm');
      el.dlg.returnValue = '';
      el.dlg.addEventListener('close', () => {
        resolve(el.dlg.returnValue === 'confirm');
        if (opener && opener.isConnected && !opener.hidden) opener.focus();
      }, { once: true });
      el.dlg.showModal();
      el.dlgCancel.focus(); // 실수로 Enter를 눌러도 취소되도록
    });
  }

  function finishExit() {
    if (ui.ended) return;
    clearTimeout(ui.exitTimer);
    ui.ended = true;
    camera.set(null);
    setLogOpen(false);
    el.ended.hidden = false; // 브라우저는 스크립트가 연 창만 닫을 수 있어 종료 화면을 남긴다
  }

  el.estop.addEventListener('click', () => {
    if (S() && S().estop) return;
    // 긴급정지는 다른 요청을 기다리지 않고 바로 보낸다. 서버가 받기만 하고 장비를 멈추지 않았으면(XML v1.0) 그렇게 알린다
    api.estop()
      .then((res) => {
        const note = store.resultNote('estop', res);
        if (note) ui.notes.estop = note;
        else delete ui.notes.estop;
        render();
      })
      .catch((err) => { ui.notes.estop = { text: errorText(err), kind: 'error' }; render(); });
  });

  el.release.addEventListener('click', async () => {
    if (await confirmDialog('release')) {
      await act('release', () => api.releaseEstop());
      el.estop.focus();
    }
  });

  el.run.addEventListener('click', () => {
    const running = S() && S().line === 'running';
    act('run', () => (running ? api.stop() : store.startLine()));
  });

  // 원점 복귀: 이 HMI에 저장한 원점 각도를 서버에 보낸다
  el.home.addEventListener('click', () => act('home', () => store.goHome()));

  // 원점 잡기는 저장된 원점을 덮어쓴다 — 확인 창을 거친다. 저장한 때는 키 아래 안내에 보인다
  el.setHome.addEventListener('click', async () => {
    if (await confirmDialog('setHome')) await act('setHome', () => store.saveHome());
  });

  el.modeKeys.forEach((key) => key.addEventListener('click', () => {
    const mode = key.dataset.mode;
    if (!S() || S().mode === mode) return;
    act('mode', () => api.setMode(mode));
  }));

  el.camera.addEventListener('click', () => act('camera', () => api.startCamera()));
  el.cameraOff.addEventListener('click', () => act('camera', () => api.stopCamera()));

  el.themeBtn.addEventListener('click', toggleTheme);
  darkQuery.addEventListener('change', renderTheme); // 'auto'일 때 PC 설정이 바뀌면 버튼 상태도 따라간다

  el.logBtn.addEventListener('click', () => setLogOpen(!el.logWin.open));
  el.logClose.addEventListener('click', () => setLogOpen(false));
  // Esc로 로그 창 닫기. 확인 창이 떠 있으면 Esc는 확인 창 몫이다 (캡처 단계에서 먼저 확인)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !el.logWin.open || el.dlg.open) return;
    e.preventDefault();
    setLogOpen(false);
  }, true);

  el.exit.addEventListener('click', async () => {
    if (!(await confirmDialog('exit'))) return;
    ui.exiting = true;
    delete ui.notes.exit;
    render();
    try {
      await api.shutdown();
      ui.exitTimer = setTimeout(finishExit, 5000); // 완료 알림이 오지 않아도 5초 뒤에는 닫는다
    } catch (err) {
      ui.exiting = false;
      ui.notes.exit = { text: errorText(err), kind: 'error' };
      render();
    }
  });

  // ---------- 시작 ----------

  function buildJoints() {
    JOINTS.forEach((j) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = t('joint.' + j);
      dd.textContent = '–';
      row.append(dt, dd);
      el.jointsList.appendChild(row);
      jointCells[j] = dd;
    });
  }

  function buildDevices(ids) {
    el.deviceList.textContent = '';
    deviceKeys = {};
    ids.forEach((name) => {
      const li = document.createElement('li');
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'device';
      key.disabled = !api.mock;
      if (api.mock) key.title = t('devices.toggleHint');
      const lamp = document.createElement('span');
      lamp.className = 'lamp';
      const label = document.createElement('span');
      label.textContent = name === 'server' ? t('device.server') : store.deviceName(name);
      const state = document.createElement('span');
      state.textContent = t('devices.disconnected');
      key.append(lamp, label, state);
      key.addEventListener('click', () => {
        const connected = name === 'server' ? online() : !!(S() && S().devices[name] === 'connected');
        api.mock.setDevice(name, !connected);
      });
      li.appendChild(key);
      el.deviceList.appendChild(li);
      deviceKeys[name] = { lamp, state };
    });
  }

  el.dashLink.href = 'dashboard.html' + location.search; // ?dev=0, ?theme= 같은 주소 설정을 그대로 넘긴다

  window.I18N.apply();
  buildJoints();
  renderTheme();
  render();
  store.start();
})();
