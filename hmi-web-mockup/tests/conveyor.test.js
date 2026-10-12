// 컨베이어 시리얼 규약(js/conveyor.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 서버 쪽 견본(Client)과 가짜 아두이노가 docs/conveyor-protocol.md대로 주고받는지, 규약 점검이 맞게 판정하는지 본다.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../js/conveyor.js');
const C = window.Conveyor;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 가짜 아두이노에 붙은 서버 쪽 견본. fast면 벨트를 빠르게 돌려 부품이 자주 온다
async function setup(t, options, setupOpts) {
  const link = C.fakeLink(Object.assign({ bootMs: 5 }, options));
  const client = new C.Client(link, { readyWaitMs: 500 });
  const got = [];
  client.on((kind, data) => got.push({ kind, data }));
  t.after(() => client.close());
  const info = await client.open(setupOpts);
  return { link, device: link.device, client, info, got };
}

async function until(pred, ms) {
  const end = Date.now() + (ms || 2000);
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(10);
  }
  return false;
}

test('한 줄 읽기: 응답·오류·알림·그 밖', () => {
  assert.deepEqual(C.parse('OK proto=1 fw=0.1.0'), { kind: 'ok', args: [], fields: { proto: '1', fw: '0.1.0' }, line: 'OK proto=1 fw=0.1.0' });
  const err = C.parse('ERR halted');
  assert.equal(err.kind, 'err');
  assert.equal(err.code, 'HALTED');
  const evt = C.parse('!STATE halted reason=watchdog');
  assert.equal(evt.kind, 'event');
  assert.equal(evt.name, 'STATE');
  assert.deepEqual(evt.args, ['halted']);
  assert.equal(evt.fields.reason, 'watchdog');
  assert.equal(C.parse('motor pwm 128').kind, 'text');
});

test('줄 나누기: 잘려 온 바이트와 \\r\\n', () => {
  const s = new C.LineSplitter();
  assert.deepEqual(s.feed('OK pro'), []);
  assert.deepEqual(s.feed('to=1\r\n!PART 1\n!PA'), ['OK proto=1', '!PART 1']);
  assert.deepEqual(s.feed(new TextEncoder().encode('RT 0\n')), ['!PART 0']);
});

test('연결 순서: !READY → INFO → STOP → STATUS, 기능과 상태를 안다', async (t) => {
  const { info, client, got } = await setup(t, {}, { speed: 60, autostop: true });
  assert.equal(info.proto, 1);
  assert.equal(info.speed && info.sensor && info.autostop, true);
  assert.equal(info.watchdogMs, 1000);
  assert.equal(client.state.state, 'stopped');
  assert.ok(got.some((g) => g.kind === 'ready'));
  const st = await client.status();
  assert.equal(st.speed, 60);
  assert.equal(st.autostop, true);
  assert.equal(st.part, false);
});

test('가동·잠금·풀기: 잠기면 RUN을 거절하고, 풀어도 멈춘 그대로', async (t) => {
  const { client } = await setup(t);
  await client.run();
  assert.ok(await until(() => client.state.state === 'running'));
  await client.halt();
  assert.ok(await until(() => client.state.state === 'halted'));
  await assert.rejects(client.run(), (err) => err.code === 'HALTED');
  await client.stop(); // 잠긴 채로 STOP은 잠김을 풀지 않는다
  assert.equal((await client.status()).state, 'halted');
  await client.reset();
  assert.equal((await client.status()).state, 'stopped');
  await assert.rejects(client.send('JUMP'), (err) => err.code === 'UNKNOWN');
  await assert.rejects(client.speed(101), (err) => err.code === 'BAD_ARG');
});

test('감시 타이머: PING이 끊기면 아두이노가 스스로 멈추고 잠근다', async (t) => {
  const { client } = await setup(t, { watchdogMs: 200 });
  await client.run();
  client.keepAlive(false);
  assert.ok(await until(() => client.state.state === 'halted', 1000));
  assert.equal(client.state.reason, 'watchdog');
  await assert.rejects(client.run(), (err) => err.code === 'HALTED');
});

test('PING이 이어지면 감시 타이머가 멈추지 않는다', async (t) => {
  const { client } = await setup(t, { watchdogMs: 200 });
  await client.run();
  await sleep(600);
  assert.equal(client.state.state, 'running');
});

test('스스로 멈추기: 센서에 부품이 오면 !PART 1 다음 멈춤, 다시 가동하면 그 부품은 지나간다', async (t) => {
  const { client, got } = await setup(t, { maxMmS: 400 }, { speed: 100, autostop: true });
  await client.run();
  assert.ok(await until(() => client.state.state === 'stopped' && client.state.reason === 'part', 2000));
  const order = got.filter((g) => g.kind === 'event').map((g) => g.data.name + (g.data.args[0] ? ' ' + g.data.args[0] : ''));
  assert.deepEqual(order.slice(-2), ['PART 1', 'STATE stopped']);
  await client.run();
  assert.ok(await until(() => client.state.part === false, 1000));
  assert.equal(client.state.state, 'running');
});

test('로봇팔이 부품을 집어 가면 !PART 0', async (t) => {
  const { client, device } = await setup(t, { maxMmS: 400 }, { speed: 100, autostop: true });
  await client.run();
  assert.ok(await until(() => client.state.part === true, 2000));
  device.removePart();
  assert.ok(await until(() => client.state.part === false, 500));
});

test('USB가 빠지면 응답 없음 3번 → 끊김, 다시 꽂으면 리셋 알림과 함께 돌아옴', async (t) => {
  const { client, device, got } = await setup(t);
  device.setUnplugged(true);
  assert.ok(await until(() => got.some((g) => g.kind === 'lost'), 2000));
  device.setUnplugged(false);
  assert.ok(await until(() => got.some((g) => g.kind === 'back'), 2000));
  assert.ok(got.filter((g) => g.kind === 'ready').length >= 2);
  assert.equal(client.state.reason, 'boot');
});

test('규약 점검: 가짜 아두이노는 모두 통과', async (t) => {
  const { client } = await setup(t, { watchdogMs: 250 });
  const results = await C.check(client, { motion: true });
  const failed = results.filter((r) => r.ok === false);
  assert.deepEqual(failed, []);
  ['info', 'status', 'unknown', 'badarg', 'stop', 'run', 'halt', 'reset', 'watchdog', 'speed', 'autostop'].forEach((id) => {
    assert.equal(results.find((r) => r.id === id).ok, true, id);
  });
});

test('규약 점검: 센서·속도가 없는 컨베이어도 그에 맞게 판정', async (t) => {
  const { client } = await setup(t, { sensor: false, speed: false, watchdogMs: 250 });
  const results = await C.check(client, { motion: false });
  assert.deepEqual(results.filter((r) => r.ok === false), []);
  assert.equal(results.find((r) => r.id === 'badarg').title, '속도 조절 없음: SPEED → ERR UNSUPPORTED');
  assert.equal(results.find((r) => r.id === 'motion').ok, null);
  assert.equal(results.find((r) => r.id === 'sensor'), undefined);
});

test('규약 점검: 모르는 명령에 답하지 않는 스케치를 잡아낸다', async (t) => {
  const link = C.fakeLink({ bootMs: 5, watchdogMs: 250 });
  const receive = link.device.receive.bind(link.device);
  link.device.receive = (line) => { if (!/^NOPE/.test(line)) receive(line); };
  const client = new C.Client(link, { readyWaitMs: 500 });
  t.after(() => client.close());
  const results = await C.check(client, { motion: false });
  const unknown = results.find((r) => r.id === 'unknown');
  assert.equal(unknown.ok, false);
  assert.match(unknown.note, /답이 없습니다/);
});
