// 가짜 서버(js/mock-server.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 실제 서버를 만들 때 동작 견본으로 쓰므로, 문서(docs/API.md v0.5 · docs/line-sequence.md)에 적은 규칙대로 움직이는지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../config/robot.js');
require('../js/conveyor.js');
require('../js/mock-server.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 시험은 빠르게: 벨트를 빨리 돌리고(부품이 0.2초마다), 로봇팔도 빨리 움직이며, 불량은 일부러 낼 때만
function setup(t, options) {
  const server = new window.MockServer(Object.assign({ defectRate: 0, armSpeed: 900, conveyor: { maxMmS: 400 } }, options));
  const got = [];
  server.connect({ onMessage: (m) => got.push(m) });
  t.after(() => server.destroy());
  const events = () => got.filter((m) => m.type === 'event').map((m) => m.data.code + ':' + m.data.level);
  // 가동 중 단계가 바뀐 차례 (같은 단계가 이어지면 하나로)
  const stages = () => got.filter((m) => m.type === 'status' && m.data.cycle).map((m) => m.data.cycle.stage)
    .filter((s, i, xs) => s !== xs[i - 1]);
  const device = server.conv.link.device;
  return { server, got, events, stages, device };
}

async function until(pred, ms) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(10);
  }
  return false;
}

// 원점은 HMI가 저장하고 원점 복귀 명령이 각도를 가져온다 (v0.5)
const POSE_A = { shoulder_pan: 25, shoulder_lift: -10, elbow_flex: 50, wrist_flex: 30, wrist_roll: 5, gripper: 40 };
const homeBody = (pose) => ({ angles: Object.assign({}, pose), unit: 'deg' });

async function startLine(server) {
  await until(() => server.conv.opened, 2000);
  const r = await server.request('POST', '/line/start');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r;
}

test('서버 정보와 상태 모양 (v0.5)', async (t) => {
  const { server } = setup(t);
  const info = await server.request('GET', '/info');
  assert.equal(info.body.api, '0.5');
  assert.deepEqual(info.body.cameras.map((c) => c.id), ['top', 'close']);
  assert.ok(['history', 'cycle', 'home'].every((f) => info.body.features.includes(f)));
  const st = (await server.request('GET', '/status')).body;
  assert.deepEqual(Object.keys(st.devices), ['conveyor', 'arm', 'leader', 'camera_top', 'camera_close']);
  assert.deepEqual(Object.keys(st.cameras), ['top', 'close']);
  assert.equal(st.fault, null);
  assert.equal(st.home_required, false);
  assert.equal(st.cycle, null);
  assert.equal(st.home, undefined); // 원점은 서버가 아니라 HMI가 저장한다 (v0.5)
});

test('시작: 위 카메라가 끊겨 있으면 거절, 연결되면 가동', async (t) => {
  const { server, events } = setup(t);
  server.setDevice('camera_top', false);
  const r1 = await server.request('POST', '/line/start');
  assert.equal(r1.status, 409);
  assert.deepEqual(r1.body.error, { code: 'DEVICES_NOT_READY', details: { missing: ['camera_top'] } });
  server.setDevice('camera_top', true);
  await startLine(server);
  assert.equal(server.state.line, 'running');
  assert.ok(server.state.started_at);
  assert.ok(events().includes('start_rejected:warning'));
  assert.ok(events().includes('line_started:info'));
});

test('공정 순서: 부품이 오면 멈춰 판정하고, 양품은 내보낸 뒤 다음 부품을 기다린다', async (t) => {
  const { server, got, stages, device } = setup(t);
  await startLine(server);
  assert.ok(await until(() => server.state.cycle && server.state.cycle.stage === 'inspecting'));
  assert.equal(device.state, 'stopped'); // 판정하는 동안 벨트는 서 있다
  assert.equal(device.reason, 'part'); // 아두이노가 센서로 스스로 멈췄다
  assert.equal(server.state.cycle.part, server.nextId);
  assert.ok(await until(() => got.some((m) => m.type === 'inspection')));
  const insp = got.find((m) => m.type === 'inspection').data;
  assert.equal(insp.result, 'good');
  assert.equal(typeof insp.seq, 'number');
  assert.ok(await until(() => stages().join().startsWith('feeding,inspecting,passing,feeding')), stages().join());
});

test('불량: 로봇팔 작업(자세 → 학습 정책 → 자세)으로 불량 상자에 넣고 다음 부품으로', async (t) => {
  const { server, got, stages } = setup(t);
  server.simulate('defect', true);
  await startLine(server);
  assert.ok(await until(() => stages().includes('sorting')));
  const steps = () => got.filter((m) => m.type === 'status' && m.data.cycle && m.data.cycle.step).map((m) => m.data.cycle.step)
    .filter((s, i, xs) => s !== xs[i - 1]);
  assert.ok(await until(() => steps().includes('wait') && server.state.cycle && server.state.cycle.stage === 'feeding', 5000), steps().join());
  assert.deepEqual(steps().slice(0, 5), ['above_pick', 'grasp_part', 'above_bin', 'gripper_open', 'wait']);
  assert.equal(server.holding, false);
  assert.equal(server.state.fault, null);
  assert.ok(got.some((m) => m.type === 'event' && m.data.code === 'defect_detected'));
});

test('집기 실패: 한 번 다시 시도 → 그래도 안 되면 GRIP_FAILED, 원점 복귀를 해야 다시 시작', async (t) => {
  const tasks = { sort_defect: { retry: { times: 1, from: 0 }, steps: [
    { pose: 'above_pick' }, { policy: 'grasp_part', timeout_s: 0.4, until: 'holding' }, { pose: 'above_bin' }, { gripper: 'open' }, { pose: 'wait' },
  ] } };
  const { server, events } = setup(t, { tasks });
  server.simulate('defect', true);
  server.simulate('gripFail', true);
  await startLine(server);
  assert.ok(await until(() => server.state.fault !== null, 5000));
  assert.ok(events().includes('sort_retry:warning'));
  assert.ok(events().includes('line_halted:warning'));
  assert.equal(server.state.line, 'stopped');
  assert.deepEqual(server.state.fault.code, 'GRIP_FAILED');
  assert.equal(server.state.fault.clear, 'home');
  assert.equal(server.state.fault.params.step, 'grasp_part');
  assert.equal(server.state.home_required, true);
  assert.equal((await server.request('POST', '/line/start')).body.error.code, 'HOME_REQUIRED');
  assert.equal((await server.request('POST', '/robot/home', homeBody(POSE_A))).status, 202);
  assert.ok(await until(() => server.state.line === 'stopped', 3000));
  assert.equal(server.state.fault, null);
  assert.equal(server.state.home_required, false);
  server.simulate('gripFail', false);
  await startLine(server);
});

test('긴급정지: 컨베이어를 잠그고 로봇팔 힘을 뺀다. 해제하면 컨베이어만 풀리고 자동 시작에는 원점 복귀가 필요하다', async (t) => {
  const { server, device } = setup(t);
  await startLine(server);
  assert.equal((await server.request('POST', '/estop')).status, 200);
  assert.equal((await server.request('POST', '/estop')).status, 200);
  assert.ok(await until(() => device.state === 'halted'));
  assert.equal(server.arms.arm.torque, false);
  assert.equal(server.state.home_required, true);
  assert.equal(server.state.cycle, null);
  assert.equal((await server.request('POST', '/line/start')).body.error.code, 'ESTOP_ACTIVE');
  assert.equal((await server.request('POST', '/estop/release')).status, 200);
  assert.ok(await until(() => device.state === 'stopped'));
  assert.equal(server.state.line, 'stopped');
  assert.equal(server.arms.arm.torque, true);
  assert.equal((await server.request('POST', '/estop/release')).body.error.code, 'ESTOP_NOT_ACTIVE');
  assert.equal((await server.request('POST', '/line/start')).body.error.code, 'HOME_REQUIRED');
});

test('컨베이어 정지 단추: 가동 중이면 CONVEYOR_HALTED, 누른 채 시작하면 거절, 떼고 시작하면 풀린다', async (t) => {
  const { server, events } = setup(t);
  await startLine(server);
  server.simulate('conveyorButton', true);
  assert.ok(await until(() => server.state.fault !== null));
  assert.deepEqual(server.state.fault, { code: 'CONVEYOR_HALTED', params: { reason: 'button' }, clear: 'start' });
  assert.ok(events().includes('line_halted:warning'));
  const r = await server.request('POST', '/line/start');
  assert.equal(r.body.error.code, 'FAULT_ACTIVE'); // 단추가 눌려 있어 잠금을 풀 수 없음
  server.simulate('conveyorButton', false);
  await startLine(server);
  assert.equal(server.state.fault, null);
});

test('부품 걸림: 양품이 검사 자리를 지나가지 않으면 PART_STUCK (확인하고 시작하면 풀림)', async (t) => {
  const { server } = setup(t, { line: { passTimeoutMs: 300 } });
  server.simulate('jam', true);
  await startLine(server);
  assert.ok(await until(() => server.state.fault !== null, 3000));
  assert.equal(server.state.fault.code, 'PART_STUCK');
  assert.equal(server.state.fault.clear, 'start');
  assert.equal(server.state.home_required, false);
  server.simulate('jam', false);
  await startLine(server);
});

test('감시 타이머: 서버가 PING을 멈추면 컨베이어가 스스로 잠기고 라인은 고장으로 선다', async (t) => {
  const { server } = setup(t, { conveyor: { maxMmS: 400, watchdogMs: 200 } });
  await startLine(server);
  server.conv.client.keepAlive(false);
  assert.ok(await until(() => server.state.fault !== null, 2000));
  assert.deepEqual(server.state.fault.params, { reason: 'watchdog' });
  assert.equal(server.state.line, 'stopped');
});

test('컨베이어 USB를 뽑으면 응답 없음으로 끊김 → 라인 정지, 다시 꽂으면 연결', async (t) => {
  const { server, events } = setup(t);
  await startLine(server);
  server.setDevice('conveyor', false);
  assert.ok(await until(() => server.state.devices.conveyor === 'disconnected', 3000));
  assert.equal(server.state.line, 'stopped');
  assert.ok(events().includes('line_stopped_fault:warning'));
  server.setDevice('conveyor', true);
  assert.ok(await until(() => server.state.devices.conveyor === 'connected', 3000));
  assert.ok(events().includes('device_reconnected:info'));
  await startLine(server);
});

test('정지: 로봇팔이 불량품을 옮기는 중이면 그 작업을 끝낸 뒤 정지', async (t) => {
  const { server, events } = setup(t, { armSpeed: 300 });
  server.simulate('defect', true);
  await startLine(server);
  assert.ok(await until(() => server.task !== null));
  const r = await server.request('POST', '/line/stop');
  assert.equal(r.body.line, 'stopping');
  assert.ok(await until(() => server.state.line === 'stopped', 6000));
  assert.equal(server.state.home_required, false);
  assert.ok(events().includes('line_stopped:info'));
});

test('수동 모드: 부품마다 멈추지 않고 판정만 보낸다', async (t) => {
  const { server, got, device } = setup(t);
  await server.request('PUT', '/mode', { mode: 'manual' });
  await startLine(server);
  assert.ok(await until(() => got.filter((m) => m.type === 'inspection').length >= 2, 3000));
  assert.equal(device.state, 'running');
  assert.equal(server.state.cycle.stage, 'feeding');
});

test('서보 과열: 경고 → 비상 → 라인 정지(고장) → 식으면 고장 해제', async (t) => {
  const { server, got, events } = setup(t);
  await startLine(server);
  server.arms.arm.temp.elbow_flex = 56;
  server.sendTelemetry();
  assert.ok(events().includes('servo_overheat:warning'));
  server.arms.arm.temp.elbow_flex = 66;
  server.sendTelemetry();
  assert.ok(events().includes('servo_overheat:alarm'));
  assert.ok(events().includes('line_halted:warning'));
  assert.equal(server.state.line, 'stopped');
  assert.equal(server.state.fault.code, 'SERVO_OVERHEAT');
  assert.equal(server.state.fault.clear, 'auto');
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

// 원점 (v0.5): 원점은 HMI가 저장한다. 복귀 = HMI가 보낸 각도로 이동(자동 모드·정지 상태). 잡기는 HMI 안에서 끝나 서버 명령이 없다
function placeArm(server, pose) { // 사람이 리더암으로 팔을 그 자세에 옮겨 둔 것처럼
  Object.assign(server.arms.arm.pos, pose);
  Object.assign(server.arms.arm.target, pose);
}

test('원점 복귀: 자동 모드·정지 상태에서만, HMI가 보낸 각도로 옮기고 닿으면 끝', async (t) => {
  const { server, events } = setup(t);
  await server.request('PUT', '/mode', { mode: 'manual' });
  assert.equal((await server.request('POST', '/robot/home', homeBody(POSE_A))).body.error.code, 'NOT_AUTO');
  await server.request('PUT', '/mode', { mode: 'auto' });
  assert.equal((await server.request('POST', '/robot/home')).body.error.code, 'HOME_NOT_SET'); // 각도 없이 오면
  const r = await server.request('POST', '/robot/home', homeBody(Object.assign({}, POSE_A, { gripper: 'open' })));
  assert.equal(r.status, 422);
  assert.deepEqual(r.body.error, { code: 'INVALID_ANGLES', details: { joints: ['gripper'] } });
  assert.equal((await server.request('POST', '/robot/home', homeBody(POSE_A))).status, 202);
  assert.equal(server.state.line, 'homing');
  assert.deepEqual(server.arms.arm.target, POSE_A);
  assert.ok(await until(() => server.state.line === 'stopped'));
  assert.ok(events().includes('home_completed:info'));
  await startLine(server);
  assert.equal((await server.request('POST', '/robot/home', homeBody(POSE_A))).body.error.code, 'NOT_STOPPED');
});

test('원점 잡기는 서버 명령이 없다 (HMI가 저장)', async (t) => {
  const { server } = setup(t);
  assert.equal((await server.request('POST', '/robot/home/set')).status, 404);
});

test('원점 복귀 필요는 자동 모드에만: 긴급정지 뒤 수동 시작은 되고, 자동 시작은 원점 복귀를 마쳐야 된다', async (t) => {
  const { server } = setup(t);
  await until(() => server.conv.opened, 2000);
  await server.request('POST', '/estop');
  await server.request('POST', '/estop/release');
  assert.equal((await server.request('POST', '/line/start')).body.error.code, 'HOME_REQUIRED');
  await server.request('PUT', '/mode', { mode: 'manual' });
  await startLine(server);
  assert.equal(server.state.home_required, true); // 자동으로 돌아가려면 아직 필요
  await server.request('POST', '/line/stop');
  assert.ok(await until(() => server.state.line === 'stopped', 3000));
  await server.request('PUT', '/mode', { mode: 'auto' });
  assert.equal((await server.request('POST', '/line/start')).body.error.code, 'HOME_REQUIRED');
  placeArm(server, POSE_A);
  assert.equal((await server.request('POST', '/robot/home', homeBody(POSE_A))).status, 202);
  assert.ok(await until(() => server.state.line === 'stopped' && !server.state.home_required, 3000));
  await startLine(server);
});

test('서버는 저장된 원점을 보지 않는다: 원점이 없어도 자동 시작을 거절하지 않는다 (HMI가 본다)', async (t) => {
  const { server } = setup(t);
  await startLine(server);
});

test('기록 조회: 순번이 이어지고, after 뒤만, 분당 집계', async (t) => {
  const { server } = setup(t);
  await server.request('PUT', '/mode', { mode: 'manual' });
  await server.request('PUT', '/mode', { mode: 'auto' });
  await startLine(server);
  assert.ok(await until(() => server.log.inspections.length >= 2, 3000));
  const all = (await server.request('GET', '/history')).body;
  assert.equal(all.run_id, server.runId);
  assert.ok(all.now);
  const seqs = all.events.concat(all.inspections).map((x) => x.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1)); // 이벤트와 판정에 한 줄로 이어 매긴다
  assert.equal(all.last_seq, server.seq);
  assert.equal(all.events[0].code, 'mode_changed');
  const total = all.minutes.reduce((n, b) => n + b.good + b.defect, 0);
  assert.equal(total, server.log.inspections.length);
  const mid = all.events[1].seq;
  const later = (await server.request('GET', '/history?after=' + mid + '&events=200&inspections=0&minutes=0')).body;
  assert.ok(later.events.every((e) => e.seq > mid));
  assert.deepEqual(later.inspections, []);
  assert.deepEqual(later.minutes, []);
});

test('서버 연결이 끊긴 동안 생긴 이벤트도 기록 조회로 받는다', async (t) => {
  const { server, got } = setup(t);
  await sleep(200);
  const last = server.seq;
  server.setOnline(false);
  server.setDevice('camera_close', false);
  server.setOnline(true);
  assert.equal(got.some((m) => m.type === 'event' && m.data.code === 'device_disconnected'), false);
  const h = (await server.request('GET', '/history?after=' + last)).body;
  assert.deepEqual(h.events.map((e) => e.code), ['device_disconnected']);
});

test('다른 탭이 이어받기: 마지막 상태·판정 번호·기록 순번을 잇는다', (t) => {
  const seed = { line: 'homing', estop: false, mode: 'manual', stats: { total: 41, good: 38, defect: 3 }, devices: { leader: 'disconnected' }, home_required: true };
  const history = { runId: 'run-a', seq: 77, events: [{ seq: 77, code: 'line_started', level: 'info', params: {}, at: new Date().toISOString() }], inspections: [], minutes: [] };
  const server = new window.MockServer({ seed, history });
  t.after(() => server.destroy());
  assert.equal(server.state.line, 'stopped'); // 옮겨 가는 중이던 상태는 정지로
  assert.equal(server.state.mode, 'manual');
  assert.equal(server.state.devices.leader, 'disconnected');
  assert.equal(server.state.home_required, true);
  assert.equal(server.nextId, 42);
  assert.equal(server.runId, 'run-a');
  server.event('mode_changed', 'info', { mode: 'auto' });
  assert.equal(server.log.events[server.log.events.length - 1].seq, 78);
});
