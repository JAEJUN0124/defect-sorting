// Feetech STS 서보 버스 읽기 — 로봇팔(STS3215 × 6)의 상태를 브라우저에서 직접 읽습니다 (tools/devices.html).
// 읽기만 합니다: ID·통신 속도 바꾸기, 힘(토크) 켜기, 움직이기는 하지 않습니다. 그런 일은 서버 PC의 LeRobot이 합니다.
// 프로토콜·주소: Feetech STS(프로토콜 0, 낮은 바이트 먼저), LeRobot feetech/tables.py와 같은 값. docs/robot-arm.md
//   명령 묶음:  FF FF ID 길이 명령 값… 검사합      길이 = 값 개수 + 2, 검사합 = ~(ID + 길이 + 명령 + 값…) & FF
//   응답 묶음:  FF FF ID 길이 오류 값… 검사합
(function (root) {
  'use strict';

  const INST = { PING: 0x01, READ: 0x02 };
  const MODEL = { 777: 'STS3215', 2825: 'STS3250', 1284: 'SCS0009' }; // LeRobot MODEL_NUMBER_TABLE
  const RESOLUTION = 4096;
  // 응답 묶음 오류 바이트와 서보 상태(주소 65)의 비트
  const ERROR_BITS = [[0, 'voltage'], [1, 'sensor'], [2, 'temperature'], [3, 'current'], [5, 'overload']];
  // 자주 쓰는 USB-시리얼 칩 (보드를 구분하는 데 쓴다: 서보 보드는 보통 CH340/CH343, 아두이노는 자체 번호)
  const USB_CHIPS = {
    '1a86:7523': 'CH340', '1a86:55d3': 'CH343', '1a86:55d4': 'CH9102', '10c4:ea60': 'CP210x',
    '0403:6001': 'FT232', '0403:6015': 'FT231X', '2341:0043': 'Arduino Uno', '2341:0001': 'Arduino Uno',
    '2341:0042': 'Arduino Mega', '2341:8036': 'Arduino Leonardo', '2e8a:0005': 'Raspberry Pi Pico',
  };

  const checksum = (bytes) => (~bytes.reduce((a, b) => a + b, 0)) & 0xff;

  function packet(id, inst, params) {
    const p = params || [];
    const body = [id & 0xff, p.length + 2, inst].concat(p);
    return Uint8Array.from([0xff, 0xff].concat(body, [checksum(body)]));
  }

  const ping = (id) => packet(id, INST.PING);
  const read = (id, addr, len) => packet(id, INST.READ, [addr, len]);

  // 받은 바이트를 모아 응답 묶음을 꺼낸다. 깨진 바이트는 건너뛰고 다음 FF FF부터 다시 찾는다
  class Parser {
    constructor() { this.buf = []; }
    feed(bytes) {
      for (const b of bytes) this.buf.push(b);
      const out = [];
      for (;;) {
        let i = 0;
        while (i + 1 < this.buf.length && !(this.buf[i] === 0xff && this.buf[i + 1] === 0xff)) i += 1;
        if (i) this.buf.splice(0, i);
        if (this.buf.length < 6) break;
        // FF FF FF ID … 처럼 머리가 셋이면 하나를 버린다
        if (this.buf[2] === 0xff) { this.buf.shift(); continue; }
        const len = this.buf[3];
        if (len < 2 || len > 250) { this.buf.splice(0, 2); continue; }
        const total = len + 4;
        if (this.buf.length < total) break;
        const pkt = this.buf.splice(0, total);
        const body = pkt.slice(2, total - 1);
        if (checksum(body) !== pkt[total - 1]) { out.push({ bad: true, raw: pkt }); continue; }
        out.push({ id: pkt[2], error: pkt[4], params: pkt.slice(5, total - 1), raw: pkt });
      }
      return out;
    }
  }

  const u16 = (p, i) => p[i] | (p[i + 1] << 8);
  const signMagnitude = (v, bit) => ((v >> bit) & 1 ? -(v & ((1 << bit) - 1)) : v & ((1 << bit) - 1));
  const bits = (v) => ERROR_BITS.filter(([b]) => (v >> b) & 1).map(([, name]) => name);

  // 주소 56부터 15바이트: 현재 위치·속도·부하·전압·온도·(비동기)·상태·움직임·(목표)·전류
  function decodeTelemetry(p) {
    return {
      raw: signMagnitude(u16(p, 0), 15),
      speed: signMagnitude(u16(p, 2), 15),
      load: signMagnitude(u16(p, 4), 10) / 10, // %
      volt: p[6] / 10, // V
      temp: p[7], // °C
      status: p[9],
      faults: bits(p[9]),
      moving: p[10] === 1,
      current: Math.round(u16(p, 13) * 6.5), // mA
    };
  }

  // 주소 0부터 16바이트(EEPROM 앞부분)
  function decodeInfo(p) {
    const model = u16(p, 3);
    return {
      firmware: p[0] + '.' + p[1],
      model,
      modelName: MODEL[model] || null,
      id: p[5],
      baudIndex: p[6], // 0 = 1,000,000
      minLimit: u16(p, 9),
      maxLimit: u16(p, 11),
      maxTemp: p[13],
      maxVolt: p[14] / 10,
      minVolt: p[15] / 10,
    };
  }

  // LeRobot과 같은 식으로 바꾼다 (motors_bus.py _normalize). 최소·최대는 캘리브레이션 때 EEPROM에 써 둔 값
  function toDegrees(raw, min, max) {
    const mid = (min + max) / 2;
    return (raw - mid) * 360 / (RESOLUTION - 1);
  }
  function toPercent(raw, min, max) {
    if (max === min) return null;
    return Math.min(100, Math.max(0, ((raw - min) / (max - min)) * 100));
  }
  // 최소·최대가 기본값(0·4095)이면 아직 캘리브레이션하지 않은 것으로 본다 (손목 회전은 원래 한 바퀴라 제외)
  const looksUncalibrated = (info, joint) => joint !== 'wrist_roll' && info.minLimit === 0 && info.maxLimit === RESOLUTION - 1;

  // ---------- 버스: 명령 하나 보내고 그 ID의 응답을 기다린다 ----------
  class Bus {
    constructor(link, options) {
      this.link = link; // { write(Uint8Array) → Promise, onData(fn) }
      this.timeoutMs = (options && options.timeoutMs) || 100;
      this.parser = new Parser();
      this.waiting = null;
      this.queue = Promise.resolve();
      this.stats = { sent: 0, ok: 0, timeout: 0, bad: 0 };
      link.onData((bytes) => this.receive(bytes));
    }

    receive(bytes) {
      this.parser.feed(bytes).forEach((pkt) => {
        if (pkt.bad) { this.stats.bad += 1; return; }
        const w = this.waiting;
        // 반이중 보드가 보낸 명령이 되돌아오는 경우(에코)는 건너뛴다
        if (!w || pkt.id !== w.id || (w.sent && pkt.raw.length === w.sent.length && pkt.raw.every((b, i) => b === w.sent[i]))) return;
        this.waiting = null;
        clearTimeout(w.timer);
        this.stats.ok += 1;
        w.resolve(pkt);
      });
    }

    // 한 번에 하나씩 (응답이 섞이지 않게)
    transact(id, bytes) {
      const run = () => new Promise((resolve, reject) => {
        this.stats.sent += 1;
        const timer = setTimeout(() => {
          this.waiting = null;
          this.stats.timeout += 1;
          const err = new Error('TIMEOUT');
          err.code = 'TIMEOUT';
          reject(err);
        }, this.timeoutMs);
        this.waiting = { id, resolve, timer, sent: bytes };
        Promise.resolve(this.link.write(bytes)).catch((err) => { clearTimeout(timer); this.waiting = null; reject(err); });
      });
      const next = this.queue.then(run, run);
      this.queue = next.catch(() => {});
      return next;
    }

    async ping(id) {
      try { await this.transact(id, ping(id)); return true; } catch (e) { return false; }
    }

    async read(id, addr, len) {
      const pkt = await this.transact(id, read(id, addr, len));
      if (pkt.params.length !== len) {
        const err = new Error('SHORT');
        err.code = 'SHORT';
        throw err;
      }
      return pkt;
    }

    async scan(ids) {
      const found = [];
      for (const id of ids) { if (await this.ping(id)) found.push(id); }
      return found;
    }

    async info(id) {
      const a = await this.read(id, 0, 16);
      const b = await this.read(id, 31, 3);
      const c = await this.read(id, 40, 1);
      return Object.assign(decodeInfo(a.params), {
        homingOffset: signMagnitude(u16(b.params, 0), 11),
        mode: b.params[2],
        torque: c.params[0] === 1,
        errorByte: a.error,
      });
    }

    async telemetry(id) {
      const pkt = await this.read(id, 56, 15);
      return Object.assign(decodeTelemetry(pkt.params), { errorByte: pkt.error, packetFaults: bits(pkt.error) });
    }
  }

  // ---------- 연결: Web Serial (Chrome·Edge, localhost 또는 https) ----------
  async function openSerial(options) {
    if (!root.navigator || !root.navigator.serial) {
      const err = new Error('NO_WEB_SERIAL');
      err.code = 'NO_WEB_SERIAL';
      throw err;
    }
    const port = await root.navigator.serial.requestPort(options && options.filters ? { filters: options.filters } : {});
    await port.open({ baudRate: (options && options.baudRate) || 1000000, bufferSize: 4096 });
    let listener = () => {};
    let reading = true;
    const reader = port.readable.getReader();
    const writer = port.writable.getWriter();
    (async () => {
      try {
        while (reading) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) listener(value);
        }
      } catch (e) { /* 선을 뽑으면 여기로 온다 */ }
    })();
    const info = port.getInfo ? port.getInfo() : {};
    const key = info.usbVendorId !== undefined ? info.usbVendorId.toString(16).padStart(4, '0') + ':' + info.usbProductId.toString(16).padStart(4, '0') : null;
    return {
      port,
      usb: key,
      chip: key ? USB_CHIPS[key] || null : null,
      write: (bytes) => writer.write(bytes),
      onData: (fn) => { listener = fn; },
      async close() {
        reading = false;
        try { await reader.cancel(); } catch (e) { /* 이미 닫힘 */ }
        reader.releaseLock();
        writer.releaseLock();
        await port.close();
      },
    };
  }

  // ---------- 가짜 버스: 하드웨어 없이 화면과 이 파일을 시험할 때 ----------
  // STS3215 6개(ID 1~6)가 핑·읽기에 답한다. voltage: 7.4(리더) 또는 12(팔로워)
  function fakeLink(options) {
    const opt = Object.assign({ ids: [1, 2, 3, 4, 5, 6], voltage: 12, echo: false, calibrated: true }, options);
    let listener = () => {};
    const motors = {};
    opt.ids.forEach((id, i) => {
      const min = opt.calibrated ? 900 + i * 37 : 0;
      const max = opt.calibrated ? 3150 + i * 23 : 4095;
      motors[id] = { min, max, pos: Math.round((min + max) / 2 + (i - 2) * 120), temp: 31 + i, offset: opt.calibrated ? 140 - i * 30 : 0 };
    });
    const mem = (m, id) => {
      const b = new Array(80).fill(0);
      b[0] = 3; b[1] = 10; b[3] = 777 & 0xff; b[4] = 777 >> 8; b[5] = id; b[6] = 0;
      b[9] = m.min & 0xff; b[10] = m.min >> 8; b[11] = m.max & 0xff; b[12] = m.max >> 8;
      b[13] = 70; b[14] = opt.voltage > 10 ? 140 : 80; b[15] = 40;
      const off = m.offset < 0 ? (1 << 11) | -m.offset : m.offset;
      b[31] = off & 0xff; b[32] = off >> 8; b[33] = 0; b[40] = 0;
      m.pos += Math.round((Math.random() - 0.5) * 6);
      b[56] = m.pos & 0xff; b[57] = m.pos >> 8;
      const load = Math.round(Math.random() * 40);
      b[60] = load & 0xff; b[61] = load >> 8;
      b[62] = Math.round(opt.voltage * 10 + (Math.random() - 0.5) * 2);
      b[63] = m.temp;
      b[65] = 0; b[66] = 0;
      const cur = Math.round(load / 2);
      b[69] = cur & 0xff; b[70] = cur >> 8;
      return b;
    };
    const reply = (id, params) => {
      const body = [id, params.length + 2, 0].concat(params);
      return Uint8Array.from([0xff, 0xff].concat(body, [checksum(body)]));
    };
    return {
      fake: true,
      usb: null,
      chip: null,
      onData: (fn) => { listener = fn; },
      write(bytes) {
        const parsed = new Parser().feed(bytes)[0]; // 같은 모양이라 응답 해석기로 명령도 읽힌다
        if (!parsed || parsed.bad) return Promise.resolve();
        if (opt.echo) setTimeout(() => listener(bytes), 0);
        const m = motors[parsed.id];
        if (!m) return Promise.resolve(); // 없는 ID는 답하지 않는다
        const inst = parsed.error; // 명령 묶음에서는 이 자리가 명령
        let params = [];
        if (inst === INST.READ) params = mem(m, parsed.id).slice(parsed.params[0], parsed.params[0] + parsed.params[1]);
        setTimeout(() => listener(reply(parsed.id, params)), 2);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
      setVoltage(v) { opt.voltage = v; },
      heat(id, t) { if (motors[id]) motors[id].temp = t; },
    };
  }

  root.Feetech = {
    INST, MODEL, RESOLUTION, USB_CHIPS,
    packet, ping, read, checksum, Parser, signMagnitude, decodeTelemetry, decodeInfo,
    toDegrees, toPercent, looksUncalibrated, Bus, openSerial, fakeLink,
  };
})(typeof window !== 'undefined' ? window : globalThis);
