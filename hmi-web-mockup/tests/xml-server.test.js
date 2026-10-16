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
  const codeOf = async (id, inner) => X.child(await (c.ws.send(cmd(id, inner)), c.next(type('Reply', id))), 'Reply').attrs.code;
  assert.equal(await codeOf('m2', '<Command name="SetMode" mode="Toggle" />'), 'InvalidMode');
  assert.equal(await codeOf('m3', '<Command name="Stop" />'), 'UnknownCommand'); // 별칭은 아직 제안 단계 (서버 담당 회신)
  assert.equal(await codeOf('m5', '<Command name="Home" extra="1" />'), 'InvalidCommand');
  // 회신(2026-10-16)으로 더해진 것: 긴급정지 해제·장비 정지는 받음 확인, 속성 검사가 이름 검사보다 먼저
  assert.equal(await codeOf('m6', '<Command name="EmergencyStopRelease" />'), 'ReceiptOnly');
  assert.equal(await codeOf('m7', '<Command name="ProgramStop" />'), 'ReceiptOnly');
  assert.equal(await codeOf('m8', '<Command name="CameraStart" camera="top" />'), 'InvalidCommand');
  assert.equal(await codeOf('m9', '<Command name="CameraStart" />'), 'UnknownCommand');
  // 원점 각도(Home/Motors): 모터 1~6이 한 번씩, 숫자, deg만. 맞으면 받음 확인뿐(장비는 움직이지 않음), 틀리면 InvalidAngles
  const motors = (f) => '<Motors>' + [1, 2, 3, 4, 5, 6].map((i) => `<Motor id="${i}">${f(i)}</Motor>`).join('') + '</Motors>';
  const deg = (i) => `<Angle unit="deg">${i * 10 - 25.5}</Angle>`;
  const home = X.child(await (c.ws.send(cmd('h1', `<Command name="Home">${motors(deg)}</Command>`)), c.next(type('Reply', 'h1'))), 'Reply');
  assert.deepEqual([home.attrs.result, home.attrs.code, home.attrs.executed], ['Received', 'ReceiptOnly', 'false']);
  assert.equal(await codeOf('h2', '<Command name="Home"><Motors /></Command>'), 'InvalidAngles');
  assert.equal(await codeOf('h3', `<Command name="Home">${motors((i) => (i === 6 ? '<Angle unit="percent">40</Angle>' : deg(i)))}</Command>`), 'InvalidAngles');
  assert.equal(await codeOf('h4', `<Command name="Home">${motors((i) => (i === 3 ? '<Angle unit="deg">NaN</Angle>' : deg(i)))}</Command>`), 'InvalidAngles');
  assert.equal(await codeOf('h5', `<Command name="Home">${motors(deg).replace('id="2"', 'id="1"')}</Command>`), 'InvalidAngles');
  assert.equal(await codeOf('h6', '<Command name="Home" />'), 'ReceiptOnly'); // 각도 없는 원점 복귀도 지금은 받음 확인
  const errorCode = async (text, id) => { c.ws.send(text); return X.child(await c.next(type('Error', id)), 'Error').attrs.code; };
  assert.equal(await errorCode('<Message version="1.0" type="Command"><Command name="Home" /></Message>'), 'MissingRequestId');
  assert.equal(await errorCode('<Message version="1.0" type="Hello" id="q1" />', 'q1'), 'UnknownType');
  assert.equal(await errorCode('<Message version="2.0" type="Ping" id="q2" />', 'q2'), 'UnsupportedVersion');
  assert.equal(await errorCode('<Message version="1.0" type="Ping"', undefined), 'InvalidXml');
  // 바이너리는 닫기 코드 1003
  c.ws.send(new Uint8Array([1, 2, 3]));
  assert.equal(await c.closed, 1003);
});

// 메인 서버가 HMI 화면도 내주는 구성 흉내 (--static): 같은 주소에서 화면 파일과 웹소켓
test('시험용 XML 서버 --static: "/"는 index.html, 폴더 밖·모르는 종류는 404, 같은 주소의 /ws/hmi는 그대로 웹소켓', { skip: !PY && 'python 없음' }, async (t) => {
  // 내줄 폴더(www)와 그 바깥 파일(secret.html)을 만든다
  const fs = require('node:fs');
  const os = require('node:os');
  const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xml-static-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'www', 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'www', 'index.html'), '<!doctype html><title>HMI</title>');
  fs.writeFileSync(path.join(dir, 'www', 'js', 'a.js'), 'var a = 1;');
  fs.writeFileSync(path.join(dir, 'www', 'note.py'), 'x = 1');
  fs.writeFileSync(path.join(dir, 'secret.html'), 'secret');
  const url = await startServer(t, ['--simulation', '--static', path.join(dir, 'www')]);
  const http = url.replace(/^ws/, 'http').replace(/\/ws\/hmi$/, '');
  const index = await fetch(http + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.equal(await index.text(), '<!doctype html><title>HMI</title>');
  assert.match((await fetch(http + '/js/a.js')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(http + '/note.py')).status, 404); // 모르는 종류
  // 폴더 밖: fetch는 /../를 지워 버리므로 요청 줄을 그대로 보낸다
  const { port } = new URL(http);
  const line = await new Promise((resolve) => {
    const s = net.connect(Number(port), '127.0.0.1', () => s.write('GET /../secret.html HTTP/1.1\r\nHost: x\r\n\r\n'));
    s.on('data', (d) => { resolve(String(d).split('\r\n')[0]); s.destroy(); });
  });
  assert.equal(line, 'HTTP/1.1 404 Not Found');
  const c = await connect(url);
  assert.ok(await c.next(type('Status'), 1000));
  c.ws.close();
});

test('시험용 XML 서버 요청안(--extended): 라인 상태가 바뀌고, 각도가 붙은 원점 복귀를 받는다', { skip: !PY && 'python 없음' }, async (t) => {
  const url = await startServer(t, ['--simulation', '--extended', '--interval-ms', '300']);
  const c = await connect(url);
  const line = (m) => X.child(X.child(m, 'Status'), 'Line').attrs;
  assert.equal(line(await c.next(type('Status'))).state, 'Stopped');
  const event = (code) => (m) => m.attrs.type === 'Event' && X.child(m, 'Event').attrs.code === code;
  const requestIdOf = (m) => (X.children(X.child(m, 'Event'), 'Param').find((p) => p.attrs.name === 'requestId') || {}).text;
  c.ws.send(cmd('s1', '<Command name="ProgramStart" />'));
  assert.equal(X.child(await c.next(type('Reply', 's1')), 'Reply').attrs.executed, 'true');
  assert.ok(await c.next((m) => m.attrs.type === 'Status' && line(m).state === 'Running'));
  // ProgramStop은 장비 정지 요청 — 라인이 멈추고, 완료 이벤트에 요청 id가 실린다 (서버 담당 회신의 제안)
  c.ws.send(cmd('p1', '<Command name="ProgramStop" />'));
  assert.equal(X.child(await c.next(type('Reply', 'p1')), 'Reply').attrs.executed, 'true');
  assert.equal(requestIdOf(await c.next(event('LineStopped'))), 'p1');
  c.ws.send(cmd('e1', '<Command name="EmergencyStop" />'));
  assert.ok(await c.next(event('EstopPressed')));
  c.ws.send(cmd('h1', '<Command name="Home" />'));
  assert.equal(X.child(await c.next(type('Reply', 'h1')), 'Reply').attrs.code, 'EstopActive');
  c.ws.send(cmd('r1', '<Command name="EmergencyStopRelease" />'));
  await c.next(type('Reply', 'r1'));
  c.ws.send(cmd('h2', '<Command name="Home" />'));
  assert.equal(X.child(await c.next(type('Reply', 'h2')), 'Reply').attrs.code, 'HomeNotSet');
  const motors = [1, 2, 3, 4, 5, 6].map((i) => `<Motor id="${i}"><Angle unit="deg">${i}</Angle></Motor>`).join('');
  c.ws.send(cmd('h3', `<Command name="Home"><Motors>${motors}</Motors></Command>`));
  assert.equal(X.child(await c.next(type('Reply', 'h3')), 'Reply').attrs.result, 'Received');
  assert.equal(requestIdOf(await c.next(event('HomeCompleted'), 4000)), 'h3');
  c.ws.close();
});

test('SetSortTarget(로봇팔이 옮길 부품): v1.0은 속성 target을 몰라 InvalidCommand — 요청안(--extended)은 정지 상태에서만 받고 Line/@sortTarget·이벤트로 알림', { skip: !PY && 'python 없음' }, async (t) => {
  const replyOf = async (c, id, inner) => X.child(await (c.ws.send(cmd(id, inner)), c.next(type('Reply', id))), 'Reply').attrs;
  const plain = await connect(await startServer(t, []));
  assert.equal((await replyOf(plain, 'v1', '<Command name="SetSortTarget" target="Good" />')).code, 'InvalidCommand'); // 실제 서버처럼 속성 검사가 먼저
  assert.equal((await replyOf(plain, 'v2', '<Command name="SetSortTarget" />')).code, 'UnknownCommand');
  plain.ws.close();

  const c = await connect(await startServer(t, ['--simulation', '--extended', '--interval-ms', '300']));
  const line = (m) => X.child(X.child(m, 'Status'), 'Line').attrs;
  assert.equal(line(await c.next(type('Status'))).sortTarget, 'Defect'); // 처음은 불량품
  const ok = await replyOf(c, 's1', '<Command name="SetSortTarget" target="Good" />');
  assert.deepEqual([ok.result, ok.executed, ok.command], ['Received', 'true', 'SetSortTarget']);
  const ev = await c.next((m) => m.attrs.type === 'Event' && X.child(m, 'Event').attrs.code === 'SortTargetChanged');
  assert.equal(X.children(X.child(ev, 'Event'), 'Param').find((p) => p.attrs.name === 'target').text, 'Good');
  assert.ok(await c.next((m) => m.attrs.type === 'Status' && line(m).sortTarget === 'Good'));
  assert.equal((await replyOf(c, 's2', '<Command name="SetSortTarget" target="Maybe" />')).code, 'InvalidTarget');
  await replyOf(c, 's3', '<Command name="ProgramStart" />');
  assert.equal((await replyOf(c, 's4', '<Command name="SetSortTarget" target="Defect" />')).code, 'NotStopped');
  c.ws.close();
});

test('시험용 XML 서버 --video: 브릿지 영상 흉내 — 상태 JSON(안내 4장), MJPEG 조각마다 JPEG, 카메라·업로드 끊김 흉내', { skip: !PY && 'python 없음' }, async (t) => {
  const http = (await startServer(t, ['--video'])).replace(/^ws/, 'http').replace(/\/ws\/hmi$/, '');
  const status = async (q) => (await fetch(http + (q ? '/video/_sim?' + q : '/video/status'))).json();
  await new Promise((r) => setTimeout(r, 500)); // 첫 프레임이 들어올 때까지
  let st = await status();
  assert.equal(st.connected, true);
  assert.equal(st.freshnessMs, 5000);
  assert.deepEqual(st.cameras.map((c) => [c.id, c.available, typeof c.sequence]), [[1, true, 'number'], [2, true, 'number']]);
  // MJPEG: multipart/x-mixed-replace, 조각마다 Content-Length·X-Sequence와 JPEG
  const ctrl = new AbortController();
  const res = await fetch(http + '/video/1.mjpg?t=1', { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^multipart\/x-mixed-replace; boundary=frame/);
  const reader = res.body.getReader();
  let buf = Buffer.alloc(0);
  while (buf.indexOf('X-Sequence') < 0 || buf.indexOf(Buffer.from([0xff, 0xd9])) < 0) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = Buffer.concat([buf, Buffer.from(value)]);
  }
  ctrl.abort();
  assert.ok(buf.indexOf('--frame') === 0);
  assert.ok(buf.indexOf(Buffer.from([0xff, 0xd8])) > 0); // JPEG 시작
  // 카메라 2만 멈추면: 5초 뒤 available=false이고 받은 때는 남음 (화면은 "5초 이상 새 영상 없음")
  await status('cam=2&on=0');
  await new Promise((r) => setTimeout(r, 5300));
  st = await status();
  assert.deepEqual(st.cameras.map((c) => [c.id, c.available, !!c.receivedAt]), [[1, true, true], [2, false, true]]);
  // 업로드 연결이 끊기면: connected=false, 받은 때는 null
  st = await status('link=0');
  assert.equal(st.connected, false);
  assert.deepEqual(st.cameras.map((c) => c.receivedAt), [null, null]);
});
