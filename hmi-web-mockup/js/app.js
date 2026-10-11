// 화면 동작 — 서버 상태를 받아 그리고, 버튼 누름을 서버 명령으로 바꿉니다.
(function () {
  const cfg = window.HMI_CONFIG;
  const home = window.HMI_HOME_POSITION;
  const api = window.HmiApi;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);

  const DEVICES = ['server', 'conveyor', 'arm', 'leader', 'camera'];
  const LAMP = { running: 'green', estop: 'red', connecting: 'amber', starting: 'amber', stopping: 'amber', homing: 'amber', shutdown: 'amber' };
  const BLINKING = ['connecting', 'starting', 'stopping', 'homing', 'shutdown'];
  // 로그 버튼의 빨간 점을 켜는 기록. 불량 검출은 정상 공정에서 늘 생기는 일이라 통계로 보고 점은 켜지 않는다
  const NOTIFY_LEVELS = ['warning', 'alarm'];
  const NOTIFY_SKIP = ['defect_detected'];

  const el = {
    stateLamp: $('state-lamp'), stateWord: $('state-word'), stateDetail: $('state-detail'),
    estop: $('btn-estop'), estopLabel: $('estop-label'), estopNote: $('estop-note'), release: $('btn-release'),
    run: $('btn-run'), runIcon: $('run-icon'), runLabel: $('run-label'), runNote: $('run-note'),
    home: $('btn-home'), homeNote: $('home-note'),
    modeKeys: Array.from(document.querySelectorAll('.key--mode')), modeNote: $('mode-note'),
    joints: $('joints'), jointsList: $('joints-list'),
    exit: $('btn-exit'), exitNote: $('exit-note'),
    canvas: $('camera-canvas'), img: $('camera-img'), cameraEmpty: $('camera-empty'),
    camera: $('btn-camera'), cameraLabel: $('camera-btn-label'), cameraNote: $('camera-note'), cameraOff: $('btn-camera-off'),
    total: $('stat-total'), good: $('stat-good'), defect: $('stat-defect'), rate: $('stat-rate'),
    logBtn: $('btn-log'), logWin: $('logwin'), logClose: $('btn-log-close'), logList: $('log-list'), logEmpty: $('log-empty'),
    logDot: $('log-dot'), logDotText: $('log-dot-text'), themeBtn: $('btn-theme'),
    devices: $('devices'), deviceList: $('device-list'),
    dlg: $('dlg'), dlgTitle: $('dlg-title'), dlgBody: $('dlg-body'), dlgConfirm: $('dlg-confirm'), dlgCancel: $('dlg-cancel'),
    ended: $('ended'),
  };

  // S: 서버가 알려 준 상태 / ui: 화면에서만 쓰는 상태
  let S = null;
  let online = false;
  let everConnected = false;
  let lastMessageAt = 0;
  const ui = { busy: new Set(), notes: {}, exiting: false, ended: false, leader: null, exitTimer: 0 };
  const jointCells = {};
  const deviceKeys = {};
  const sim = new window.CameraSim(el.canvas, { good: t('result.good'), defect: t('result.defect') });

  // ---------- 서버 연결 ----------

  function setOnline(next) {
    if (online === next) return;
    online = next;
    lastMessageAt = Date.now();
    if (everConnected) addLog({ code: next ? 'server_back' : 'server_lost', level: next ? 'info' : 'warning', at: new Date().toISOString() });
    if (next) everConnected = true;
    render();
  }

  function handle(msg) {
    const data = msg.data || {};
    switch (msg.type) {
      case 'status':
        S = data;
        clearSolvedNotes();
        render();
        break;
      case 'inspection':
        if (S) S.stats = data.stats;
        if (S && S.camera.streaming) sim.mark(data.result);
        renderStats();
        break;
      case 'event':
        addLog(data);
        break;
      case 'joints':
        if (data.source === 'leader') { ui.leader = data.angles; renderJoints(); }
        break;
      case 'shutdown_complete':
        finishExit();
        break;
      default:
        break; // heartbeat, home_complete
    }
  }

  // ---------- 그리기 ----------

  function phase() {
    if (ui.exiting) return 'shutdown';
    if (!everConnected) return 'connecting';
    if (!online || !S) return 'offline';
    if (S.estop) return 'estop';
    return S.line; // stopped · starting · running · stopping · homing
  }

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
    el.stateWord.textContent = t('state.' + p);
    el.stateDetail.textContent = (p === 'stopped' || p === 'running') ? t('detail.' + p + '.' + S.mode) : t('detail.' + p);
    el.stateLamp.dataset.color = LAMP[p] || 'off';
    el.stateLamp.dataset.blink = String(BLINKING.includes(p));
  }

  function renderControls(p) {
    const ready = !['connecting', 'offline', 'shutdown'].includes(p);
    const latched = p === 'estop';
    const stopped = p === 'stopped';
    const running = p === 'running';

    // 긴급정지 — 서버와 이어져 있으면 언제나 누를 수 있다
    el.estop.disabled = !ready;
    el.estop.setAttribute('aria-pressed', String(latched));
    el.estopLabel.textContent = t(latched ? 'estop.latched' : 'estop.press');
    el.release.hidden = !latched;
    el.release.disabled = ui.busy.has('release');
    setNote(el.estopNote, p === 'offline' ? { text: t('estop.offline'), kind: 'error' } : (ui.notes.estop || ui.notes.release));

    // 시작 / 정지 — 하나의 키가 지금 할 수 있는 동작을 보여 준다
    el.runLabel.textContent = t(running ? 'run.stop' : 'run.start');
    el.runIcon.setAttribute('href', running ? '#i-stop' : '#i-play');
    el.run.disabled = !(stopped || running) || ui.busy.has('run');
    setNote(el.runNote, ui.notes.run || (running ? { text: t('run.locked') } : null));

    // 원점 — 정지 상태에서만
    el.home.disabled = !stopped || ui.busy.has('home');
    setNote(el.homeNote, ui.notes.home || (cfg.devMode && home.provisional ? { text: t('home.provisional') } : null));

    // 운전 모드 — 정지 상태에서만
    el.modeKeys.forEach((key) => {
      key.setAttribute('aria-pressed', String(!!S && S.mode === key.dataset.mode));
      key.disabled = !stopped || ui.busy.has('mode');
    });
    setNote(el.modeNote, ui.notes.mode);

    el.exit.disabled = ui.exiting;
    setNote(el.exitNote, ui.notes.exit);
  }

  function renderCamera() {
    const streaming = !!(S && online && S.camera.streaming);
    const busy = ui.busy.has('camera');
    el.cameraEmpty.hidden = streaming;
    el.cameraOff.hidden = !streaming;
    el.cameraOff.disabled = busy;
    el.camera.disabled = !online || !S || busy || ui.exiting;
    el.cameraLabel.textContent = t(busy ? 'camera.connecting' : 'camera.connect');
    setNote(el.cameraNote, ui.notes.camera);

    if (cfg.useMock) {
      el.canvas.hidden = !streaming;
      if (streaming) { sim.setBelt(S.line === 'running'); sim.start(); } else sim.stop();
      return;
    }
    // 실제 서버: MJPEG 주소를 그대로 <img>에 건다
    el.img.hidden = !streaming;
    if (streaming && el.img.dataset.src !== S.camera.url) {
      el.img.src = new URL(S.camera.url, cfg.apiBase).href;
      el.img.dataset.src = S.camera.url;
    } else if (!streaming && el.img.dataset.src) {
      el.img.removeAttribute('src');
      delete el.img.dataset.src;
    }
  }

  function renderStats() {
    const st = (S && S.stats) || { total: 0, good: 0, defect: 0 };
    el.total.textContent = st.total.toLocaleString();
    el.good.textContent = st.good.toLocaleString();
    el.defect.textContent = st.defect.toLocaleString();
    el.rate.textContent = (st.total ? (st.defect / st.total) * 100 : 0).toFixed(1) + '%';
  }

  function renderJoints() {
    const show = !!S && online && S.mode === 'manual';
    el.joints.hidden = !show;
    if (!show) return;
    home.joints.forEach((j) => {
      const v = ui.leader ? ui.leader[j.id] : undefined;
      jointCells[j.id].textContent = typeof v === 'number' ? Math.round(v) + j.unit : '–';
    });
  }

  function renderDevices() {
    el.devices.hidden = !cfg.devMode;
    if (!cfg.devMode) return;
    DEVICES.forEach((name) => {
      const key = deviceKeys[name];
      const connected = name === 'server' ? online : !!(S && S.devices[name] === 'connected');
      key.lamp.dataset.color = connected ? 'green' : 'off';
      key.state.hidden = connected; // 색만으로 알리지 않도록 끊김은 글자로도 쓴다
    });
  }

  // "장치가 끊겨 실패" 안내는 그 장치들이 다시 연결되면 지운다
  function clearSolvedNotes() {
    Object.keys(ui.notes).forEach((key) => {
      const missing = ui.notes[key].missing;
      if (missing && missing.every((d) => S.devices[d] === 'connected')) delete ui.notes[key];
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
    const time = document.createElement('time');
    time.className = 'log__time';
    time.dateTime = evt.at;
    time.textContent = clock(evt.at);
    const msg = document.createElement('span');
    msg.className = 'log__msg';
    msg.textContent = eventText(evt);
    li.append(time, msg);
    el.logList.prepend(li);
    while (el.logList.children.length > cfg.logLimit) el.logList.lastElementChild.remove();
    el.logEmpty.hidden = true;
    if (!el.logWin.open && NOTIFY_LEVELS.includes(li.dataset.level) && !NOTIFY_SKIP.includes(evt.code)) setUnread(true);
  }

  function eventText(evt) {
    const p = Object.assign({}, evt.params);
    if (p.device) p.device = t('device.' + p.device);
    if (Array.isArray(p.devices)) p.devices = deviceNames(p.devices);
    if (p.mode) p.mode = t('mode.' + p.mode);
    return t('event.' + evt.code, p);
  }

  const deviceNames = (list) => list.map((d) => t('device.' + d)).join(', ');

  function clock(iso) {
    const d = new Date(iso);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  // ---------- 명령 ----------

  // 같은 명령은 응답이 올 때까지 한 번만. 실패하면 그 버튼 아래에 이유와 다음 행동을 쓴다.
  async function act(key, command) {
    if (ui.busy.has(key)) return;
    ui.busy.add(key);
    delete ui.notes[key];
    render();
    try {
      await command();
    } catch (err) {
      ui.notes[key] = { text: errorText(err), kind: 'error', missing: err.details && err.details.missing };
    } finally {
      ui.busy.delete(key);
      render();
    }
  }

  function errorText(err) {
    const code = err && err.code;
    if (code === 'DEVICES_NOT_READY') return t('error.DEVICES_NOT_READY', { devices: deviceNames(err.details.missing || []) });
    const known = t('error.' + code);
    return known === 'error.' + code ? t('error.unknown', { code }) : known;
  }

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
    sim.stop();
    setLogOpen(false);
    el.ended.hidden = false; // 브라우저는 스크립트가 연 창만 닫을 수 있어 종료 화면을 남긴다
  }

  el.estop.addEventListener('click', () => {
    if (S && S.estop) return;
    // 긴급정지는 다른 요청을 기다리지 않고 바로 보낸다
    api.estop()
      .then(() => { delete ui.notes.estop; render(); })
      .catch((err) => { ui.notes.estop = { text: errorText(err), kind: 'error' }; render(); });
  });

  el.release.addEventListener('click', async () => {
    if (await confirmDialog('release')) {
      await act('release', () => api.releaseEstop());
      el.estop.focus();
    }
  });

  el.run.addEventListener('click', () => {
    const running = S && S.line === 'running';
    act('run', () => (running ? api.stop() : api.start()));
  });

  el.home.addEventListener('click', () => {
    const angles = Object.fromEntries(home.joints.map((j) => [j.id, j.angle]));
    act('home', () => api.home(angles));
  });

  el.modeKeys.forEach((key) => key.addEventListener('click', () => {
    const mode = key.dataset.mode;
    if (!S || S.mode === mode) return;
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
    home.joints.forEach((j) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = t('joint.' + j.id);
      dd.textContent = '–';
      row.append(dt, dd);
      el.jointsList.appendChild(row);
      jointCells[j.id] = dd;
    });
  }

  function buildDevices() {
    DEVICES.forEach((name) => {
      const li = document.createElement('li');
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'device';
      key.disabled = !api.mock;
      if (api.mock) key.title = t('devices.toggleHint');
      const lamp = document.createElement('span');
      lamp.className = 'lamp';
      const label = document.createElement('span');
      label.textContent = t('device.' + name);
      const state = document.createElement('span');
      state.textContent = t('devices.disconnected');
      key.append(lamp, label, state);
      key.addEventListener('click', () => {
        const connected = name === 'server' ? online : !!(S && S.devices[name] === 'connected');
        api.mock.setDevice(name, !connected);
      });
      li.appendChild(key);
      el.deviceList.appendChild(li);
      deviceKeys[name] = { lamp, state };
    });
  }

  window.I18N.apply();
  buildJoints();
  buildDevices();
  renderTheme();
  render();

  api.connect({
    onOpen() { setOnline(true); },
    onClose() { setOnline(false); },
    onMessage(msg) {
      lastMessageAt = Date.now();
      if (!online) setOnline(true);
      handle(msg);
    },
  });

  setInterval(() => {
    if (online && Date.now() - lastMessageAt > cfg.heartbeatTimeoutMs) setOnline(false);
  }, 1000);
})();
