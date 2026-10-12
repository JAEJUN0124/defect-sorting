// 가짜 서버(js/mock-server.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 실제 서버를 만들 때 동작 견본으로 쓰므로, 문서(docs/API.md v0.2)에 적은 규칙대로 움직이는지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../config/robot.js');
require('../js/mock-server.js');

function setup(t) {
  const server = new window.MockServer();
  const got = [];
  server.connect({ onMessage: (m) => got.push(m) });
  t.after(() => server.destroy());
  const events = () => got.filter((m) => m.type === 'event').map((m) => m.data.code + ':' + m.data.level);
  return { server, got, events };
}

test('서버 정보와 상태 모양 (v0.2)', async (t) => {
  const { server } = setup(t);
  const info = await server.request('GET', '/info');
  assert.equal(info.body.api, '0.2');
  assert.deepEqual(info.body.cameras.map((c) => c.id), ['top', 'close']);
  const st = (await server.request('GET', '/status')).body;
  assert.deepEqual(Object.keys(st.devices), ['conveyor', 'arm', 'leader', 'camera_top', 'camera_close']);
  assert.deepEqual(Object.keys(st.cameras), ['top', 'close']);
  assert.equal(st.fault, null);
});

test('시작: 위 카메라가 끊겨 있으면 거절, 연결되면 가동', async (t) => {
  const { server, events } = setup(t);
  server.setDevice('camera_top', false);
  const r1 = await server.request('POST', '/line/start');
  assert.equal(r1.status, 409);
  assert.deepEqual(r1.body.error, { code: 'DEVICES_NOT_READY', details: { missing: ['camera_top'] } });
  server.setDevice('camera_top', true);
  const r2 = await server.request('POST', '/line/start');
  assert.equal(r2.status, 200);
  assert.equal(server.state.line, 'running');
  assert.ok(server.state.started_at);
  assert.ok(events().includes('start_rejected:warning'));
  assert.ok(events().includes('line_started:info'));
});

test('긴급정지: 늘 받고, 해제해도 정지 상태, 해제 뒤 힘을 다시 준다', async (t) => {
  const { server } = setup(t);
  assert.equal((await server.request('POST', '/estop')).status, 200);
  assert.equal((await server.request('POST', '/estop')).status, 200);
  assert.equal(server.arms.arm.torque, false);
  assert.equal((await server.request('POST', '/line/start')).body.error.code, 'ESTOP_ACTIVE');
  assert.equal((await server.request('POST', '/estop/release')).status, 200);
  assert.equal(server.state.line, 'stopped');
  assert.equal(server.arms.arm.torque, true);
  assert.equal((await server.request('POST', '/estop/release')).body.error.code, 'ESTOP_NOT_ACTIVE');
});

test('서보 과열: 경고 → 비상 → 라인 정지(고장) → 식으면 고장 해제', async (t) => {
  const { server, got, events } = setup(t);
  await server.request('POST', '/line/start');
  server.arms.arm.temp.elbow_flex = 56;
  server.sendTelemetry();
  assert.ok(events().includes('servo_overheat:warning'));
  server.arms.arm.temp.elbow_flex = 66;
  server.sendTelemetry();
  assert.ok(events().includes('servo_overheat:alarm'));
  assert.ok(events().includes('line_halted:warning'));
  assert.equal(server.state.line, 'stopped');
  assert.equal(server.state.fault.code, 'SERVO_OVERHEAT');
  assert.equal((await server.request('POST', '/line/start')).body.error.code, 'FAULT_ACTIVE');
  // 경고 이벤트는 그 온도를 담은 서보 상태보다 먼저 간다
  const lastTel = got.map((m) => m.type).lastIndexOf('telemetry');
  const alarmAt = got.findIndex((m) => m.type === 'event' && m.data.level === 'alarm');
  assert.ok(alarmAt < lastTel);
  server.arms.arm.temp.elbow_flex = 40;
  server.sendTelemetry();
  assert.equal(server.state.fault, null);
  assert.ok(events().includes('servo_recovered:info'));
});

test('리더에 12V 어댑터: 전압 비상 기록, 수동 모드 시작 거절', async (t) => {
  const { server, events } = setup(t);
  server.simulate('voltage', true);
  server.sendTelemetry();
  assert.ok(events().includes('servo_voltage:alarm'));
  await server.request('PUT', '/mode', { mode: 'manual' });
  const r = await server.request('POST', '/line/start');
  assert.deepEqual(r.body.error, { code: 'POWER_ABNORMAL', details: { arm: 'leader' } });
  // 처음 보내는 서보 상태에서 "정상으로 돌아옴"이 잘못 나가지 않는다
  assert.equal(events().filter((e) => e.startsWith('servo_recovered')).length, 0);
});

test('카메라: 하나만 켜기, 없는 카메라, 모두 끄기', async (t) => {
  const { server } = setup(t);
  const r = await server.request('POST', '/camera/start', { camera: 'close' });
  assert.equal(r.status, 200);
  assert.equal(server.state.cameras.close.streaming, true);
  assert.equal(server.state.cameras.top.streaming, false);
  assert.equal((await server.request('POST', '/camera/start', { camera: 'wrist' })).body.error.code, 'CAMERA_NOT_FOUND');
  await server.request('POST', '/camera/start');
  assert.equal(server.state.cameras.top.streaming, true);
  await server.request('POST', '/camera/stop');
  assert.equal(server.state.cameras.top.streaming || server.state.cameras.close.streaming, false);
});

test('원점: 정지 상태에서만, 각도 6개가 모두 있어야', async (t) => {
  const { server } = setup(t);
  assert.equal((await server.request('POST', '/robot/home', { angles: { shoulder_pan: 0 } })).body.error.code, 'INVALID_ANGLES');
  const angles = { shoulder_pan: 0, shoulder_lift: 0, elbow_flex: 0, wrist_flex: 0, wrist_roll: 0, gripper: 0 };
  assert.equal((await server.request('POST', '/robot/home', { angles, unit: 'deg' })).status, 202);
  assert.equal(server.state.line, 'homing');
  assert.equal(server.arms.arm.target.elbow_flex, 0);
});

test('다른 탭이 이어받기: 마지막 상태에서 이어 가고 판정 번호도 잇는다', (t) => {
  const seed = { line: 'homing', estop: false, mode: 'manual', stats: { total: 41, good: 38, defect: 3 }, devices: { leader: 'disconnected' } };
  const server = new window.MockServer({ seed });
  t.after(() => server.destroy());
  assert.equal(server.state.line, 'stopped'); // 옮겨 가는 중이던 상태는 정지로
  assert.equal(server.state.mode, 'manual');
  assert.equal(server.state.devices.leader, 'disconnected');
  assert.equal(server.nextId, 42);
});
