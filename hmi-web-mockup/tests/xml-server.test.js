// 시험용 XML 서버(tests/xml-server.py) 시험 — 서버 담당의 규약 v1.0(docs/server-xml-v1.0.md)대로 답하는지 본다.
// 브라우저에서 HMI를 이 서버에 붙여 확인하므로, 이 서버가 규약과 다르면 그 확인이 틀린다. 파이썬이 없으면 건너뛴다.
// 실행: node --test "hmi-web-mockup/tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

globalThis.window = globalThis;
require('../js/xml.js');
const X = window.HmiXml;

const PY = ['python', 'python3'].find((cmd) => { try { return spawnSync(cmd, ['--version']).status === 0; } catch (e) { return false; } });
const SCRIPT = path.join(__dirname, 'xml-server.py');

function startServer(t, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PY, [SCRIPT, '0', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => proc.kill());
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const m = /ws:\/\/[^\s]+\/ws\/hmi/.exec(out);
      if (m) resolve(m[0]);
    });
    proc.on('exit', (code) => reject(new Error('server exited ' + code + ' ' + out)));
  });
}

// 메시지를 차례로 받아 두고, 조건에 맞는 것을 기다린다
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const got = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const m = X.parse(e.data);
      got.push(m);
      waiters.slice().forEach((w) => { if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } });
    };
    ws.onerror = () => reject(new Error('ws error'));
    ws.onopen = () => resolve({
      ws,
      got,
      next(pred, ms) {
        const found = got.find(pred);
        if (found) { got.splice(got.indexOf(found), 1); return Promise.resolve(found); }
        return new Promise((res, rej) => {
          const w = { pred, resolve: (m) => { clearTimeout(w.timer); got.splice(got.indexOf(m), 1); res(m); } };
          w.timer = setTimeout(() => rej(new Error('timeout')), ms || 3000);
          waiters.push(w);
        });
      },
      closed: new Promise((res) => { ws.onclose = (e) => res(e.code); }),
    });
  });
}

const type = (kind, id) => (m) => m.attrs.type === kind && (id === undefined || m.attrs.id === id);
const cmd = (id, inner) => `<Message version="1.0" type="Command" id="${id}">${inner}</Message>`;

test('시험용 XML 서버 v1.0: 접속 직후 상태 · 조회 · 명령 받음 확인 · 오류 코드', { skip: !PY && 'python 없음' }, async (t) => {
  const url = await startServer(t, ['--simulation', '--interval-ms', '300']);
  const c = await connect(url);
  const first = await c.next(type('Status'), 1000);
  assert.equal(first.attrs.id, undefined); // 자동 전송에는 id가 없다
  assert.equal(X.child(first, 'Status').attrs.source, 'simulation');
  c.ws.send('<Message version="1.0" type="GetStatus" id="status-001" />');
  assert.ok(await c.next(type('Status', 'status-001')));
  c.ws.send('<Message version="1.0" type="Ping" id="ping-001" />');
  assert.ok(await c.next(type('Pong', 'ping-001')));
  c.ws.send(cmd('hmi01-auto-001', '<Command name="SetMode" mode="Auto" />'));
  const ok = X.child(await c.next(type('Reply', 'hmi01-auto-001')), 'Reply');
  assert.deepEqual([ok.attrs.command, ok.attrs.result, ok.attrs.code, ok.attrs.executed, ok.attrs.mode], ['SetMode', 'Received', 'ReceiptOnly', 'false', 'Auto']);
  const rejected = async (id, inner) => X.child(await (c.ws.send(cmd(id, inner)), c.next(type('Reply', id))), 'Reply').attrs.code;
  assert.equal(await rejected('m2', '<Command name="SetMode" mode="Toggle" />'), 'InvalidMode');
  assert.equal(await rejected('m3', '<Command name="Stop" />'), 'UnknownCommand');
  assert.equal(await rejected('m4', '<Command name="Home"><Motors /></Command>'), 'InvalidCommand'); // v1.0은 하위 요소를 받지 않는다
  assert.equal(await rejected('m5', '<Command name="Home" extra="1" />'), 'InvalidCommand');
  const errorCode = async (text, id) => { c.ws.send(text); return X.child(await c.next(type('Error', id)), 'Error').attrs.code; };
  assert.equal(await errorCode('<Message version="1.0" type="Command"><Command name="Home" /></Message>'), 'MissingRequestId');
  assert.equal(await errorCode('<Message version="1.0" type="Hello" id="q1" />', 'q1'), 'UnknownType');
  assert.equal(await errorCode('<Message version="2.0" type="Ping" id="q2" />', 'q2'), 'UnsupportedVersion');
  assert.equal(await errorCode('<Message version="1.0" type="Ping"', undefined), 'InvalidXml');
  // 바이너리는 닫기 코드 1003
  c.ws.send(new Uint8Array([1, 2, 3]));
  assert.equal(await c.closed, 1003);
});

test('시험용 XML 서버 요청안(--extended): 라인 상태가 바뀌고, 각도가 붙은 원점 복귀를 받는다', { skip: !PY && 'python 없음' }, async (t) => {
  const url = await startServer(t, ['--simulation', '--extended', '--interval-ms', '300']);
  const c = await connect(url);
  const line = (m) => X.child(X.child(m, 'Status'), 'Line').attrs;
  assert.equal(line(await c.next(type('Status'))).state, 'Stopped');
  c.ws.send(cmd('s1', '<Command name="ProgramStart" />'));
  assert.equal(X.child(await c.next(type('Reply', 's1')), 'Reply').attrs.executed, 'true');
  assert.ok(await c.next((m) => m.attrs.type === 'Status' && line(m).state === 'Running'));
  c.ws.send(cmd('e1', '<Command name="EmergencyStop" />'));
  assert.ok(await c.next((m) => m.attrs.type === 'Event' && X.child(m, 'Event').attrs.code === 'EstopPressed'));
  c.ws.send(cmd('h1', '<Command name="Home" />'));
  assert.equal(X.child(await c.next(type('Reply', 'h1')), 'Reply').attrs.code, 'EstopActive');
  c.ws.send(cmd('r1', '<Command name="EmergencyStopRelease" />'));
  await c.next(type('Reply', 'r1'));
  c.ws.send(cmd('h2', '<Command name="Home" />'));
  assert.equal(X.child(await c.next(type('Reply', 'h2')), 'Reply').attrs.code, 'HomeNotSet');
  const motors = [1, 2, 3, 4, 5, 6].map((i) => `<Motor id="${i}"><Angle unit="deg">${i}</Angle></Motor>`).join('');
  c.ws.send(cmd('h3', `<Command name="Home"><Motors>${motors}</Motors></Command>`));
  assert.equal(X.child(await c.next(type('Reply', 'h3')), 'Reply').attrs.result, 'Received');
  assert.ok(await c.next((m) => m.attrs.type === 'Event' && X.child(m, 'Event').attrs.code === 'HomeCompleted', 4000));
  c.ws.close();
});
