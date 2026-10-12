// 서버 형식 맞추기(js/adapter.js) 시험 — 실행: node --test hmi-web-mockup/tests
// 서버 담당이 고를 수 있는 형식마다 "HMI 안에서는 같은 모양이 되는지"를 본다. 대응표: docs/server-cases.md
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../js/adapter.js');

const make = (opt) => window.HmiAdapter.create(opt);
const one = (a, raw) => {
  const list = a.message(raw);
  assert.equal(list.length, 1, 'message count');
  return list[0];
};

test('기준 형식(v0.2) 상태는 그대로 읽는다', () => {
  const a = make();
  const m = one(a, JSON.stringify({
    type: 'status',
    data: {
      line: 'running', estop: false, mode: 'manual',
      devices: { conveyor: 'connected', arm: 'connected', leader: 'disconnected', camera_top: 'connected' },
      stats: { total: 10, good: 9, defect: 1 },
      cameras: { top: { streaming: true, url: '/api/camera/top/stream', transport: 'mjpeg' } },
    },
  }));
  assert.equal(m.type, 'status');
  assert.deepEqual(m.data, {
    line: 'running', estop: false, mode: 'manual',
    devices: { conveyor: 'connected', arm: 'connected', leader: 'disconnected', camera_top: 'connected' },
    stats: { total: 10, good: 9, defect: 1 },
    cameras: { top: { streaming: true, url: '/api/camera/top/stream', transport: 'mjpeg' } },
  });
  assert.deepEqual(a.notes(), []);
});

test('다른 이름·평평한 봉투·대문자 값도 같은 상태가 된다', () => {
  const a = make();
  const m = one(a, {
    type: 'state', state: 'IDLE', emergency: 'off', operation_mode: 'AUTO',
    devices: { robot: true, teleop: 'offline', conveyor: 'ok', cam_top: 1 },
    counts: { ok: 5, ng: 1 },
  });
  assert.equal(m.type, 'status');
  assert.equal(m.data.line, 'stopped');
  assert.equal(m.data.estop, false);
  assert.equal(m.data.mode, 'auto');
  assert.deepEqual(m.data.devices, { arm: 'connected', leader: 'disconnected', conveyor: 'connected', camera_top: 'connected' });
  assert.deepEqual(m.data.stats, { total: 6, good: 5, defect: 1 });
  const codes = a.notes().map((n) => n.code);
  assert.ok(codes.includes('envelope.flat'));
  assert.ok(codes.includes('type.alias:state'));
  assert.ok(codes.includes('line.alias:IDLE'));
  assert.ok(codes.includes('stats.total.computed'));
});

test('한 겹 싸인 상태, 상태 글자로 온 긴급정지·고장, 모르는 상태', () => {
  const a = make();
  assert.equal(a.status({ status: { line: 'running' } }).line, 'running');
  assert.equal(a.status({ state: { line: 'homing' } }).line, 'homing');
  assert.deepEqual(a.status({ state: 'EMERGENCY_STOP' }), { line: 'stopped', estop: true });
  assert.deepEqual(a.status({ line: 'fault' }), { line: 'stopped', fault: { code: 'LINE_FAULT', params: {}, clear: 'auto' } });
  assert.deepEqual(a.status({ line: 'calibrating' }), { line: 'unknown', lineRaw: 'calibrating' });
  assert.deepEqual(a.status({ mode: 'learning' }), { mode: 'unknown', modeRaw: 'learning' });
  assert.deepEqual(a.status({ fault: 'servo overheat' }).fault, { code: 'SERVO_OVERHEAT', params: {}, clear: 'auto' });
  assert.equal(a.status({ fault: null }).fault, null);
});

test('카메라: v0.1 한 대, v0.2 여러 대, 주소로 방식 추정', () => {
  const a = make();
  assert.deepEqual(a.status({ camera: { streaming: true, url: '/api/camera/stream' } }).cameras, {
    main: { streaming: true, url: '/api/camera/stream', transport: null },
  });
  const cams = a.status({ cameras: [
    { id: 'top', url: 'ws://h:8000/ws/camera/top' },
    { id: 'side', url: 'http://h:8000/side.jpg', streaming: false },
    { id: 'hls', url: 'http://h/live/index.m3u8' },
  ] }).cameras;
  assert.equal(cams.top.transport, 'ws');
  assert.equal(cams.top.streaming, true);
  assert.equal(cams.side.transport, 'snapshot');
  assert.equal(cams.side.streaming, false);
  assert.equal(cams.hls.transport, 'video');
  // 주 카메라 id는 서버 정보(GET /info)의 첫 카메라를 따른다
  a.setInfo(a.info({ cameras: [{ id: 'top' }, { id: 'side' }] }));
  assert.deepEqual(Object.keys(a.status({ camera: { streaming: false } }).cameras), ['top']);
  assert.deepEqual(a.status({ devices: { camera: 'connected', cameras: { side: false } } }).devices, { camera_top: 'connected', camera_side: 'disconnected' });
});

test('시각: ISO · 공백 · 마이크로초 · 1970년 기준 초/밀리초 · 시간대 없음', () => {
  const a = make();
  assert.equal(a.time('2026-10-06T14:32:05+09:00'), '2026-10-06T05:32:05.000Z');
  assert.equal(a.time('2026-10-06T05:32:05.123456Z'), '2026-10-06T05:32:05.123Z');
  assert.equal(a.time(1791264725), '2026-10-06T05:32:05.000Z');
  assert.equal(a.time(1791264725123), '2026-10-06T05:32:05.123Z');
  assert.equal(a.time('1791264725.5'), '2026-10-06T05:32:05.500Z');
  const utc = make({ naiveTime: 'utc' });
  assert.equal(utc.time('2026-10-06 05:32:05'), '2026-10-06T05:32:05.000Z');
  const local = make({ naiveTime: 'local' });
  assert.equal(local.time('2026-10-06T05:32:05'), new Date(2026, 9, 6, 5, 32, 5).toISOString());
  assert.equal(a.time('not a time'), null);
  assert.equal(a.time(null), null);
});

test('판정: NG/OK 글자, 참거짓 깃발, 백분율 신뢰도, 초 단위 지연', () => {
  const a = make();
  let m = one(a, { type: 'result', data: { part_id: 7, judgement: 'NG', score: 97, latency: 0.023, timestamp: 1791264725 } });
  assert.equal(m.type, 'inspection');
  assert.equal(m.data.id, 7);
  assert.equal(m.data.result, 'defect');
  assert.equal(m.data.confidence, 0.97);
  assert.equal(m.data.latencyMs, 23);
  assert.equal(m.data.at, '2026-10-06T05:32:05.000Z');
  assert.equal(m.data.stats, undefined);
  m = one(a, { type: 'inspection', data: { id: 8, is_defect: false, stats: { total: 8, good: 7, defect: 1 } } });
  assert.equal(m.data.result, 'good');
  assert.deepEqual(m.data.stats, { total: 8, good: 7, defect: 1 });
  assert.equal(a.inspection({ result: '불량' }).result, 'defect');
  assert.equal(a.inspection({ result: 'pass' }).result, 'good');
  assert.equal(a.inspection({ result: 3 }).result, null);
});

test('판정 상자: 비율·픽셀·두 모서리·가운데 기준(YOLO)·목록', () => {
  const a = make();
  assert.deepEqual(a.inspection({ result: 'defect', bbox: [0.1, 0.2, 0.3, 0.4] }).bbox, [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(a.inspection({ result: 'defect', xyxy: [128, 72, 384, 360], image_size: [1280, 720] }).bbox, [0.1, 0.1, 0.2, 0.4]);
  assert.deepEqual(a.inspection({ result: 'defect', box: { cx: 0.5, cy: 0.5, w: 0.2, h: 0.4 } }).bbox, [0.4, 0.3, 0.2, 0.4]);
  assert.deepEqual(a.inspection({ result: 'defect', detections: [{ xyxy: [0.1, 0.1, 0.5, 0.6], conf: 0.9 }] }).bbox, [0.1, 0.1, 0.4, 0.5]);
  assert.deepEqual(make({ bboxFormat: 'cxcywh' }).inspection({ result: 'defect', bbox: [0.5, 0.5, 0.2, 0.2] }).bbox, [0.4, 0.4, 0.2, 0.2]);
  // 픽셀 좌표인데 영상 크기를 모르면 그리지 않는다
  assert.equal(a.inspection({ result: 'defect', bbox: [100, 100, 50, 50] }).bbox, undefined);
  // 서버 정보에 카메라 해상도가 있으면 그것으로 바꾼다
  a.setInfo(a.info({ cameras: [{ id: 'top', width: 1000, height: 500 }] }));
  assert.deepEqual(a.inspection({ result: 'defect', camera: 'top', bbox: [100, 100, 50, 50] }).bbox, [0.1, 0.2, 0.05, 0.1]);
});

test('이벤트: 평평한 모양, 대문자 코드, 숫자 등급, 서버 문장, 장치 별명', () => {
  const a = make();
  let m = one(a, { event: 'LINE_STARTED', severity: 'INFO', ts: 1791264725 });
  assert.deepEqual(m, { type: 'event', data: { code: 'line_started', level: 'info', params: {}, at: '2026-10-06T05:32:05.000Z' } });
  m = one(a, { type: 'log', data: { name: 'deviceDisconnected', level: 40, params: { device: 'robot' }, message: 'Robot arm lost' } });
  assert.equal(m.type, 'event');
  assert.equal(m.data.code, 'device_disconnected');
  assert.equal(m.data.level, 'alarm');
  assert.equal(m.data.params.device, 'arm');
  assert.equal(m.data.message, 'Robot arm lost');
  m = one(a, { type: 'event', data: { code: 'start_rejected', level: 'warn', params: { devices: ['camera', 'teleop'] } } });
  assert.equal(m.data.level, 'warning');
  assert.deepEqual(m.data.params.devices, ['camera_main', 'leader']);
  assert.equal(a.event({ code: 'estop_pressed' }).level, 'alarm');
  // 흔한 다른 이름은 HMI 코드로 바꾼다 (화면 문구를 쓸 수 있게)
  assert.equal(a.event({ event: 'EMERGENCY_STOP_PRESSED', severity: 'CRITICAL' }).code, 'estop_pressed');
  assert.equal(a.event({ code: 'EmergencyStopReleased' }).code, 'estop_released');
  assert.equal(a.event({ code: 'homing_done' }).code, 'home_completed');
  assert.equal(a.event({ code: 'conveyor_jam' }).code, 'conveyor_jam');
});

test('관절: LeRobot 평평한 .pos(도), 정규화(-100~100), 라디안, 원시값, 배열', () => {
  const a = make();
  let m = one(a, { type: 'joints', data: { source: 'leader', 'shoulder_pan.pos': 12.5, 'gripper.pos': 40 } });
  assert.deepEqual(m.data.angles, { shoulder_pan: 12.5, gripper: 40 });
  assert.deepEqual(m.data.units, { shoulder_pan: 'deg', gripper: 'pct' });
  m = one(a, { type: 'joints', data: { source: 'follower', unit: 'range_m100_100', angles: { shoulder_pan: -50 } } });
  assert.equal(m.data.source, 'arm');
  assert.deepEqual(m.data.units, { shoulder_pan: 'pct' });
  m = one(a, { type: 'joints', data: { unit: 'rad', positions: [Math.PI / 2, 0, 0, 0, 0, 0] } });
  assert.equal(m.data.angles.shoulder_pan, 90);
  assert.equal(m.data.units.gripper, 'deg');
  // 원시값 2047.5가 가운데(0°), 캘리브레이션이 있으면 그 가운데를 쓴다
  m = one(a, { type: 'joints', data: { unit: 'raw', source: 'arm', angles: { shoulder_pan: 3071 } } });
  assert.equal(Math.round(m.data.angles.shoulder_pan), 90);
  a.setInfo(a.info({ arms: { follower: { calibration: { shoulder_pan: { range_min: 1000, range_max: 3000 } } } } }));
  m = one(a, { type: 'joints', data: { unit: 'raw', source: 'arm', angles: { shoulder_pan: 2000 } } });
  assert.equal(m.data.angles.shoulder_pan, 0);
  // 서버 정보의 관절 단위를 기본으로 쓴다
  const b = make();
  b.setInfo(b.info({ joint_unit: 'normalized' }));
  assert.deepEqual(b.joints({ angles: { elbow: 10 } }).units, { elbow_flex: 'pct' });
});

test('서보 상태: 기준 모양, 평평한 모양, 원시 전압·부하, 상태 비트', () => {
  const a = make();
  let m = one(a, { type: 'telemetry', data: { arm: 'follower', motors: { shoulder_pan: { pos: 1.5, temp: 41, volt: 12.1, load: 12, current: 130, status: 0, torque: true, moving: false } } } });
  assert.deepEqual(m.data.motors.shoulder_pan, { pos: 1.5, posUnit: 'deg', temp: 41, volt: 12.1, load: 12, current: 130, statusBits: 0, faults: [], torque: true, moving: false });
  assert.equal(m.data.arm, 'arm');
  m = one(a, { type: 'servos', data: { source: 'leader', 'elbow_flex.temperature': 50, 'elbow_flex.voltage': 74, 'elbow_flex.load': 1050, 'elbow_flex.status': 4 } });
  assert.equal(m.type, 'telemetry');
  assert.equal(m.data.arm, 'leader');
  assert.deepEqual(m.data.motors.elbow_flex, { temp: 50, volt: 7.4, load: -2.6, statusBits: 4, faults: ['temperature'] });
  m = one(a, { type: 'telemetry', data: { arm: 'arm', motors: [{ id: 3, temperature: 44 }, { name: 'gripper', temperature: 39 }] } });
  assert.equal(m.data.motors.elbow_flex.temp, 44);
  assert.equal(m.data.motors.gripper.temp, 39);
  // 원시 부하(0.1%): 100을 넘는 값을 한 번 보면 그 뒤의 작은 값도 원시값으로 읽는다
  const b = make();
  assert.equal(b.telemetry({ arm: 'arm', motors: { elbow_flex: { load: 91 } } }).motors.elbow_flex.load, 91);
  assert.equal(b.telemetry({ arm: 'arm', motors: { elbow_flex: { load: 250 } } }).motors.elbow_flex.load, 25);
  assert.equal(b.telemetry({ arm: 'arm', motors: { elbow_flex: { load: 91 } } }).motors.elbow_flex.load, 9.1);
  assert.equal(make({ loadUnit: 'permille' }).telemetry({ arm: 'arm', motors: { gripper: { load: 50 } } }).motors.gripper.load, 5);
  assert.equal(make({ loadUnit: 'pct' }).telemetry({ arm: 'arm', motors: { gripper: { load: 150 } } }).motors.gripper.load, 150);
});

test('운전 모드 글자가 다르면(AUTO) 기록해 두어 보낼 값을 맞추게 한다', () => {
  const a = make();
  assert.equal(a.status({ mode: 'AUTO' }).mode, 'auto');
  assert.ok(a.notes().some((n) => n.code === 'mode.raw:AUTO'));
  const b = make();
  b.status({ mode: 'auto' });
  assert.equal(b.notes().length, 0);
});

test('오류 응답: 기준, FastAPI(detail), 검증 실패, 글자, HTML, 별명 코드', () => {
  const a = make();
  assert.deepEqual(a.error(409, { error: { code: 'DEVICES_NOT_READY', details: { missing: ['arm', 'camera'] } } }), {
    code: 'DEVICES_NOT_READY', details: { missing: ['arm', 'camera_main'] }, message: null,
  });
  assert.deepEqual(a.error(409, { detail: { code: 'E_STOP_ACTIVE' } }).code, 'ESTOP_ACTIVE');
  assert.deepEqual(a.error(409, { detail: { error: 'devicesNotReady', missing: ['robot'] } }).details.missing, ['arm']);
  assert.deepEqual(a.error(404, { detail: 'Not Found' }), { code: 'HTTP_404', details: {}, message: 'Not Found' });
  assert.equal(a.error(422, { detail: [{ loc: ['body', 'mode'], msg: 'field required', type: 'missing' }] }).code, 'VALIDATION_ERROR');
  assert.equal(a.error(409, 'NOT_STOPPED').code, 'NOT_STOPPED');
  assert.equal(a.error(500, '<html><body>Internal Server Error</body></html>').code, 'HTTP_500');
  assert.deepEqual(a.error(409, { code: 'busy', message: 'line is busy' }), { code: 'INVALID_STATE', details: {}, message: 'line is busy' });
  assert.equal(a.error(409, { error: 'ESTOP_ACTIVE' }).code, 'ESTOP_ACTIVE');
});

test('봉투: 소켓IO식 배열, 여러 개 묶음, ROS rosbridge, payload, 모르는 종류, JSON 아님', () => {
  const a = make();
  assert.equal(one(a, ['status', { line: 'running' }]).data.line, 'running');
  const batch = a.message([{ type: 'heartbeat', data: {} }, { type: 'status', data: { line: 'stopped' } }]);
  assert.deepEqual(batch.map((m) => m.type), ['heartbeat', 'status']);
  assert.equal(one(a, { op: 'publish', topic: '/hmi/status', msg: { line: 'homing' } }).data.line, 'homing');
  assert.equal(one(a, { type: 'status', payload: { line: 'running' } }).data.line, 'running');
  assert.equal(one(a, { kind: 'heartbeat' }).type, 'heartbeat');
  assert.equal(one(a, { type: 'weather', data: {} }).type, 'unknown');
  assert.deepEqual(a.message('not json'), []);
  assert.deepEqual(a.message({ hello: 1 }), []);
  // type이 없어도 내용으로 종류를 알아낸다
  assert.equal(one(a, { line: 'running', estop: false }).type, 'status');
  assert.equal(one(a, { result: 'ok', id: 3 }).type, 'inspection');
});

test('서버 정보·성능·영상 조각·명령 응답', () => {
  const a = make();
  const info = a.info({ api: '0.2', joint_unit: 'deg', cameras: { top: { url: '/api/camera/top/stream', width: 1280, height: 720 } }, features: { telemetry: true, bbox: false } });
  assert.equal(info.api, '0.2');
  assert.equal(info.jointUnit, 'deg');
  assert.equal(info.cameras[0].id, 'top');
  assert.equal(info.cameras[0].width, 1280);
  assert.deepEqual(info.features, ['telemetry']);
  a.setInfo(info);
  assert.deepEqual(one(a, { type: 'metrics', data: { inference_ms: 21, fps: 29.7 } }).data, { inferenceMs: 21, fps: { top: 29.7 } });
  assert.deepEqual(one(a, { type: 'frame', data: { camera: 'cam_side', data: 'data:image/jpeg;base64,AAAA' } }).data, { camera: 'side', mime: 'image/jpeg', data: 'AAAA', url: null, at: null });
  assert.deepEqual(one(a, { type: 'ack', data: { id: 4, ok: false, error: 'NOT_STOPPED' } }).data, { id: 4, status: 409, body: { error: 'NOT_STOPPED' } });
  assert.deepEqual(one(a, { type: 'command_result', data: { id: 5, status: 200, body: { line: 'running' } } }).data, { id: 5, status: 200, body: { line: 'running' } });
});

test('v0.3 상태: 공정 단계·원점 필요·고장이 풀리는 방법', () => {
  const a = make();
  const st = a.status({ line: 'running', home_required: false, cycle: { stage: 'sorting', part: 812, step: 'grasp_part' } });
  assert.deepEqual(st.cycle, { stage: 'sorting', part: 812, step: 'grasp_part' });
  assert.equal(st.homeRequired, false);
  assert.equal(a.status({ cycle: null }).cycle, null);
  assert.deepEqual(a.status({ process: 'PICKING' }).cycle, { stage: 'sorting', part: null, step: null });
  assert.equal(a.status({ cycle: { phase: 'judging' } }).cycle.stage, 'inspecting');
  assert.equal(a.status({ needs_home: 'true' }).homeRequired, true);
  assert.deepEqual(a.status({ fault: { code: 'GRIP_FAILED', params: { step: 'pick' }, clear: 'home' } }).fault, { code: 'GRIP_FAILED', params: { step: 'pick' }, clear: 'home' });
  assert.equal(a.status({ fault: { code: 'PART_STUCK', clear: 'ACK' } }).fault.clear, 'start');
  assert.equal(a.status({ fault: { code: 'X', clear: 'whenever' } }).fault.clear, 'auto');
});

test('v0.3 순번: 판정·이벤트의 seq', () => {
  const a = make();
  assert.equal(one(a, { type: 'inspection', data: { seq: 1532, id: 812, result: 'good' } }).data.seq, 1532);
  assert.equal(one(a, { type: 'event', data: { seq: 1533, code: 'line_started', level: 'info' } }).data.seq, 1533);
  assert.equal(one(a, { type: 'event', data: { code: 'line_started' } }).data.seq, undefined);
});

test('v0.3 기록 조회 응답: 오래된 것부터, 분당 집계, 다른 이름', () => {
  const a = make();
  const h = a.history({
    run_id: 20261012, now: '2026-10-12T14:32:05+09:00', last_seq: 1532,
    events: [{ seq: 1520, code: 'MODE_CHANGED', level: 'info', params: { mode: 'AUTO' } }, { seq: 1517, code: 'servo_overheat', level: 'warning' }],
    inspections: [{ seq: 1532, id: 812, result: 'OK', at: '2026-10-12T14:32:04+09:00' }],
    minutes: [{ t: '2026-10-12T14:31:00+09:00', good: 18, defect: 2 }, { time: '2026-10-12T14:32:00+09:00', ok: 3, ng: 1 }],
  });
  assert.equal(h.runId, '20261012');
  assert.equal(h.now, '2026-10-12T05:32:05.000Z');
  assert.equal(h.lastSeq, 1532);
  assert.deepEqual(h.events.map((e) => e.seq), [1517, 1520]);
  assert.equal(h.events[1].code, 'mode_changed');
  assert.equal(h.events[1].params.mode, 'auto');
  assert.equal(h.inspections[0].result, 'good');
  assert.deepEqual(h.minutes, [
    { t: '2026-10-12T05:31:00.000Z', good: 18, defect: 2 },
    { t: '2026-10-12T05:32:00.000Z', good: 3, defect: 1 },
  ]);
  const old = a.history({ logs: [{ code: 'x' }] });
  assert.equal(old.events.length, 1);
  assert.equal(old.minutes, null); // 분당 집계가 없으면 null (화면이 판정으로 센다)
});
