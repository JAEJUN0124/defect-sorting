// 대시보드 조작 — 조작 화면(js/app.js)과 같은 규칙으로 시작/정지·긴급정지 해제·원점 복귀·원점 잡기·운전 모드·카메라·프로그램 종료를 서버에 보냅니다.
// 긴급정지 단추 자체는 화면마다 그리는 곳(dashboard.js · dashboard-tabs.js)이 맡습니다.
// 단추 자리는 화면마다 달라 data-ctl 속성으로 찾습니다 (한 기능의 단추가 여러 자리에 있어도 된다):
//   data-ctl="run"         시작/정지 (가동 중이면 정지). data-slot="banner"면 긴급정지 중에는 숨고 그 자리를 해제 단추가 쓴다
//   data-ctl="release"     긴급정지 해제 (확인 창). 긴급정지 중에만 보인다
//   data-ctl="home"        원점 복귀 — 이 HMI에 저장한 원점으로 옮긴다 (자동 모드·정지 상태)
//   data-ctl="set-home"    원점 잡기 — 로봇팔의 지금 자세를 이 HMI에 원점으로 저장한다 (수동 모드, 확인 창)
//   data-ctl="mode"        운전 모드. data-mode="auto" | "manual"
//   data-ctl="camera-on" · "camera-off"  카메라 켜기/끄기. data-camera로 id를 주면 그 카메라만, 없으면 모든 카메라
//   data-ctl="exit"        프로그램 종료 (확인 창 → 종료 화면). 이 HMI만 닫고 서버에는 보내지 않는다
//   data-note="mode home"  처럼 기능 이름을 적은 자리에 실패 이유나 지금 누를 수 없는 이유를 쓴다 (앞에 적은 것부터).
//                          data-note-short가 있으면 늘 붙는 안내는 짧은 문장으로 (좁은 자리)
// 확인 창(#dlg)과 종료 화면(#ended)은 화면 HTML에 둔다 — 조작 화면과 같은 구조.
(function () {
  const api = window.HmiApi;
  const store = window.HmiStore;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const S = () => store.state.status;
  const online = () => store.state.online;

  const ui = { busy: new Set(), notes: {}, ended: false, lastError: null, lastPhase: null };
  const listeners = new Set();
  const dlg = { el: $('dlg'), title: $('dlg-title'), body: $('dlg-body'), confirm: $('dlg-confirm'), cancel: $('dlg-cancel') };
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const camKey = (node) => 'camera:' + (node.dataset.camera || 'all');

  function phase() {
    if (ui.ended) return 'shutdown';
    return store.linePhase();
  }
  const modeKnown = () => !!S() && (S().mode === 'auto' || S().mode === 'manual');

  function streamingOf(id) {
    const st = S();
    if (!st || !online()) return false;
    const src = store.cameraSource(id);
    return !!(src && src.streaming && src.transport !== 'local');
  }

  // 실패한 명령의 이유가 먼저, 없으면 지금 누를 수 없는 이유
  function noteFor(key, p, short) {
    if (ui.notes[key]) return ui.notes[key];
    if ((key === 'home' || key === 'mode') && p === 'running') return { text: t(short ? 'ctl.locked.short' : 'run.locked') };
    // 자동 모드에서는 저장된 원점이 있어야 하고, 긴급정지·로봇팔 고장 뒤에는 원점 복귀를 해야 시작할 수 있다 (docs/API.md 4.1)
    const block = p === 'stopped' ? store.homeBlock() : null;
    const unset = block === 'unset';
    if (key === 'run' && block) return { text: t(short ? (unset ? 'ctl.homeNotSet.short' : 'ctl.homeFirst.short') : (unset ? 'run.homeNotSet' : 'run.homeFirst')) };
    if (key === 'home' && block) return { text: t(short ? (unset ? 'ctl.homeNotSet.short' : 'ctl.homeNeeded.short') : (unset ? 'home.notSet' : 'home.needed')) };
    // 수동 모드(운전 모드를 모르면 그때도): 원점 잡기 쓰는 법과 마지막으로 저장한 때 (좁은 자리에는 쓰지 않는다)
    if (key === 'set-home' && !short && ['stopped', 'running', 'unreported'].includes(p) && S() && S().mode !== 'auto') {
      return { text: store.state.home || S().mode === 'manual' ? store.homeSetHint() : t('home.notSet.short') };
    }
    return null;
  }

  function setNote(node, note) {
    node.hidden = !note;
    node.textContent = note ? note.text : '';
    if (note && note.kind) node.dataset.kind = note.kind;
    else delete node.dataset.kind;
  }

  function render() {
    const p = phase();
    const st = S();
    const latched = p === 'estop';
    // 서버가 라인 상태를 보내지 않으면(XML v1.0) 정지 상태처럼 키를 열어 둔다 — 할 수 있는지는 서버의 답으로 알린다
    const stopped = p === 'stopped' || p === 'unreported';
    const running = p === 'running';

    // 시작 / 정지 — 하나의 키가 지금 할 수 있는 동작을 보여 준다
    all('[data-ctl="run"]').forEach((b) => {
      b.hidden = latched && b.dataset.slot === 'banner';
      b.disabled = !(stopped || running) || ui.busy.has('run');
      const label = b.querySelector('[data-ctl-label]');
      if (label) label.textContent = t(running ? 'run.stop' : 'run.start');
      const icon = b.querySelector('use');
      if (icon) icon.setAttribute('href', running ? '#i-stop' : '#i-play');
    });
    all('[data-ctl="release"]').forEach((b) => { b.hidden = !latched; b.disabled = ui.busy.has('release'); });
    // 원점 — 복귀는 자동 모드·정지 상태(저장된 원점이 있을 때), 잡기는 수동 모드(정지·가동 중). 긴급정지 중에는 둘 다 잠긴다.
    // 모드 때문에 못 누르는 키는 마우스를 올리면 이유가 보인다. 운전 모드를 모르면(XML v1.0) 모드로는 막지 않는다
    const manual = !!st && st.mode === 'manual';
    const auto = modeKnown() && !manual;
    all('[data-ctl="home"]').forEach((b) => {
      b.disabled = !stopped || manual || !store.state.home || ui.busy.has('home');
      b.title = manual ? t('home.go.autoOnly') : '';
    });
    all('[data-ctl="set-home"]').forEach((b) => {
      b.disabled = !(stopped || running) || auto || ui.busy.has('set-home');
      b.title = auto ? t('home.set.manualOnly') : '';
    });
    // 운전 모드 — 정지 상태에서만
    all('[data-ctl="mode"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(!!st && st.mode === b.dataset.mode));
      b.disabled = !stopped || ui.busy.has('mode');
    });
    // 카메라 — 켜진 카메라는 끄기, 꺼진 카메라는 연결
    const ids = store.cameraIds();
    all('[data-ctl="camera-on"]').forEach((b) => {
      const id = b.dataset.camera;
      const busy = ui.busy.has(camKey(b));
      const lost = !!id && !!st && st.devices['camera_' + id] === 'disconnected';
      b.hidden = id ? streamingOf(id) : ids.length > 0 && ids.every(streamingOf);
      b.disabled = !online() || !st || busy || lost || ui.ended;
      const label = b.querySelector('[data-ctl-label]');
      if (label) label.textContent = t(busy ? 'camera.connecting' : b.dataset.label || 'camera.connect');
    });
    all('[data-ctl="camera-off"]').forEach((b) => {
      const id = b.dataset.camera;
      b.hidden = id ? !streamingOf(id) : !ids.some(streamingOf);
      b.disabled = ui.busy.has(camKey(b));
    });
    all('[data-ctl="exit"]').forEach((b) => { b.disabled = ui.ended; });

    all('[data-note]').forEach((n) => {
      let note = null;
      n.dataset.note.split(' ').some((k) => {
        note = noteFor(k === 'camera' ? camKey(n) : k, p, n.hasAttribute('data-note-short'));
        return !!note;
      });
      setNote(n, note);
    });
    listeners.forEach((fn) => fn());
  }

  // "장치가 끊겨 실패" 안내는 그 장치들이 다시 연결되면 지운다 (조작 화면과 같다)
  function clearSolvedNotes() {
    const st = S();
    if (!st) return;
    Object.keys(ui.notes).forEach((key) => {
      const missing = ui.notes[key].missing;
      if (missing && missing.every((d) => st.devices[d] === 'connected')) delete ui.notes[key];
    });
  }

  // 서버가 지난 기록(GET /history)을 주면 "이 화면을 연 뒤부터" 안내를 서버 기록 안내로 바꾼다 (data-history-note="i18n 키")
  function renderHistoryNotes() {
    const fromServer = store.state.history.supported === true;
    all('[data-history-note]').forEach((n) => { n.textContent = t(n.dataset.historyNote + (fromServer ? '.server' : '')); });
  }

  store.subscribe((kind) => {
    if (ui.ended) return; // 프로그램 종료로 이 HMI를 닫았다
    if (kind === 'history') { renderHistoryNotes(); return; }
    if (!['status', 'online', 'info', 'home'].includes(kind)) return;
    clearSolvedNotes();
    // 라인 상태가 바뀌면 지난 실패 안내는 지운다 (예: 시작 실패 → 장치 연결 → 가동)
    const p = phase();
    if (ui.lastPhase && p !== ui.lastPhase) { ui.notes = {}; ui.lastError = null; }
    ui.lastPhase = p;
    render();
  });

  // ---------- 명령 ----------

  // 같은 명령은 응답이 올 때까지 한 번만. 실패하면 그 자리(data-note)와 윗판에 이유와 다음 행동을 쓴다.
  // 서버가 받기만 하고 장비는 움직이지 않았다는 답(XML v1.0)도 그 자리에 쓴다
  async function act(key, command) {
    if (ui.busy.has(key)) return;
    ui.busy.add(key);
    delete ui.notes[key];
    if (ui.lastError === key) ui.lastError = null;
    render();
    try {
      const note = store.resultNote(key, await command());
      if (note) ui.notes[key] = note;
    } catch (err) {
      ui.notes[key] = { text: store.errorText(err), kind: 'error', missing: err.details && err.details.missing };
      ui.lastError = key;
    } finally {
      ui.busy.delete(key);
      render();
    }
  }

  // 답은 단추를 누른(또는 Esc) 그 순간에 정한다. close 이벤트는 쓰지 않는다 — 화면을 그리지 않는 동안(숨은 창 등)에는
  // 늦게 와서, 앞 창의 close가 다음에 연 창을 취소해 버릴 수 있다
  function confirmDialog(kind) {
    return new Promise((resolve) => {
      const opener = document.activeElement;
      const finish = (yes) => {
        dlg.confirm.removeEventListener('click', onYes);
        dlg.cancel.removeEventListener('click', onNo);
        dlg.el.removeEventListener('cancel', onNo);
        if (dlg.el.open) dlg.el.close(yes ? 'confirm' : 'cancel');
        resolve(yes);
        if (opener && opener.isConnected && !opener.hidden) opener.focus();
      };
      const onYes = () => finish(true);
      const onNo = () => finish(false);
      dlg.title.textContent = t('dialog.' + kind + '.title');
      dlg.body.textContent = t('dialog.' + kind + '.body');
      dlg.confirm.textContent = t('dialog.' + kind + '.confirm');
      dlg.el.returnValue = '';
      dlg.confirm.addEventListener('click', onYes);
      dlg.cancel.addEventListener('click', onNo);
      dlg.el.addEventListener('cancel', onNo); // Esc
      dlg.el.showModal();
      dlg.cancel.focus(); // 실수로 Enter를 눌러도 취소되도록
    });
  }

  // 프로그램 종료: 이 HMI만 끝낸다 (사용자 2026-10-16). 서버에는 아무것도 보내지 않아 라인과 장비는 그대로다.
  // 서버 연결을 닫고, 브라우저는 스크립트가 연 창만 닫을 수 있어 종료 화면을 남긴다. 영상은 화면마다 ended를 보고 끈다
  function finishExit() {
    if (ui.ended) return;
    ui.ended = true;
    store.stop();
    const ended = $('ended');
    if (ended) ended.hidden = false;
    render();
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ctl]');
    if (!b || b.disabled) return;
    const kind = b.dataset.ctl;
    if (kind === 'run') {
      const running = S() && S().line === 'running';
      act('run', () => (running ? api.stop() : store.startLine()));
    } else if (kind === 'release') {
      if (!(await confirmDialog('release'))) return;
      await act('release', () => api.releaseEstop());
      const estop = $('btn-estop');
      if (estop) estop.focus();
    } else if (kind === 'home') {
      act('home', () => store.goHome());
    } else if (kind === 'set-home') {
      // 저장된 원점을 덮어쓴다 — 확인 창을 거친다
      if (!(await confirmDialog('setHome'))) return;
      act('set-home', () => store.saveHome());
    } else if (kind === 'mode') {
      if (!S() || S().mode === b.dataset.mode) return;
      act('mode', () => api.setMode(b.dataset.mode));
    } else if (kind === 'camera-on') {
      act(camKey(b), () => api.startCamera(b.dataset.camera));
    } else if (kind === 'camera-off') {
      act(camKey(b), () => api.stopCamera(b.dataset.camera));
    } else if (kind === 'exit') {
      if (await confirmDialog('exit')) finishExit();
    }
  });

  window.HmiControls = {
    render,
    phase,
    get ended() { return ui.ended; },
    // 윗판에 쓸 가장 최근 실패 안내 (없으면 null)
    message() { return ui.lastError && ui.notes[ui.lastError] ? ui.notes[ui.lastError].text : null; },
    onRender(fn) { listeners.add(fn); },
  };
})();
