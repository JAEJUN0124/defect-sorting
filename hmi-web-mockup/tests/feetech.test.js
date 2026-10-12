// Feetech STS 서보 버스 읽기(js/feetech.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 실제 로봇팔 없이 묶음 모양·검사합·해석과, 가짜 서보 6개(STS3215)에 대한 찾기·읽기를 본다.
const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../js/feetech.js');
const FT = window.Feetech;
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

test('명령 묶음: 핑·읽기 검사합', () => {
  assert.equal(hex(FT.ping(1)), 'FF FF 01 02 01 FB');
  assert.equal(hex(FT.read(1, 56, 2)), 'FF FF 01 04 02 38 02 BE');
  assert.equal(hex(FT.read(6, 0, 16)), 'FF FF 06 04 02 00 10 E3');
});

test('응답 해석: 깨진 바이트 건너뛰기, 나뉘어 온 묶음, 검사합 틀림', () => {
  const p = new FT.Parser();
  // 위치 2048 응답 = FF FF 01 04 00 00 08 F2
  const ok = [0xff, 0xff, 0x01, 0x04, 0x00, 0x00, 0x08, 0xf2];
  assert.deepEqual(p.feed([0x13, 0x37].concat(ok.slice(0, 5))), []);
  const got = p.feed(ok.slice(5));
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 1);
  assert.deepEqual(got[0].params, [0x00, 0x08]);
  const bad = ok.slice();
  bad[7] = 0x00;
  assert.equal(p.feed(bad)[0].bad, true);
  // 머리 FF가 셋이어도 읽는다
  assert.equal(p.feed([0xff].concat(ok))[0].id, 1);
});

test('부호 비트(크기+방향)와 서보 상태 해석', () => {
  assert.equal(FT.signMagnitude(0x8000 | 100, 15), -100);
  assert.equal(FT.signMagnitude(1024 | 50, 10), -50);
  assert.equal(FT.signMagnitude(2048, 15), 2048);
  // 위치 3071, 속도 0, 부하 -12.5%, 12.1V, 41°C, 상태 4(온도), 움직임 1, 전류 20 → 130mA
  const params = [0xff, 0x0b, 0, 0, 125 & 0xff, (1 << 10 | 125) >> 8, 121, 41, 0, 4, 1, 0, 0, 20, 0];
  const t = FT.decodeTelemetry(params);
  assert.deepEqual(t, { raw: 3071, speed: 0, load: -12.5, volt: 12.1, temp: 41, status: 4, faults: ['temperature'], moving: true, current: 130 });
});

test('각도·백분율: LeRobot과 같은 식, 캘리브레이션 여부', () => {
  assert.equal(FT.toDegrees(2047.5, 0, 4095), 0);
  assert.equal(Math.round(FT.toDegrees(3071, 0, 4095)), 90);
  assert.equal(FT.toDegrees(2000, 1000, 3000), 0);
  assert.equal(FT.toPercent(1500, 1000, 3000), 25);
  assert.equal(FT.looksUncalibrated({ minLimit: 0, maxLimit: 4095 }, 'elbow_flex'), true);
  assert.equal(FT.looksUncalibrated({ minLimit: 0, maxLimit: 4095 }, 'wrist_roll'), false);
  assert.equal(FT.looksUncalibrated({ minLimit: 900, maxLimit: 3150 }, 'elbow_flex'), false);
});

test('가짜 버스: ID 1~6 찾기, 정보·상태 읽기, 없는 ID는 시간 초과', async () => {
  const bus = new FT.Bus(FT.fakeLink({ voltage: 7.4 }), { timeoutMs: 40 });
  assert.deepEqual(await bus.scan([1, 2, 3, 4, 5, 6, 7, 8]), [1, 2, 3, 4, 5, 6]);
  const info = await bus.info(3);
  assert.equal(info.model, 777);
  assert.equal(info.modelName, 'STS3215');
  assert.equal(info.id, 3);
  assert.equal(info.baudIndex, 0);
  assert.equal(info.maxTemp, 70);
  assert.ok(info.minLimit > 0 && info.maxLimit < 4095);
  assert.equal(typeof info.homingOffset, 'number');
  const tel = await bus.telemetry(3);
  assert.ok(tel.volt > 7 && tel.volt < 8);
  assert.ok(tel.raw > info.minLimit && tel.raw < info.maxLimit);
  await assert.rejects(bus.telemetry(9), (e) => e.code === 'TIMEOUT');
  assert.equal(bus.stats.timeout, 3); // 핑 7·8 + 읽기 9
});

test('반이중 보드의 명령 되돌림(에코)은 응답으로 착각하지 않는다', async () => {
  const bus = new FT.Bus(FT.fakeLink({ echo: true }), { timeoutMs: 40 });
  const tel = await bus.telemetry(1);
  assert.ok(tel.volt > 11);
  assert.equal(await bus.ping(2), true);
});
