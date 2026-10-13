// 서버 형식 맞추기 — 서버가 어떤 모양으로 보내도 HMI 안에서는 한 가지 모양(docs/API.md v0.4)으로 바꿔 씁니다.
// 서버 담당이 이름·단위·묶음 방식을 다르게 정해도 화면 코드는 고치지 않고, 여기서 흡수합니다.
// 무엇을 바꿨는지는 notes()에 쌓입니다. tools/server-check.html이 이 기록으로 "서버가 어떤 형식인지" 보여 줍니다.
// 대응표: docs/server-cases.md
(function (root) {
  'use strict';

  const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

  // 이름 비교는 소문자·영숫자만 남겨서 한다: line_state = lineState = LINE-STATE
  const compact = (k) => String(k).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

  // 받는 메시지 종류와 다른 이름들 (첫 번째가 HMI 안에서 쓰는 이름)
  const TYPES = {
    status: ['status', 'state', 'snapshot', 'linestatus', 'systemstatus', 'statusupdate'],
    inspection: ['inspection', 'inspect', 'result', 'detection', 'judgement', 'judgment', 'decision', 'classification', 'part'],
    event: ['event', 'log', 'alarm', 'alert', 'notice', 'notification'],
    joints: ['joints', 'jointstate', 'jointstates', 'positions', 'pose', 'leader', 'action'],
    telemetry: ['telemetry', 'motors', 'servos', 'servostate', 'motorstate', 'health'],
    heartbeat: ['heartbeat', 'ping', 'hb', 'keepalive', 'alive', 'tick', 'pong'],
    home_complete: ['homecomplete', 'homed', 'homedone', 'homefinished', 'homingcomplete', 'homingdone'],
    shutdown_complete: ['shutdowncomplete', 'shutdowndone', 'shutdownfinished', 'bye', 'goodbye'],
    metrics: ['metrics', 'performance', 'perf', 'stats_metrics', 'inference'],
    frame: ['frame', 'image', 'videoframe', 'cameraframe', 'jpeg'],
    command_result: ['commandresult', 'ack', 'response', 'reply', 'result_command'],
    info: ['info', 'hello', 'welcome', 'capabilities', 'serverinfo'],
  };
  const TYPE_OF = new Map();
  Object.entries(TYPES).forEach(([type, names]) => names.forEach((n) => TYPE_OF.set(compact(n), type)));

  const LINE = {
    stopped: ['stopped', 'stop', 'idle', 'ready', 'standby', 'paused', 'pause', 'waiting', 'off'],
    starting: ['starting', 'start', 'startup', 'booting', 'initializing', 'init', 'preparing', 'warmingup'],
    running: ['running', 'run', 'active', 'operating', 'working', 'busy', 'inprogress', 'producing', 'on'],
    stopping: ['stopping', 'halting', 'shuttingdown'],
    homing: ['homing', 'home', 'returninghome', 'gohome', 'movinghome', 'goinghome'],
  };
  const LINE_ESTOP = ['estop', 'emergency', 'emergencystop', 'ems', 'estopped', 'estopactive'];
  const LINE_FAULT = ['fault', 'error', 'alarm', 'failed', 'failure', 'tripped'];
  const MODE = {
    auto: ['auto', 'automatic', 'autonomous', 'policy', 'ai', 'autorun', 'automode', '자동'],
    manual: ['manual', 'teleop', 'teleoperation', 'hand', 'jog', 'manualmode', '수동'],
  };
  // 공정 단계 (상태 cycle.stage, docs/line-sequence.md 1장)
  const STAGE = {
    feeding: ['feeding', 'feed', 'conveying', 'transport', 'waitingpart', 'waitpart', 'loading', 'moving', 'indexing'],
    inspecting: ['inspecting', 'inspect', 'inspection', 'judging', 'judge', 'capturing', 'capture', 'detecting', 'settling'],
    sorting: ['sorting', 'sort', 'picking', 'pick', 'removing', 'rejecting', 'reject'],
    passing: ['passing', 'pass', 'ejecting', 'eject', 'unloading', 'discharging', 'outfeed'],
  };
  // 고장이 풀리는 방법 (fault.clear, docs/API.md 3.1)
  const CLEAR = {
    auto: ['auto', 'automatic', 'self', 'condition', 'none'],
    home: ['home', 'homing', 'origin', 'rehome'],
    start: ['start', 'ack', 'acknowledge', 'confirm', 'restart', 'operator'],
  };
  const DEVICE = {
    conveyor: ['conveyor', 'belt', 'arduino', 'conveyorbelt', 'plc', 'conveyorarduino'],
    arm: ['arm', 'robot', 'follower', 'followerarm', 'robotarm', 'so101', 'so101follower', 'sofollower', 'mainarm'],
    leader: ['leader', 'leaderarm', 'teleop', 'teleoperator', 'so101leader', 'soleader', 'master', 'masterarm'],
  };
  const CONNECTED = ['connected', 'ok', 'online', 'ready', 'up', 'true', 'on', 'normal', 'running', 'idle', 'active', 'alive', 'good', 'open', 'streaming', 'available', '1', 'yes', '연결'];
  const DISCONNECTED = ['disconnected', 'offline', 'down', 'lost', 'error', 'fault', 'false', 'off', 'missing', 'notconnected', 'unavailable', 'timeout', 'failed', 'fail', 'closed', 'none', '0', 'no', '끊김'];
  const GOOD = ['good', 'ok', 'pass', 'passed', 'normal', 'accept', 'accepted', 'g', 'okay', 'conforming', '양품', '정상'];
  const DEFECT = ['defect', 'defective', 'ng', 'nogood', 'fail', 'failed', 'bad', 'abnormal', 'reject', 'rejected', 'nok', 'anomaly', 'anomalous', 'nonconforming', 'd', '불량'];
  const LEVEL = {
    info: ['info', 'information', 'normal', 'notice', 'debug', 'trace', 'ok', 'success', 'i'],
    warning: ['warning', 'warn', 'caution', 'minor', 'w', 'medium', 'low'],
    alarm: ['alarm', 'error', 'critical', 'emergency', 'fatal', 'major', 'severe', 'high', 'danger', 'e', 'crit'],
  };
  const JOINT_ALIAS = {
    shoulder_pan: ['shoulderpan', 'pan', 'base', 'waist', 'joint1', 'j1', 'joint0', 'motor1', '1'],
    shoulder_lift: ['shoulderlift', 'shoulder', 'lift', 'joint2', 'j2', 'motor2', '2'],
    elbow_flex: ['elbowflex', 'elbow', 'joint3', 'j3', 'motor3', '3'],
    wrist_flex: ['wristflex', 'wrist', 'wristpitch', 'pitch', 'joint4', 'j4', 'motor4', '4'],
    wrist_roll: ['wristroll', 'roll', 'joint5', 'j5', 'motor5', '5'],
    gripper: ['gripper', 'jaw', 'claw', 'hand', 'grip', 'joint6', 'j6', 'motor6', '6'],
  };
  const JOINT_OF = new Map();
  Object.entries(JOINT_ALIAS).forEach(([id, names]) => names.forEach((n) => JOINT_OF.set(n, id)));
  const TRANSPORT = {
    mjpeg: ['mjpeg', 'mjpg', 'multipart', 'motionjpeg', 'mxmixedreplace'],
    snapshot: ['snapshot', 'jpeg', 'jpg', 'still', 'image', 'png', 'poll'],
    ws: ['ws', 'websocket', 'wss', 'socket'],
    webrtc: ['webrtc', 'whep', 'rtc'],
    video: ['video', 'hls', 'm3u8', 'mp4', 'webm', 'dash'],
    local: ['local', 'usb', 'getusermedia', 'browser'],
    mock: ['mock', 'fake', 'sim'],
  };
  const ERROR_ALIAS = {
    ESTOP_ACTIVE: ['ESTOP', 'E_STOP_ACTIVE', 'EMERGENCY_STOP_ACTIVE', 'EMERGENCY_STOP', 'ESTOPPED', 'EMS_ACTIVE'],
    DEVICES_NOT_READY: ['DEVICE_NOT_READY', 'NOT_READY', 'DEVICE_DISCONNECTED', 'DEVICES_DISCONNECTED', 'HARDWARE_NOT_READY'],
    NOT_STOPPED: ['NOT_IDLE', 'RUNNING', 'LINE_RUNNING', 'MUST_BE_STOPPED', 'NOT_STOPPED_STATE'],
    INVALID_STATE: ['BUSY', 'INVALID_STATE_TRANSITION', 'WRONG_STATE', 'ILLEGAL_STATE', 'CONFLICT'],
    NOT_AUTO: ['MODE_MANUAL', 'NOT_AUTO_MODE', 'NOT_IN_AUTO', 'AUTO_ONLY', 'AUTO_MODE_REQUIRED'],
    NOT_MANUAL: ['MODE_AUTO', 'NOT_MANUAL_MODE', 'NOT_IN_MANUAL', 'MANUAL_ONLY', 'MANUAL_MODE_REQUIRED'],
    HOME_NOT_SET: ['NO_HOME', 'HOME_UNSET', 'HOME_MISSING', 'ORIGIN_NOT_SET', 'NO_ORIGIN'],
  };
  const ERROR_OF = new Map();
  Object.entries(ERROR_ALIAS).forEach(([code, names]) => names.forEach((n) => ERROR_OF.set(n, code)));
  // 이벤트 코드의 다른 이름들 (소문자 밑줄로 바꾼 뒤 비교)
  const EVENT_ALIAS = {
    estop_pressed: ['emergency_stop_pressed', 'emergency_stop', 'estop', 'e_stop', 'e_stop_pressed', 'estop_activated', 'emergency_stop_activated'],
    estop_released: ['emergency_stop_released', 'estop_reset', 'e_stop_released', 'estop_cleared', 'emergency_stop_reset', 'emergency_released'],
    line_started: ['started', 'run_started', 'line_start', 'production_started'],
    line_stopped: ['stopped', 'run_stopped', 'line_stop', 'production_stopped'],
    mode_changed: ['mode_change', 'mode_set', 'mode_switched'],
    home_started: ['homing_started', 'home_start'],
    home_completed: ['homed', 'home_done', 'homing_done', 'homing_completed', 'home_complete'],
    home_set: ['home_saved', 'home_updated', 'set_home', 'home_taught', 'origin_set', 'origin_saved'],
    defect_detected: ['ng_detected', 'defect_found'],
    device_disconnected: ['disconnected', 'device_lost', 'connection_lost'],
    device_reconnected: ['reconnected', 'device_connected'],
    camera_started: ['camera_on', 'stream_started'],
    camera_stopped: ['camera_off', 'stream_stopped'],
    shutdown_started: ['shutting_down', 'shutdown_requested'],
  };
  const EVENT_OF = new Map();
  Object.entries(EVENT_ALIAS).forEach(([code, names]) => names.forEach((n) => EVENT_OF.set(n, code)));
  // Feetech 서보 상태 비트 (주소 65): 0 전압, 1 센서, 2 온도, 3 전류, 5 과부하
  const STATUS_BITS = [[0, 'voltage'], [1, 'sensor'], [2, 'temperature'], [3, 'current'], [5, 'overload']];

  function create(options) {
    const opt = Object.assign({
      jointUnit: 'auto',      // 'auto' | 'deg' | 'norm' | 'rad' | 'raw'
      naiveTime: 'local',     // 시간대가 없는 시각: 'local'(이 PC 시간대) | 'utc'
      primaryCamera: 'auto',  // 주 카메라 id. 'auto'면 서버 정보의 첫 카메라, 그것도 없으면 'main'(카메라 한 대인 v0.1 서버)
      bboxFormat: 'xywh',     // 'xywh'(왼쪽 위 + 크기) | 'xyxy'(두 모서리) | 'cxcywh'(가운데 + 크기, YOLO)
      loadUnit: 'auto',       // 서보 부하: 'pct'(%) | 'permille'(서보 원시값, 0.1%) | 'auto'(100을 넘는 값을 한 번 보면 그 뒤로 원시값)
    }, options);
    let info = null;
    let loadPermille = opt.loadUnit === 'permille';
    const notes = new Map();
    const note = (code) => notes.set(code, (notes.get(code) || 0) + 1);

    // 이름 여러 개 중 처음 찾은 것을 돌려준다. 첫 이름이 아니면 "다른 이름을 썼다"고 기록한다
    function pick(obj, names, what) {
      if (!isObj(obj)) return null;
      const ix = new Map();
      Object.keys(obj).forEach((k) => { const c = compact(k); if (!ix.has(c)) ix.set(c, k); });
      for (let i = 0; i < names.length; i += 1) {
        const key = ix.get(names[i]);
        if (key === undefined || obj[key] === undefined) continue;
        if (i > 0 && what) note('field.alias:' + key + '→' + what);
        return { key, value: obj[key] };
      }
      return null;
    }
    const val = (obj, names, what) => { const p = pick(obj, names, what); return p ? p.value : undefined; };

    function mapWord(raw, table, kind) {
      const c = compact(raw);
      for (const [id, names] of Object.entries(table)) {
        if (names.includes(c)) {
          if (c !== compact(id)) note(kind + '.alias:' + raw);
          return id;
        }
      }
      return null;
    }

    const bool = (v) => {
      if (typeof v === 'boolean') return v;
      if (v === 1 || v === 0) return v === 1;
      if (typeof v === 'string') {
        const c = compact(v);
        if (['true', 'on', 'yes', 'active', 'pressed', 'latched', 'engaged', 'enabled', '1', 'set'].includes(c)) return true;
        if (['false', 'off', 'no', 'inactive', 'released', 'clear', 'disabled', '0', 'reset', 'none'].includes(c)) return false;
      }
      return null;
    };

    // ---------- 시각 ----------
    // ISO 8601, 날짜와 시각 사이 공백, 1970년 기준 초·밀리초를 받는다. 시간대가 없으면 opt.naiveTime을 따른다.
    function time(v) {
      if (v === null || v === undefined || v === '') return null;
      const n = num(v);
      if (n !== null) {
        if (n > 1e12) { note('time.epoch_ms'); return new Date(n).toISOString(); }
        if (n > 1e9) { note('time.epoch_s'); return new Date(n * 1000).toISOString(); }
        note('time.invalid');
        return null;
      }
      if (typeof v !== 'string') return null;
      let s = v.trim();
      if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) { s = s.replace(' ', 'T'); note('time.space'); }
      s = s.replace(/(\.\d{3})\d+/, '$1'); // 파이썬 isoformat()의 마이크로초는 밀리초까지만
      if (/T\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
        note('time.naive');
        if (opt.naiveTime === 'utc') s += 'Z';
      }
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) { note('time.invalid'); return null; }
      return d.toISOString();
    }
    const timeOf = (obj) => time(val(obj, ['at', 'time', 'timestamp', 'ts', 'datetime', 'date', 'created', 'createdat', 'stamp'], 'at'));
    // 판정·이벤트의 순번(v0.3). 서버를 켤 때부터 하나씩 늘어난다
    const seqOf = (obj) => num(val(obj, ['seq', 'sequence', 'seqno', 'cursor']));

    // ---------- 장치 ----------
    function cameraIdOf(raw) {
      const s = String(raw);
      const m = /^(?:camera|cam)[\s_.:\-]?(.+)$/i.exec(s);
      return m ? m[1] : s;
    }
    function deviceId(key) {
      const c = compact(key);
      for (const [id, names] of Object.entries(DEVICE)) {
        if (names.includes(c)) {
          if (c !== id) note('device.alias:' + key);
          return id;
        }
      }
      if (['camera', 'cam', 'webcam', 'cameras', 'cams'].includes(c)) return 'camera_' + primaryCamera();
      if (/^(?:camera|cam)[\s_.:\-]?.+$/i.test(String(key))) return 'camera_' + cameraIdOf(key);
      return String(key);
    }
    function deviceState(v) {
      if (isObj(v)) return deviceState(val(v, ['connected', 'state', 'status', 'online', 'ok', 'ready', 'alive']));
      if (v === true || v === 1) return 'connected';
      if (v === false || v === 0) return 'disconnected';
      if (typeof v === 'string') {
        const c = compact(v);
        if (CONNECTED.includes(c)) { if (c !== 'connected') note('device.state.alias:' + v); return 'connected'; }
        if (DISCONNECTED.includes(c)) { if (c !== 'disconnected') note('device.state.alias:' + v); return 'disconnected'; }
      }
      note('device.state.unknown');
      return 'unknown';
    }
    function devices(raw) {
      const out = {};
      const put = (key, v) => {
        if (/^cameras?$/i.test(key) && (isObj(v) || Array.isArray(v))) {
          note('device.cameras.nested');
          if (Array.isArray(v)) v.forEach((c) => { if (isObj(c)) put('camera_' + (val(c, ['id', 'name', 'camera']) || primaryCamera()), c); });
          else Object.entries(v).forEach(([id, s]) => put('camera_' + id, s));
          return;
        }
        out[deviceId(key)] = deviceState(v);
      };
      if (Array.isArray(raw)) {
        note('device.array');
        raw.forEach((d) => { if (isObj(d)) put(String(val(d, ['id', 'name', 'device', 'key']) || '?'), d); });
      } else if (isObj(raw)) {
        Object.entries(raw).forEach(([k, v]) => put(k, v));
      }
      return out;
    }

    // ---------- 카메라 ----------
    function transportOf(raw, url) {
      if (raw) {
        const t = mapWord(raw, TRANSPORT, 'camera.transport');
        if (t) return t;
        note('camera.transport.unknown:' + raw);
      }
      if (typeof url === 'string' && url) {
        note('camera.transport.guess');
        if (/^wss?:/i.test(url)) return 'ws';
        if (/\.m3u8|\.mp4|\.webm/i.test(url)) return 'video';
        if (/whep|webrtc/i.test(url)) return 'webrtc';
        if (/\.(jpe?g|png)(\?|$)|snapshot|still/i.test(url)) return 'snapshot';
      }
      return null;
    }
    function cameraState(raw) {
      if (typeof raw === 'string') return { streaming: true, url: raw, transport: transportOf(null, raw) };
      if (!isObj(raw)) return { streaming: bool(raw) === true, url: null, transport: null };
      const url = val(raw, ['url', 'stream', 'streamurl', 'src', 'uri', 'href', 'endpoint', 'path'], 'url');
      let streaming = bool(val(raw, ['streaming', 'active', 'on', 'running', 'enabled', 'open', 'live', 'started'], 'streaming'));
      if (streaming === null) streaming = !!url;
      const out = {
        streaming,
        url: typeof url === 'string' && url ? url : null,
        transport: transportOf(val(raw, ['transport', 'protocol', 'kind', 'format', 'type', 'codec']), url),
      };
      const label = val(raw, ['label', 'name', 'title']);
      if (typeof label === 'string') out.label = label;
      const w = num(val(raw, ['width', 'w'])); const h = num(val(raw, ['height', 'h'])); const fps = num(val(raw, ['fps', 'framerate']));
      if (w) out.width = w;
      if (h) out.height = h;
      if (fps) out.fps = fps;
      return out;
    }
    function cameras(raw) {
      const out = {};
      if (Array.isArray(raw)) {
        raw.forEach((c, i) => {
          const id = isObj(c) ? String(val(c, ['id', 'name', 'camera', 'key']) || (i ? 'cam' + i : primaryCamera())) : (i ? 'cam' + i : primaryCamera());
          out[cameraIdOf(id)] = cameraState(c);
        });
      } else if (isObj(raw)) {
        // { streaming, url } 하나만 온 경우(v0.1)와 { top: {...}, side: {...} } 를 구분한다
        if (pick(raw, ['streaming', 'url', 'stream', 'active', 'src'])) { note('camera.single'); out[primaryCamera()] = cameraState(raw); }
        else Object.entries(raw).forEach(([id, c]) => { out[cameraIdOf(id)] = cameraState(c); });
      }
      return out;
    }
    function primaryCamera() {
      if (opt.primaryCamera && opt.primaryCamera !== 'auto') return opt.primaryCamera;
      if (info && info.cameras && info.cameras.length) return info.cameras[0].id;
      return 'main';
    }

    // ---------- 상태 ----------
    function stats(raw) {
      if (!isObj(raw)) return null;
      let total = num(val(raw, ['total', 'count', 'inspected', 'checked', 'all', 'n', 'processed', 'parts'], 'total'));
      let good = num(val(raw, ['good', 'ok', 'pass', 'passed', 'accepted', 'normal', 'okcount', 'goodcount'], 'good'));
      let defect = num(val(raw, ['defect', 'defects', 'ng', 'fail', 'failed', 'bad', 'reject', 'rejected', 'abnormal', 'ngcount', 'defectcount'], 'defect'));
      if (total === null && good === null && defect === null) return null;
      if (total === null) { total = (good || 0) + (defect || 0); note('stats.total.computed'); }
      if (good === null) { good = Math.max(0, total - (defect || 0)); note('stats.good.computed'); }
      if (defect === null) { defect = Math.max(0, total - good); note('stats.defect.computed'); }
      return { total, good, defect };
    }

    function fault(raw) {
      if (raw === null || raw === undefined || raw === false || raw === '' || raw === 0) return null;
      if (typeof raw === 'string') return { code: codeOf(raw), params: {}, clear: 'auto' };
      if (isObj(raw)) {
        const code = val(raw, ['code', 'error', 'name', 'id', 'type', 'reason']);
        if (!code) return null;
        const params = val(raw, ['params', 'details', 'detail', 'data', 'args']);
        const message = val(raw, ['message', 'msg', 'text', 'description']);
        const out = { code: codeOf(code), params: isObj(params) ? params : {} };
        if (typeof message === 'string') out.message = message;
        // 풀리는 방법(v0.3). 없거나 모르는 값이면 auto(원인이 사라지면 풀림)
        const clear = val(raw, ['clear', 'clearby', 'clearedby', 'recovery', 'release', 'reset']);
        out.clear = (typeof clear === 'string' && mapWord(clear, CLEAR, 'fault.clear')) || 'auto';
        return out;
      }
      return { code: 'FAULT', params: {}, clear: 'auto' };
    }

    // 공정 단계(v0.3): { stage, part, step } 또는 null(가동 중이 아님). 글자 하나로 와도 단계로 읽는다
    function cycle(raw) {
      if (raw === null || raw === undefined || raw === false || raw === '') return null;
      if (typeof raw === 'string') return { stage: mapWord(raw, STAGE, 'cycle.stage') || raw, part: null, step: null };
      if (!isObj(raw)) return null;
      const stage = val(raw, ['stage', 'phase', 'state']);
      const part = val(raw, ['part', 'partid', 'id', 'item', 'inspection']);
      const step = val(raw, ['step', 'task', 'action', 'substep']);
      return {
        stage: typeof stage === 'string' ? mapWord(stage, STAGE, 'cycle.stage') || stage : null,
        part: part === undefined ? null : part,
        step: typeof step === 'string' && step ? step : null,
      };
    }

    // 저장된 원점(v0.4): { angles, units, unit, setAt } 또는 null(아직 저장하지 않음). 모르는 모양이면 undefined(상태에 넣지 않음)
    // 원점은 서버가 가진다 — 수동 모드에서 "원점 잡기"를 누르면 로봇팔의 지금 자세를 저장한다
    function homePose(raw) {
      if (raw === null || raw === false || raw === '') return null;
      if (!isObj(raw) && !Array.isArray(raw)) { note('home.unknown'); return undefined; }
      const unit = jointUnit(isObj(raw) ? val(raw, ['unit', 'units', 'angleunit']) : null);
      let body = isObj(raw) ? val(raw, ['angles', 'positions', 'joints', 'pose', 'values', 'qpos'], 'angles') : raw;
      if (body === undefined) { body = raw; note('home.flat'); }
      const out = angleMap(body, unit, 'arm');
      if (!Object.keys(out.angles).length) return null;
      const at = isObj(raw) ? val(raw, ['setat', 'savedat', 'updatedat', 'at', 'time', 'timestamp'], 'set_at') : undefined;
      return { angles: out.angles, units: out.units, unit, setAt: time(at) };
    }

    // 상태는 바뀐 부분만 와도 된다. 온 필드만 돌려주고, 합치는 일은 store.js가 한다
    function status(raw) {
      const out = {};
      if (!isObj(raw)) return out;
      // { status: { … } } 처럼 한 겹 더 싸서 오는 경우: 상태 글자도, 상태 필드도 없으면 안쪽을 본다
      const lineWord = pick(raw, ['line', 'linestate', 'state', 'status', 'phase']);
      if (!(lineWord && typeof lineWord.value === 'string') && !pick(raw, ['estop', 'mode', 'devices', 'stats', 'cameras', 'camera'])) {
        const inner = pick(raw, ['status', 'state', 'data', 'payload', 'system']);
        if (inner && isObj(inner.value)) { note('status.wrapped'); return status(inner.value); }
      }
      const line = pick(raw, ['line', 'linestate', 'state', 'status', 'phase', 'runstate', 'machinestate', 'systemstate'], 'line');
      if (line && typeof line.value === 'string') {
        const c = compact(line.value);
        const word = mapWord(line.value, LINE, 'line');
        if (word) out.line = word;
        else if (LINE_ESTOP.includes(c)) { out.line = 'stopped'; out.estop = true; note('line.estop_as_state'); }
        else if (LINE_FAULT.includes(c)) { out.line = 'stopped'; out.fault = { code: 'LINE_FAULT', params: {}, clear: 'auto' }; note('line.fault_as_state'); }
        else { out.line = 'unknown'; out.lineRaw = line.value; note('line.unknown:' + line.value); }
      }
      const estop = pick(raw, ['estop', 'estopactive', 'emergency', 'emergencystop', 'ems', 'estopped', 'emergencystopactive', 'estoplatched'], 'estop');
      if (estop) {
        const b = bool(estop.value);
        if (b !== null) out.estop = b;
        else if (isObj(estop.value)) { const a = bool(val(estop.value, ['active', 'latched', 'pressed', 'on', 'state'])); if (a !== null) out.estop = a; }
      }
      const mode = pick(raw, ['mode', 'operationmode', 'runmode', 'operatingmode', 'controlmode', 'drivemode'], 'mode');
      if (mode && typeof mode.value === 'string') {
        out.mode = mapWord(mode.value, MODE, 'mode') || 'unknown';
        if (out.mode === 'unknown') { out.modeRaw = mode.value; note('mode.unknown:' + mode.value); }
        // 'AUTO'처럼 글자가 다르면 바꿀 때도 그 글자를 기대하는 서버가 많다 (config.js server.modeValues)
        else if (mode.value !== out.mode) note('mode.raw:' + mode.value);
      }
      const dev = pick(raw, ['devices', 'device', 'hardware', 'connections', 'components', 'peripherals'], 'devices');
      if (dev) out.devices = devices(dev.value);
      const st = stats(val(raw, ['stats', 'statistics', 'counts', 'counter', 'counters', 'production', 'summary', 'totals'], 'stats'));
      if (st) out.stats = st;
      else if (pick(raw, ['total']) && pick(raw, ['defect', 'ng', 'defects'])) { const flat = stats(raw); if (flat) { out.stats = flat; note('stats.flat'); } }
      // 카메라: v0.2는 cameras(여러 대), v0.1은 camera(한 대). 둘 다 오면 cameras를 쓴다
      const cams = pick(raw, ['cameras', 'cams', 'videos', 'streams']);
      const cam = pick(raw, ['camera', 'cam', 'video', 'stream']);
      if (cams) out.cameras = cameras(cams.value);
      else if (cam) { note('camera.v01'); out.cameras = { [primaryCamera()]: cameraState(cam.value) }; }
      const f = pick(raw, ['fault', 'error', 'alarm', 'faultcode', 'lasterror', 'trip']);
      if (f) out.fault = fault(f.value);
      const started = pick(raw, ['startedat', 'runstartedat', 'since', 'runningsince', 'starttime', 'linestartedat']);
      if (started) out.startedAt = time(started.value);
      const homeReq = pick(raw, ['homerequired', 'needshome', 'homingrequired', 'homeneeded', 'requireshome', 'musthome'], 'home_required');
      if (homeReq) { const b = bool(homeReq.value); if (b !== null) out.homeRequired = b; }
      const home = pick(raw, ['home', 'homepose', 'homeposition', 'homeangles', 'savedhome', 'origin', 'originpose'], 'home');
      if (home) { const h = homePose(home.value); if (h !== undefined) out.home = h; }
      const cyc = pick(raw, ['cycle', 'process', 'cyclestate', 'processstage', 'stage'], 'cycle');
      if (cyc) out.cycle = cycle(cyc.value);
      return out;
    }

    // ---------- 판정 ----------
    function resultOf(raw) {
      const r = pick(raw, ['result', 'judgement', 'judgment', 'decision', 'verdict', 'label', 'class', 'classname', 'outcome', 'status', 'grade', 'prediction', 'pred'], 'result');
      if (r) {
        if (typeof r.value === 'string') {
          const c = compact(r.value);
          if (GOOD.includes(c)) { if (c !== 'good') note('inspection.result.alias:' + r.value); return 'good'; }
          if (DEFECT.includes(c)) { if (c !== 'defect') note('inspection.result.alias:' + r.value); return 'defect'; }
        }
        if (typeof r.value === 'boolean') { note('inspection.result.bool'); return r.value ? 'good' : 'defect'; }
      }
      const bad = pick(raw, ['defect', 'isdefect', 'defective', 'ng', 'reject', 'bad', 'anomaly', 'isanomaly', 'isng']);
      if (bad && typeof bad.value === 'boolean') { note('inspection.result.flag:' + bad.key); return bad.value ? 'defect' : 'good'; }
      const ok = pick(raw, ['ok', 'good', 'pass', 'passed', 'isgood', 'isok']);
      if (ok && typeof ok.value === 'boolean') { note('inspection.result.flag:' + ok.key); return ok.value ? 'good' : 'defect'; }
      note('inspection.result.unknown');
      return null;
    }
    function bbox(raw, size) {
      let format = opt.bboxFormat;
      let b = pick(raw, ['bbox', 'box', 'rect', 'xywh', 'xyxy', 'cxcywh', 'boundingbox', 'region', 'roi']);
      let v = b && b.value;
      if (b && /xyxy/i.test(b.key)) format = 'xyxy';
      if (b && /cxcywh/i.test(b.key)) format = 'cxcywh';
      if (!v) { const boxes = val(raw, ['boxes', 'bboxes', 'detections', 'objects']); if (Array.isArray(boxes) && boxes.length) { v = boxes[0]; note('inspection.bbox.list'); } }
      if (!v) return null;
      if (isObj(v)) {
        if (pick(v, ['x1']) && pick(v, ['x2'])) { v = [v.x1, v.y1, v.x2, v.y2].map(num); format = 'xyxy'; }
        else if (pick(v, ['cx'])) { v = [val(v, ['cx']), val(v, ['cy']), val(v, ['w', 'width']), val(v, ['h', 'height'])].map(num); format = 'cxcywh'; }
        else {
          const inner = pick(v, ['bbox', 'box', 'xywh', 'xyxy', 'cxcywh']);
          if (inner && /xyxy/i.test(inner.key)) format = 'xyxy';
          if (inner && /cxcywh/i.test(inner.key)) format = 'cxcywh';
          v = inner ? inner.value : [val(v, ['x', 'left']), val(v, ['y', 'top']), val(v, ['w', 'width']), val(v, ['h', 'height'])].map(num);
        }
      }
      if (!Array.isArray(v) || v.length < 4 || v.slice(0, 4).some((n) => num(n) === null)) return null;
      let [a, bb, c, d] = v.slice(0, 4).map(Number);
      if (format === 'xyxy') { note('inspection.bbox.xyxy'); c -= a; d -= bb; }
      if (format === 'cxcywh') { note('inspection.bbox.cxcywh'); a -= c / 2; bb -= d / 2; }
      // 1보다 큰 값이 있으면 픽셀 좌표다. 영상 크기를 알아야 비율로 바꿀 수 있다
      if (Math.max(a, bb, c, d) > 1.0001) {
        const w = size && size.width;
        const h = size && size.height;
        if (!w || !h) { note('inspection.bbox.pixel_without_size'); return null; }
        note('inspection.bbox.pixel');
        a /= w; c /= w; bb /= h; d /= h;
      }
      return [a, bb, c, d].map((n) => round(Math.min(1, Math.max(0, n)), 4));
    }
    function inspection(raw) {
      if (!isObj(raw)) return null;
      const out = { result: resultOf(raw), at: timeOf(raw) };
      const id = val(raw, ['id', 'partid', 'seq', 'sequence', 'count', 'index', 'no', 'number', 'serial', 'itemid'], 'id');
      if (id !== undefined && id !== null) out.id = id;
      const seq = seqOf(raw);
      if (seq !== null) out.seq = seq;
      const conf = num(val(raw, ['confidence', 'conf', 'score', 'prob', 'probability', 'certainty'], 'confidence'));
      if (conf !== null) {
        out.confidence = conf > 1 && conf <= 100 ? round(conf / 100, 4) : conf;
        if (conf > 1) note('inspection.confidence.percent');
      }
      const cam = val(raw, ['camera', 'cameraid', 'cam', 'source', 'camerasource']);
      if (cam !== undefined) out.camera = cameraIdOf(cam);
      const size = { width: num(val(raw, ['width', 'imagewidth', 'framewidth'])), height: num(val(raw, ['height', 'imageheight', 'frameheight'])) };
      const imgSize = val(raw, ['imagesize', 'framesize', 'size', 'shape']);
      if (Array.isArray(imgSize) && imgSize.length >= 2) { size.width = num(imgSize[0]); size.height = num(imgSize[1]); }
      if (!size.width && info && info.cameras) {
        const c = info.cameras.find((x) => x.id === (out.camera || primaryCamera()));
        if (c) { size.width = c.width; size.height = c.height; }
      }
      const box = bbox(raw, size);
      if (box) out.bbox = box;
      const st = stats(val(raw, ['stats', 'statistics', 'counts', 'counter', 'totals'], 'stats'));
      if (st) out.stats = st;
      else note('inspection.nostats');
      const img = val(raw, ['image', 'imageurl', 'img', 'snapshot', 'snapshoturl', 'thumbnail', 'thumb', 'crop', 'picture', 'photo']);
      if (typeof img === 'string' && img) {
        if (/^(https?:|data:|blob:|\/|\.)/i.test(img)) out.image = img;
        else if (img.length > 64 && /^[A-Za-z0-9+/=\s]+$/.test(img)) { out.image = 'data:image/jpeg;base64,' + img.replace(/\s/g, ''); note('inspection.image.base64'); }
        else out.image = img;
      }
      const ms = num(val(raw, ['latencyms', 'inferencems', 'elapsedms', 'processingms', 'durationms', 'timems']));
      if (ms !== null) out.latencyMs = ms;
      else {
        const sec = num(val(raw, ['latency', 'inferencetime', 'elapsed', 'duration', 'processingtime']));
        if (sec !== null) { out.latencyMs = sec < 10 ? round(sec * 1000, 1) : sec; if (sec < 10) note('inspection.latency.seconds'); }
      }
      return out;
    }

    // ---------- 이벤트 ----------
    // 코드는 소문자 밑줄로 맞춘다: LINE_STARTED · lineStarted · line-started → line_started
    function eventCode(raw) {
      const s = String(raw).trim();
      const snake = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s\-.]+/g, '_').toLowerCase();
      if (snake !== s) note('event.code.case');
      const known = EVENT_OF.get(snake);
      if (known) { note('event.alias:' + s); return known; }
      return snake;
    }
    function event(raw) {
      if (!isObj(raw)) return null;
      const code = val(raw, ['code', 'event', 'name', 'eventcode', 'eventname', 'id', 'kind', 'type'], 'code');
      const lvl = val(raw, ['level', 'severity', 'priority', 'loglevel', 'category'], 'level');
      const params = val(raw, ['params', 'parameters', 'args', 'arguments', 'data', 'details', 'payload', 'extra', 'context'], 'params');
      const text = val(raw, ['message', 'msg', 'text', 'description', 'detail', 'desc']);
      const out = { code: code ? eventCode(code) : 'unknown', level: 'info', params: isObj(params) ? Object.assign({}, params) : {}, at: timeOf(raw) };
      const seq = seqOf(raw);
      if (seq !== null) out.seq = seq;
      if (typeof lvl === 'string') {
        const l = mapWord(lvl, LEVEL, 'event.level');
        if (l) out.level = l; else note('event.level.unknown:' + lvl);
      } else if (num(lvl) !== null) {
        // 숫자 등급: 파이썬 logging(10 debug · 20 info · 30 warning · 40 error · 50 critical)으로 읽는다
        const n = num(lvl);
        out.level = n >= 40 ? 'alarm' : n >= 30 ? 'warning' : 'info';
        note('event.level.number');
      } else if (out.code === 'estop_pressed') out.level = 'alarm';
      if (typeof text === 'string' && text) { out.message = text; note('event.text'); }
      if (out.params.device !== undefined) out.params.device = deviceId(out.params.device);
      if (Array.isArray(out.params.devices)) out.params.devices = out.params.devices.map(deviceId);
      if (typeof out.params.mode === 'string') out.params.mode = mapWord(out.params.mode, MODE, 'mode') || out.params.mode;
      if (out.params.arm !== undefined) out.params.arm = armId(out.params.arm);
      if (out.params.joint !== undefined) out.params.joint = jointId(out.params.joint) || out.params.joint;
      return out;
    }

    // ---------- 관절 ----------
    function armId(raw) {
      const c = compact(raw);
      if (DEVICE.leader.includes(c)) return 'leader';
      if (DEVICE.arm.includes(c)) return 'arm';
      if (['target', 'goal', 'command', 'action', 'setpoint', 'policy'].includes(c)) return 'target';
      return String(raw);
    }
    function jointId(raw) {
      let k = String(raw);
      k = k.replace(/[._](pos|position|angle|deg|rad|value)$/i, '');
      const c = compact(k);
      return JOINT_OF.get(c) || (JOINTS.includes(k) ? k : null);
    }
    function unitOf(raw) {
      if (!raw) return null;
      const c = compact(raw);
      if (['deg', 'degree', 'degrees', '°'].includes(c) || raw === '°') return 'deg';
      if (['rad', 'radian', 'radians'].includes(c)) return 'rad';
      if (['norm', 'normalized', 'range', 'percent', 'pct', 'rangem100100', 'm100100', 'range0100'].includes(c)) return 'norm';
      if (['raw', 'tick', 'ticks', 'step', 'steps', 'count', 'counts', 'position'].includes(c)) return 'raw';
      return null;
    }
    function jointUnit(explicit) {
      const u = unitOf(explicit);
      if (u) { if (u !== 'deg') note('joints.unit:' + u); return u; }
      if (opt.jointUnit && opt.jointUnit !== 'auto') return opt.jointUnit;
      if (info && info.jointUnit) return info.jointUnit;
      return 'deg';
    }
    // 서보 원시값(0~4095) → 도. LeRobot과 같은 식: (값 - 가운데) × 360 / 4095, 가운데 = (최소 + 최대) / 2
    function rawToDeg(v, arm, joint) {
      const cal = info && info.arms && info.arms[arm] && info.arms[arm].calibration && info.arms[arm].calibration[joint];
      const mid = cal && num(cal.min) !== null && num(cal.max) !== null ? (cal.min + cal.max) / 2 : 2047.5;
      return (v - mid) * 360 / 4095;
    }
    // 화면에 쓰는 값과 단위. LeRobot은 그리퍼만 늘 0~100(%)이다
    function convertJoint(v, unit, arm, joint) {
      if (unit === 'rad') return { value: round(v * 180 / Math.PI, 2), unit: 'deg' };
      if (unit === 'raw') return { value: round(rawToDeg(v, arm, joint), 2), unit: 'deg' };
      if (unit === 'norm') return { value: v, unit: 'pct' };
      return { value: v, unit: joint === 'gripper' ? 'pct' : 'deg' };
    }
    function angleMap(raw, unit, arm) {
      const angles = {};
      const units = {};
      const put = (joint, v) => {
        const n = num(v);
        if (!joint || n === null) return;
        const c = convertJoint(n, unit, arm, joint);
        angles[joint] = c.value;
        units[joint] = c.unit;
      };
      if (Array.isArray(raw)) {
        note('joints.array');
        raw.slice(0, 6).forEach((v, i) => put(JOINTS[i], v));
      } else if (isObj(raw)) {
        Object.entries(raw).forEach(([k, v]) => {
          if (/[._]pos$/i.test(k)) note('joints.suffix.pos');
          const j = jointId(k);
          if (j && j !== k) note('joints.alias:' + k);
          put(j, isObj(v) ? val(v, ['pos', 'position', 'angle', 'value']) : v);
        });
      }
      return { angles, units };
    }
    function joints(raw) {
      if (!isObj(raw) && !Array.isArray(raw)) return null;
      const source = isObj(raw) ? val(raw, ['source', 'arm', 'from', 'device', 'role', 'robot']) : undefined;
      const arm = source !== undefined ? armId(source) : 'leader';
      const unit = jointUnit(isObj(raw) ? val(raw, ['unit', 'units', 'angleunit']) : null);
      let body = isObj(raw) ? val(raw, ['angles', 'positions', 'joints', 'position', 'pos', 'values', 'state', 'action', 'qpos', 'q'], 'angles') : raw;
      if (body === undefined) { body = raw; note('joints.flat'); }
      const out = angleMap(body, unit, arm);
      return { source: arm, unit, angles: out.angles, units: out.units, at: isObj(raw) ? timeOf(raw) : null };
    }

    // ---------- 서보 상태 ----------
    function motor(raw, unit, arm, joint) {
      const out = {};
      if (num(raw) !== null) { raw = { pos: raw }; }
      if (!isObj(raw)) return out;
      const pos = num(val(raw, ['pos', 'position', 'presentposition', 'angle', 'q']));
      if (pos !== null) { const c = convertJoint(pos, unit, arm, joint); out.pos = c.value; out.posUnit = c.unit; }
      const temp = num(val(raw, ['temp', 'temperature', 'presenttemperature', 'tempc', 'celsius']));
      if (temp !== null) out.temp = temp;
      let volt = num(val(raw, ['volt', 'voltage', 'presentvoltage', 'vin', 'supply', 'v']));
      if (volt !== null) {
        if (volt > 30) { volt /= 10; note('telemetry.voltage.decivolt'); } // 서보 원시값(0.1V 단위)
        out.volt = round(volt, 2);
      }
      const loadPick = pick(raw, ['load', 'presentload', 'loadpct', 'effort', 'torquepct']);
      let load = loadPick ? num(loadPick.value) : null;
      if (load !== null) {
        // 서보 원시값: 0.1% 단위이고 10번 비트(1024)가 방향이다. 100 이하 값만으로는 %와 구분이 안 되므로
        // 100을 넘는 값을 한 번 보면 그 뒤로는 모두 원시값으로 읽는다 (처음부터 정하려면 loadUnit)
        if (load > 1023) { load = -(load - 1024); loadPermille = loadPermille || opt.loadUnit === 'auto'; note('telemetry.load.signbit'); }
        else if (Math.abs(load) > 100 && opt.loadUnit !== 'pct') { loadPermille = true; }
        if (loadPermille) { load /= 10; note('telemetry.load.permille'); }
        out.load = round(load, 1);
      }
      const cur = num(val(raw, ['current', 'presentcurrent', 'currentma', 'ma', 'amps']));
      if (cur !== null) out.current = cur;
      const st = val(raw, ['status', 'error', 'errorbits', 'alarm', 'hardwareerror', 'servostatus', 'faults']);
      if (num(st) !== null) {
        out.statusBits = num(st);
        out.faults = STATUS_BITS.filter(([bit]) => (num(st) >> bit) & 1).map(([, name]) => name);
      } else if (Array.isArray(st)) out.faults = st.map(String);
      const torque = pick(raw, ['torque', 'torqueenable', 'torqueenabled', 'enabled', 'torqueon']);
      if (torque) { const b = bool(torque.value); if (b !== null) out.torque = b; }
      const moving = bool(val(raw, ['moving', 'ismoving', 'inmotion']));
      if (moving !== null) out.moving = moving;
      return out;
    }
    function telemetry(raw) {
      if (!isObj(raw)) return null;
      const arm = armId(val(raw, ['arm', 'source', 'device', 'robot', 'role', 'name', 'bus']) || 'arm');
      const unit = jointUnit(val(raw, ['unit', 'units', 'positionunit']));
      let motorsRaw = val(raw, ['motors', 'servos', 'joints', 'actuators', 'data'], 'motors');
      const motors = {};
      if (motorsRaw === undefined) {
        // 평평한 모양: { "shoulder_pan.temperature": 41, "shoulder_pan.pos": 3.2 }
        note('telemetry.flat');
        motorsRaw = {};
        Object.entries(raw).forEach(([k, v]) => {
          const m = /^(.+?)[._](pos|position|temp|temperature|volt|voltage|load|current|status|torque|moving)$/i.exec(k);
          if (!m) return;
          const j = jointId(m[1]);
          if (!j) return;
          motorsRaw[j] = motorsRaw[j] || {};
          motorsRaw[j][m[2]] = v;
        });
      }
      if (Array.isArray(motorsRaw)) {
        motorsRaw.forEach((m, i) => {
          const idv = isObj(m) ? num(val(m, ['id', 'motorid', 'servoid'])) : null;
          const name = isObj(m) ? val(m, ['name', 'joint', 'motor']) : null;
          const j = (name && jointId(name)) || (idv ? JOINTS[idv - 1] : JOINTS[i]);
          if (j) motors[j] = motor(m, unit, arm, j);
        });
      } else if (isObj(motorsRaw)) {
        Object.entries(motorsRaw).forEach(([k, m]) => { const j = jointId(k); if (j) motors[j] = motor(m, unit, arm, j); });
      }
      return { arm, unit, motors, at: timeOf(raw) };
    }

    // ---------- 그 밖의 메시지 ----------
    function metrics(raw) {
      if (!isObj(raw)) return null;
      const out = {};
      const inf = num(val(raw, ['inferencems', 'inference', 'latencyms', 'modelms', 'avginferencems', 'detectms']));
      if (inf !== null) out.inferenceMs = inf;
      const fps = val(raw, ['fps', 'framerate', 'camerafps']);
      if (num(fps) !== null) out.fps = { [primaryCamera()]: num(fps) };
      else if (isObj(fps)) { out.fps = {}; Object.entries(fps).forEach(([k, v]) => { if (num(v) !== null) out.fps[cameraIdOf(k)] = num(v); }); }
      const cpu = num(val(raw, ['cpu', 'cpupct', 'cpuload'])); if (cpu !== null) out.cpu = cpu;
      const gpu = num(val(raw, ['gpu', 'gpupct', 'gpuload'])); if (gpu !== null) out.gpu = gpu;
      const q = num(val(raw, ['queue', 'queuelength', 'backlog', 'pending'])); if (q !== null) out.queue = q;
      const cycle = num(val(raw, ['cyclems', 'loopms', 'controlms', 'periodms'])); if (cycle !== null) out.cycleMs = cycle;
      return out;
    }
    function frame(raw) {
      if (!isObj(raw)) return null;
      const data = val(raw, ['data', 'jpeg', 'jpg', 'image', 'frame', 'b64', 'base64', 'bytes', 'img']);
      const url = val(raw, ['url', 'src']);
      const cam = val(raw, ['camera', 'cameraid', 'cam', 'source', 'id']);
      const mime = val(raw, ['mime', 'mimetype', 'contenttype', 'format']);
      if (typeof data !== 'string' && typeof url !== 'string') return null;
      return {
        camera: cam !== undefined ? cameraIdOf(cam) : primaryCamera(),
        mime: typeof mime === 'string' && mime.includes('/') ? mime : 'image/' + (typeof mime === 'string' ? mime.replace('jpg', 'jpeg') : 'jpeg'),
        data: typeof data === 'string' ? data.replace(/^data:[^,]+,/, '') : null,
        url: typeof url === 'string' ? url : null,
        at: timeOf(raw),
      };
    }
    function commandResult(raw) {
      if (!isObj(raw)) return null;
      const id = val(raw, ['id', 'requestid', 'commandid', 'ref', 'replyto', 'seq']);
      let status = num(val(raw, ['status', 'statuscode', 'httpstatus', 'code']));
      const okFlag = bool(val(raw, ['ok', 'success', 'accepted']));
      const err = val(raw, ['error', 'err', 'failure']);
      if (status === null || status < 100) status = err || okFlag === false ? 409 : 200;
      const body = err ? { error: err } : (val(raw, ['body', 'result', 'data', 'response', 'payload']) || {});
      return { id, status, body };
    }

    // ---------- 서버 정보 (GET /info) ----------
    function infoOf(raw) {
      const out = { api: null, jointUnit: null, cameras: [], arms: {}, features: [], server: null };
      if (!isObj(raw)) return out;
      const api = val(raw, ['api', 'apiversion', 'version', 'protocol']);
      if (api !== undefined) out.api = String(api);
      out.jointUnit = unitOf(val(raw, ['jointunit', 'jointunits', 'unit', 'angleunit', 'positionunit']));
      const cams = val(raw, ['cameras', 'camera', 'cams', 'streams']);
      const list = Array.isArray(cams) ? cams : isObj(cams) ? Object.entries(cams).map(([id, c]) => Object.assign({ id }, isObj(c) ? c : { url: c })) : [];
      out.cameras = list.filter(isObj).map((c, i) => Object.assign({ id: cameraIdOf(val(c, ['id', 'name', 'key']) || (i ? 'cam' + i : 'main')) }, cameraState(c), { streaming: undefined }));
      const arms = val(raw, ['arms', 'robots', 'robot', 'devices']);
      if (isObj(arms)) {
        Object.entries(arms).forEach(([k, a]) => {
          if (!isObj(a)) return;
          const id = armId(k);
          const cal = val(a, ['calibration', 'cal', 'ranges']);
          const entry = { role: val(a, ['role', 'type']) || null, calibration: {} };
          if (isObj(cal)) {
            Object.entries(cal).forEach(([j, c]) => {
              const jid = jointId(j);
              if (!jid || !isObj(c)) return;
              entry.calibration[jid] = { min: num(val(c, ['min', 'rangemin', 'minposition', 'minpositionlimit'])), max: num(val(c, ['max', 'rangemax', 'maxposition', 'maxpositionlimit'])), offset: num(val(c, ['offset', 'homingoffset'])) };
            });
          }
          out.arms[id] = entry;
        });
      }
      const feats = val(raw, ['features', 'capabilities', 'supports']);
      if (Array.isArray(feats)) out.features = feats.map(String);
      else if (isObj(feats)) out.features = Object.keys(feats).filter((k) => feats[k]);
      const server = val(raw, ['server', 'name', 'app']);
      if (server !== undefined) out.server = isObj(server) ? server : { name: String(server) };
      return out;
    }

    // ---------- 지난 기록 (GET /history, v0.3) ----------
    // { runId, now, lastSeq, events: [이벤트], inspections: [판정], minutes: [{ t, good, defect }] | null } — 기록은 오래된 것부터
    function history(raw) {
      const out = { runId: null, now: null, lastSeq: null, events: [], inspections: [], minutes: null };
      if (!isObj(raw)) return out;
      const run = val(raw, ['runid', 'run', 'bootid', 'boot', 'session', 'sessionid', 'epoch', 'instance']);
      if (run !== undefined && run !== null && run !== '') out.runId = String(run);
      out.now = time(val(raw, ['now', 'servertime', 'time', 'at', 'timestamp']));
      out.lastSeq = num(val(raw, ['lastseq', 'seq', 'last', 'cursor', 'head']));
      const bySeq = (a, b) => (a.seq === undefined || b.seq === undefined ? 0 : a.seq - b.seq);
      const evs = val(raw, ['events', 'logs', 'log', 'alarms']);
      if (Array.isArray(evs)) out.events = evs.map(event).filter(Boolean).sort(bySeq);
      const ins = val(raw, ['inspections', 'results', 'judgements', 'judgments', 'detections']);
      if (Array.isArray(ins)) out.inspections = ins.map(inspection).filter(Boolean).sort(bySeq);
      const mins = val(raw, ['minutes', 'perminute', 'buckets', 'timeline']);
      if (Array.isArray(mins)) {
        out.minutes = mins.filter(isObj).map((b) => {
          const t = time(val(b, ['t', 'time', 'minute', 'start', 'at', 'ts']));
          const s = stats(b);
          return t && s ? { t, good: s.good, defect: s.defect } : null;
        }).filter(Boolean);
      }
      return out;
    }

    // ---------- 오류 응답 ----------
    function codeOf(raw) {
      const s = String(raw).trim();
      const upper = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s\-.]+/g, '_').toUpperCase();
      const known = ERROR_OF.get(upper);
      if (known) { note('error.alias:' + s); return known; }
      return upper;
    }
    const looksLikeCode = (s) => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_.\-]{1,63}$/.test(s.trim()) && !/\s/.test(s.trim());
    function error(httpStatus, body) {
      const out = { code: 'HTTP_' + httpStatus, details: {}, message: null };
      if (typeof body === 'string') {
        const s = body.trim();
        if (looksLikeCode(s)) { out.code = codeOf(s); note('error.text_code'); }
        else if (s && !/^</.test(s)) { out.message = s.slice(0, 200); note('error.text'); }
        else if (s) note('error.html');
        return withMissing(out);
      }
      if (!isObj(body)) return out;
      let e = body.error;
      if (e === undefined && body.detail !== undefined) { e = body.detail; note('error.fastapi'); }
      if (e === undefined) { e = body; note('error.flat'); }
      if (Array.isArray(e)) {
        // FastAPI 검증 실패: [{ loc, msg, type }]
        out.code = 'VALIDATION_ERROR';
        out.details = { items: e.map((x) => (isObj(x) ? { loc: x.loc, msg: x.msg, type: x.type } : x)) };
        note('error.validation');
        return out;
      }
      if (typeof e === 'string') {
        if (looksLikeCode(e)) out.code = codeOf(e);
        else { out.message = e; note('error.message_only'); }
        const d = val(body, ['details', 'detail', 'data']);
        if (isObj(d)) out.details = d;
        return withMissing(out);
      }
      if (isObj(e)) {
        const code = val(e, ['code', 'errorcode', 'error', 'type', 'name', 'reason', 'id']);
        if (typeof code === 'string' && code) out.code = codeOf(code);
        const d = val(e, ['details', 'detail', 'data', 'params', 'info', 'context']);
        if (isObj(d)) out.details = Object.assign({}, d);
        const m = val(e, ['message', 'msg', 'text', 'description']);
        if (typeof m === 'string') out.message = m;
        // 세부 값이 따로 묶이지 않고 바로 붙어 오는 경우: { code, missing: [...] }
        ['missing', 'devices', 'line', 'joints'].forEach((k) => { if (e[k] !== undefined && out.details[k] === undefined) out.details[k] = e[k]; });
      }
      return withMissing(out);
    }
    function withMissing(out) {
      const m = val(out.details, ['missing', 'devices', 'missingdevices', 'notready', 'disconnected', 'offline']);
      if (Array.isArray(m)) out.details.missing = m.map(deviceId);
      else if (typeof m === 'string') out.details.missing = [deviceId(m)];
      return out;
    }

    // ---------- 메시지 봉투 ----------
    function guessType(raw) {
      if (pick(raw, ['line', 'linestate', 'estop', 'devices'])) return 'status';
      if (pick(raw, ['result', 'judgement', 'judgment', 'isdefect', 'verdict']) && !pick(raw, ['level'])) return 'inspection';
      if (pick(raw, ['level', 'severity']) && pick(raw, ['code', 'event', 'name'])) return 'event';
      if (pick(raw, ['motors', 'servos'])) return 'telemetry';
      if (pick(raw, ['angles', 'positions', 'qpos'])) return 'joints';
      return null;
    }
    function normalizeData(type, data) {
      switch (type) {
        case 'status': return status(data);
        case 'inspection': return inspection(data);
        case 'event': return event(data);
        case 'joints': return joints(data);
        case 'telemetry': return telemetry(data);
        case 'metrics': return metrics(data);
        case 'frame': return frame(data);
        case 'command_result': return commandResult(data);
        case 'info': return infoOf(data);
        case 'heartbeat': return { at: isObj(data) ? timeOf(data) : null };
        default: return isObj(data) ? data : {};
      }
    }
    // 메시지 하나를 [{ type, data }] 목록으로 바꾼다. 알 수 없는 것은 빈 목록
    function message(raw) {
      let m = raw;
      if (typeof m === 'string') {
        try { m = JSON.parse(m); } catch (e) { note('envelope.not_json'); return []; }
      }
      if (Array.isArray(m)) {
        // 소켓IO처럼 ['status', {...}]로 온 경우와 메시지 여러 개를 배열로 보낸 경우
        if (m.length >= 1 && typeof m[0] === 'string' && (m.length === 1 || !isObj(m[1]) || !pick(m[1], ['type']))) {
          note('envelope.tuple');
          return message({ type: m[0], data: m.length > 2 ? m.slice(1) : m[1] });
        }
        note('envelope.batch');
        return m.flatMap((x) => message(x));
      }
      if (!isObj(m)) return [];
      // ROS rosbridge: { op: 'publish', topic: '/hmi/status', msg: { ... } }
      if (m.op === 'publish' && typeof m.topic === 'string') {
        note('envelope.rosbridge');
        return message({ type: m.topic.split('/').filter(Boolean).pop(), data: m.msg });
      }
      const typeField = pick(m, ['type', 'msgtype', 'messagetype', 'kind', 'event', 'topic', 'channel', 'action', 'cmd']);
      let type = null;
      let data;
      if (typeField && typeof typeField.value === 'string') {
        type = TYPE_OF.get(compact(typeField.value)) || null;
        // { event: 'line_started', level: 'info' } 의 event는 종류가 아니라 이벤트 코드다
        if (!type && /^event$/i.test(typeField.key)) { note('envelope.event_key'); return [{ type: 'event', data: event(m) }]; }
        if (type && compact(typeField.value) !== compact(type)) note('type.alias:' + typeField.value);
        if (typeField.key !== 'type') note('envelope.type_key:' + typeField.key);
        if (!type) { note('type.unknown:' + typeField.value); return [{ type: 'unknown', data: m, rawType: typeField.value }]; }
        const body = pick(m, ['data', 'payload', 'body', 'content', 'value', 'msg']);
        if (body && (isObj(body.value) || Array.isArray(body.value))) {
          data = body.value;
          if (body.key !== 'data') note('envelope.data_key:' + body.key);
        } else {
          data = Object.assign({}, m);
          delete data[typeField.key];
          note('envelope.flat');
        }
      } else {
        type = guessType(m);
        data = m;
        if (!type) { note('envelope.unknown'); return []; }
        note('envelope.no_type');
      }
      const out = normalizeData(type, data);
      return out ? [{ type, data: out }] : [];
    }

    return {
      message,
      status,
      inspection,
      event,
      joints,
      telemetry,
      metrics,
      frame,
      commandResult,
      error,
      time,
      history,
      cycle,
      info: infoOf,
      deviceId,
      jointId,
      unitOf,
      setInfo(next) { info = next; },
      getInfo: () => info,
      primaryCamera,
      notes: () => Array.from(notes, ([code, count]) => ({ code, count })),
      resetNotes: () => notes.clear(),
    };
  }

  root.HmiAdapter = { create, JOINTS };
})(typeof window !== 'undefined' ? window : globalThis);
