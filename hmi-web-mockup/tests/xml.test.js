// 서버 XML 규약 시험 — XML 읽기·쓰기(js/xml.js), 규약 바꾸기(js/xml-protocol.js), XML로 명령 보내기(js/api.js)
// 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 받는 글은 서버 담당의 규약 v1.0(docs/server-xml-v1.0.md)에 나온 예시를 그대로 쓴다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

globalThis.window = globalThis;

const load = (file) => {
  const full = path.join(__dirname, '..', 'js', file);
  delete require.cache[require.resolve(full)];
  require(full);
};
load('xml.js');
load('xml-protocol.js');
load('adapter.js');
load('transport.js');
const X = window.HmiXml;
const P = window.HmiXmlProtocol;
const make = (opt) => window.HmiAdapter.create(opt);

const motors = (valid, base) => [1, 2, 3, 4, 5, 6].map((id) => (valid
  ? `<Motor id="${id}"><Angle unit="deg" valid="true">${base + id}.5</Angle></Motor>`
  : `<Motor id="${id}"><Angle unit="deg" valid="false" /></Motor>`)).join('');

// 서버 규약 v1.0 3.장비가 미연결된 기본 상태
const STATUS_UNAVAILABLE = `<Message version="1.0" type="Status" timestamp="2026-10-13T10:00:00Z" id="status-001">
  <Status source="unavailable">
    <Equipment>
      <Conveyor connected="false" running="false" />
      <RobotArm connected="false">
        <Motors>${motors(false)}</Motors>
      </RobotArm>
    </Equipment>
    <Inspection valid="false">
      <GoodCount>0</GoodCount>
      <DefectCount>0</DefectCount>
    </Inspection>
  </Status>
</Message>`;

const STATUS_SIMULATION = `<?xml version="1.0" encoding="utf-8"?>
<Message version="1.0" type="Status" timestamp="2026-10-13T10:00:05Z">
  <Status source="simulation">
    <Equipment>
      <Conveyor connected="true" running="true" />
      <RobotArm connected="true"><Motors>${motors(true, 10)}</Motors></RobotArm>
    </Equipment>
    <Inspection valid="true"><GoodCount>8</GoodCount><DefectCount>2</DefectCount></Inspection>
  </Status>
</Message>`;

// ---------- XML 읽기·쓰기 ----------

test('XML 읽기: 선언·BOM·주석·CDATA·엔티티·작은따옴표 속성', () => {
  const n = X.parse('﻿<?xml version="1.0"?><!-- 처음 --><A x=\'1\' y="a&amp;b&#x41;&#66;"><!-- 안 --><B>글 &lt;1&gt;</B><![CDATA[<날것>]]></A>\n');
  assert.equal(n.name, 'A');
  assert.deepEqual(n.attrs, { x: '1', y: 'a&bAB' });
  assert.equal(X.child(n, 'B').text, '글 <1>');
  assert.equal(n.text, '<날것>');
  assert.equal(X.attr(n, 'z'), undefined);
  assert.deepEqual(X.children(n, 'B').map((c) => c.name), ['B']);
});

test('XML 읽기: 받지 않는 것 — DTD·외부 엔티티, 틀린 모양', () => {
  const bad = {
    '<!DOCTYPE A [<!ENTITY e SYSTEM "file:///etc/passwd">]><A>&e;</A>': 'DTD_NOT_ALLOWED',
    '<A>&e;</A>': 'UNKNOWN_ENTITY',
    '<A>a & b</A>': 'BAD_ENTITY',
    '<A>&#xD800;</A>': 'BAD_ENTITY',
    '<A><B></A>': 'MISMATCHED_TAG',
    '<A>': 'UNCLOSED_ELEMENT',
    '<A x="1" x="2"/>': 'DUPLICATE_ATTRIBUTE',
    '<A x="1"y="2"/>': 'EXPECTED_SPACE',
    '<A/><B/>': 'TRAILING_CONTENT',
    '': 'EMPTY',
    '   ': 'EMPTY',
    '<A x=1/>': 'EXPECTED_QUOTE',
    '<1A/>': 'BAD_NAME',
  };
  Object.entries(bad).forEach(([text, code]) => {
    assert.throws(() => X.parse(text), (e) => e instanceof X.XmlError && e.code === code, text);
  });
  let deep = '';
  for (let i = 0; i < 40; i += 1) deep += '<A>';
  assert.throws(() => X.parse(deep), (e) => e.code === 'TOO_DEEP');
});

test('XML 쓰기: 특수 문자·제어 문자를 막고, 읽으면 같은 값', () => {
  const node = X.el('Message', { version: '1.0', id: 'a"b<c>&\'d\n', skip: undefined }, [X.el('Detail', null, '1 < 2 & "ok"\u0001')]);
  const s = X.stringify(node);
  assert.equal(s, '<Message version="1.0" id="a&quot;b&lt;c&gt;&amp;&apos;d&#10;"><Detail>1 &lt; 2 &amp; "ok"</Detail></Message>');
  const back = X.parse(s);
  assert.equal(back.attrs.id, 'a"b<c>&\'d\n');
  assert.equal(X.child(back, 'Detail').text, '1 < 2 & "ok"');
  assert.equal(X.stringify(X.el('Command', { name: 'Home' })), '<Command name="Home" />');
});

// ---------- 받기 (서버 → HMI) ----------

test('상태 v1.0 (장비 없음): 연결 끊김 · 가동 여부 모름 · 개수 무효 · 각도 없음 · heartbeat', () => {
  const a = make();
  const list = a.message(STATUS_UNAVAILABLE);
  assert.deepEqual(list.map((m) => m.type), ['status', 'joints', 'heartbeat']);
  const st = list[0];
  assert.equal(st.replyTo, 'status-001');
  assert.deepEqual(st.data, {
    devices: { conveyor: 'disconnected', arm: 'disconnected' },
    source: 'unavailable',
    conveyorRunning: null,
    stats: null,
    at: '2026-10-13T10:00:00.000Z',
  });
  // 라인 상태·긴급정지·운전 모드는 v1.0에 없다 — 넣지 않는다(모름)
  assert.equal('line' in st.data || 'estop' in st.data || 'mode' in st.data, false);
  assert.deepEqual(list[1].data, { source: 'leader', unit: 'deg', angles: {}, units: {}, at: '2026-10-13T10:00:00.000Z' });
});

test('상태 v1.0 (시뮬레이션): 개수 · 리더암 각도(그리퍼도 도) · 컨베이어 가동', () => {
  const a = make();
  const [st, joints] = a.message(STATUS_SIMULATION);
  assert.equal(st.replyTo, undefined);
  assert.deepEqual(st.data.devices, { conveyor: 'connected', arm: 'connected' });
  assert.equal(st.data.conveyorRunning, true);
  assert.equal(st.data.source, 'simulation');
  assert.deepEqual(st.data.stats, { total: 10, good: 8, defect: 2 });
  assert.equal(joints.data.source, 'leader');
  assert.deepEqual(joints.data.angles, { shoulder_pan: 11.5, shoulder_lift: 12.5, elbow_flex: 13.5, wrist_flex: 14.5, wrist_roll: 15.5, gripper: 16.5 });
  assert.equal(joints.data.units.gripper, 'deg');
  // 서버 담당이 RobotArm의 각도를 로봇팔(팔로워) 것으로 바꾸면 설정 한 줄
  const b = make({ xml: { motorsAre: 'arm' } });
  assert.equal(b.message(STATUS_SIMULATION)[1].data.source, 'arm');
});

test('답(Reply): 받음은 202 + 장비 실행 여부, 거절은 코드별 오류', () => {
  const a = make();
  const [ok] = a.message(`<Message version="1.0" type="Reply" timestamp="2026-10-13T10:00:00Z" id="hmi01-auto-001">
    <Reply command="SetMode" result="Received" code="ReceiptOnly" executed="false" mode="Auto">
      <Detail>Command validated and received. No equipment action was executed or queued.</Detail>
    </Reply></Message>`);
  assert.equal(ok.type, 'command_result');
  assert.deepEqual(ok.data, {
    id: 'hmi01-auto-001', command: 'SetMode', mode: 'Auto', status: 202,
    body: { reply: { code: 'ReceiptOnly', executed: false, command: 'SetMode', mode: 'Auto', detail: 'Command validated and received. No equipment action was executed or queued.' } },
  });
  const [bad] = a.message('<Message version="1.0" type="Reply" timestamp="2026-10-13T10:00:00Z" id="hmi01-mode-002"><Reply command="SetMode" result="Rejected" code="InvalidMode" executed="false"><Detail>SetMode requires mode Auto or Manual.</Detail></Reply></Message>');
  assert.equal(bad.data.status, 409);
  const e = a.error(bad.data.status, bad.data.body);
  assert.equal(e.code, 'INVALID_MODE');
  assert.equal(e.message, 'SetMode requires mode Auto or Manual.');
  const [unknown] = a.message('<Message version="1.0" type="Reply" id="x"><Reply command="Stop" result="Rejected" code="UnknownCommand" executed="false" /></Message>');
  assert.deepEqual(a.error(409, unknown.data.body), { code: 'XML_UNKNOWN_COMMAND', details: { command: 'Stop', serverCode: 'UnknownCommand' }, message: null });
  // 나중에 서버가 상태 때문에 거절하면 HMI 코드로 (EstopActive → ESTOP_ACTIVE)
  const [later] = a.message('<Message version="1.0" type="Reply" id="y"><Reply command="ProgramStart" result="Rejected" code="EstopActive" executed="false" /></Message>');
  assert.equal(a.error(409, later.data.body).code, 'ESTOP_ACTIVE');
  // 요청안: 거절 이유의 값 — 끊긴 장치(여러 번·쉼표), 고장 코드
  const [devs] = a.message('<Message version="1.0" type="Reply" id="z"><Reply command="ProgramStart" result="Rejected" code="DevicesNotReady" executed="false"><Param name="missing">Conveyor</Param><Param name="missing">RobotArm, Camera:top</Param></Reply></Message>');
  const de = a.error(409, devs.data.body);
  assert.equal(de.code, 'DEVICES_NOT_READY');
  assert.deepEqual(de.details.missing, ['conveyor', 'arm', 'camera_top']);
  const [ft] = a.message('<Message version="1.0" type="Reply" id="w"><Reply command="ProgramStart" result="Rejected" code="FaultActive" executed="false"><Param name="fault">ServoOverheat</Param></Reply></Message>');
  assert.equal(a.error(409, ft.data.body).details.fault, 'SERVO_OVERHEAT');
  // id 없는 답은 쓰지 않는다
  assert.deepEqual(a.message('<Message version="1.0" type="Reply"><Reply result="Received" /></Message>'), []);
});

test('오류(Error): id가 있으면 그 요청의 실패, 없으면 통신 오류 기록', () => {
  const a = make();
  const [withId] = a.message('<Message version="1.0" type="Error" timestamp="2026-10-13T10:00:00Z" id="req-001"><Error code="UnknownType">Supported requests: GetStatus, Ping, Command.</Error></Message>');
  assert.equal(withId.type, 'command_result');
  assert.equal(withId.data.id, 'req-001');
  assert.equal(a.error(withId.data.status, withId.data.body).code, 'XML_UNKNOWN_TYPE');
  const [noId] = a.message('<Message version="1.0" type="Error" timestamp="2026-10-13T10:00:00Z"><Error code="MissingRequestId">Command requires an id.</Error></Message>');
  assert.equal(noId.type, 'event');
  assert.equal(noId.data.code, 'server_protocol_error');
  assert.equal(noId.data.level, 'warning');
  assert.deepEqual(noId.data.params, { code: 'MissingRequestId' });
});

test('Pong은 연결 확인, 깨진 XML·모르는 종류는 버리고 기록', () => {
  const a = make();
  assert.deepEqual(a.message('<Message version="1.0" type="Pong" timestamp="2026-10-13T10:00:00Z" id="ping-001" />'), [
    { type: 'heartbeat', data: { at: '2026-10-13T10:00:00.000Z' }, replyTo: 'ping-001' },
  ]);
  assert.deepEqual(a.message('<Message version="1.0" type="Status"><Status>'), []);
  assert.deepEqual(a.message('<Message version="1.0" type="Hello" />'), []);
  assert.deepEqual(a.message('<Other />'), []);
  const codes = a.notes().map((n) => n.code);
  assert.ok(codes.includes('xml.invalid:UNCLOSED_ELEMENT'));
  assert.ok(codes.includes('xml.type.unknown:Hello'));
  assert.ok(codes.includes('xml.root:Other'));
});

test('요청안(v1.0 다음): 라인 상태·고장·단계·리더암·카메라를 읽는다', () => {
  const a = make();
  const list = a.message(`<Message version="1.0" type="Status" timestamp="2026-10-14T01:00:00Z">
    <Status source="equipment">
      <Line state="Stopped" mode="Manual" emergencyStop="false" homeRequired="true" />
      <Fault code="GRIP_FAILED" clear="Home"><Param name="part">12</Param><Param name="step">grasp_part</Param></Fault>
      <Equipment>
        <Conveyor connected="true" running="false" />
        <RobotArm connected="true"><Motors role="follower">${motors(true, 0)}</Motors></RobotArm>
        <LeaderArm connected="false" />
        <Camera id="top" connected="true" streaming="true" url="/camera/top" transport="mjpeg" />
      </Equipment>
      <Inspection valid="true"><GoodCount>3</GoodCount><DefectCount>1</DefectCount></Inspection>
    </Status></Message>`);
  const st = list[0].data;
  assert.equal(st.line, 'stopped');
  assert.equal(st.mode, 'manual');
  assert.equal(st.estop, false);
  assert.equal(st.homeRequired, true);
  assert.deepEqual(st.fault, { code: 'GRIP_FAILED', params: { part: 12, step: 'grasp_part' }, clear: 'home' });
  // 고장 코드는 v1.0처럼 대문자로 시작해도 되고, 팔·관절은 장치 이름·모터 번호로 와도 된다
  const [hot] = a.message('<Message version="1.0" type="Status"><Status><Line state="Stopped" /><Fault code="ServoOverheat" clear="Auto"><Param name="arm">RobotArm</Param><Param name="joint">3</Param><Param name="temp">65.2</Param></Fault></Status></Message>');
  assert.deepEqual(hot.data.fault, { code: 'SERVO_OVERHEAT', params: { arm: 'arm', joint: 'elbow_flex', temp: 65.2 }, clear: 'auto' });
  assert.equal(st.cycle, null); // 라인 상태를 보내는 서버가 단계를 안 보내면 없음
  assert.deepEqual(st.devices, { conveyor: 'connected', arm: 'connected', leader: 'disconnected', camera_top: 'connected' });
  assert.deepEqual(st.cameras, { top: { streaming: true, url: '/camera/top', transport: 'mjpeg' } });
  assert.equal(list[1].data.source, 'arm');
});

test('요청안: 이벤트(원점 복귀·종료 완료 알림 포함)와 부품 하나의 판정', () => {
  const a = make();
  const ev = a.message('<Message version="1.0" type="Event" timestamp="2026-10-14T01:00:00Z"><Event code="HomeCompleted" level="Info" seq="5" /></Message>');
  assert.deepEqual(ev.map((m) => m.type), ['event', 'home_complete']);
  assert.equal(ev[0].data.code, 'home_completed');
  assert.equal(ev[0].data.seq, 5);
  const down = a.message('<Message version="1.0" type="Event"><Event code="ShutdownCompleted" level="Info" /></Message>');
  assert.deepEqual(down.map((m) => m.type), ['event', 'shutdown_complete']);
  const dev = a.message('<Message version="1.0" type="Event"><Event code="DeviceDisconnected" level="Warning"><Param name="device">conveyor</Param></Event></Message>');
  assert.deepEqual(dev[0].data.params, { device: 'conveyor' });
  assert.equal(dev[0].data.level, 'warning');
  const [ins] = a.message('<Message version="1.0" type="Inspection" timestamp="2026-10-14T01:00:01Z"><Inspection seq="6" id="128" result="Defect" confidence="0.93" camera="top" latencyMs="21"><GoodCount>3</GoodCount><DefectCount>2</DefectCount></Inspection></Message>');
  assert.equal(ins.type, 'inspection');
  assert.deepEqual(ins.data, { result: 'defect', at: '2026-10-14T01:00:01.000Z', id: 128, seq: 6, confidence: 0.93, camera: 'top', stats: { total: 5, good: 3, defect: 2 }, latencyMs: 21 });
});

// ---------- 보내기 (HMI → 서버) ----------

test('보내기: v1.0 명령 이름 · 모드 값 · 요청', () => {
  const c = (name, body) => P.command(name, body, 'id-1');
  assert.equal(c('estop').text, '<Message version="1.0" type="Command" id="id-1"><Command name="EmergencyStop" /></Message>');
  assert.equal(c('start').command, 'ProgramStart');
  assert.equal(c('shutdown').command, 'ProgramStop'); // 프로그램 종료로 가정
  const mode = c('mode', { mode: 'manual' });
  assert.equal(mode.text, '<Message version="1.0" type="Command" id="id-1"><Command name="SetMode" mode="Manual" /></Message>');
  assert.deepEqual([mode.command, mode.mode], ['SetMode', 'Manual']);
  // v1.0에 없는 명령은 요청안 이름으로 보낸다 (서버가 모르면 UnknownCommand로 답한다). null로 두면 보내지 않는다
  assert.equal(c('release').command, 'EmergencyStopRelease');
  assert.equal(P.command('cameraStart', { camera: 'top' }, 'id-2').text, '<Message version="1.0" type="Command" id="id-2"><Command name="CameraStart" camera="top" /></Message>');
  assert.equal(P.command('stop', undefined, 'id-3', { commands: { stop: null } }), null);
  assert.equal(P.request('GetStatus', 'status-001'), '<Message version="1.0" type="GetStatus" id="status-001" />');
  assert.equal(P.request('Ping', 'ping-001'), '<Message version="1.0" type="Ping" id="ping-001" />');
});

test('보내기: 원점 복귀는 HMI가 저장한 각도를 Status와 같은 모양으로 붙인다 (homePose: false면 v1.0처럼 이름만)', () => {
  const pose = { angles: { shoulder_pan: 10.123, shoulder_lift: -20, elbow_flex: 30, wrist_flex: 40, wrist_roll: 50, gripper: 60 }, units: { gripper: 'pct' } };
  const r = P.command('home', pose, 'h-1');
  assert.equal(r.command, 'Home');
  const msg = X.parse(r.text);
  const ms = X.children(X.child(X.child(msg, 'Command'), 'Motors'), 'Motor');
  assert.deepEqual(ms.map((m) => [m.attrs.id, X.child(m, 'Angle').attrs.unit, X.child(m, 'Angle').text]), [
    ['1', 'deg', '10.12'], ['2', 'deg', '-20'], ['3', 'deg', '30'], ['4', 'deg', '40'], ['5', 'deg', '50'], ['6', 'percent', '60'],
  ]);
  assert.equal(P.command('home', pose, 'h-2', { homePose: false }).text, '<Message version="1.0" type="Command" id="h-2"><Command name="Home" /></Message>');
  // 보낸 각도를 서버 Status처럼 읽으면 같은 값 (서버 담당이 Status 읽기를 그대로 쓸 수 있다)
  const a = make();
  const back = a.message(`<Message version="1.0" type="Status"><Status><Equipment><RobotArm connected="true">${X.stringify(X.child(X.child(msg, 'Command'), 'Motors'))}</RobotArm></Equipment></Status></Message>`);
  assert.equal(back[1].data.angles.shoulder_pan, 10.12);
  assert.equal(back[1].data.units.gripper, 'pct');
});

// ---------- api.js: XML로 명령 보내기 ----------

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    FakeWebSocket.all.push(this);
  }
  send(s) { this.sent.push(s); }
  close() { this.readyState = 3; this.closed = true; if (this.onclose) this.onclose(); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  receive(data) { if (this.onmessage) this.onmessage({ data }); }
}
FakeWebSocket.all = [];
globalThis.WebSocket = FakeWebSocket;

function xmlApi(xml) {
  FakeWebSocket.all = [];
  window.HMI_CONFIG = {
    useMock: false,
    apiBase: 'http://h/api',
    wsUrl: 'ws://h:5080/ws/hmi',
    server: { format: 'xml', push: 'sse', xml: Object.assign({ replyTimeoutMs: 80 }, xml) },
    cameras: { primary: 'auto', bboxFormat: 'xywh' },
  };
  load('api.js');
  const api = window.HmiApi;
  const messages = [];
  let closed = 0;
  api.connect({ onOpen() {}, onClose() { closed += 1; }, onMessage: (m) => messages.push(m) });
  const ws = FakeWebSocket.all[0];
  ws.open();
  const idOf = (i) => X.parse(ws.sent[i]).attrs.id;
  const reply = (id, command, extra) => `<Message version="1.0" type="Reply" timestamp="2026-10-14T00:00:00Z" id="${id}"><Reply command="${command}" result="Received" code="ReceiptOnly" executed="false"${extra || ''} /></Message>`;
  return { api, ws, messages, idOf, reply, closed: () => closed };
}

test('api.js(XML): 같은 웹소켓으로 명령을 보내고, id·명령 이름이 맞는 답으로 끝낸다', async () => {
  const { api, ws, messages, idOf, reply } = xmlApi();
  assert.equal(api.xml, true);
  assert.equal(ws.url, 'ws://h:5080/ws/hmi'); // push 설정과 상관없이 웹소켓
  const start = api.start();
  const id = idOf(0);
  assert.match(id, /^hmi-[a-z0-9]+-start-\d+$/);
  assert.ok(id.length <= 64);
  assert.equal(X.child(X.parse(ws.sent[0]), 'Command').attrs.name, 'ProgramStart');
  ws.receive(reply(id, 'ProgramStart'));
  const res = await start;
  assert.equal(res.reply.executed, false);
  // 답은 화면 메시지로 새지 않는다
  assert.deepEqual(messages, []);
  // 모드: 목표 모드까지 맞아야 그 요청의 답
  const mode = api.setMode('manual');
  const modeId = idOf(1);
  assert.equal(X.child(X.parse(ws.sent[1]), 'Command').attrs.mode, 'Manual');
  ws.receive(reply(modeId, 'SetMode', ' mode="Auto"')); // 다른 목표 모드의 답 — 쓰지 않는다
  ws.receive(reply('somebody-else', 'SetMode', ' mode="Manual"')); // 모르는 id — 쓰지 않는다
  await assert.rejects(mode, (e) => e.code === 'NO_REPLY'); // 맞는 답이 없으면 "응답 미확인"
});

test('api.js(XML): 거절·오류·보내지 않는 명령·끊김', async () => {
  const { api, ws, idOf } = xmlApi({ commands: { cameraStart: null } });
  const mode = api.setMode('auto');
  ws.receive(`<Message version="1.0" type="Reply" id="${idOf(0)}"><Reply command="SetMode" result="Rejected" code="InvalidMode" executed="false" /></Message>`);
  await assert.rejects(mode, (e) => e instanceof api.ApiError && e.code === 'INVALID_MODE');
  const stop = api.shutdown();
  assert.equal(X.child(X.parse(ws.sent[1]), 'Command').attrs.name, 'ProgramStop');
  ws.receive(`<Message version="1.0" type="Error" id="${idOf(1)}"><Error code="UnsupportedVersion">nope</Error></Message>`);
  await assert.rejects(stop, (e) => e.code === 'XML_UNSUPPORTED_VERSION' && e.serverMessage === 'nope');
  await assert.rejects(api.startCamera(), (e) => e.code === 'NOT_IN_PROTOCOL' && e.details.command === 'cameraStart');
  assert.equal(ws.sent.length, 2); // 보내지 않았다
  assert.equal(await api.getInfo(), null); // 서버 정보·지난 기록은 XML 규약에 없다
  assert.equal(await api.getHistory({}), null);
  // 끊기면 기다리던 명령은 "응답 미확인"
  const estop = api.estop();
  ws.close();
  await assert.rejects(estop, (e) => e.code === 'NO_REPLY');
});

test('api.js(XML): 상태 묻기(GetStatus)는 같은 id의 Status로 답을 받고, 원점 복귀는 각도를 싣는다', async () => {
  const { api, ws, messages, idOf } = xmlApi();
  const status = api.getStatus();
  const id = idOf(0);
  assert.equal(X.parse(ws.sent[0]).attrs.type, 'GetStatus');
  ws.receive(STATUS_UNAVAILABLE.replace('status-001', id));
  const st = await status;
  assert.deepEqual(st.devices, { conveyor: 'disconnected', arm: 'disconnected' });
  assert.ok(messages.some((m) => m.type === 'status')); // 화면도 같은 상태를 받는다
  const pose = { angles: { shoulder_pan: 1, shoulder_lift: 2, elbow_flex: 3, wrist_flex: 4, wrist_roll: 5, gripper: 6 }, units: {} };
  api.home(pose).catch(() => {});
  const cmd = X.child(X.parse(ws.sent[1]), 'Command');
  assert.equal(cmd.attrs.name, 'Home');
  assert.equal(X.children(X.child(cmd, 'Motors'), 'Motor').length, 6);
  // 상태가 끊겨 다시 붙기: 웹소켓을 닫으면 transport가 다시 연다
  api.reconnect();
  assert.equal(ws.closed, true);
});
