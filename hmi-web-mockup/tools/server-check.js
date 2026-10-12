// 서버 점검 — 서버가 어떤 형식인지 읽어 보고, HMI가 알아서 맞춘 것과 config.js에서 바꿀 값을 알려 줍니다.
// 읽기만 합니다: GET /info, GET /status, 실시간 메시지 듣기. 명령(시작·정지 등)은 보내지 않습니다.
(function () {
  const base = window.HMI_CONFIG;
  const T = window.HmiTransport;
  const $ = (id) => document.getElementById(id);
  const el = {
    api: $('api'), ws: $('ws'), push: $('push'), sse: $('sse'), listen: $('listen'),
    run: $('run'), runMock: $('run-mock'), progress: $('progress'),
    checks: $('checks'), config: $('config-out'), rows: $('msg-rows'), notes: $('notes'),
  };
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
    const request = async (name) => {
      const r = T.route(useMock ? {} : cfg.server, name);
      return mock ? mock.request(r.method, r.path) : T.httpRequest(cfg, r.method, r.path);
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
      list(el.notes, notes.length ? notes.map((n) => { const [kind, text] = explain(n.code); return [kind, text + (n.count > 1 ? ` (${n.count}번)` : '')]; }) : [['ok', '서버가 기준 형식(docs/API.md v0.2) 그대로 보냅니다. 맞출 것이 없습니다.']]);

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

  el.run.addEventListener('click', () => check(false));
  el.runMock.addEventListener('click', () => check(true));
})();
