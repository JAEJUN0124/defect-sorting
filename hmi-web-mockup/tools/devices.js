// 장치 점검 — 로봇팔 서보(Feetech, Web Serial)·자세 저장 · USB 카메라 · 컨베이어 규약 점검 · 시리얼 콘솔. 설치·고장 확인용 (운영 화면 아님)
(function () {
  const robot = window.HMI_ROBOT;
  // 각도 단위: 서버(LeRobot)와 같게. 'norm'이면 -100~100, 아니면 도 (config/robot.js jointUnit)
  const UNIT = robot.jointUnit === 'norm' ? 'norm' : 'deg';
  const FT = window.Feetech;
  const CV = window.Conveyor;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const JOINTS = robot.joints;
  const LOCAL_KEY = window.CameraView.LOCAL_KEY;

  // 공통: 점검 결과 한 줄 (글자로 판정을 먼저 쓴다)
  function checks(listEl, items) {
    listEl.textContent = '';
    items.forEach(([kind, text]) => {
      const li = document.createElement('li');
      li.dataset.kind = kind;
      const mark = document.createElement('span');
      mark.className = 'checks__mark';
      mark.textContent = { ok: '정상', warn: '확인', bad: '문제' }[kind];
      const msg = document.createElement('span');
      msg.textContent = text;
      li.append(mark, msg);
      listEl.appendChild(li);
    });
  }

  // ---------- 1. 로봇팔 서보 ----------

  const sv = {
    arm: $('servo-arm'), connect: $('servo-connect'), fake: $('servo-fake'), live: $('servo-live'), close: $('servo-close'),
    port: $('servo-port'), checks: $('servo-checks'), table: $('servo-table'), rows: $('servo-rows'),
  };
  const servo = { link: null, bus: null, found: [], info: {}, tel: {}, timer: 0, busy: false };
  const po = { name: $('pose-name'), save: $('pose-save'), clear: $('pose-clear'), out: $('pose-out') };

  function setServoButtons(on) {
    sv.live.disabled = !on;
    sv.close.disabled = !on;
    po.save.disabled = !on;
    if (!on) { sv.live.setAttribute('aria-pressed', 'false'); clearInterval(servo.timer); }
  }

  async function servoDisconnect() {
    clearInterval(servo.timer);
    if (servo.link) { try { await servo.link.close(); } catch (e) { /* 이미 닫힘 */ } }
    Object.assign(servo, { link: null, bus: null, found: [], info: {}, tel: {} });
    setServoButtons(false);
  }

  async function servoConnect(fake) {
    await servoDisconnect();
    try {
      servo.link = fake
        ? FT.fakeLink({ voltage: sv.arm.value === 'leader' ? 7.4 : 12 })
        : await FT.openSerial({ baudRate: robot.bus.baudRate });
    } catch (err) {
      if (err.code === 'NO_WEB_SERIAL') sv.port.textContent = '이 브라우저는 USB 포트를 못 엽니다. Chrome·Edge에서 http://localhost 로 여세요.';
      else if (err.name === 'NotFoundError') sv.port.textContent = '포트를 고르지 않았습니다.';
      else sv.port.textContent = '포트를 열지 못했습니다(' + (err.name || err.message) + '). 서버나 다른 프로그램이 이 포트를 쓰고 있는지 확인하세요.';
      return;
    }
    servo.bus = new FT.Bus(servo.link, { timeoutMs: 100 });
    sv.port.textContent = fake
      ? '가짜 서보 6개(STS3215)에 연결했습니다.'
      : '연결: USB ' + (servo.link.usb || '?') + (servo.link.chip ? ' (' + servo.link.chip + ')' : '') + ', ' + robot.bus.baudRate.toLocaleString() + 'bps. 서보를 찾는 중…';
    servo.found = await servo.bus.scan([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const id of servo.found) {
      try { servo.info[id] = await servo.bus.info(id); } catch (e) { /* 읽기 실패는 표에 – 로 */ }
    }
    if (!fake) sv.port.textContent = sv.port.textContent.replace(' 서보를 찾는 중…', '');
    setServoButtons(true);
    await servoRead();
  }

  async function servoRead() {
    if (!servo.bus || servo.busy) return;
    servo.busy = true;
    try {
      for (const id of servo.found) {
        try { servo.tel[id] = await servo.bus.telemetry(id); } catch (e) { servo.tel[id] = null; }
      }
    } finally {
      servo.busy = false;
    }
    renderServo();
  }

  const jointOf = (id) => JOINTS[id - 1] || null;

  function displayPos(id) {
    const info = servo.info[id];
    const tel = servo.tel[id];
    const joint = jointOf(id);
    if (!info || !tel) return null;
    if (joint === 'gripper') return { value: FT.toPercent(tel.raw, info.minLimit, info.maxLimit), unit: '%' };
    if (UNIT === 'norm') {
      const p = FT.toPercent(tel.raw, info.minLimit, info.maxLimit);
      return p === null ? null : { value: p * 2 - 100, unit: '%' };
    }
    return { value: FT.toDegrees(tel.raw, info.minLimit, info.maxLimit), unit: '°' };
  }

  function renderServo() {
    const armId = sv.arm.value;
    const sup = robot.arms[armId].supply;
    const lim = robot.limits;
    sv.table.hidden = !servo.found.length;
    sv.rows.textContent = '';
    servo.found.forEach((id) => {
      const info = servo.info[id] || {};
      const tel = servo.tel[id];
      const pos = displayPos(id);
      const tr = sv.rows.insertRow();
      const cells = [
        String(id),
        jointOf(id) ? t('joint.' + jointOf(id)) : '(1~6 밖)',
        info.modelName || (info.model ? String(info.model) : '–'),
        pos && pos.value !== null ? pos.value.toFixed(1) + pos.unit : '–',
        tel ? String(tel.raw) : '–',
        info.minLimit !== undefined ? info.minLimit + '–' + info.maxLimit : '–',
        tel ? tel.volt.toFixed(1) + 'V' : '–',
        tel ? tel.temp + '°C' : '–',
        tel ? Math.abs(tel.load).toFixed(1) + '%' : '–',
        tel ? tel.current + 'mA' : '–',
        info.torque === undefined ? '–' : info.torque ? '켜짐' : '꺼짐',
        tel ? (tel.faults.length ? tel.faults.map((f) => t('fault.bit.' + f)).join(', ') : '정상') : '응답 없음',
      ];
      cells.forEach((text, i) => {
        const td = tr.insertCell();
        td.textContent = text;
        if ([3, 4, 6, 7, 8, 9].includes(i)) td.className = 'num';
      });
      if (tel && tel.temp >= lim.tempAlarm) tr.cells[7].className = 'num is-bad';
      else if (tel && tel.temp >= lim.tempWarn) tr.cells[7].className = 'num is-warn';
      if (tel && tel.faults.length) tr.cells[11].className = 'is-bad';
    });

    // 점검 결과
    const items = [];
    const expected = [1, 2, 3, 4, 5, 6];
    const missing = expected.filter((id) => !servo.found.includes(id));
    const extra = servo.found.filter((id) => !expected.includes(id));
    if (!servo.found.length) {
      items.push(['bad', '서보가 하나도 답하지 않습니다. DC 어댑터 전원, 보드와 서보 사이 선, 포트 선택을 확인하세요 (USB만으로는 서보에 전원이 가지 않습니다).']);
    } else {
      if (missing.length) items.push(['bad', 'ID ' + missing.map((id) => id + '(' + t('joint.' + jointOf(id)) + ')').join(', ') + ' 서보가 답하지 않습니다. 그 서보의 선 연결과 ID 설정을 확인하세요.']);
      else items.push(['ok', '서보 6개(ID 1~6)가 모두 답합니다.']);
      if (servo.found.length === 1 && servo.found[0] === 1) items.push(['warn', 'ID 1만 답합니다. 새 서보는 모두 ID 1이라, 여러 개를 이었다면 ID 설정(lerobot-setup-motors) 전일 수 있습니다.']);
      if (extra.length) items.push(['warn', 'ID ' + extra.join(', ') + '도 답합니다. SO-101은 ID 1~6만 씁니다.']);
      const notSts = servo.found.filter((id) => servo.info[id] && servo.info[id].model && servo.info[id].model !== 777);
      if (notSts.length) items.push(['warn', 'ID ' + notSts.join(', ') + '는 STS3215가 아닙니다(모델 번호 다름).']);
      const volts = servo.found.map((id) => servo.tel[id] && servo.tel[id].volt).filter((v) => typeof v === 'number').sort((a, b) => a - b);
      if (volts.length) {
        const v = volts[Math.floor(volts.length / 2)];
        const name = armId === 'leader' ? '리더암' : '로봇팔(팔로워)';
        if (sup.wrongAbove !== undefined && v > sup.wrongAbove) items.push(['bad', name + '에 ' + v.toFixed(1) + 'V가 들어옵니다. 12V 어댑터로 보입니다 — 7.5V 어댑터로 바꾸세요. 7.4V급 서보가 상할 수 있습니다.']);
        else if (sup.wrongBelow !== undefined && v < sup.wrongBelow) items.push(['bad', name + '에 ' + v.toFixed(1) + 'V가 들어옵니다. 7.5V 어댑터로 보입니다 — 12V 어댑터를 쓰세요(힘이 모자랍니다).']);
        else if (v < sup.warnLow || v > sup.warnHigh) items.push(['warn', name + ' 전원 ' + v.toFixed(1) + 'V — 정격 ' + sup.nominal + 'V에서 10% 넘게 벗어났습니다.']);
        else items.push(['ok', name + ' 전원 ' + v.toFixed(1) + 'V (정격 ' + sup.nominal + 'V 어댑터와 맞음).']);
      }
      const uncal = servo.found.filter((id) => servo.info[id] && jointOf(id) && FT.looksUncalibrated(servo.info[id], jointOf(id)));
      if (uncal.length) items.push(['warn', 'ID ' + uncal.join(', ') + '는 최소·최대 위치가 기본값(0–4095)입니다. 캘리브레이션 전으로 보입니다 — 서버 PC에서 lerobot-calibrate를 하세요.']);
      else items.push(['ok', '최소·최대 위치가 기록되어 있습니다 (캘리브레이션 값이 서보에 있음).']);
      const hot = servo.found.filter((id) => servo.tel[id] && servo.tel[id].temp >= lim.tempWarn);
      if (hot.length) items.push(['warn', 'ID ' + hot.join(', ') + ' 온도가 ' + lim.tempWarn + '°C 이상입니다. 쉬게 하고 통풍(상하좌우 10cm)을 확인하세요.']);
      const faulty = servo.found.filter((id) => servo.tel[id] && servo.tel[id].faults.length);
      if (faulty.length) items.push(['bad', 'ID ' + faulty.join(', ') + ' 서보가 이상 비트를 보냈습니다(상태 칸 참고).']);
    }
    if (servo.bus && servo.bus.stats.bad) items.push(['warn', '깨진 응답 ' + servo.bus.stats.bad + '번 — 선 접촉이나 통신 속도를 확인하세요.']);
    checks(sv.checks, items);
  }

  sv.connect.addEventListener('click', () => servoConnect(false));
  sv.fake.addEventListener('click', () => servoConnect(true));
  sv.close.addEventListener('click', async () => { await servoDisconnect(); sv.port.textContent = '연결을 끊었습니다.'; });
  sv.arm.addEventListener('change', () => { if (servo.bus) renderServo(); });
  sv.live.addEventListener('click', () => {
    const on = sv.live.getAttribute('aria-pressed') !== 'true';
    sv.live.setAttribute('aria-pressed', String(on));
    clearInterval(servo.timer);
    if (on) servo.timer = setInterval(servoRead, 300);
  });
  // ----- 자세 저장 (docs/arm-control.md 3.4장) -----
  // LeRobot과 같은 계산으로 6축을 읽어 이름별로 모은다. 이 브라우저에 남겨 두어 여러 자세를 차례로 모을 수 있다
  const POSE_KEY = 'hmi.armPoses';
  const loadPoses = () => { try { return JSON.parse(localStorage.getItem(POSE_KEY) || '{}'); } catch (e) { return {}; } };

  function renderPoses() {
    const poses = loadPoses();
    if (!Object.keys(poses).length) { po.out.textContent = '아직 모은 자세가 없습니다.'; return; }
    po.out.textContent = JSON.stringify({ unit: UNIT, poses }, null, 2)
      .replace(/\{\n\s+("shoulder_pan"[\s\S]*?)\n\s+\}/g, (m, body) => '{ ' + body.replace(/\n\s+/g, ' ') + ' }'); // 자세 하나를 한 줄로
  }

  po.save.addEventListener('click', async () => {
    const name = po.name.value.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(name)) { po.out.textContent = '자세 이름은 영문 소문자·숫자·밑줄로 쓰세요 (예: above_pick).'; return; }
    await servoRead();
    const pose = {};
    const missing = [];
    JOINTS.forEach((joint, i) => {
      const pos = displayPos(i + 1);
      if (pos && pos.value !== null) pose[joint] = Math.round(pos.value * 10) / 10;
      else missing.push(t('joint.' + joint));
    });
    if (missing.length) { po.out.textContent = missing.join(', ') + ' 값을 읽지 못해 저장하지 않았습니다. 서보 연결을 확인하세요.'; return; }
    const poses = loadPoses();
    poses[name] = pose;
    try { localStorage.setItem(POSE_KEY, JSON.stringify(poses)); } catch (e) { /* 저장이 막히면 화면에만 */ }
    renderPoses();
    try { await navigator.clipboard.writeText(po.out.textContent); } catch (e) { /* 복사가 막히면 화면의 글을 직접 복사 */ }
  });

  po.clear.addEventListener('click', () => {
    try { localStorage.removeItem(POSE_KEY); } catch (e) { /* 이미 비어 있음 */ }
    renderPoses();
  });
  renderPoses();

  // ---------- 2. 카메라 ----------

  const cam = { list: $('cam-list'), device: $('cam-device'), slot: $('cam-slot'), save: $('cam-save'), fake: $('cam-fake'), video: $('cam-video'), info: $('cam-info'), saved: $('cam-saved') };
  let camStream = null;
  let fakeTimer = 0;

  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch (e) { return {}; } };
  function renderSaved() {
    const saved = loadSaved();
    const keys = Object.keys(saved);
    cam.saved.textContent = keys.length
      ? '저장된 자리 (이 브라우저):\n' + keys.map((k) => '  ' + k + ' → ' + saved[k].slice(0, 16) + '…').join('\n')
      : '아직 저장된 자리가 없습니다.';
  }

  function stopCam() {
    clearInterval(fakeTimer);
    if (camStream) camStream.getTracks().forEach((tr) => tr.stop());
    camStream = null;
    cam.video.srcObject = null;
  }

  function showStream(stream, label) {
    stopCam();
    camStream = stream;
    cam.video.srcObject = stream;
    cam.video.play().catch(() => {});
    const s = stream.getVideoTracks()[0].getSettings();
    cam.info.textContent = label + ': 실제 ' + (s.width || '?') + '×' + (s.height || '?') + (s.frameRate ? ', ' + Math.round(s.frameRate) + 'fps' : '') + '. 키트 카메라는 1280×720(720p)이 나와야 합니다.';
  }

  async function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cam.info.textContent = '이 브라우저는 카메라를 못 엽니다. Chrome·Edge에서 http://localhost 로 여세요.'; return; }
    try {
      // 이름(라벨)은 권한을 한 번 받은 뒤에만 보인다
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((tr) => tr.stop());
    } catch (err) {
      cam.info.textContent = '카메라를 열지 못했습니다(' + err.name + '). 권한, USB 연결, 다른 프로그램(서버)이 쓰는지 확인하세요.';
      return;
    }
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    cam.device.textContent = '';
    devices.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || '카메라 ' + (i + 1);
      cam.device.appendChild(o);
    });
    cam.info.textContent = '카메라 ' + devices.length + '대를 찾았습니다.' + (devices.length < 2 ? ' 키트에는 2대가 있습니다.' : '');
    cam.save.disabled = !devices.length;
    if (devices.length) openCamera();
  }

  async function openCamera() {
    const id = cam.device.value;
    if (!id) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      showStream(stream, cam.device.selectedOptions[0].textContent);
    } catch (err) {
      cam.info.textContent = '이 카메라를 열지 못했습니다(' + err.name + ').';
    }
  }

  // 하드웨어 없이 화면을 시험할 때: 캔버스를 영상처럼 쓴다
  function fakeCamera() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let x = 0;
    const draw = () => {
      ctx.fillStyle = '#23282D';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#353C43';
      ctx.fillRect(0, 216, 1280, 288);
      ctx.fillStyle = '#C3C9CF';
      ctx.fillRect(x % 1380 - 100, 312, 96, 96);
      ctx.fillStyle = '#C9CED4';
      ctx.font = '600 32px sans-serif';
      ctx.fillText('가짜 카메라 1280×720', 32, 60);
      x += 8;
    };
    draw();
    const stream = canvas.captureStream(30);
    showStream(stream, '가짜 카메라');
    fakeTimer = setInterval(draw, 33);
  }

  cam.list.addEventListener('click', listCameras);
  cam.device.addEventListener('change', openCamera);
  cam.fake.addEventListener('click', fakeCamera);
  cam.save.addEventListener('click', () => {
    const saved = loadSaved();
    saved[cam.slot.value] = cam.device.value;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(saved)); } catch (e) { cam.info.textContent = '이 브라우저는 저장이 막혀 있습니다.'; }
    renderSaved();
  });
  renderSaved();

  // 서버 영상 주소 시험 — 판정 화면과 같은 camera.js로 연다
  const st = { url: $('stream-url'), transport: $('stream-transport'), open: $('stream-open'), close: $('stream-close'), state: $('stream-state') };
  const STATE_TEXT = { off: '닫혀 있습니다.', loading: '영상을 기다리는 중…', live: '영상을 받고 있습니다.', error: '영상을 받지 못했습니다. 주소·방식·서버의 다른 주소 허용(CORS)을 확인하세요.' };
  const view = new window.CameraView($('stream-stage'), { onState: (s) => { st.state.textContent = STATE_TEXT[s] || s; } });
  st.open.addEventListener('click', () => {
    const url = st.url.value.trim();
    if (!url) { st.state.textContent = '영상 주소를 넣으세요.'; return; }
    view.set(null);
    view.set({ id: 'test', streaming: true, url, transport: st.transport.value });
  });
  st.close.addEventListener('click', () => view.set(null));

  // ---------- 3. 컨베이어 (아두이노 규약 점검, docs/conveyor-protocol.md) ----------
  // 서버 쪽 견본(Conveyor.Client)으로 연결해, 사람이 명령을 보내 보거나 규약 점검을 차례로 돌린다

  const cv = {
    connect: $('cv-connect'), fake: $('cv-fake'), close: $('cv-close'), port: $('cv-port'), state: $('cv-state'),
    keys: Array.from(document.querySelectorAll('[data-cv]')), speed: $('cv-speed'), motion: $('cv-motion'),
    check: $('cv-check'), checks: $('cv-checks'), log: $('cv-log'),
  };
  const conv = { client: null, link: null, checking: false, lastEvent: null };
  const STATE_WORD = { stopped: '멈춤', running: '가동', halted: '잠긴 정지' };
  const REASON_WORD = { boot: '켜짐', command: '명령', part: '센서에 부품', watchdog: '감시 타이머', button: '정지 단추', fault: '이상' };

  function cvLog(text) {
    cv.log.textContent = (cv.log.textContent + text + '\n').slice(-12000);
    cv.log.scrollTop = cv.log.scrollHeight;
  }

  function setConveyorKeys() {
    const on = !!conv.client && !conv.checking;
    cv.keys.forEach((b) => { b.disabled = !on; });
    cv.check.disabled = !on;
    cv.close.disabled = !conv.client;
  }

  function renderConveyor() {
    const c = conv.client;
    if (!c) { cv.state.textContent = '연결하지 않았습니다.'; return; }
    const i = c.caps;
    const s = c.state || {};
    const caps = i ? ['speed', 'sensor', 'autostop', 'button'].filter((k) => i[k]).map((k) => ({ speed: '속도 조절', sensor: '부품 센서', autostop: '스스로 멈추기', button: '정지 단추' })[k]) : [];
    const lines = [];
    lines.push(i ? '규약 ' + i.proto + ' · ' + (i.name || '?') + ' ' + (i.fw || '') + ' · 기능: ' + (caps.join(', ') || '없음') + ' · 감시 ' + (i.watchdogMs ? i.watchdogMs + 'ms' : '?') : 'INFO를 아직 받지 못했습니다.');
    lines.push('상태: ' + (STATE_WORD[s.state] || s.state || '?') + (s.reason ? ' (' + (REASON_WORD[s.reason] || s.reason) + (s.code ? ' ' + s.code : '') + ')' : '')
      + ' · 속도 ' + (typeof s.speed === 'number' ? s.speed + '%' : '–')
      + ' · 센서 ' + (s.part === null || s.part === undefined ? '–' : s.part ? '부품 있음' : '비어 있음')
      + ' · 스스로 멈추기 ' + (s.autostop ? '켜짐' : '꺼짐'));
    if (conv.lastEvent) lines.push('마지막 알림: ' + conv.lastEvent);
    if (c.lost) lines.push('응답이 없습니다 (3번 이어서). 선과 전원을 확인하세요.');
    cv.state.textContent = lines.join('\n');
    const auto = cv.keys.find((b) => b.dataset.cv === 'autostop');
    auto.setAttribute('aria-pressed', String(!!s.autostop));
  }

  async function conveyorDisconnect() {
    const c = conv.client;
    conv.client = null;
    conv.lastEvent = null;
    if (c) await c.close();
    setConveyorKeys();
    renderConveyor();
  }

  async function conveyorConnect(fake) {
    await conveyorDisconnect();
    cv.checks.textContent = '';
    try {
      conv.link = fake ? CV.fakeLink({ bootMs: 400 }) : await FT.openSerial({ baudRate: 115200 });
    } catch (err) {
      if (err.code === 'NO_WEB_SERIAL') cv.port.textContent = '이 브라우저는 USB 포트를 못 엽니다. Chrome·Edge에서 http://localhost 로 여세요.';
      else if (err.name === 'NotFoundError') cv.port.textContent = '포트를 고르지 않았습니다.';
      else cv.port.textContent = '포트를 열지 못했습니다(' + (err.name || err.message) + '). 서버나 시리얼 콘솔이 이 포트를 쓰고 있는지 확인하세요.';
      return;
    }
    const c = new CV.Client(conv.link, { readyWaitMs: 3000 });
    conv.client = c;
    c.on((kind, data) => {
      if (kind === 'line') {
        // 0.25초마다 오가는 살아 있음 신호(PING과 그 OK)는 줄 기록에 남기지 않는다
        if (data.dir === 'out' && data.text === 'PING') { conv.pingPending = true; return; }
        if (data.dir === 'in' && conv.pingPending && data.text === 'OK') { conv.pingPending = false; return; }
        conv.pingPending = false;
        cvLog((data.dir === 'out' ? '→ ' : '← ') + data.text);
      }
      if (kind === 'event') conv.lastEvent = data.line;
      if (['state', 'part', 'event', 'lost', 'back', 'ready'].includes(kind)) renderConveyor();
    });
    cv.port.textContent = (fake ? '가짜 컨베이어에 연결했습니다.' : '연결: USB ' + (conv.link.usb || '?') + (conv.link.chip ? ' (' + conv.link.chip + ')' : '') + ', 115200bps.')
      + ' 켜짐 알림(!READY)을 기다리는 중…';
    setConveyorKeys();
    try {
      await c.open();
      cv.port.textContent = cv.port.textContent.replace(' 켜짐 알림(!READY)을 기다리는 중…', c.readyFields ? '' : ' 켜짐 알림이 없었습니다 (리셋되지 않는 보드면 괜찮음).');
    } catch (err) {
      cv.port.textContent += ' — 규약대로 답하지 않습니다(' + err.code + '). 아래 규약 점검으로 무엇이 다른지 보세요.';
    }
    renderConveyor();
  }

  // 명령 하나 — 결과를 줄 기록에 남기고 상태를 다시 묻는다
  async function conveyorCommand(name) {
    const c = conv.client;
    if (!c) return;
    try {
      if (name === 'speed') await c.speed(Math.max(0, Math.min(100, Number(cv.speed.value) || 0)));
      else if (name === 'autostop') await c.autostop(!(c.state && c.state.autostop));
      else await c[name]();
      await c.status();
    } catch (err) {
      cvLog('   (' + ({ HALTED: '잠겨 있어 거절 — 잠금 풀기를 먼저', UNSUPPORTED: '이 컨베이어에 없는 기능', TIMEOUT: '응답 없음', BAD_ARG: '값이 범위 밖' }[err.code] || err.code) + ')');
    }
    renderConveyor();
  }

  cv.connect.addEventListener('click', () => conveyorConnect(false));
  cv.fake.addEventListener('click', () => conveyorConnect(true));
  cv.close.addEventListener('click', async () => { await conveyorDisconnect(); cv.port.textContent = '연결을 끊었습니다.'; });
  cv.keys.forEach((b) => b.addEventListener('click', () => conveyorCommand(b.dataset.cv)));
  cv.check.addEventListener('click', async () => {
    if (!conv.client) return;
    conv.checking = true;
    setConveyorKeys();
    cv.checks.textContent = '';
    const items = [];
    const kind = (ok) => (ok === true ? 'ok' : ok === false ? 'bad' : 'warn');
    try {
      await CV.check(conv.client, {
        motion: cv.motion.checked,
        onStep: (r) => { items.push([kind(r.ok), r.title + (r.note ? ' — ' + r.note : '')]); checks(cv.checks, items); },
      });
    } finally {
      conv.checking = false;
      setConveyorKeys();
      renderConveyor();
    }
    const bad = items.filter((x) => x[0] === 'bad').length;
    items.push([bad ? 'bad' : 'ok', bad ? bad + '개가 규약과 다릅니다. 위 줄을 보고 스케치를 고치세요.' : '규약대로 답합니다.']);
    checks(cv.checks, items);
  });

  // ---------- 4. 시리얼 콘솔 ----------

  const se = { baud: $('ser-baud'), connect: $('ser-connect'), close: $('ser-close'), input: $('ser-input'), eol: $('ser-eol'), send: $('ser-send'), out: $('ser-out') };
  let serial = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const MAX_OUT = 20000;

  function log(text) {
    se.out.textContent = (se.out.textContent + text).slice(-MAX_OUT);
    se.out.scrollTop = se.out.scrollHeight;
  }

  se.connect.addEventListener('click', async () => {
    if (serial) { await serial.close().catch(() => {}); serial = null; }
    try {
      serial = await FT.openSerial({ baudRate: Number(se.baud.value) });
    } catch (err) {
      log('[연결 실패] ' + (err.code === 'NO_WEB_SERIAL' ? 'Chrome·Edge에서 http://localhost 로 여세요.' : err.name || err.message) + '\n');
      return;
    }
    serial.onData((bytes) => log(decoder.decode(bytes, { stream: true })));
    log('[연결] USB ' + (serial.usb || '?') + (serial.chip ? ' (' + serial.chip + ')' : '') + ', ' + Number(se.baud.value).toLocaleString() + 'bps\n');
    se.close.disabled = false;
    se.send.disabled = false;
  });

  se.close.addEventListener('click', async () => {
    if (serial) await serial.close().catch(() => {});
    serial = null;
    se.close.disabled = true;
    se.send.disabled = true;
    log('[끊음]\n');
  });

  const sendLine = async () => {
    if (!serial) return;
    const eol = se.eol.value.replace('\\r', '\r').replace('\\n', '\n');
    await serial.write(encoder.encode(se.input.value + eol));
    log('> ' + se.input.value + '\n');
    se.input.value = '';
  };
  se.send.addEventListener('click', sendLine);
  se.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendLine(); });

  window.addEventListener('beforeunload', () => { servoDisconnect(); conveyorDisconnect(); stopCam(); if (serial) serial.close().catch(() => {}); });
})();
