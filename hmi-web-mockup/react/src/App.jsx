import { useCallback, useEffect, useRef, useState } from 'react';
import Icons, { Icon } from './Icons.jsx';
import Camera from './Camera.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import LoginDialog from './LoginDialog.jsx';
import LogWindow from './LogWindow.jsx';

// 조작 화면 — 기존 js/app.js를 React로 옮긴 것. 서버 연결과 상태 모으기는 기존 store.js(window.HmiStore),
// 서버 명령은 api.js(window.HmiApi), 영상은 camera.js(window.CameraView)가 그대로 맡는다.
// 대시보드는 없다 (사용자 2026-10-17: 조작 화면 하나만 React로). 가짜 영상(camera-sim.js)도 뺐다
const cfg = window.HMI_CONFIG;
const robot = window.HMI_ROBOT || {};
const JOINTS = robot.joints || ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];
const api = window.HmiApi;
const store = window.HmiStore;
const { t } = window.I18N;

const DEVICE_ORDER = ['conveyor', 'arm', 'leader'];
const LAMP = { running: 'green', estop: 'red', connecting: 'amber', starting: 'amber', stopping: 'amber', homing: 'amber', unknown: 'amber' };
const BLINKING = ['connecting', 'starting', 'stopping', 'homing'];
// 로그 버튼의 빨간 점을 켜는 기록. 불량 검출은 정상 공정에서 늘 생기는 일이라 통계로 보고 점은 켜지 않는다
const NOTIFY_LEVELS = ['warning', 'alarm'];
const NOTIFY_SKIP = ['defect_detected'];
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function isDark() {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === 'dark' : darkQuery.matches;
}

function Note({ note, id, className = 'note' }) {
  if (!note) return <p className={className} id={id} hidden />;
  return <p className={className} id={id} data-kind={note.kind || undefined}>{note.text}</p>;
}

let logSeq = 0;

export default function App() {
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);
  // 버튼마다: 응답을 기다리는 중(busy), 그 자리에 쓸 안내(notes) — 기존 app.js의 ui와 같다
  const ui = useRef({ busy: new Set(), notes: {}, connectedOnce: false }).current;
  const [ended, setEnded] = useState(false);
  const endedRef = useRef(false);
  const [log, setLog] = useState([]);
  const [unread, setUnread] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const logOpenRef = useRef(false);
  const [ask, setAsk] = useState(null); // 확인 창
  const [loginAsk, setLoginAsk] = useState(null); // 로그인 창 (밖 주소만)
  const [dark, setDark] = useState(isDark);
  const camera = useRef(null); // CameraView
  const estopBtn = useRef(null);
  const logBtn = useRef(null);

  logOpenRef.current = logOpen;

  // ---------- 로그 ----------
  // 기록은 늘 쌓아 두고, 보는 것은 로그 창에서만 한다. 시각 차례로 끼운다 (새것이 위)
  const addLog = useCallback((evt) => {
    const at = evt.at || new Date().toISOString();
    const entry = { key: ++logSeq, at, level: evt.level || 'info', text: store.eventText(evt) };
    setLog((list) => {
      const ms = Date.parse(at);
      let i = 0;
      while (i < list.length && Date.parse(list[i].at) > ms) i += 1;
      return list.slice(0, i).concat(entry, list.slice(i)).slice(0, cfg.logLimit);
    });
    // 화면을 열며 채운 지난 기록(restored)은 이미 지난 일이라 알림 점을 켜지 않는다
    if (!evt.restored && !logOpenRef.current && NOTIFY_LEVELS.includes(entry.level) && !NOTIFY_SKIP.includes(evt.code)) setUnread(true);
  }, []);

  // ---------- 서버 메시지 ----------
  useEffect(() => {
    document.documentElement.lang = cfg.locale || 'ko';
    document.title = t('app.title');
    const off = store.subscribe((kind, data) => {
      switch (kind) {
        case 'online':
          if (endedRef.current) return; // 프로그램 종료로 이 HMI가 연결을 닫았다
          if (ui.connectedOnce) addLog({ code: data ? 'server_back' : 'server_lost', level: data ? 'info' : 'warning', at: new Date().toISOString() });
          if (data) ui.connectedOnce = true;
          rerender();
          break;
        case 'status': {
          // "장치가 끊겨 실패" 안내는 그 장치들이 다시 연결되면 지운다
          const st = store.state.status;
          Object.keys(ui.notes).forEach((key) => {
            const missing = ui.notes[key].missing;
            if (missing && st && missing.every((d) => st.devices[d] === 'connected')) delete ui.notes[key];
          });
          rerender();
          break;
        }
        case 'info':
        case 'home':
        case 'auth': // 로그인했는지·로그인이 있는 주소인지 (js/auth.js)
        case 'joints':
        case 'video': // 브릿지 영상: 켜기·끄기, 탑뷰/그리퍼, 상태 조회 결과
        case 'sortTarget':
          rerender();
          break;
        case 'inspection':
          if (camera.current) camera.current.showInspection(data);
          rerender();
          break;
        case 'event':
          addLog(data);
          break;
        case 'frame':
          if (camera.current) camera.current.pushFrame(data);
          break;
        default:
          break;
      }
    });
    store.start();
    return off;
  }, [addLog, rerender, ui]);

  // PC의 라이트/다크 설정이 바뀌면 버튼 상태도 따라간다
  useEffect(() => {
    const onChange = () => setDark(isDark());
    darkQuery.addEventListener('change', onChange);
    return () => darkQuery.removeEventListener('change', onChange);
  }, []);

  // Esc로 로그 창 닫기. 확인 창·로그인 창이 떠 있으면 Esc는 그 창 몫이다
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !logOpenRef.current || ask || loginAsk) return;
      e.preventDefault();
      setLogOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ask, loginAsk]);

  // ---------- 지금 상태 ----------
  const S = store.state.status;
  const online = store.state.online;
  // connecting · offline · estop · unknown · unreported(서버가 라인 상태를 보내지 않음) · stopped · starting · running · stopping · homing ·
  // shutdown(프로그램 종료로 이 HMI를 닫음)
  const p = ended ? 'shutdown' : store.linePhase();
  const modeKnown = !!S && (S.mode === 'auto' || S.mode === 'manual');
  const modeKey = S && S.mode === 'manual' ? 'manual' : 'auto';

  useEffect(() => { document.body.dataset.phase = p; }, [p]);

  // ---------- 명령 ----------
  // 같은 명령은 응답이 올 때까지 한 번만. 실패하면 그 버튼 아래에 이유와 다음 행동을 쓴다.
  // 서버가 받기만 하고 장비는 움직이지 않았다는 답(XML v1.0)도 그 자리에 쓴다
  async function act(key, command) {
    if (ui.busy.has(key)) return;
    ui.busy.add(key);
    delete ui.notes[key];
    rerender();
    try {
      const note = store.resultNote(key, await command());
      if (note) ui.notes[key] = note;
    } catch (err) {
      ui.notes[key] = { text: store.errorText(err), kind: 'error', missing: err.details && err.details.missing };
    } finally {
      ui.busy.delete(key);
      rerender();
    }
  }

  const confirm = (kind) => new Promise((resolve) => setAsk({ kind, resolve, opener: document.activeElement }));

  // 긴급정지는 다른 요청을 기다리지 않고 바로 보낸다. 서버가 받기만 하고 장비를 멈추지 않았으면(XML v1.0) 그렇게 알린다
  function onEstop() {
    if (S && S.estop) return;
    api.estop()
      .then((res) => {
        const note = store.resultNote('estop', res);
        if (note) ui.notes.estop = note;
        else delete ui.notes.estop;
        rerender();
      })
      .catch((err) => { ui.notes.estop = { text: store.errorText(err), kind: 'error' }; rerender(); });
  }

  async function onRelease() {
    if (await confirm('release')) {
      await act('release', () => api.releaseEstop());
      if (estopBtn.current) estopBtn.current.focus();
    }
  }

  function onRun() {
    const isRunning = store.state.status && store.state.status.line === 'running';
    act('run', () => (isRunning ? api.stop() : store.startLine()));
  }

  // 로그인 창: 로그인하면 true. 밖 주소(Cloudflare Worker)에만 있다 — 로그인으로 바뀌는 것은 원점 잡기뿐 (사용자 2026-10-27)
  const askLogin = (reason) => new Promise((resolve) => setLoginAsk({ reason, resolve, opener: document.activeElement }));

  async function onLogin(password) {
    await window.HmiAuth.login(password);
    addLog({ code: 'login', level: 'info', at: new Date().toISOString() });
  }

  function onLoginKey() {
    if (!window.HmiAuth.state.loggedIn) {
      askLogin(null);
      return;
    }
    window.HmiAuth.logout();
    addLog({ code: 'logout', level: 'info', at: new Date().toISOString() });
  }

  // 원점 잡기는 저장된 원점을 덮어쓴다 — 확인 창을 거친다. 밖 주소면 로그인부터 하고, 그 주소의 모든 HMI가 같이 쓰는 원점이라고 알린다
  async function onSetHome() {
    if (store.loginNeeded() && !(await askLogin('setHome'))) return;
    if (await confirm(store.homeShared() ? 'setHomeShared' : 'setHome')) await act('setHome', () => store.saveHome());
  }

  function onMode(mode) {
    if (!store.state.status || store.state.status.mode === mode) return;
    act('mode', () => api.setMode(mode));
  }

  // 로봇팔이 옮길 부품 (사용자 2026-10-17). 서버가 이미 그 값이라고 알려 줬으면 보내지 않는다
  function onSortTarget(target) {
    const now = store.sortTarget();
    if (now.from === 'server' && now.value === target) return;
    act('sortTarget', () => store.setSortTarget(target));
  }

  // 프로그램 종료: 이 HMI만 끝낸다 (사용자 2026-10-16). 서버에는 아무것도 보내지 않아 라인과 장비는 그대로다.
  // 서버 연결을 닫고, 브라우저는 스크립트가 연 창만 닫을 수 있어 종료 화면을 남긴다
  async function onExit() {
    if (!(await confirm('exit'))) return;
    endedRef.current = true;
    setEnded(true);
    setLogOpen(false);
    store.stop();
  }

  // 처음에는 config.js가 정한 값(기본: PC 설정)을 따르고, 버튼을 누르면 그 선택을 브라우저에 기억한다
  function toggleTheme() {
    const root = document.documentElement;
    const next = isDark() ? 'light' : 'dark';
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    void root.offsetHeight; // 전환 효과가 꺼진 상태로 새 색을 바로 계산시킨 뒤
    root.classList.remove('theme-switching'); // 다시 켠다 — 바뀐 색이 천천히 번지지 않는다
    try { localStorage.setItem('hmi.theme', next); } catch (e) { /* 저장이 막힌 브라우저면 이번 화면에서만 바뀐다 */ }
    setDark(isDark());
  }

  function toggleLog() {
    const next = !logOpen;
    setLogOpen(next);
    if (next) setUnread(false);
  }

  // ---------- 그리기에 쓰는 값 ----------
  // 상태 표시
  const fault = p === 'stopped' && S && S.fault;
  let detail;
  const stateHomeBlock = p === 'stopped' ? store.homeBlock() : null; // 자동 시작을 막는 원점 문제 (수동 모드에서는 없음)
  if (fault) detail = store.faultDetail(S.fault);
  else if (stateHomeBlock) detail = t(stateHomeBlock === 'unset' ? 'detail.homeNotSet' : 'detail.homeRequired');
  else if ((p === 'stopped' || p === 'running') && modeKnown) detail = t('detail.' + p + '.' + modeKey);
  else if (p === 'unknown') detail = t('detail.unknown', { state: S.lineRaw });
  else if (p === 'unreported') detail = store.unreportedDetail();
  else if (p === 'stopped' || p === 'running') detail = t('detail.' + p + '.unknownMode');
  else detail = t('detail.' + p);
  // 고장으로 멈춘 정지는 노랑(IEC 60073: 이상 상태)
  const lampColor = fault ? 'amber' : LAMP[p] || 'off';

  // 조작반
  const ready = !['connecting', 'offline', 'shutdown'].includes(p);
  const latched = p === 'estop';
  // 서버가 라인 상태를 보내지 않으면(XML v1.0) 정지 상태처럼 키를 열어 둔다 — 할 수 있는지는 서버의 답으로 알린다
  const stopped = p === 'stopped' || p === 'unreported';
  const running = p === 'running';
  const offlineNote = { text: t(robot.hardwareStop === 'button' ? 'estop.offline.button' : 'estop.offline.dc'), kind: 'error' };
  const homeBlock = stopped ? store.homeBlock() : null;
  // 누르기 전에 알 수 있는 이유: 가동 중이면 잠긴 조작, 자동 모드에서 원점이 없거나 원점 복귀가 필요하면 그것 먼저
  const runHint = running ? { text: t('run.locked') } : homeBlock ? { text: t(homeBlock === 'unset' ? 'run.homeNotSet' : 'run.homeFirst') } : null;
  // 원점 — 복귀는 자동 모드·정지 상태(저장된 원점이 있을 때), 잡기는 수동 모드(정지·가동 중). 긴급정지 중에는 둘 다 잠긴다.
  // 운전 모드를 모르면(XML v1.0) 모드로는 막지 않는다. 원점은 이 HMI에 저장한다 (store.js)
  const manual = modeKey === 'manual';
  const auto = modeKnown && !manual;
  const home = store.state.home;
  let homeHint = null;
  if (homeBlock) homeHint = { text: t(homeBlock === 'unset' ? 'home.notSet' : 'home.needed') };
  else if (!auto && (stopped || running) && store.loginNeeded()) homeHint = { text: t('home.set.loginRequired') };
  else if (!auto && (stopped || running)) homeHint = { text: home || manual ? store.homeSetHint() : t('home.notSet.short') };
  // 로그인 (밖 주소만): 로그인하지 않아도 원점 잡기 말고는 다 쓴다. 로그인이 있는 주소인지 확인하는 동안에는 원점 잡기만 잠근다
  const auth = window.HmiAuth ? window.HmiAuth.state : { available: false, loggedIn: false, until: null };

  // 리더암 각도: 수동 모드에서. 운전 모드를 모르면(XML v1.0) 서버가 각도를 보내는 동안 늘 보인다
  const leader = store.state.joints.leader;
  const showJoints = !!S && online && (S.mode === 'manual' || (!modeKnown && !!leader));

  // 로봇팔이 옮길 부품: HMI는 고른 값을 서버에 보내기만 한다. 키는 서버가 알려 준 값 → 없으면 이 HMI에서 마지막으로 서버가 받은 값 (그때는 그렇다고 쓴다)
  const sort = store.sortTarget();
  const sortHint = sort.from === 'local' ? { text: t('sort.local') } : !sort.value ? { text: t('sort.unset') } : null;

  // 카메라: 실제 카메라만 (가짜 서버의 가짜 영상은 뺐다).
  // 브릿지 영상은 XML 연결과 따로 다룬다 (안내 5장) — 서버 연결이 끊겨도 영상은 이어서 볼 수 있다
  const bridge = store.videoBridge();
  const camId = store.primaryCamera();
  const src = !ended && (bridge || (S && online)) ? store.cameraSource(camId) : null;
  const mockCamera = !!(src && src.transport === 'mock');
  const streaming = !!(src && src.streaming) && !mockCamera;
  const cameraBusy = ui.busy.has('camera');
  const cameraNote = ui.notes.camera || (src && src.streaming && mockCamera ? { text: t('camera.noMock') } : null);
  const cams = bridge ? store.cameraIds() : [];

  // 생산 통계: 서버가 검사 개수를 무효라고 하면(stats: null — XML v1.0 valid="false") 0 대신 '–'
  const stats = S && S.stats;

  // 장치 연결 (개발용): 서버 → 컨베이어 → 로봇팔 → 리더암 → 카메라들(서버 목록 순) → 그 밖.
  // 브릿지 영상의 카메라는 영상을 보는 동안 /video/status로 (XML의 RobotArm·Status로 대신 판단하지 않는다 — 안내 7장)
  // config.js alwaysOn의 장치는 서버 값과 상관없이 켜짐으로 보인다 (컨베이어가 늦어져서, 사용자 2026-10-19).
  // 보이는 것만 바꾼다 — 장치가 끊겨 거절된 안내를 지우는 것(위 'status')은 서버가 보낸 값으로 한다
  const alwaysOn = (name) => name !== 'server' && (cfg.alwaysOn || []).includes(name);
  let deviceIds = [];
  const videoCams = bridge && store.state.video.on ? cams.map((c) => 'camera_' + c) : [];
  if (cfg.devMode) {
    const ids = Object.keys((S && S.devices) || {});
    const camDevices = store.cameraIds().map((c) => 'camera_' + c).filter((d) => ids.includes(d) && !videoCams.includes(d));
    const first = DEVICE_ORDER.filter((d) => ids.includes(d)).concat(camDevices);
    const ordered = first.concat(ids.filter((d) => !first.includes(d) && !videoCams.includes(d)).sort());
    deviceIds = ['server'].concat(ordered.length ? ordered : DEVICE_ORDER, videoCams);
  }
  const deviceOn = (name) => {
    if (name === 'server') return online;
    if (alwaysOn(name)) return true;
    if (videoCams.includes(name)) return store.videoPhase(name.slice(7)) === 'live';
    return !!(S && S.devices[name] === 'connected');
  };

  return (
    <>
      <div className="alarm-bar" aria-hidden="true" />

      <div className="app">
        {/* 조작반: 상태 → 긴급정지 → 시작/정지 → 원점 → 모드 → 종료 */}
        <aside className="panel" aria-label={t('panel.label')}>
          <div className="state" aria-live="polite">
            <p className="state__word">
              <span className="lamp lamp--state" id="state-lamp" data-color={lampColor} data-blink={String(BLINKING.includes(p))} />
              <span id="state-word">{t('state.' + p)}</span>
            </p>
            <p className="state__detail" id="state-detail">{detail}</p>
          </div>

          <div className="estop">
            <button type="button" className="estop__plate" id="btn-estop" ref={estopBtn} aria-pressed={String(latched)} disabled={!ready} onClick={onEstop}>
              <span className="estop__head" aria-hidden="true" />
              <span id="estop-label">{t(latched ? 'estop.latched' : 'estop.press')}</span>
            </button>
            <Note id="estop-note" note={p === 'offline' ? offlineNote : (ui.notes.estop || ui.notes.release)} />
            <button type="button" className="key" id="btn-release" hidden={!latched} disabled={ui.busy.has('release')} onClick={onRelease}>
              <span>{t('estop.release')}</span>
            </button>
          </div>

          <div className="controls">
            {/* 시작 / 정지 — 하나의 키가 지금 할 수 있는 동작을 보여 준다 */}
            <button type="button" className="key key--primary" id="btn-run" disabled={!(stopped || running) || ui.busy.has('run')} onClick={onRun}>
              <Icon name={running ? 'stop' : 'play'} />
              <span id="run-label">{t(running ? 'run.stop' : 'run.start')}</span>
            </button>
            <Note id="run-note" note={ui.notes.run || runHint} />

            {/* 원점: 복귀는 자동 모드(저장된 원점으로 이동), 잡기는 수동 모드(리더암으로 둔 지금 자세를 원점으로 저장) */}
            <div className="homekeys">
              <button
                type="button" className="key" id="btn-home" aria-describedby="home-note"
                disabled={!stopped || manual || !home || ui.busy.has('home')}
                title={manual ? t('home.go.autoOnly') : ''}
                onClick={() => act('home', () => store.goHome())}
              >
                <Icon name="home" />
                <span>{t('home.go')}</span>
              </button>
              <button
                type="button" className="key" id="btn-sethome" aria-describedby="home-note"
                disabled={!(stopped || running) || auto || ui.busy.has('setHome') || store.loginUnknown()}
                title={auto ? t('home.set.manualOnly') : ''}
                onClick={onSetHome}
              >
                <Icon name="sethome" />
                <span>{t('home.set')}</span>
              </button>
            </div>
            <Note id="home-note" note={ui.notes.setHome || ui.notes.home || homeHint} />

            {/* 운전 모드 — 정지 상태에서만 */}
            <div className="mode" role="group" aria-labelledby="mode-legend">
              <p className="mode__legend" id="mode-legend">{t('mode.legend')}</p>
              <div className="mode__keys">
                {['auto', 'manual'].map((m) => (
                  <button
                    key={m} type="button" className="key key--mode" data-mode={m}
                    aria-pressed={String(!!S && S.mode === m)}
                    disabled={!stopped || ui.busy.has('mode')}
                    onClick={() => onMode(m)}
                  >
                    <span>{t('mode.' + m)}</span>
                  </button>
                ))}
              </div>
              <Note id="mode-note" note={ui.notes.mode} />
            </div>

            {/* 로봇팔이 옮길 부품 — 운전 모드처럼 정지 상태에서만 (사용자 2026-10-17) */}
            <div className="mode" role="group" aria-labelledby="sort-legend">
              <p className="mode__legend" id="sort-legend">{t('sort.legend')}</p>
              <div className="mode__keys">
                {['good', 'defect'].map((v) => (
                  <button
                    key={v} type="button" className="key key--mode" data-sort={v}
                    aria-pressed={String(sort.value === v)}
                    disabled={!stopped || ui.busy.has('sortTarget')}
                    onClick={() => onSortTarget(v)}
                  >
                    <span>{t('sort.' + v)}</span>
                  </button>
                ))}
              </div>
              <Note id="sort-note" note={ui.notes.sortTarget || sortHint} />
            </div>

            <div className="joints" id="joints" hidden={!showJoints}>
              <p className="joints__title">{t('joints.title')}</p>
              <dl className="joints__list" id="joints-list">
                {JOINTS.map((j) => {
                  // 퍼센트로 온 값(그리퍼)도 도로 바꿔 보인다 (store.shownAngle — 임의 범위, 화면 표시만)
                  const v = leader && leader.angles ? store.shownAngle(j, leader.angles[j], leader.units && leader.units[j]) : undefined;
                  return (
                    <div key={j}>
                      <dt>{t('joint.' + j)}</dt>
                      <dd>{typeof v === 'number' ? Math.round(v) + '°' : '–'}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </div>

          <div className="exit">
            <button type="button" className="key key--quiet" id="btn-exit" disabled={ended} onClick={onExit}>
              <Icon name="power" />
              <span>{t('exit.label')}</span>
            </button>
          </div>
        </aside>

        {/* 보기: 카메라 → 생산 통계 → 맨 아래 줄(장치 연결 · 다크 모드 · 로그) */}
        <main className="view">
          <section className="camera" aria-label={t('camera.label')}>
            <Camera source={streaming ? src : null} onView={(v) => { camera.current = v; }} />
            <div className="camera__empty" id="camera-empty" hidden={streaming}>
              <p>{t('camera.off')}</p>
              {/* 브릿지 영상은 서버 명령 없이 이 HMI에서 연다 — 서버 연결과 따로 */}
              <button
                type="button" className="key key--screen" id="btn-camera"
                disabled={(bridge ? false : !online || !S) || cameraBusy || ended}
                onClick={() => act('camera', () => store.startCamera())}
              >
                <span id="camera-btn-label">{t(cameraBusy ? 'camera.connecting' : 'camera.connect')}</span>
              </button>
              <Note id="camera-note" className="note note--screen" note={cameraNote} />
            </div>
            {/* 탑뷰/그리퍼 바꾸기 — 한 화면에 고른 카메라 하나 (사용자 2026-10-17). 영상을 보는 동안은 점으로 영상이 오는지도 보인다 */}
            {cams.length > 1 && (
              <div className="camera__switch" role="group" aria-label={t('camera.switch')}>
                {cams.map((id) => {
                  const phase = store.videoPhase(id);
                  return (
                    <button
                      key={id} type="button" className="camera__pick" data-camera={id}
                      aria-pressed={String(id === camId)} disabled={ended}
                      onClick={() => store.selectCamera(id)}
                    >
                      {phase && <span className="lamp" data-color={phase === 'live' ? 'green' : 'off'} aria-hidden="true" />}
                      <span>{store.cameraName(id)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {/* 이 PC 카메라는 서버가 켜고 끄지 않는다 */}
            <button
              type="button" className="camera__off" id="btn-camera-off"
              hidden={!streaming || src.transport === 'local'} disabled={cameraBusy}
              onClick={() => act('camera', () => store.stopCamera())}
            >
              <span>{t('camera.disconnect')}</span>
            </button>
          </section>

          <section className="stats" aria-label={t('stats.label')}>
            <dl className="stats__list">
              <div className="stat"><dt>{t('stats.total')}</dt><dd id="stat-total">{stats ? stats.total.toLocaleString() : '–'}</dd></div>
              <div className="stat"><dt>{t('stats.good')}</dt><dd id="stat-good">{stats ? stats.good.toLocaleString() : '–'}</dd></div>
              <div className="stat"><dt>{t('stats.defect')}</dt><dd id="stat-defect">{stats ? stats.defect.toLocaleString() : '–'}</dd></div>
              <div className="stat"><dt>{t('stats.rate')}</dt><dd id="stat-rate">{stats ? (stats.total ? (stats.defect / stats.total) * 100 : 0).toFixed(1) + '%' : '–'}</dd></div>
            </dl>
          </section>

          <div className="view__foot">
            <div className="devices" id="devices" hidden={!cfg.devMode}>
              <p className="devices__title">{t('devices.title')}</p>
              <ul className="devices__list" id="device-list">
                {deviceIds.map((name) => {
                  const on = deviceOn(name);
                  const forced = alwaysOn(name);
                  return (
                    <li key={name}>
                      {/* 가짜 서버면 누를 때마다 연결 끊김을 흉내 낸다 (늘 켜짐으로 보이는 장치는 빼고) */}
                      <button
                        type="button" className="device" disabled={!api.mock || forced}
                        title={api.mock && !forced ? t('devices.toggleHint') : undefined}
                        onClick={() => api.mock.setDevice(name, !deviceOn(name))}
                      >
                        <span className="lamp" data-color={on ? 'green' : 'off'} />
                        <span>{name === 'server' ? t('device.server') : store.deviceName(name)}</span>
                        {/* 색만으로 알리지 않도록 끊김은 글자로도 쓴다. 늘 켜짐으로 보이는 장치는 서버 값이 아니라고 쓴다 */}
                        <span hidden={on}>{t('devices.disconnected')}</span>
                        <span hidden={!forced}>{t('devices.alwaysOn')}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="view__tools">
              {/* 밖 주소에만 — 로그인하면 원점 잡기를 할 수 있다. 로그인한 동안은 로그아웃 키가 되고, 끝나는 시각을 풍선 도움말로 보인다 */}
              {auth.available && (
                <button
                  type="button" className="key key--quiet view__toggle" id="btn-login"
                  title={auth.loggedIn && auth.until ? t('login.until', { time: store.shortTime(auth.until) }) : undefined}
                  onClick={onLoginKey}
                >
                  <Icon name="key" />
                  <span>{t(auth.loggedIn ? 'login.logout' : 'login.open')}</span>
                </button>
              )}
              <button type="button" className="key key--quiet view__toggle" id="btn-theme" aria-pressed={String(dark)} onClick={toggleTheme}>
                <Icon name="moon" />
                <span>{t('theme.dark')}</span>
              </button>
              <button
                type="button" className="key key--quiet view__toggle" id="btn-log" ref={logBtn}
                aria-expanded={String(logOpen)} aria-controls="logwin" onClick={toggleLog}
              >
                <span className="view__log-icon">
                  <Icon name="log" />
                  <span className="notify-dot" id="log-dot" hidden={!unread} />
                </span>
                <span>{t('log.open')}</span>
                <span className="sr-only" id="log-dot-text" hidden={!unread}>{t('log.unread')}</span>
              </button>
            </div>
          </div>

          <LogWindow open={logOpen} entries={log} t={t} onClose={() => setLogOpen(false)} logButton={logBtn} />
        </main>
      </div>

      <ConfirmDialog ask={ask} t={t} onDone={() => setAsk(null)} />
      <LoginDialog ask={loginAsk} t={t} onLogin={onLogin} onDone={() => setLoginAsk(null)} />

      {ended && (
        <div className="ended" id="ended">
          <p className="ended__title">{t('ended.title')}</p>
          <p className="ended__body">{t('ended.body')}</p>
        </div>
      )}

      <Icons />
    </>
  );
}
