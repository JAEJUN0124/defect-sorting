// 서버 XML 규약 — 서버 담당의 규약 v1.0(docs/server-xml-v1.0.md)과 HMI 안의 메시지 모양(docs/API.md) 사이를 바꿉니다.
//   받기: XML 글 하나 → [{ type, data, replyTo }] — adapter.js가 부릅니다 (상태·이벤트·판정은 adapter.js의 규칙으로 맞춤)
//   보내기: HMI 명령 이름 → XML 글 — api.js가 부릅니다
// v1.0에 아직 없는 것(라인 상태·이벤트·판정 하나하나 등)은 docs/xml-protocol.md 4장의 요청안 모양으로 오면 읽습니다.
// 설정: config.js의 server.xml (없는 값은 아래 DEFAULTS)
(function (root) {
  'use strict';

  const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

  const DEFAULTS = {
    version: '1.0',
    // HMI 명령 → 서버 명령 이름 (Command/@name). null이면 보내지 않고 "서버 규약에 없는 명령"으로 알린다.
    // v1.0에 있는 것: EmergencyStop · ProgramStart · ProgramStop · Home · SetMode. 나머지는 요청안 이름 (docs/xml-protocol.md 4.2)
    commands: {
      estop: 'EmergencyStop',
      start: 'ProgramStart',
      shutdown: 'ProgramStop', // 프로그램 종료(F-03)로 가정 (사용자 2026-10-14)
      home: 'Home', // 원점 복귀
      mode: 'SetMode',
      release: 'EmergencyStopRelease',
      stop: 'Stop',
      cameraStart: 'CameraStart',
      cameraStop: 'CameraStop',
    },
    modeValues: { auto: 'Auto', manual: 'Manual' },
    // 원점 복귀(Home) 때 HMI가 저장한 원점 각도를 <Motors>로 함께 보낸다 (원점은 HMI가 가진다).
    // 서버 v1.0은 Command 안에 하위 요소를 받지 않아 InvalidCommand로 거절한다 — false면 v1.0처럼 이름만 보낸다
    homePose: true,
    // v1.0의 RobotArm/Motors 각도가 어느 팔의 것인지: 'leader'(리더암, 서버 담당 답 2026-10-14) · 'arm'(로봇팔)
    motorsAre: 'leader',
  };

  // v1.0 오류 코드 → HMI 오류 코드 (화면 문구: js/i18n/ko.js error.*)
  const REPLY_CODES = { InvalidCommand: 'XML_INVALID_COMMAND', UnknownCommand: 'XML_UNKNOWN_COMMAND', InvalidMode: 'INVALID_MODE' };
  const ERROR_CODES = {
    InvalidXml: 'XML_INVALID_XML', InvalidRequest: 'XML_INVALID_REQUEST', UnsupportedVersion: 'XML_UNSUPPORTED_VERSION',
    UnknownType: 'XML_UNKNOWN_TYPE', MissingRequestId: 'XML_MISSING_REQUEST_ID',
  };

  function settings(cfg) {
    const c = cfg || {};
    return Object.assign({}, DEFAULTS, c, {
      commands: Object.assign({}, DEFAULTS.commands, c.commands),
      modeValues: Object.assign({}, DEFAULTS.modeValues, c.modeValues),
    });
  }

  const X = () => root.HmiXml;
  const trim = (v) => (typeof v === 'string' ? v.trim() : v);
  function bool(v) {
    const s = String(trim(v) === undefined ? '' : trim(v)).toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return null;
  }
  function num(v) {
    const s = trim(v);
    if (s === undefined || s === null || s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const textOf = (node) => (node ? trim(node.text) : undefined);

  // <Param name="joint">elbow_flex</Param> 들 → { joint: 'elbow_flex' } (숫자는 숫자로)
  function paramsOf(node) {
    const out = {};
    X().children(node, 'Param').forEach((p) => {
      const name = X().attr(p, 'name');
      if (!name) return;
      const v = textOf(p);
      out[name] = num(v) !== null ? num(v) : v;
    });
    return out;
  }

  // 각도 단위: 'deg' · 'pct'(그리퍼 0~100). 라디안은 도로 바꾼다. 그 밖의 단위는 읽지 않는다
  function angleOf(node, note) {
    if (!node || bool(X().attr(node, 'valid')) === false) return null;
    const v = num(textOf(node));
    if (v === null) return null;
    const unit = String(X().attr(node, 'unit') || 'deg').toLowerCase();
    if (['deg', 'degree', 'degrees'].includes(unit)) return { value: v, unit: 'deg' };
    if (['percent', 'pct', '%'].includes(unit)) return { value: v, unit: 'pct' };
    if (['rad', 'radian', 'radians'].includes(unit)) return { value: Math.round((v * 180 / Math.PI) * 100) / 100, unit: 'deg' };
    note('xml.angle.unit:' + unit);
    return null;
  }

  // <Motors><Motor id="1"><Angle unit="deg" valid="true">12.34</Angle></Motor>…</Motors> → 관절 메시지.
  // 받지 못한 각도(valid="false")는 빼고 보낸다 — 화면은 그 관절을 '–'로 보인다
  function jointsOf(motors, source, at, note) {
    const angles = {};
    const units = {};
    X().children(motors, 'Motor').forEach((m) => {
      const id = num(X().attr(m, 'id'));
      const joint = id >= 1 && id <= 6 && Number.isInteger(id) ? JOINTS[id - 1] : null;
      if (!joint) { note('xml.motor.id'); return; }
      const a = angleOf(X().child(m, 'Angle'), note);
      if (!a) return;
      angles[joint] = a.value;
      units[joint] = a.unit;
    });
    return { source, unit: 'deg', angles, units, at };
  }

  // 받은 Status → 상태 메시지 + 관절 메시지 + heartbeat (상태가 1초마다 오므로 연결 확인으로도 쓴다)
  function decodeStatus(msg, at, ctx, s) {
    const X_ = X();
    const node = X_.child(msg, 'Status');
    if (!node) { ctx.note('xml.status.missing'); return []; }
    const raw = {};
    const extra = {};
    const out = [];
    const source = X_.attr(node, 'source');
    if (source !== undefined) extra.source = source;
    // 장치 — 연결 여부 속성이 없는 장치는 넣지 않는다 (모름)
    const devices = {};
    const eq = X_.child(node, 'Equipment');
    const conn = (el, key) => {
      const c = bool(X_.attr(el, 'connected'));
      if (c !== null) devices[key] = c ? 'connected' : 'disconnected';
      return c;
    };
    const conveyor = X_.child(eq, 'Conveyor');
    if (conveyor) {
      const c = conn(conveyor, 'conveyor');
      // 연결이 끊긴 동안의 가동 여부는 믿을 수 없다(v1.0 규약) — 모름(null)
      extra.conveyorRunning = c === true ? bool(X_.attr(conveyor, 'running')) : null;
    }
    const arm = X_.child(eq, 'RobotArm');
    if (arm) {
      conn(arm, 'arm');
      X_.children(arm, 'Motors').forEach((m) => {
        const role = String(X_.attr(m, 'role') || s.motorsAre).toLowerCase();
        out.push({ type: 'joints', data: jointsOf(m, ['arm', 'follower', 'robot'].includes(role) ? 'arm' : 'leader', at, ctx.note) });
      });
    }
    // 요청안: 리더암 연결과 카메라 (docs/xml-protocol.md 4.1)
    const leader = X_.child(eq, 'LeaderArm');
    if (leader) {
      conn(leader, 'leader');
      X_.children(leader, 'Motors').forEach((m) => out.push({ type: 'joints', data: jointsOf(m, 'leader', at, ctx.note) }));
    }
    const cameras = {};
    X_.children(eq, 'Camera').forEach((c) => {
      const id = X_.attr(c, 'id') || 'main';
      conn(c, 'camera_' + id);
      const streaming = bool(X_.attr(c, 'streaming'));
      if (streaming !== null) cameras[id] = { streaming, url: X_.attr(c, 'url') || null, transport: X_.attr(c, 'transport') || null };
    });
    if (Object.keys(devices).length) raw.devices = devices;
    if (Object.keys(cameras).length) raw.cameras = cameras;
    // 검사 개수 — valid="false"면 0은 자리 표시값이라 화면에 '–'로 (stats: null)
    const ins = X_.child(node, 'Inspection');
    if (ins) {
      if (bool(X_.attr(ins, 'valid')) === false) extra.stats = null;
      else {
        const good = num(textOf(X_.child(ins, 'GoodCount')));
        const defect = num(textOf(X_.child(ins, 'DefectCount')));
        if (good !== null || defect !== null) raw.stats = { good: good || 0, defect: defect || 0 };
      }
    }
    // 요청안: 라인 상태 · 고장 · 공정 단계 (docs/xml-protocol.md 4.1). 라인 상태를 보내는 서버라면 고장·단계가 없을 때 '없음'으로 본다
    const line = X_.child(node, 'Line');
    if (line) {
      [['state', 'line'], ['mode', 'mode'], ['emergencyStop', 'estop'], ['homeRequired', 'home_required'], ['startedAt', 'started_at']].forEach(([a, k]) => {
        const v = X_.attr(line, a);
        if (v !== undefined) raw[k] = v;
      });
    }
    const fault = X_.child(node, 'Fault');
    if (fault) {
      const f = { code: X_.attr(fault, 'code'), params: paramsOf(fault) };
      if (X_.attr(fault, 'clear') !== undefined) f.clear = X_.attr(fault, 'clear');
      const msgText = textOf(X_.child(fault, 'Detail'));
      if (msgText) f.message = msgText;
      raw.fault = f;
    } else if (line) raw.fault = null;
    const cycle = X_.child(node, 'Cycle');
    if (cycle) raw.cycle = { stage: X_.attr(cycle, 'stage'), part: num(X_.attr(cycle, 'part')), step: X_.attr(cycle, 'step') || null };
    else if (line) raw.cycle = null;
    const data = Object.assign(ctx.status(raw), extra);
    if (at) data.at = at;
    return [{ type: 'status', data }].concat(out, [{ type: 'heartbeat', data: { at } }]);
  }

  function decodeReply(msg, id, ctx) {
    const X_ = X();
    const r = X_.child(msg, 'Reply');
    if (!r) { ctx.note('xml.reply.missing'); return []; }
    const result = X_.attr(r, 'result');
    const code = X_.attr(r, 'code');
    const command = X_.attr(r, 'command');
    const mode = X_.attr(r, 'mode');
    const detail = textOf(X_.child(r, 'Detail'));
    const executed = bool(X_.attr(r, 'executed'));
    if (!id) { ctx.note('xml.reply.no_id'); return []; }
    if (result === 'Received') {
      // 받았다는 확인일 뿐이다. executed="false"면 장비는 아무것도 하지 않았다 (v1.0)
      return [{ type: 'command_result', data: { id, command, mode, status: 202, body: { reply: { code: code || null, executed, command: command || null, mode: mode || null, detail: detail || null } } } }];
    }
    if (result !== 'Rejected') ctx.note('xml.reply.result:' + result);
    const hmiCode = REPLY_CODES[code] || code || 'XML_REJECTED';
    // 거절 이유의 값 (요청안): 끊긴 장치 <Param name="missing">Conveyor</Param>(여러 번 또는 쉼표로) · 고장 <Param name="fault">ServoOverheat</Param>
    const details = { command: command || null, serverCode: code || null };
    X_.children(r, 'Param').forEach((p) => {
      const name = X_.attr(p, 'name');
      const v = textOf(p);
      if (!name || v === undefined || v === '') return;
      if (name === 'missing') details.missing = (details.missing || []).concat(String(v).split(/[\s,]+/).filter(Boolean));
      else if (name === 'fault') details.fault = String(v).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
      else details[name] = num(v) !== null ? num(v) : v;
    });
    return [{ type: 'command_result', data: { id, command, mode, status: 409, body: { error: { code: hmiCode, details, message: detail || undefined } } } }];
  }

  function decodeError(msg, id, at, ctx) {
    const X_ = X();
    const e = X_.child(msg, 'Error');
    const code = e ? X_.attr(e, 'code') : undefined;
    const text = e ? textOf(e) : undefined;
    const hmiCode = ERROR_CODES[code] || (code ? 'XML_' + String(code).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase() : 'XML_ERROR');
    // 요청 id가 있으면 그 요청의 실패. 없으면 어느 요청인지 모르므로 다른 요청을 끝내지 않고 통신 오류로 기록한다
    if (id) return [{ type: 'command_result', data: { id, status: 400, body: { error: { code: hmiCode, details: { serverCode: code || null }, message: text || undefined } } } }];
    return [{ type: 'event', data: ctx.event({ code: 'server_protocol_error', level: 'warning', params: { code: code || '?' }, at }) }];
  }

  // 요청안: 이벤트 하나 (docs/xml-protocol.md 4.3). 원점 복귀·종료를 마친 이벤트는 완료 알림으로도 넘긴다
  function decodeEvent(msg, at, ctx) {
    const X_ = X();
    const e = X_.child(msg, 'Event');
    if (!e) { ctx.note('xml.event.missing'); return []; }
    const raw = { code: X_.attr(e, 'code'), level: X_.attr(e, 'level'), params: paramsOf(e), at: X_.attr(e, 'at') || at };
    const seq = num(X_.attr(e, 'seq'));
    if (seq !== null) raw.seq = seq;
    const msgText = textOf(X_.child(e, 'Detail'));
    if (msgText) raw.message = msgText;
    const evt = ctx.event(raw);
    if (!evt) return [];
    const out = [{ type: 'event', data: evt }];
    if (evt.code === 'home_completed') out.push({ type: 'home_complete', data: {} });
    if (evt.code === 'shutdown_completed') out.push({ type: 'shutdown_complete', data: {} });
    return out;
  }

  // 요청안: 부품 하나의 판정 (docs/xml-protocol.md 4.3)
  function decodeInspection(msg, at, ctx) {
    const X_ = X();
    const n = X_.child(msg, 'Inspection');
    if (!n) { ctx.note('xml.inspection.missing'); return []; }
    const raw = { at: X_.attr(n, 'at') || at };
    ['id', 'seq', 'result', 'confidence', 'camera', 'image'].forEach((k) => { if (X_.attr(n, k) !== undefined) raw[k] = X_.attr(n, k); });
    if (X_.attr(n, 'latencyMs') !== undefined) raw.latency_ms = X_.attr(n, 'latencyMs');
    ['id', 'seq', 'confidence', 'latency_ms'].forEach((k) => { if (num(raw[k]) !== null) raw[k] = num(raw[k]); });
    const good = num(textOf(X_.child(n, 'GoodCount')));
    const defect = num(textOf(X_.child(n, 'DefectCount')));
    if (good !== null && defect !== null) raw.stats = { good, defect };
    const d = ctx.inspection(raw);
    return d ? [{ type: 'inspection', data: d }] : [];
  }

  // XML 글 하나 → HMI 메시지 목록. ctx: { note, status, event, inspection, time } (adapter.js가 넘김)
  function decode(text, ctx, cfg) {
    const s = settings(cfg);
    let msg;
    try { msg = X().parse(text); } catch (err) { ctx.note('xml.invalid:' + (err.code || 'PARSE')); return []; }
    if (msg.name !== 'Message') { ctx.note('xml.root:' + msg.name); return []; }
    const version = X().attr(msg, 'version');
    if (version !== s.version) ctx.note('xml.version:' + version);
    const type = X().attr(msg, 'type');
    const id = X().attr(msg, 'id') || null;
    const at = ctx.time(X().attr(msg, 'timestamp'));
    switch (type) {
      case 'Status': return decodeStatus(msg, at, ctx, s).map((m) => (m.type === 'status' && id ? Object.assign(m, { replyTo: id }) : m));
      case 'Reply': return decodeReply(msg, id, ctx);
      case 'Error': return decodeError(msg, id, at, ctx);
      case 'Pong': return [{ type: 'heartbeat', data: { at }, replyTo: id }];
      case 'Event': return decodeEvent(msg, at, ctx);
      case 'Inspection': return decodeInspection(msg, at, ctx);
      default:
        ctx.note('xml.type.unknown:' + type);
        return [];
    }
  }

  // ---------- 보내기 ----------
  const round2 = (v) => String(Math.round(v * 100) / 100);

  // 원점 각도 → <Motors> (받는 Status와 같은 모양)
  function motorsOf(pose) {
    const el = X().el;
    return el('Motors', null, JOINTS.map((j, i) => {
      const v = pose.angles[j];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      const unit = pose.units && pose.units[j] === 'pct' ? 'percent' : 'deg';
      return el('Motor', { id: i + 1 }, [el('Angle', { unit }, round2(v))]);
    }));
  }

  // 요청(GetStatus · Ping): 하위 요소 없이
  function request(type, id, cfg) {
    const s = settings(cfg);
    return X().stringify(X().el('Message', { version: s.version, type, id }));
  }

  // HMI 명령 → { text, command, mode }. 서버 규약에 없는 명령이면 null
  function command(name, body, id, cfg) {
    const s = settings(cfg);
    const wire = s.commands[name];
    if (!wire) return null;
    const el = X().el;
    const attrs = { name: wire };
    let mode = null;
    if (name === 'mode') {
      const m = body && body.mode;
      mode = s.modeValues[m] || m;
      attrs.mode = mode;
    }
    if ((name === 'cameraStart' || name === 'cameraStop') && body && body.camera) attrs.camera = body.camera;
    const children = [];
    if (name === 'home' && s.homePose && body && body.angles) children.push(motorsOf(body));
    const text = X().stringify(el('Message', { version: s.version, type: 'Command', id }, [el('Command', attrs, children)]));
    return { text, command: wire, mode };
  }

  root.HmiXmlProtocol = { decode, request, command, settings, DEFAULTS, JOINTS };
})(typeof window !== 'undefined' ? window : globalThis);
