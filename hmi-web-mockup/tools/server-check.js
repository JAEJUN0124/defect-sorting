// 서버 점검 — 서버가 어떤 형식인지 읽어 보고, HMI가 알아서 맞춘 것과 config.js에서 바꿀 값을 알려 줍니다.
// 읽기만 합니다: XML 서버는 상태 듣기 · GetStatus · Ping, JSON 서버는 GET /info, GET /status, 실시간 메시지 듣기.
// 명령(시작·정지 등)은 보내지 않습니다.
(function () {
  const base = window.HMI_CONFIG;
  const T = window.HmiTransport;
  const $ = (id) => document.getElementById(id);
  const el = {
    format: $('format'), api: $('api'), ws: $('ws'), push: $('push'), sse: $('sse'), listen: $('listen'),
    run: $('run'), runMock: $('run-mock'), progress: $('progress'),
    checks: $('checks'), config: $('config-out'), rows: $('msg-rows'), notes: $('notes'),
  };
  el.format.value = base.server.format === 'json' ? 'json' : 'xml';
  el.api.value = base.apiBase;
  el.ws.value = base.wsUrl;
  el.sse.value = base.server.sseUrl;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function list(target, items) {
    target.textContent = '';
    items.forEach(([kind, text]) => {
      const li = document.createElement('li');
      li.dataset.kind = kind;
      const mark = document.createElement('span');
      mark.className = 'checks__mark';
      mark.textContent = { ok: '정상', warn: '확인', bad: '문제', info: '참고' }[kind] || kind;
      const msg = document.createElement('span');
      msg.textContent = text;
      li.append(mark, msg);
      target.appendChild(li);
    });
  }

  // adapter.js가 남긴 기록(notes)을 사람 말로
  function explain(code) {
    const [key, detail] = [code.split(':')[0], code.slice(code.indexOf(':') + 1)];
    const d = code.includes(':') ? detail : '';
    const table = {
      'field.alias': ['info', `이름 맞춤(서버 → HMI): ${d.replace('→', ' → ')}`],
      'envelope.flat': ['info', '메시지에 data 없이 값이 바로 붙어 옵니다 (그대로 읽음).'],
      'envelope.data_key': ['info', `값을 data 대신 다른 칸에 담아 보냅니다: ${d} (그대로 읽음).`],
      'envelope.type_key': ['info', `종류를 type 대신 다른 칸에 담아 보냅니다: ${d} (그대로 읽음).`],
      'envelope.event_key': ['info', 'event 칸에 이벤트 코드를 바로 보냅니다 (그대로 읽음).'],
      'envelope.no_type': ['warn', '종류(type)가 없어 내용으로 짐작했습니다. type을 넣어 달라고 하면 더 확실합니다.'],
      'envelope.tuple': ['info', "['종류', {값}] 배열로 보냅니다 (그대로 읽음)."],
      'envelope.batch': ['info', '메시지 여러 개를 배열 하나로 묶어 보냅니다 (그대로 읽음).'],
      'envelope.rosbridge': ['info', 'ROS rosbridge 형식입니다. 받기는 되지만 명령은 rosbridge 서비스 호출이 따로 필요합니다(docs/server-cases.md).'],
      'envelope.not_json': ['warn', 'JSON이 아닌 메시지가 왔습니다 (무시함).'],
      'envelope.unknown': ['warn', '무슨 메시지인지 모르는 것이 왔습니다 (무시함).'],
      'type.alias': ['info', `알아들은 종류 이름: ${d}`],
      'type.unknown': ['warn', `모르는 종류(무시함): ${d}. 필요한 정보면 docs/server-cases.md에 맞춰 이름을 정하세요.`],
      'line.alias': ['info', `알아들은 라인 상태: ${d}`],
      'line.unknown': ['bad', `모르는 라인 상태: ${d}. 화면이 '알 수 없음'이 되고 조작이 잠깁니다. stopped, starting, running, stopping, homing 중 하나로 보내 달라고 하세요.`],
      'line.estop_as_state': ['info', '긴급정지를 라인 상태 글자로 보냅니다 (긴급정지로 읽음).'],
      'line.fault_as_state': ['info', '고장을 라인 상태 글자로 보냅니다 (고장으로 읽음).'],
      'mode.alias': ['info', `알아들은 운전 모드: ${d}`],
      'mode.raw': ['warn', `서버가 운전 모드를 ${d}처럼 씁니다. 모드를 바꿀 때도 같은 글자를 기대할 수 있으니 server.modeValues를 맞추세요 (아래 값 참고).`],
      'mode.unknown': ['bad', `모르는 운전 모드: ${d}. auto 또는 manual로 보내 달라고 하거나 adapter.js MODE에 더하세요.`],
      'device.alias': ['info', `알아들은 장치 이름: ${d}`],
      'device.state.alias': ['info', `알아들은 장치 상태 값: ${d}`],
      'device.state.unknown': ['warn', '장치 상태 값을 알아듣지 못해 "알 수 없음"으로 봤습니다.'],
      'device.cameras.nested': ['info', '카메라 연결 상태를 devices.cameras 안에 묶어 보냅니다 (그대로 읽음).'],
      'device.array': ['info', '장치 목록을 배열로 보냅니다 (그대로 읽음).'],
      'camera.single': ['info', '카메라를 한 대(v0.1 모양)로 보냅니다.'],
      'camera.v01': ['info', '카메라를 한 대(v0.1의 camera)로 보냅니다.'],
      'camera.transport.guess': ['warn', '영상 방식을 주소 모양으로 짐작했습니다. 서버 정보에 transport를 넣거나 config.js cameras.transport를 정하세요.'],
      'camera.transport.unknown': ['warn', `모르는 영상 방식: ${d}. MJPEG로 열어 봅니다.`],
      'stats.total.computed': ['info', '검사 수(total)가 없어 양품+불량으로 셌습니다.'],
      'stats.good.computed': ['info', '양품 수가 없어 검사−불량으로 셌습니다.'],
      'stats.defect.computed': ['info', '불량 수가 없어 검사−양품으로 셌습니다.'],
      'stats.flat': ['info', '통계를 stats로 묶지 않고 바로 보냅니다 (그대로 읽음).'],
      'status.wrapped': ['info', '상태를 한 겹 더 싸서 보냅니다 (그대로 읽음).'],
      'time.epoch_s': ['info', '시각을 1970년 기준 초로 보냅니다 (그대로 읽음).'],
      'time.epoch_ms': ['info', '시각을 1970년 기준 밀리초로 보냅니다 (그대로 읽음).'],
      'time.naive': ['warn', '시각에 시간대가 없습니다. 로그 시각이 9시간 어긋나면 config.js server.naiveTime을 \'utc\'로 바꾸세요.'],
      'time.space': ['info', '날짜와 시각 사이를 공백으로 보냅니다 (그대로 읽음).'],
      'time.invalid': ['warn', '시각을 읽지 못한 값이 있습니다 (받은 때로 대신 씀).'],
      'inspection.result.alias': ['info', `알아들은 판정 값: ${d}`],
      'inspection.result.bool': ['info', '판정을 참/거짓으로 보냅니다 (참 = 양품으로 읽음).'],
      'inspection.result.flag': ['info', `판정을 참/거짓 깃발로 보냅니다: ${d} (그대로 읽음).`],
      'inspection.result.unknown': ['bad', '판정 값을 알아듣지 못했습니다. 통계와 판정 상자가 맞지 않습니다. result를 good·defect로 보내 달라고 하세요.'],
      'inspection.nostats': ['info', '판정마다 통계가 오지 않아 HMI가 셉니다 (상태의 stats가 오면 그 값이 맞는 값).'],
      'inspection.bbox.xyxy': ['info', '판정 상자를 두 모서리(x1,y1,x2,y2)로 보냅니다.'],
      'inspection.bbox.cxcywh': ['info', '판정 상자를 가운데 기준(YOLO)으로 보냅니다.'],
      'inspection.bbox.pixel': ['info', '판정 상자를 픽셀 좌표로 보냅니다 (영상 크기로 나눠 씀).'],
      'inspection.bbox.pixel_without_size': ['warn', '판정 상자가 픽셀 좌표인데 영상 크기를 몰라 그리지 못합니다. 서버 정보에 카메라 width·height를 넣어 달라고 하세요.'],
      'inspection.bbox.list': ['info', '판정 상자를 목록으로 보냅니다 (첫 번째를 씀).'],
      'inspection.confidence.percent': ['info', '신뢰도를 백분율(0~100)로 보냅니다 (0~1로 바꿔 씀).'],
      'inspection.latency.seconds': ['info', '판정 시간을 초 단위로 보냅니다 (밀리초로 바꿔 씀).'],
      'inspection.image.base64': ['info', '불량 사진을 base64로 보냅니다.'],
      'event.code.case': ['info', '이벤트 코드를 대문자·camelCase로 보냅니다 (맞춰 읽음).'],
      'event.alias': ['info', `알아들은 이벤트 이름: ${d}`],
      'event.level.alias': ['info', `알아들은 이벤트 등급: ${d}`],
      'event.level.number': ['info', '이벤트 등급을 숫자(파이썬 logging)로 보냅니다.'],
      'event.level.unknown': ['warn', `모르는 이벤트 등급: ${d}. 정보로 봅니다.`],
      'event.text': ['info', '서버가 문장도 보냅니다. HMI가 모르는 코드일 때만 그 문장을 씁니다.'],
      'joints.unit': ['info', `관절 값 단위: ${d}.`],
      'joints.suffix.pos': ['info', 'LeRobot 모양(shoulder_pan.pos)으로 보냅니다 (그대로 읽음).'],
      'joints.array': ['info', '관절 값을 배열로 보냅니다 (1~6번 순서로 읽음).'],
      'joints.alias': ['info', `알아들은 관절 이름: ${d}`],
      'joints.flat': ['info', '관절 값을 묶지 않고 바로 보냅니다 (그대로 읽음).'],
      'telemetry.flat': ['info', '서보 상태를 관절별로 묶지 않고 보냅니다 (그대로 읽음).'],
      'telemetry.voltage.decivolt': ['info', '전압을 서보 원시값(0.1V 단위)으로 보냅니다 (V로 바꿔 씀).'],
      'telemetry.load.signbit': ['info', '부하를 서보 원시값(방향 비트)으로 보냅니다 (바꿔 씀).'],
      'telemetry.load.permille': ['info', '부하를 0.1% 단위로 보냅니다 (%로 바꿔 씀).'],
      'error.fastapi': ['info', '오류를 FastAPI 모양({ detail })으로 보냅니다 (그대로 읽음).'],
      'error.flat': ['info', '오류를 error로 묶지 않고 보냅니다 (그대로 읽음).'],
      'error.text': ['warn', '오류를 글자로만 보냅니다. 코드가 없어 HMI는 일반 문구를 씁니다.'],
      'error.text_code': ['info', '오류 코드를 글자 하나로 보냅니다 (그대로 읽음).'],
      'error.html': ['warn', '오류를 HTML 페이지로 보냅니다. 코드를 알 수 없어 HMI는 일반 문구를 씁니다.'],
      'error.validation': ['info', '요청 형식 오류(FastAPI 422)를 받았습니다.'],
      'error.message_only': ['info', '오류를 코드 없이 문장으로 보냅니다.'],
      'error.alias': ['info', `알아들은 오류 코드: ${d}`],
      'xml.invalid': ['bad', `XML을 읽지 못한 메시지가 있습니다 (${d}). 서버 담당에게 그 메시지를 보여 주세요.`],
      'xml.root': ['bad', `맨 바깥 요소가 Message가 아닌 메시지가 있습니다: ${d} (무시함).`],
      'xml.version': ['warn', `규약 판이 ${d}입니다. HMI는 1.0 기준으로 읽습니다 — 바뀐 판이면 docs/xml-protocol.md를 맞추세요.`],
      'xml.type.unknown': ['warn', `모르는 메시지 종류: ${d} (무시함). 필요한 정보면 docs/xml-protocol.md에 맞춰 정하세요.`],
      'xml.angle.unit': ['warn', `모르는 각도 단위: ${d}. deg로 보내 달라고 하세요.`],
      'xml.motor.id': ['warn', 'Motor id가 1~6이 아닌 것이 있습니다 (무시함).'],
      'xml.status.missing': ['bad', 'type="Status"인데 Status 요소가 없습니다.'],
      'xml.reply.no_id': ['warn', 'id 없는 Reply가 왔습니다. 어느 명령의 답인지 몰라 쓰지 않습니다.'],
      'xml.reply.result': ['warn', `모르는 Reply result: ${d}. Received 또는 Rejected여야 합니다.`],
    };
    return table[key] || ['info', code];
  }

  function rawTypeOf(raw) {
    let m = raw;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { return '(JSON 아님)'; } }
    if (Array.isArray(m)) return typeof m[0] === 'string' ? m[0] : '(배열)';
    if (m && typeof m === 'object') return m.type || m.event || m.kind || m.topic || m.msg_type || '(type 없음)';
    return '?';
  }

  function brief(v) {
    const s = JSON.stringify(v);
    return s && s.length > 120 ? s.slice(0, 117) + '…' : s;
  }

  async function diagnoseNetwork(url) {
    try { await fetch(url, { mode: 'no-cors' }); return 'cors'; } catch (e) { return 'down'; }
  }

  // ---------- XML 서버 (서버 담당 규약 v1.0, docs/server-xml-v1.0.md) ----------
  // 웹소켓 하나로 듣고, GetStatus·Ping만 보낸다 (명령은 보내지 않는다)
  async function checkXml() {
    el.run.disabled = true;
    el.runMock.disabled = true;
    const url = el.ws.value.trim();
    const limit = (base.server.xml && base.server.xml.statusTimeoutMs) || 3000;
    const adapter = window.HmiAdapter.create({ naiveTime: base.server.naiveTime, primaryCamera: 'auto', xml: base.server.xml });
    const X = window.HmiXml;
    const results = [];
    const show = () => list(el.checks, results);
    el.rows.textContent = '';
    el.notes.textContent = '';
    el.config.textContent = '점검 중…';
    const listenMs = Number(el.listen.value) * 1000;
    const stat = { types: {}, last: {}, statusAt: [], firstAt: null, withId: 0, replies: {} };
    const startedAt = Date.now();
    let ws = null;
    try {
      el.progress.textContent = '웹소켓에 연결하는 중…';
      ws = new WebSocket(url);
      const opened = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 4000);
        ws.onopen = () => { clearTimeout(timer); resolve(true); };
        ws.onerror = () => { clearTimeout(timer); resolve(false); };
      });
      if (!opened) {
        results.push(['bad', `서버에 닿지 않습니다 (${url}). 서버 실행 여부, 주소의 IP·포트(기본 5080)·경로(/ws/hmi), 서버 PC 방화벽(TCP 5080)을 확인하세요. 다른 PC에서 붙으려면 서버를 그 PC의 장비망 IP로 띄워야 합니다(서버 담당 문서 "실행").`]);
        show();
        throw new Error('stop');
      }
      results.push(['ok', `웹소켓 연결: ${url}`]);
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') { stat.types['(바이너리)'] = (stat.types['(바이너리)'] || 0) + 1; return; }
        let root = null;
        try { root = X.parse(e.data); } catch (err) { /* adapter가 기록한다 */ }
        const kind = root ? X.attr(root, 'type') : '(XML 아님)';
        const id = root ? X.attr(root, 'id') : undefined;
        if (kind === 'Status') {
          if (id) stat.withId += 1;
          else stat.statusAt.push(Date.now());
          if (stat.firstAt === null) stat.firstAt = Date.now();
        }
        if (id) stat.replies[id] = kind;
        adapter.message(e.data).forEach((m) => {
          stat.types[m.type] = (stat.types[m.type] || 0) + 1;
          stat.last[m.type] = m.data;
        });
      };
      // 조회만: GetStatus · Ping — 같은 id로 답하는지
      ws.send('<Message version="1.0" type="GetStatus" id="check-status-1" />');
      ws.send('<Message version="1.0" type="Ping" id="check-ping-1" />');
      el.progress.textContent = `${listenMs / 1000}초 듣는 중…`;
      await wait(listenMs);
      results.push(stat.firstAt !== null && stat.firstAt - startedAt <= 1500 ? ['ok', '연결하고 곧바로 상태를 보냅니다.'] : ['bad', '연결한 뒤 상태(Status)가 오지 않았습니다.']);
      results.push(stat.replies['check-status-1'] === 'Status' ? ['ok', 'GetStatus에 같은 id의 상태로 답합니다.'] : ['warn', 'GetStatus에 답이 없거나 다른 것으로 답했습니다.']);
      results.push(stat.replies['check-ping-1'] === 'Pong' ? ['ok', 'Ping에 같은 id의 Pong으로 답합니다.'] : ['warn', 'Ping에 Pong으로 답하지 않았습니다.']);
      // 자동 상태 간격 → 끊김 판단 시간
      let gap = null;
      if (stat.statusAt.length >= 2) {
        gap = (stat.statusAt[stat.statusAt.length - 1] - stat.statusAt[0]) / (stat.statusAt.length - 1);
        results.push(gap * 2 < limit ? ['ok', `상태가 약 ${(gap / 1000).toFixed(1)}초마다 옵니다 (끊김 판단 ${limit / 1000}초).`]
          : ['warn', `상태가 약 ${(gap / 1000).toFixed(1)}초마다 옵니다. 끊김 판단(${limit / 1000}초)이 짧아 끊김을 잘못 띄웁니다 — 아래 statusTimeoutMs를 쓰세요.`]);
      } else results.push(['warn', '듣는 동안 자동 상태가 두 번 이상 오지 않았습니다. 서버의 상태 전송 간격(PushIntervalMs)을 확인하세요.']);
      if (stat.withId > 1) results.push(['warn', 'id가 붙은 상태가 여러 번 왔습니다. 자동 전송에는 id를 붙이지 않아야 합니다(규약 v1.0).']);
      // 상태 내용
      const st = stat.last.status;
      if (st) {
        const dev = Object.entries(st.devices || {}).map(([k, v]) => `${k} ${v === 'connected' ? '연결' : '끊김'}`).join(', ');
        const running = st.conveyorRunning === null || st.conveyorRunning === undefined ? '모름' : st.conveyorRunning ? '예' : '아니오';
        const counts = st.stats ? `${st.stats.total}(양품 ${st.stats.good}·불량 ${st.stats.defect})` : '무효(화면에 –)';
        results.push(['ok', `상태: 데이터 ${st.source || '알려 주지 않음'}, 장치 ${dev || '없음'}, 컨베이어 가동 ${running}, 검사 개수 ${counts}.`]);
        const joints = stat.last.joints;
        if (joints) {
          const n = Object.keys(joints.angles).length;
          results.push([n ? 'ok' : 'info', `${joints.source === 'leader' ? '리더암' : '로봇팔'} 각도: 6개 중 ${n}개 받음${n ? '' : ' (valid="false" — 화면에 –)'}.`]);
        }
        if (!st.line) results.push(['info', '라인 상태·긴급정지·운전 모드가 없습니다(v1.0). 화면은 "상태 미수신"으로 보이고 키를 막지 않으며, 명령의 결과는 서버의 답으로 알립니다. 서버 담당에게 docs/xml-protocol.md 4장의 Line 요소를 요청하세요.']);
        else results.push(['ok', `라인 상태: ${st.line}, 모드 ${st.mode || '모름'}, 긴급정지 ${st.estop === undefined || st.estop === null ? '모름' : st.estop ? '켜짐' : '꺼짐'} (요청안 Line 요소).`]);
      }
      show();

      el.rows.textContent = '';
      Object.keys(stat.types).sort().forEach((ty) => {
        const tr = el.rows.insertRow();
        [ty, String(stat.types[ty]), 'XML', brief(stat.last[ty])].forEach((text, i) => {
          const td = tr.insertCell();
          td.textContent = text;
          if (i === 1) td.className = 'num';
        });
      });
      const notes = adapter.notes();
      list(el.notes, notes.length ? notes.map((n) => { const [kind, text] = explain(n.code); return [kind, text + (n.count > 1 ? ` (${n.count}번)` : '')]; }) : [['ok', '서버 규약 v1.0 그대로 보냅니다. 맞출 것이 없습니다.']]);
      const out = ['// js/config.js', 'useMock: false,', `wsUrl: '${url}',`, 'server: {', "  format: 'xml',"];
      if (gap && gap * 2 >= limit) out.push(`  xml: { statusTimeoutMs: ${Math.ceil((gap * 3) / 1000) * 1000} }, // 상태 간격의 3배`);
      out.push('},');
      el.config.textContent = out.join('\n');
      el.progress.textContent = '점검을 마쳤습니다.';
    } catch (err) {
      if (err.message !== 'stop') { results.push(['bad', '점검 중 오류: ' + err.message]); show(); }
      el.progress.textContent = '점검을 멈췄습니다.';
      el.config.textContent = '서버에 닿아야 값을 정할 수 있습니다.';
    } finally {
      if (ws) { try { ws.close(); } catch (e) { /* 이미 닫힘 */ } }
      el.run.disabled = false;
      el.runMock.disabled = false;
    }
  }

  async function check(useMock) {
    el.run.disabled = true;
    el.runMock.disabled = true;
    const cfg = JSON.parse(JSON.stringify(base));
    cfg.apiBase = el.api.value.trim();
    cfg.wsUrl = el.ws.value.trim();
    cfg.server.sseUrl = el.sse.value.trim();
    const adapter = window.HmiAdapter.create({ naiveTime: cfg.server.naiveTime, primaryCamera: 'auto' });
    const mock = useMock ? new window.MockServer() : null;
    const results = [];
    const request = async (name, query) => {
      const r = T.route(useMock ? {} : cfg.server, name);
      const path = query ? r.path + (r.path.includes('?') ? '&' : '?') + new URLSearchParams(query).toString() : r.path;
      return mock ? mock.request(r.method, path) : T.httpRequest(cfg, r.method, path);
    };
    const show = () => list(el.checks, results);
    el.rows.textContent = '';
    el.notes.textContent = '';
    el.config.textContent = '점검 중…';

    try {
      // 1. 서버 정보
      el.progress.textContent = '서버 정보를 묻는 중…';
      let info = null;
      try {
        const res = await request('info');
        if (res.status >= 200 && res.status < 300) {
          info = adapter.info(res.body);
          adapter.setInfo(info);
          results.push(['ok', `서버 정보(GET /info): API ${info.api || '?'}, 카메라 ${info.cameras.map((c) => c.id + (c.transport ? '(' + c.transport + ')' : '')).join(', ') || '없음'}, 관절 단위 ${info.jointUnit || '알려 주지 않음'}.`]);
        } else if ([404, 405, 501].includes(res.status)) {
          results.push(['warn', '서버 정보(GET /info)가 없습니다. v0.1 서버로 보고 카메라·관절 단위는 config 값을 씁니다. 서버 정보를 만들어 달라고 하면 설정이 줄어듭니다.']);
        } else {
          results.push(['warn', `서버 정보 요청이 ${res.status}로 끝났습니다.`]);
        }
      } catch (err) {
        const why = useMock ? 'down' : await diagnoseNetwork(T.joinUrl(cfg.apiBase, '/status'));
        results.push(why === 'cors'
          ? ['bad', '서버는 켜져 있지만 다른 주소에서 오는 요청을 막습니다(CORS). 서버에 CORS 허용을 켜야 합니다 — FastAPI: CORSMiddleware(allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]), Flask: flask-cors. 또는 서버가 HMI 파일을 직접 내주면(같은 주소) 이 문제가 없습니다.']
          : ['bad', '서버에 닿지 않습니다. API 주소·포트, 서버 실행 여부, 방화벽을 확인하세요.']);
        show();
        throw new Error('stop');
      }
      show();

      // 2. 상태
      el.progress.textContent = '상태를 묻는 중…';
      const res = await request('status');
      if (res.status >= 200 && res.status < 300) {
        const st = adapter.status(res.body);
        const parts = [];
        if (st.line) parts.push('라인 ' + st.line + (st.lineRaw ? `(${st.lineRaw})` : ''));
        if (st.estop !== undefined) parts.push('긴급정지 ' + (st.estop ? '켜짐' : '꺼짐'));
        if (st.mode) parts.push('모드 ' + st.mode);
        if (st.devices) parts.push('장치 ' + Object.keys(st.devices).join(', '));
        if (st.stats) parts.push(`통계 ${st.stats.total}/${st.stats.good}/${st.stats.defect}`);
        if (st.cameras) parts.push('카메라 ' + Object.keys(st.cameras).join(', '));
        results.push([st.line && st.line !== 'unknown' ? 'ok' : 'bad', '상태(GET /status): ' + (parts.join(', ') || '읽은 값 없음') + '.']);
        if (!st.line) results.push(['bad', '상태에 라인 상태(line)가 없습니다. 화면이 상태를 그릴 수 없습니다.']);
        if (st.estop === undefined) results.push(['warn', '상태에 긴급정지 여부(estop)가 없습니다. 긴급정지 표시를 못 합니다.']);
        if (!st.devices) results.push(['warn', '상태에 장치 연결(devices)이 없습니다. 시작 실패 이유를 화면에 쓰기 어렵습니다.']);
        results.push(st.cycle !== undefined || st.homeRequired !== undefined
          ? ['ok', `v0.3 상태: 공정 단계(cycle) ${st.cycle !== undefined ? '있음' : '없음'}, 원점 필요(home_required) ${st.homeRequired !== undefined ? '있음' : '없음'}.`]
          : ['info', '상태에 공정 단계(cycle)·원점 필요(home_required)가 없습니다 (v0.3). 없어도 동작하지만 대시보드 공정 흐름은 가동 여부만 보입니다.']);
        // 영상 주소 열어 보기 (MJPEG·JPEG만 여기서 시험, 나머지는 장치 점검의 '서버 영상 주소 시험')
        const cams = Object.entries(st.cameras || {});
        for (const [id, c] of cams) {
          const url = c.url || (info && (info.cameras.find((x) => x.id === id) || {}).url);
          if (!url || useMock) continue;
          const tr = c.transport || 'mjpeg';
          if (!['mjpeg', 'snapshot'].includes(tr)) { results.push(['info', `카메라 ${id}: ${tr} 방식은 장치 점검 페이지의 '서버 영상 주소 시험'으로 여세요.`]); continue; }
          // MJPEG는 끝나지 않는 응답이라 onload가 늦을 수 있다 — 첫 장면이 생기면(naturalWidth) 성공으로 본다
          const ok = await new Promise((resolve) => {
            const img = new Image();
            let poll = 0;
            let timer = 0;
            const finish = (v) => {
              clearTimeout(timer);
              clearInterval(poll);
              img.onload = null;
              img.onerror = null;
              img.removeAttribute('src');
              resolve(v);
            };
            timer = setTimeout(() => finish(false), 4000);
            img.onload = () => finish(true);
            img.onerror = () => finish(false);
            poll = setInterval(() => { if (img.naturalWidth) finish(true); }, 200);
            img.src = new URL(url, cfg.apiBase.replace(/\/?$/, '/')).href;
          });
          results.push(ok ? ['ok', `카메라 ${id}: 영상이 열립니다.`] : ['warn', `카메라 ${id}: 영상이 열리지 않습니다 (카메라를 아직 안 켰거나 주소가 다를 수 있음).`]);
        }
      } else {
        const e = adapter.error(res.status, res.body);
        results.push(['bad', `상태 요청이 ${res.status}(${e.code})로 끝났습니다. config.js server.paths.status를 확인하세요.`]);
      }
      show();

      // 2-1. 지난 기록 (v0.3, docs/API.md 5.2)
      el.progress.textContent = '지난 기록을 묻는 중…';
      try {
        const hr = await request('history', { events: 5, inspections: 5, minutes: 10 });
        if (hr.status >= 200 && hr.status < 300) {
          const h = adapter.history(hr.body);
          const noSeq = h.events.concat(h.inspections).filter((x) => x.seq === undefined).length;
          results.push(['ok', `지난 기록(GET /history): 이벤트 ${h.events.length}·판정 ${h.inspections.length}건, 분당 집계 ${h.minutes ? h.minutes.length + '분' : '없음'}, 마지막 순번 ${h.lastSeq === null ? '없음' : h.lastSeq}.`]);
          if (!h.runId) results.push(['warn', '기록 응답에 run_id가 없습니다. 서버를 다시 켜 순번이 처음부터 시작되면 HMI가 알아채지 못해 기록이 빠질 수 있습니다.']);
          if (noSeq) results.push(['warn', `기록 ${noSeq}건에 순번(seq)이 없습니다. 다시 연결할 때 빈 곳만 채울 수 없습니다.`]);
          if (!h.now) results.push(['info', '기록 응답에 서버 시각(now)이 없습니다. 서버와 이 PC의 시계가 다르면 분당 그래프가 밀릴 수 있습니다.']);
        } else if ([404, 405, 501].includes(hr.status)) {
          results.push(['info', '지난 기록(GET /history)이 없습니다. 화면을 새로 열거나 서버에 다시 붙으면 그 전 기록이 비어 보입니다 (v0.3 권장 기능).']);
        } else {
          results.push(['warn', `지난 기록 요청이 ${hr.status}로 끝났습니다. 경로가 다르면 config.js server.paths.history로 맞추세요.`]);
        }
      } catch (err) {
        results.push(['warn', '지난 기록 요청에 답이 없습니다.']);
      }
      show();

      // 3. 실시간 메시지
      const listenMs = Number(el.listen.value) * 1000;
      const listen = (kind, ms) => new Promise((resolve) => {
        const stat = { kind, opened: false, messages: 0, types: {}, raw: {}, last: {}, hb: [], startedAt: Date.now(), statusAt: null };
        const handlers = {
          onOpen() { stat.opened = true; },
          onClose() {},
          onMessage(raw) {
            const rawType = rawTypeOf(raw);
            adapter.message(raw).forEach((m) => {
              stat.messages += 1;
              if (m.type === 'status' && stat.statusAt === null) stat.statusAt = Date.now();
              const ty = m.type === 'unknown' ? '모름: ' + (m.rawType || rawType) : m.type;
              stat.types[ty] = (stat.types[ty] || 0) + 1;
              stat.raw[ty] = rawType;
              stat.last[ty] = m.data;
              if (m.type === 'heartbeat') stat.hb.push(Date.now());
            });
          },
        };
        let conn = null;
        try {
          const c = Object.assign({}, cfg, { server: Object.assign({}, cfg.server, { push: kind }) });
          conn = mock ? mock.connect(handlers) : T.push(c, handlers);
        } catch (e) { resolve(stat); return; }
        setTimeout(() => { try { conn.close(); } catch (e) { /* 이미 닫힘 */ } resolve(stat); }, ms);
      });

      let stat;
      if (el.push.value === 'auto' && !mock) {
        for (const kind of ['ws', 'socketio', 'sse', 'poll']) {
          el.progress.textContent = `실시간 방식 찾는 중: ${kind}…`;
          stat = await listen(kind, 3000);
          if (stat.messages) break;
        }
        if (stat.messages) {
          el.progress.textContent = `${stat.kind} 방식으로 ${listenMs / 1000}초 듣는 중…`;
          stat = await listen(stat.kind, listenMs);
        }
      } else {
        const kind = mock ? 'ws' : el.push.value;
        el.progress.textContent = `${kind} 방식으로 ${listenMs / 1000}초 듣는 중…`;
        stat = await listen(kind, listenMs);
      }

      if (!stat.opened && !stat.messages) results.push(['bad', `실시간 연결이 열리지 않았습니다(${stat.kind}). 실시간 주소·방식을 확인하세요.`]);
      else if (!stat.messages) results.push(['warn', `연결은 됐지만 듣는 동안 메시지가 없었습니다(${stat.kind}). 연결 직후 상태를 보내고, 2초마다 heartbeat를 보내 달라고 하세요.`]);
      else {
        results.push(['ok', `실시간 메시지: ${stat.kind} 방식으로 ${stat.messages}개를 받았습니다.`]);
        const quick = stat.statusAt !== null && stat.statusAt - stat.startedAt <= 1000;
        results.push(quick ? ['ok', '연결하고 1초 안에 상태를 보냅니다.'] : ['info', '연결 직후 상태를 보내지 않습니다. HMI가 연결되면 GET /status로 묻기 때문에 괜찮습니다.']);
        const unnumbered = ['event', 'inspection'].filter((ty) => stat.last[ty] && stat.last[ty].seq === undefined);
        if (unnumbered.length) results.push(['info', `실시간 ${unnumbered.join('·')} 메시지에 순번(seq)이 없습니다 (v0.3). 없어도 동작하지만 다시 연결할 때 겹치거나 빠진 기록을 가려내지 못합니다.`]);
      }
      let hbAvg = null;
      if (stat.hb.length >= 2) {
        hbAvg = (stat.hb[stat.hb.length - 1] - stat.hb[0]) / (stat.hb.length - 1) / 1000;
        results.push([hbAvg * 2 < base.heartbeatTimeoutMs / 1000 ? 'ok' : 'warn', `heartbeat가 약 ${hbAvg.toFixed(1)}초마다 옵니다${hbAvg * 2 < base.heartbeatTimeoutMs / 1000 ? '' : ' — heartbeatTimeoutMs를 늘리세요'}.`]);
      } else if (stat.messages) {
        results.push(['warn', 'heartbeat가 없습니다. 기본 설정(heartbeatRequired: \'auto\')이면 문제없지만, 랜선이 빠진 것을 늦게 알아챕니다.']);
      }
      show();

      // 받은 메시지 표
      el.rows.textContent = '';
      Object.keys(stat.types).sort().forEach((ty) => {
        const tr = el.rows.insertRow();
        [ty, String(stat.types[ty]), stat.raw[ty], brief(stat.last[ty])].forEach((text, i) => {
          const td = tr.insertCell();
          td.textContent = text;
          if (i === 1) td.className = 'num';
        });
      });

      // HMI가 맞춘 것
      const notes = adapter.notes();
      list(el.notes, notes.length ? notes.map((n) => { const [kind, text] = explain(n.code); return [kind, text + (n.count > 1 ? ` (${n.count}번)` : '')]; }) : [['ok', '서버가 기준 형식(docs/API.md v0.3) 그대로 보냅니다. 맞출 것이 없습니다.']]);

      // config.js에 넣을 값
      const codes = notes.map((n) => n.code);
      const out = [];
      out.push('// js/config.js', `useMock: false,`, `apiBase: '${cfg.apiBase}',`, `wsUrl: '${cfg.wsUrl}',`);
      if (hbAvg && hbAvg * 2 >= base.heartbeatTimeoutMs / 1000) out.push(`heartbeatTimeoutMs: ${Math.ceil(hbAvg * 3) * 1000},`);
      out.push('server: {', `  push: '${stat.messages ? stat.kind : (mock ? 'ws' : el.push.value)}',`);
      if (stat.kind === 'sse') out.push(`  sseUrl: '${cfg.server.sseUrl}',`);
      if (codes.includes('time.naive')) out.push("  naiveTime: 'local', // 로그 시각이 9시간 어긋나면 'utc'");
      const modeRaw = codes.filter((c) => c.startsWith('mode.raw:')).map((c) => c.slice(9));
      if (modeRaw.length && modeRaw.every((m) => m === m.toUpperCase())) out.push("  modeValues: { auto: 'AUTO', manual: 'MANUAL' }, // 서버가 대문자를 씀 — 바꿀 때도 같은 글자로 보낸다");
      else if (modeRaw.length) out.push(`  modeValues: { /* 서버가 쓰는 값: ${modeRaw.join(', ')} */ },`);
      out.push('},');
      if (codes.includes('camera.transport.guess') || (info && info.cameras.some((c) => !c.transport))) out.push("cameras: { transport: 'mjpeg' }, // 서버 담당에게 영상 방식을 물어 맞추세요");
      const unit = codes.find((c) => c.startsWith('joints.unit:'));
      if (unit) out.push('', '// config/robot.js', `jointUnit: '${unit.slice(12)}',`);
      el.config.textContent = out.join('\n');
      el.progress.textContent = '점검을 마쳤습니다.';
    } catch (err) {
      if (err.message !== 'stop') { results.push(['bad', '점검 중 오류: ' + err.message]); show(); }
      el.progress.textContent = '점검을 멈췄습니다.';
      el.config.textContent = '서버에 닿아야 값을 정할 수 있습니다.';
    } finally {
      if (mock) mock.destroy();
      el.run.disabled = false;
      el.runMock.disabled = false;
    }
  }

  el.run.addEventListener('click', () => (el.format.value === 'xml' ? checkXml() : check(false)));
  el.runMock.addEventListener('click', () => check(true));
})();
