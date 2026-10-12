// 컨베이어(아두이노) 시리얼 규약 v1 — docs/conveyor-protocol.md
// 세 가지가 들어 있습니다.
//   1) Client: 서버 쪽 견본. 명령을 한 번에 하나씩 보내고 응답·알림을 받으며, PING으로 감시 타이머를 살리고 끊김을 판단합니다.
//      HMI의 가짜 서버와 장치 점검 도구가 쓰고, 실제 서버(파이썬)를 만들 때 동작 견본이 됩니다.
//   2) fakeLink: 규약대로 답하는 가짜 아두이노. 벨트 위 부품과 검사 자리의 센서도 흉내 냅니다 (하드웨어 없이 시험).
//   3) check: 만든 스케치가 규약대로 답하는지 차례로 시험합니다 (장치 점검의 "컨베이어 점검").
// link는 feetech.js의 openSerial()·fakeLink()와 같은 모양입니다: { write(bytes) → Promise, onData(fn), close() }
(function (root) {
  'use strict';

  const PROTO = 1;
  const MAX_LINE = 64;
  const STATES = ['stopped', 'running', 'halted'];

  const encode = (text) => new TextEncoder().encode(text);

  class ConveyorError extends Error {
    constructor(code, line) {
      super(code);
      this.code = code;
      this.line = line || null;
    }
  }

  // ---------- 줄 나누기 ----------
  // 바이트가 잘려 와도 줄바꿈(\n)까지 모아 한 줄씩 돌려준다. \r은 버린다
  class LineSplitter {
    constructor() {
      this.buf = '';
      this.decoder = new TextDecoder();
    }

    feed(chunk) {
      this.buf += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
      const lines = [];
      let i = this.buf.indexOf('\n');
      while (i >= 0) {
        const line = this.buf.slice(0, i).replace(/\r/g, '').trim();
        this.buf = this.buf.slice(i + 1);
        if (line) lines.push(line);
        i = this.buf.indexOf('\n');
      }
      if (this.buf.length > 1024) this.buf = this.buf.slice(-1024); // 줄바꿈 없이 쌓이는 쓰레기 글자
      return lines;
    }
  }

  // ---------- 한 줄 읽기 ----------
  //   'OK proto=1 fw=0.1.0'            → { kind: 'ok', args: [], fields: { proto: '1', fw: '0.1.0' } }
  //   'ERR HALTED'                     → { kind: 'err', code: 'HALTED' }
  //   '!STATE halted reason=watchdog'  → { kind: 'event', name: 'STATE', args: ['halted'], fields: { reason: 'watchdog' } }
  //   그 밖 (스케치의 디버그 출력)       → { kind: 'text' }
  function parse(line) {
    const s = String(line).trim();
    const words = s.split(/\s+/);
    const head = words[0] || '';
    const args = [];
    const fields = {};
    words.slice(1).forEach((w) => {
      const eq = w.indexOf('=');
      if (eq > 0) fields[w.slice(0, eq).toLowerCase()] = w.slice(eq + 1);
      else args.push(w);
    });
    if (/^OK$/i.test(head)) return { kind: 'ok', args, fields, line: s };
    if (/^ERR$/i.test(head)) return { kind: 'err', code: (args[0] || 'UNKNOWN').toUpperCase(), args: args.slice(1), fields, line: s };
    if (head[0] === '!' && head.length > 1) return { kind: 'event', name: head.slice(1).toUpperCase(), args, fields, line: s };
    return { kind: 'text', args: [], fields: {}, line: s };
  }

  // INFO 응답 → { proto, name, fw, speed, sensor, autostop, button, watchdogMs }
  function infoOf(fields) {
    const flag = (k) => fields[k] === '1';
    const wd = Number(fields.watchdog);
    return {
      proto: Number(fields.proto) || null,
      name: fields.name || null,
      fw: fields.fw || null,
      speed: flag('speed'),
      sensor: flag('sensor'),
      autostop: flag('autostop'),
      button: flag('button'),
      watchdogMs: Number.isFinite(wd) && wd > 0 ? wd : null,
    };
  }

  // STATUS 응답·!STATE 알림 → { state, reason, speed, part, autostop, code }. 센서·속도가 없으면 part·speed는 null
  function statusOf(fields, base) {
    const out = Object.assign({ state: null, reason: null, speed: null, part: null, autostop: false, code: null }, base);
    if (fields.state !== undefined) out.state = String(fields.state).toLowerCase();
    if (fields.reason !== undefined) out.reason = String(fields.reason).toLowerCase();
    if (fields.speed !== undefined) out.speed = fields.speed === '-' ? null : Number(fields.speed);
    if (fields.part !== undefined) out.part = fields.part === '-' ? null : fields.part === '1';
    if (fields.autostop !== undefined) out.autostop = fields.autostop === '1';
    out.code = fields.code || null;
    return out;
  }

  // ---------- 1. 서버 쪽 견본 ----------
  // on(fn)으로 받는 알림: 'line'({ dir: 'in'|'out', text }) · 'ready'(fields) · 'state'(상태) · 'part'(참·거짓)
  //                      'event'(읽은 알림) · 'text'(그 밖의 줄) · 'lost'(응답이 3번 이어서 없음) · 'back'(다시 답함)
  class Client {
    constructor(link, options) {
      this.link = link;
      this.opt = Object.assign({ replyTimeoutMs: 200, pingMs: 250, maxMisses: 3, readyWaitMs: 3000 }, options);
      this.split = new LineSplitter();
      this.listeners = new Set();
      this.queue = [];
      this.waiting = null;
      this.misses = 0;
      this.lost = false;
      this.closed = false;
      this.caps = null; // INFO로 안 기능 (infoOf 모양)
      this.state = null;
      this.readyFields = null;
      this.readyWaiters = [];
      this.pingTimer = 0;
      link.onData((bytes) => this.split.feed(bytes).forEach((line) => this.receive(line)));
    }

    on(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    emit(kind, data) {
      this.listeners.forEach((fn) => {
        try { fn(kind, data); } catch (err) { console.error(err); }
      });
    }

    receive(line) {
      this.emit('line', { dir: 'in', text: line });
      const m = parse(line);
      if (m.kind === 'event') { this.onEvent(m); return; }
      if ((m.kind === 'ok' || m.kind === 'err') && this.waiting) {
        const w = this.waiting;
        this.waiting = null;
        clearTimeout(w.timer);
        this.misses = 0;
        if (this.lost) { this.lost = false; this.emit('back'); }
        if (m.kind === 'ok') w.resolve({ fields: m.fields, args: m.args, line: m.line });
        else w.reject(new ConveyorError(m.code, m.line));
        this.pump();
        return;
      }
      this.emit('text', line); // 기다리는 명령이 없는데 온 응답이나 디버그 출력
    }

    onEvent(m) {
      if (m.name === 'READY') {
        // 켜지거나 리셋된 아두이노는 멈춘 상태로, 속도·스스로 멈추기 설정도 처음 값으로 돌아간다
        this.readyFields = m.fields;
        this.setState({ state: 'stopped', reason: 'boot', speed: null, part: this.state ? this.state.part : null, autostop: false, code: null });
        this.readyWaiters.splice(0).forEach((fn) => fn(m.fields));
        this.emit('ready', m.fields);
      } else if (m.name === 'STATE') {
        this.setState(statusOf(Object.assign({}, m.fields, { state: m.args[0] || '' }), this.state));
      } else if (m.name === 'PART') {
        const on = m.args[0] === '1';
        this.state = Object.assign({}, this.state, { part: on });
        this.emit('part', on);
      }
      this.emit('event', m);
    }

    setState(st) {
      this.state = st;
      this.emit('state', st);
    }

    // 명령 하나를 보내고 응답을 기다린다. 앞 명령의 응답이 오기 전에는 보내지 않는다
    send(text) {
      return new Promise((resolve, reject) => {
        if (this.closed) { reject(new ConveyorError('CLOSED')); return; }
        this.queue.push({ text, resolve, reject, timer: 0 });
        this.pump();
      });
    }

    pump() {
      if (this.waiting || !this.queue.length || this.closed) return;
      const w = this.queue.shift();
      this.waiting = w;
      w.timer = setTimeout(() => {
        if (this.waiting !== w) return;
        this.waiting = null;
        this.misses += 1;
        if (this.misses >= this.opt.maxMisses && !this.lost) { this.lost = true; this.emit('lost'); }
        w.reject(new ConveyorError('TIMEOUT'));
        this.pump();
      }, this.opt.replyTimeoutMs);
      this.emit('line', { dir: 'out', text: w.text });
      Promise.resolve()
        .then(() => this.link.write(encode(w.text + '\n')))
        .catch(() => { /* 응답 시간 초과로 처리된다 */ });
    }

    async info() {
      const r = await this.send('INFO');
      this.caps = infoOf(r.fields);
      return this.caps;
    }

    async status() {
      const r = await this.send('STATUS');
      this.setState(statusOf(r.fields, this.state));
      return this.state;
    }

    run() { return this.send('RUN'); }
    stop() { return this.send('STOP'); }
    halt() { return this.send('HALT'); }
    reset() { return this.send('RESET'); }
    ping() { return this.send('PING'); }

    // 설정은 알림으로 오지 않으므로 받아들여지면 기억해 둔다 (리셋되면 !READY에서 처음 값으로)
    async speed(n) {
      const r = await this.send('SPEED ' + Math.round(n));
      this.state = Object.assign({}, this.state, { speed: Math.round(n) });
      return r;
    }

    async autostop(on) {
      const r = await this.send('AUTOSTOP ' + (on ? 1 : 0));
      this.state = Object.assign({}, this.state, { autostop: !!on });
      return r;
    }

    // !READY를 기다린다. 이미 받았으면 바로, 시간 안에 안 오면 null (리셋되지 않는 보드)
    waitReady(ms) {
      if (this.readyFields) return Promise.resolve(this.readyFields);
      return new Promise((resolve) => {
        const done = (fields) => { clearTimeout(timer); resolve(fields); };
        const timer = setTimeout(() => {
          const i = this.readyWaiters.indexOf(done);
          if (i >= 0) this.readyWaiters.splice(i, 1);
          resolve(null);
        }, ms);
        this.readyWaiters.push(done);
      });
    }

    // 연결 순서 (규약 7장): !READY 기다림 → INFO → STOP → STATUS → (SPEED · AUTOSTOP) → PING 시작
    async open(setup) {
      const s = Object.assign({ waitReady: true, speed: null, autostop: null }, setup);
      if (s.waitReady) await this.waitReady(this.opt.readyWaitMs);
      const info = await this.info();
      if (info.proto !== PROTO) throw new ConveyorError('PROTO_MISMATCH', 'proto=' + info.proto);
      await this.stop();
      await this.status();
      await this.configure(s);
      this.keepAlive(true);
      return info;
    }

    // 리셋되면 설정이 처음 값으로 돌아가므로 다시 연결할 때도 부른다
    async configure(setup) {
      const info = this.caps || {};
      if (setup.speed !== null && setup.speed !== undefined && info.speed) await this.speed(setup.speed);
      if (setup.autostop !== null && setup.autostop !== undefined && info.autostop) await this.autostop(setup.autostop);
    }

    // PING 간격: pingMs와 감시 시간의 1/4 중 짧은 것 (감시 시간 안에 서너 번은 닿게)
    pingEvery() {
      const wd = this.caps && this.caps.watchdogMs;
      return wd ? Math.max(20, Math.min(this.opt.pingMs, Math.floor(wd / 4))) : this.opt.pingMs;
    }

    // 다른 명령을 기다리는 중이 아니면 PING (다른 명령도 아두이노의 감시 타이머를 다시 잰다)
    keepAlive(on) {
      clearInterval(this.pingTimer);
      this.pingTimer = 0;
      if (!on || this.closed) return;
      this.pingTimer = setInterval(() => {
        if (!this.waiting && !this.queue.length) this.ping().catch(() => {});
      }, this.pingEvery());
    }

    async close() {
      this.closed = true;
      this.keepAlive(false);
      if (this.waiting) { clearTimeout(this.waiting.timer); this.waiting.reject(new ConveyorError('CLOSED')); this.waiting = null; }
      this.queue.splice(0).forEach((w) => w.reject(new ConveyorError('CLOSED')));
      this.readyWaiters.splice(0).forEach((fn) => fn(null));
      try { await this.link.close(); } catch (err) { /* 이미 닫힘 */ }
    }
  }

  // ---------- 2. 가짜 아두이노 ----------
  // 벨트 위에 부품이 spacingMm 간격으로 놓여 있고, 검사 자리의 센서가 부품 앞 끝이 닿으면 !PART 1, 다 지나가면 !PART 0을 보낸다.
  // 속도 100%가 maxMmS(mm/s)다. 기본값(50% = 50mm/s, 간격 80mm)이면 부품이 1.6초마다 온다 — camera-sim.js와 같은 빠르기.
  class FakeConveyor {
    constructor(options) {
      this.opt = Object.assign({
        name: 'conveyor', fw: 'fake-1.0',
        speed: true, sensor: true, autostop: true, button: false,
        watchdogMs: 1000, bootMs: 30, replyMs: 2,
        maxMmS: 100, spacingMm: 80, partMm: 24, firstPartMm: 40,
        defaultSpeed: 50,
      }, options);
      this.send = () => {};
      this.timer = 0;
      this.boot();
    }

    // 켜짐·리셋: 멈춘 상태, 설정은 처음 값
    boot() {
      this.state = 'stopped';
      this.reason = 'boot';
      this.code = null;
      this.speedPct = this.opt.speed ? this.opt.defaultSpeed : 100;
      this.autostopOn = false;
      this.lastLineAt = Date.now();
      this.last = Date.now();
      this.pos = 0;
      this.nextPartAt = this.opt.firstPartMm;
      this.partOn = false;
      this.partEndAt = 0;
      this.jammed = false;
      this.faultCode = null;
      this.buttonDown = false;
      this.unplugged = false;
    }

    start() {
      if (this.timer) return;
      this.last = Date.now();
      this.timer = setInterval(() => this.tick(), 20);
      setTimeout(() => this.out('!READY proto=' + PROTO), this.opt.bootMs);
    }

    stop() {
      clearInterval(this.timer);
      this.timer = 0;
    }

    out(text) {
      if (this.unplugged) return;
      setTimeout(() => { if (!this.unplugged) this.send(text + '\n'); }, this.opt.replyMs);
    }

    statusText() {
      const o = this.opt;
      return 'state=' + this.state + ' reason=' + this.reason
        + ' speed=' + (o.speed ? this.speedPct : '-')
        + ' part=' + (o.sensor ? (this.partOn ? 1 : 0) : '-')
        + ' autostop=' + (this.autostopOn ? 1 : 0)
        + (this.code ? ' code=' + this.code : '');
    }

    change(state, reason, code) {
      this.state = state;
      this.reason = reason;
      this.code = code || null;
      this.out('!STATE ' + state + ' reason=' + reason + (code ? ' code=' + code : ''));
    }

    receive(line) {
      if (this.unplugged) return;
      this.lastLineAt = Date.now();
      if (line.length > MAX_LINE) { this.out('ERR TOO_LONG'); return; }
      const o = this.opt;
      const words = line.trim().split(/\s+/);
      const cmd = (words[0] || '').toUpperCase();
      const arg = words[1];
      switch (cmd) {
        case 'INFO':
          this.out('OK proto=' + PROTO + ' name=' + o.name + ' fw=' + o.fw + ' speed=' + (o.speed ? 1 : 0) + ' sensor=' + (o.sensor ? 1 : 0)
            + ' autostop=' + (o.sensor && o.autostop ? 1 : 0) + ' button=' + (o.button ? 1 : 0) + ' watchdog=' + o.watchdogMs);
          break;
        case 'STATUS':
          this.out('OK ' + this.statusText());
          break;
        case 'RUN':
          if (this.state === 'halted') { this.out('ERR HALTED'); break; }
          this.out('OK');
          if (this.state !== 'running') this.change('running', 'command');
          break;
        case 'STOP':
          this.out('OK');
          if (this.state === 'running') this.change('stopped', 'command');
          break;
        case 'HALT':
          this.out('OK');
          if (this.state !== 'halted' || this.reason !== 'command') this.change('halted', 'command');
          break;
        case 'RESET':
          if (this.faultCode || this.buttonDown) { this.out('ERR FAULT'); break; }
          this.out('OK');
          if (this.state === 'halted') this.change('stopped', 'command');
          break;
        case 'SPEED': {
          if (!o.speed) { this.out('ERR UNSUPPORTED'); break; }
          const n = Number(arg);
          if (arg === undefined || !Number.isInteger(n) || n < 0 || n > 100) { this.out('ERR BAD_ARG'); break; }
          this.speedPct = n;
          this.out('OK speed=' + n);
          break;
        }
        case 'AUTOSTOP':
          if (!o.sensor || !o.autostop) { this.out('ERR UNSUPPORTED'); break; }
          if (arg !== '0' && arg !== '1') { this.out('ERR BAD_ARG'); break; }
          this.autostopOn = arg === '1';
          this.out('OK autostop=' + arg);
          break;
        case 'PING':
          this.out('OK');
          break;
        default:
          this.out('ERR UNKNOWN');
      }
    }

    tick() {
      const now = Date.now();
      const dt = now - this.last;
      this.last = now;
      if (this.unplugged) return;
      // 감시 타이머: 가동 중 watchdogMs 동안 아무 줄도 못 받으면 스스로 멈추고 잠근다
      if (this.state === 'running' && now - this.lastLineAt > this.opt.watchdogMs) { this.change('halted', 'watchdog'); return; }
      if (this.state !== 'running') return;
      if (this.jammed && this.partOn) return; // 걸린 부품은 벨트가 돌아도 그 자리에 있다
      this.pos += (this.speedPct / 100) * this.opt.maxMmS * (dt / 1000);
      if (this.partOn && this.pos >= this.partEndAt) {
        this.partOn = false;
        if (this.opt.sensor) this.out('!PART 0');
      }
      if (!this.partOn && this.pos >= this.nextPartAt) {
        this.partOn = true;
        this.partEndAt = this.nextPartAt + this.opt.partMm;
        this.nextPartAt += this.opt.spacingMm;
        if (!this.opt.sensor) return;
        this.out('!PART 1');
        // 스스로 멈추기: 부품 앞 끝이 센서에 닿은 자리에 세운다
        if (this.autostopOn) { this.pos = this.partEndAt - this.opt.partMm; this.change('stopped', 'part'); }
      }
    }

    // ----- 시험·흉내용 -----
    // 로봇팔이 센서 위 부품을 집어 갔다
    removePart() {
      if (!this.partOn) return;
      this.partOn = false;
      this.jammed = false;
      if (this.opt.sensor) this.out('!PART 0');
    }

    setJam(on) { this.jammed = !!on; }

    pressButton(down) {
      this.buttonDown = !!down;
      if (down && this.state !== 'halted') this.change('halted', 'button');
    }

    setFault(code) {
      this.faultCode = code || null;
      if (code) this.change('halted', 'fault', code);
    }

    // USB가 빠지면 아무 답이 없고, 다시 꽂으면 리셋된다(USB 전원)
    setUnplugged(on) {
      if (on) { this.unplugged = true; return; }
      if (!this.unplugged) return;
      this.boot();
      setTimeout(() => this.out('!READY proto=' + PROTO), this.opt.bootMs);
    }

    reboot() { this.setUnplugged(true); this.setUnplugged(false); }
  }

  function fakeLink(options) {
    const device = new FakeConveyor(options);
    const split = new LineSplitter();
    let listener = () => {};
    device.send = (text) => listener(encode(text));
    return {
      fake: true,
      usb: null,
      chip: null,
      device,
      // 포트를 열면 리셋되는 보드(우노·나노)처럼, 받는 쪽이 붙으면 켜지며 !READY를 보낸다
      onData(fn) { listener = fn; device.start(); },
      write(bytes) {
        split.feed(bytes).forEach((line) => device.receive(line));
        return Promise.resolve();
      },
      close() { device.stop(); return Promise.resolve(); },
    };
  }

  // ---------- 3. 규약 점검 ----------
  // 만든 스케치가 규약대로 답하는지 차례로 시험한다. motion이 true일 때만 벨트를 움직이는 시험(가동·잠금·감시 타이머)을 한다.
  // 결과: [{ id, title, ok: true | false | null(건너뜀·참고), note }] — onStep으로 하나씩도 알린다
  async function check(client, options) {
    const opt = Object.assign({ motion: false, onStep: () => {} }, options);
    const results = [];
    const seen = [];
    const off = client.on((kind, data) => { if (kind === 'event') seen.push({ at: Date.now(), m: data }); });
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const step = (id, title, ok, note) => {
      const r = { id, title, ok, note: note || '' };
      results.push(r);
      opt.onStep(r);
      return r;
    };
    // 명령을 보내고 'OK' 또는 오류 코드를 돌려준다
    const reply = async (text) => {
      try { return { code: 'OK', r: await client.send(text) }; } catch (err) { return { code: err.code || 'ERROR' }; }
    };
    // since 뒤에 온 알림 중 맞는 것을 ms 동안 기다린다
    const waitEvent = async (pred, ms, since) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = seen.find((e) => e.at >= since && pred(e.m));
        if (hit) return hit.m;
        await sleep(20);
      }
      return null;
    };
    const isState = (state, reason) => (m) => m.name === 'STATE' && (m.args[0] || '').toLowerCase() === state && (!reason || m.fields.reason === reason);

    let info = null;
    try {
      // 1. 켜짐 알림 (우노·나노는 포트를 열면 리셋된다)
      const ready = await client.waitReady(client.opt.readyWaitMs);
      if (ready && Number(ready.proto) === PROTO) step('ready', '켜짐 알림 !READY', true, 'proto=' + ready.proto);
      else if (ready) step('ready', '켜짐 알림 !READY', false, 'proto 값이 ' + PROTO + '이 아닙니다: ' + ready.proto);
      else step('ready', '켜짐 알림 !READY', null, '3초 안에 오지 않았습니다. 포트를 열 때 리셋되지 않는 보드면 괜찮습니다.');

      // 2. 기능 알림
      const ri = await reply('INFO');
      if (ri.code !== 'OK') { step('info', 'INFO', false, ri.code === 'TIMEOUT' ? '응답이 없습니다. 속도(115200bps)와 줄 끝(\\n)을 확인하세요.' : 'ERR ' + ri.code); return results; }
      info = infoOf(ri.r.fields);
      client.caps = info;
      const caps = Object.entries({ speed: '속도 조절', sensor: '부품 센서', autostop: '스스로 멈추기', button: '정지 단추' }).filter(([k]) => info[k]).map(([, v]) => v).join(', ') || '없음';
      if (info.proto !== PROTO) { step('info', 'INFO', false, 'proto=' + info.proto + ' (이 규약은 ' + PROTO + ')'); return results; }
      step('info', 'INFO', !!info.watchdogMs, '기능: ' + caps + ' · 감시 ' + (info.watchdogMs ? info.watchdogMs + 'ms' : '값 없음 (watchdog=ms 필요)'));

      // 3. 상태
      const rs = await reply('STATUS');
      if (rs.code !== 'OK') step('status', 'STATUS', false, 'ERR ' + rs.code);
      else {
        const f = rs.r.fields;
        const missing = ['state', 'reason', 'speed', 'part', 'autostop'].filter((k) => f[k] === undefined);
        const badState = !STATES.includes(String(f.state).toLowerCase());
        const badPart = info.sensor ? !['0', '1'].includes(f.part) : f.part !== '-';
        const badSpeed = info.speed ? !(Number(f.speed) >= 0 && Number(f.speed) <= 100) : f.speed !== '-';
        const problems = [];
        if (missing.length) problems.push('빠진 값: ' + missing.join(', '));
        if (badState) problems.push('state 값: ' + f.state);
        if (!missing.includes('part') && badPart) problems.push(info.sensor ? 'part는 0 또는 1' : '센서가 없으면 part=-');
        if (!missing.includes('speed') && badSpeed) problems.push(info.speed ? 'speed는 0~100' : '속도 조절이 없으면 speed=-');
        step('status', 'STATUS', !problems.length, problems.length ? problems.join(' · ') : rs.r.line);
      }

      // 4. 모르는 명령에도 답함
      const ru = await reply('NOPE');
      step('unknown', '모르는 명령 → ERR UNKNOWN', ru.code === 'UNKNOWN', ru.code === 'OK' ? 'OK로 답했습니다' : ru.code === 'TIMEOUT' ? '답이 없습니다 (서버가 기다리게 됨)' : 'ERR ' + ru.code);

      // 5. 값 확인
      if (info.speed) {
        const rb = await reply('SPEED 999');
        step('badarg', 'SPEED 999 → ERR BAD_ARG', rb.code === 'BAD_ARG', rb.code === 'OK' ? 'OK로 받았습니다' : 'ERR ' + rb.code);
      } else {
        const rb = await reply('SPEED 30');
        step('badarg', '속도 조절 없음: SPEED → ERR UNSUPPORTED', rb.code === 'UNSUPPORTED', rb.code === 'OK' ? 'OK로 받았습니다' : 'ERR ' + rb.code);
      }

      // 6. 멈춤
      const rp = await reply('STOP');
      const st0 = await reply('STATUS');
      step('stop', 'STOP', rp.code === 'OK' && st0.code === 'OK' && st0.r.fields.state !== 'running', rp.code === 'OK' ? 'state=' + (st0.r ? st0.r.fields.state : '?') : 'ERR ' + rp.code);

      if (!opt.motion) {
        step('motion', '가동·잠금·감시 타이머', null, '벨트를 움직이는 시험은 건너뛰었습니다 ("벨트가 움직여도 됩니다"를 고르면 합니다).');
      } else {
        // 7. 가동
        await reply('RESET');
        let t0 = Date.now();
        const rr = await reply('RUN');
        const running = rr.code === 'OK' && await waitEvent(isState('running'), 600, t0);
        step('run', 'RUN → !STATE running', !!running, rr.code !== 'OK' ? 'ERR ' + rr.code : running ? '' : '!STATE running 알림이 오지 않았습니다');

        // 8. 잠금
        t0 = Date.now();
        const rh = await reply('HALT');
        const halted = rh.code === 'OK' && await waitEvent(isState('halted', 'command'), 600, t0);
        const rRun = await reply('RUN');
        step('halt', 'HALT → 잠김, RUN → ERR HALTED', !!halted && rRun.code === 'HALTED',
          !halted ? '!STATE halted reason=command 알림이 오지 않았습니다' : rRun.code === 'HALTED' ? '' : '잠긴 뒤 RUN이 ' + (rRun.code === 'OK' ? 'OK' : 'ERR ' + rRun.code));

        // 9. 잠금 풀기 — 풀어도 움직이지 않는다
        const rR = await reply('RESET');
        const st1 = await reply('STATUS');
        step('reset', 'RESET → 멈춘 그대로', rR.code === 'OK' && st1.code === 'OK' && st1.r.fields.state === 'stopped', rR.code !== 'OK' ? 'ERR ' + rR.code : 'state=' + (st1.r ? st1.r.fields.state : '?'));

        // 10. 감시 타이머 — 가동한 뒤 아무것도 보내지 않으면 스스로 멈추고 잠근다
        if (info.watchdogMs) {
          await reply('RUN');
          client.keepAlive(false);
          t0 = Date.now();
          const wd = await waitEvent(isState('halted', 'watchdog'), info.watchdogMs + 800, t0);
          const took = wd ? Date.now() - t0 : null;
          step('watchdog', '감시 타이머 (' + info.watchdogMs + 'ms)', !!wd, wd ? '보내기를 멈추고 약 ' + Math.round(took / 100) / 10 + '초 뒤 잠김' : '멈추지 않았습니다 — 서버가 죽어도 벨트가 계속 돕니다');
          await reply('RESET');
        } else step('watchdog', '감시 타이머', false, 'INFO에 watchdog 값이 없습니다');
      }

      // 11. 속도
      if (info.speed) {
        const before = await reply('STATUS');
        const old = before.code === 'OK' ? Number(before.r.fields.speed) : 50;
        const r1 = await reply('SPEED 30');
        const after = await reply('STATUS');
        step('speed', 'SPEED 30', r1.code === 'OK' && r1.r.fields.speed === '30' && after.code === 'OK' && after.r.fields.speed === '30', r1.code === 'OK' ? r1.r.line : 'ERR ' + r1.code);
        if (Number.isInteger(old)) await reply('SPEED ' + old);
      }

      // 12. 스스로 멈추기
      if (info.autostop) {
        const a1 = await reply('AUTOSTOP 1');
        const a0 = await reply('AUTOSTOP 0');
        step('autostop', 'AUTOSTOP 1 · 0', a1.code === 'OK' && a0.code === 'OK', a1.code === 'OK' && a0.code === 'OK' ? '스스로 멈추기를 켜고 가동한 뒤 부품이 센서에 오면 멈추는지는 손으로 시험하세요' : 'ERR ' + (a1.code !== 'OK' ? a1.code : a0.code));
      }

      // 13. 센서 — 손으로 부품을 지나가게 해야 알 수 있어 참고로만
      if (info.sensor) step('sensor', '부품 센서', null, '부품을 센서 앞으로 지나가게 하면 !PART 1 → !PART 0이 와야 합니다');
    } finally {
      off();
      client.keepAlive(true);
      await client.stop().catch(() => {});
    }
    return results;
  }

  root.Conveyor = { PROTO, MAX_LINE, ConveyorError, LineSplitter, parse, infoOf, statusOf, Client, FakeConveyor, fakeLink, check };
})(typeof window !== 'undefined' ? window : globalThis);
