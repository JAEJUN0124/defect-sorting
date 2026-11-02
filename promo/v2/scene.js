// v2 — 화면 가운데 판정판(낱장이 넘어가는 스플릿 플랩)이 주인공인 판.
// 화면은 웹 HMI 디자인 규칙(hmi-web-mockup/DESIGN.md)을 따른다: 차분한 회색 조작반, 색은 신호에만
// (초록 = 정상·양품, 노랑 = 이상·불량). 기계(카메라·서버·컨베이어·로봇팔)는 선으로 그린 도면처럼 판 둘레에 둔다.
// 시간은 모두 timeline.mjs에서 온다. 모든 움직임은 시각 t만으로 정해진다.
import { DURATION, BOARD, FINAL, LANDS, boardFlips, finalFlips, cellsOf } from './timeline.mjs';

export { DURATION };

/* ── 색: HMI 다크 테마 토큰에서 ── */
const C = {
  bg0: '#111417', bg1: '#1B1F23',
  line: '#7D868E', lineHi: '#E4E7EA', fill: '#15191C',
  ink: '#E4E7EA', ink2: '#B3BBC2', ink3: '#6A737B',
  faceTop: '#30373D', faceBot: '#272D32', hinge: '#0B0D0F', panel: '#0C0F11', panelLine: '#2E353B',
  green: '#34A86E', amber: '#F2B705', amberTop: '#F6C232', amberBot: '#E6AA00', amberInk: '#1C2024',
  part: '#CDD2D7', partLine: '#8E979F', crack: '#5D666E',
  screen: '#0E1113', plate: '#1E2326', key: '#343C42', bg: '#262C31', red: '#C8102E', yellow: '#F2B705', dark: '#1C2024',
};
const FONT = '"IBM Plex Sans KR", "Noto Sans KR", sans-serif';

/* ── 수학 ── */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const lerp2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  inCubic: k => k * k * k,
  outCubic: k => 1 - (1 - k) ** 3,
  inOutCubic: k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  inOutQuart: k => (k < 0.5 ? 8 * k ** 4 : 1 - (-2 * k + 2) ** 4 / 2),
  outBack: (k, s = 1.7) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2,
  inOutSine: k => -(Math.cos(Math.PI * k) - 1) / 2,
};

/* ── 화면 배치 (가로 1920×1080, 세로 1080×1920) ── */
const LAYOUT = {
  wide: {
    board: { cx: 960, cy: 500, cw: 190, ch: 244, gap: 14, pad: 22 },
    label: { y: 336, size: 48 },
    rail: 52, cam: { x: 960, body: [885, 100, 150, 88], lens: [930, 188, 60, 32] },
    server: [96, 84, 128, 176],
    beltY: 940, part: 84, pitch: 260, roller: { r: 22, step: 160 },
    arm: { S: [1620, 830], L1: 350, L2: 350, rest: [1440, 700], pick: [960, 792], drop: [1340, 870], cable: 1760 },
    bin: [1260, 972, 160, 80],
    hmi: { win: [330, 214, 1260, 712], split: 'side', capCy: 112, capScale: 0.36 },
    final: { cw: 156, ch: 204, gap: 12, rowGap: 18, cy: 468 },
    credits: { y1: 822, y2: 882, size: 40 },
    lw: 3.2,
  },
  tall: {
    board: { cx: 540, cy: 930, cw: 210, ch: 268, gap: 14, pad: 22 },
    label: { y: 728, size: 54 },
    rail: 260, cam: { x: 540, body: [465, 310, 150, 92], lens: [510, 402, 60, 34] },
    server: [56, 296, 120, 176],
    beltY: 1560, part: 96, pitch: 280, roller: { r: 26, step: 180 },
    arm: { S: [930, 1455], L1: 300, L2: 300, rest: [790, 1300], pick: [540, 1400], drop: [725, 1515], cable: 1030 },
    bin: [650, 1600, 150, 90],
    hmi: { win: [60, 620, 960, 880], split: 'stack', capCy: 486, capScale: 0.42 },
    final: { cw: 150, ch: 196, gap: 12, rowGap: 18, cy: 860 },
    credits: { y1: 1330, y2: 1398, size: 44 },
    lw: 3.4,
  },
};

// 컨베이어가 한 칸씩 내려앉은 횟수 (박 직전 0.2초 동안 움직여 박에 내려앉는다)
const beltN = t => LANDS.reduce((n, land) => n + E.inOutQuart(prog(t, land - 0.2, land)), 0);
const DEFECT_SLOT = -4; // 1.5초에 검사 자리에 오는 부품

/* ───────── 장면 ───────── */
export function createScene({ ctx, W, H, format = 'wide', assets = {} }) {
  const L = LAYOUT[format];
  const tall = format === 'tall';
  const flips = boardFlips();
  const finals = finalFlips(format);
  // 칸마다 낱장 목록
  const byCell = [0, 1, 2, 3].map(i => flips.filter(f => f.cell === i).sort((a, b) => a.t0 - b.t0));
  // 끝 판: 줄마다 칸 목록. 띄어쓰기는 칸 없이 좁은 틈
  const finalCells = FINAL.rows[format].map((line, r) =>
    cellsOf(line).map((ch, c) => ({ blank: !ch, flips: finals.filter(f => f.row === r && f.cell === c).sort((a, b) => a.t0 - b.t0) })),
  );

  // 바탕(그라디언트 + 점 격자)은 한 번만 그려 둔다
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = W;
  bgCanvas.height = H;
  {
    const b = bgCanvas.getContext('2d');
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg0);
    g.addColorStop(1, C.bg1);
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);
    b.fillStyle = 'rgba(228,231,234,0.05)';
    for (let y = 20; y < H; y += 40) for (let x = 20; x < W; x += 40) b.fillRect(x - 1, y - 1, 2, 2);
  }

  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  const font = (size, weight = 600) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
  };

  /* ── 판정판의 칸 하나 ── */
  function cellState(list, t) {
    let ch = '', tone = '';
    for (const f of list) {
      if (t < f.t0) break;
      if (t < f.t1) return { flip: f, p: (t - f.t0) / (f.t1 - f.t0) };
      ch = f.to;
      tone = f.toTone;
    }
    return { ch, tone };
  }
  function half(x, y, w, h, ch, tone, which, size) {
    const mid = y + h / 2;
    ctx.save();
    ctx.beginPath();
    if (which === 'top') ctx.rect(x - 2, y - 2, w + 4, h / 2 + 2);
    else ctx.rect(x - 2, mid, w + 4, h / 2 + 2);
    ctx.clip();
    const ng = tone === 'ng';
    ctx.fillStyle = which === 'top' ? (ng ? C.amberTop : C.faceTop) : ng ? C.amberBot : C.faceBot;
    rr(x, y, w, h, Math.min(w, h) * 0.06);
    ctx.fill();
    if (ch) {
      font(size, 600);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ng ? C.amberInk : C.ink;
      ctx.fillText(ch, x + w / 2, y + h / 2 + size * 0.04);
    }
    ctx.restore();
  }
  function flapCell(x, y, w, h, st, size) {
    const mid = y + h / 2;
    if (!st.flip) {
      half(x, y, w, h, st.ch, st.tone, 'top', size);
      half(x, y, w, h, st.ch, st.tone, 'bot', size);
    } else {
      const { from, to, fromTone, toTone } = st.flip;
      const p = st.p;
      // 뒤: 위는 새 글자, 아래는 아직 옛 글자
      half(x, y, w, h, to, toTone, 'top', size);
      half(x, y, w, h, from, fromTone, 'bot', size);
      ctx.save();
      ctx.translate(0, mid);
      if (p < 0.5) {
        // 옛 윗장이 앞으로 넘어온다
        const s = Math.cos(p * Math.PI);
        ctx.scale(1, s);
        ctx.translate(0, -mid);
        half(x, y, w, h, from, fromTone, 'top', size);
        ctx.fillStyle = `rgba(0,0,0,${0.55 * (1 - s)})`;
        ctx.fillRect(x, y, w, h / 2);
      } else {
        // 새 아랫장이 내려와 닫힌다
        const s = -Math.cos(p * Math.PI);
        ctx.scale(1, s);
        ctx.translate(0, -mid);
        half(x, y, w, h, to, toTone, 'bot', size);
        ctx.fillStyle = `rgba(0,0,0,${0.45 * (1 - s)})`;
        ctx.fillRect(x, mid, w, h / 2);
      }
      ctx.restore();
    }
    // 가운데 경첩과 양쪽 핀
    ctx.fillStyle = C.hinge;
    ctx.fillRect(x, mid - 1.5, w, 3);
    ctx.fillStyle = '#41494F';
    ctx.fillRect(x - 3, mid - 6, 5, 12);
    ctx.fillRect(x + w - 2, mid - 6, 5, 12);
  }

  /* ── 가운데 판(4칸) ── */
  function boardTone(t) {
    let tone = '';
    for (const ev of BOARD) if (t >= ev.at) tone = ev.tone || '';
    return tone;
  }
  function drawBoard(t, cx, cy, scale = 1) {
    const B = L.board;
    const cw = B.cw * scale, ch = B.ch * scale, gap = B.gap * scale, pad = B.pad * scale;
    const w = cw * 4 + gap * 3;
    const x0 = cx - w / 2, y0 = cy - ch / 2;
    // 판 바탕과 표시등
    ctx.fillStyle = C.panel;
    rr(x0 - pad, y0 - pad, w + pad * 2, ch + pad * 2, 16 * scale);
    ctx.fill();
    ctx.strokeStyle = C.panelLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const tone = boardTone(t);
    const lampR = 9 * scale;
    const lx = x0 - pad / 2, ly = y0 - pad / 2;
    ctx.beginPath();
    ctx.arc(lx + 1 * scale, ly + 1 * scale, lampR * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = tone === 'ok' ? C.green : tone === 'ng' ? C.amber : '#3A4147';
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      const st = cellState(byCell[i], t);
      flapCell(x0 + i * (cw + gap), y0, cw, ch, st, ch * 0.62);
    }
    return { x0, y0, w, h: ch };
  }

  /* ── 기계: 선으로 그린 도면 ── */
  function stroke(hi, width = L.lw) {
    ctx.strokeStyle = hi ? C.lineHi : C.line;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }
  const working = (t, a, b) => t >= a && t < b;

  function drawRail(t) {
    stroke(false, 2);
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-10, L.rail);
    ctx.lineTo(W + 10, L.rail);
    ctx.moveTo(-10, L.rail + 7);
    ctx.lineTo(W + 10, L.rail + 7);
    ctx.stroke();
    // 로봇팔로 내려가는 선
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(L.arm.cable, L.rail + 7);
    ctx.lineTo(L.arm.cable, L.beltY - 20);
    ctx.lineTo(L.arm.S[0] + 70, L.beltY - 20);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawServer(t) {
    const [x, y, w, h] = L.server;
    const hi = working(t, 4.0, 6.3);
    // 레일에 매단 선
    stroke(false, 2);
    ctx.beginPath();
    ctx.moveTo(x + w / 2, L.rail + 7);
    ctx.lineTo(x + w / 2, y);
    ctx.stroke();
    ctx.fillStyle = C.fill;
    rr(x, y, w, h, 10);
    ctx.fill();
    stroke(hi);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const sy = y + 22 + i * (h - 34) / 3;
      rr(x + 14, sy, w - 28, (h - 34) / 3 - 12, 5);
      ctx.stroke();
      // 표시등: 판단하는 동안 빠르게 깜빡임
      const busy = working(t, 4.5, 5.0);
      const on = busy ? Math.sin((t * 40 + i * 2)) > 0 : Math.sin(t * 3 + i) > -0.2;
      ctx.fillStyle = busy ? C.amber : C.green;
      ctx.globalAlpha = on ? 1 : 0.25;
      ctx.beginPath();
      ctx.arc(x + w - 30, sy + ((h - 34) / 3 - 12) / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function lastLand(t) {
    let last = -9;
    for (const land of LANDS) if (land <= t) last = land;
    return last;
  }
  function drawCamera(t) {
    const { x, body, lens } = L.cam;
    const hi = working(t, 2.0, 4.0);
    const flash = 1 - prog(t - lastLand(t), 0, 0.22);
    stroke(false, 2);
    ctx.beginPath();
    ctx.moveTo(x, L.rail + 7);
    ctx.lineTo(x, body[1]);
    ctx.stroke();
    // 시선: 렌즈에서 검사 자리의 부품 양 끝으로
    const half = L.part / 2;
    const ly = lens[1] + lens[3];
    const py = L.beltY - L.part;
    const focus = E.outCubic(prog(t, 2.0, 2.4)) * (t < 8.0 ? 1 : 1 - prog(t, 8.0, 8.3));
    const spread = lerp(half + 40, half + 6, focus);
    ctx.save();
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = -t * 40;
    ctx.strokeStyle = C.lineHi;
    ctx.globalAlpha = 0.28 + 0.5 * flash + 0.25 * focus * (t < 6 ? 1 : 0);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lens[0] + 8, ly);
    ctx.lineTo(x - spread, py);
    ctx.moveTo(lens[0] + lens[2] - 8, ly);
    ctx.lineTo(x + spread, py);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.fill;
    rr(body[0], body[1], body[2], body[3], 12);
    ctx.fill();
    stroke(hi);
    ctx.stroke();
    rr(lens[0], lens[1], lens[2], lens[3], 6);
    ctx.fillStyle = C.fill;
    ctx.fill();
    ctx.stroke();
    // 렌즈 유리와 표시등
    ctx.beginPath();
    ctx.arc(body[0] + body[2] - 26, body[1] + 24, 6, 0, Math.PI * 2);
    ctx.fillStyle = flash > 0.01 ? C.lineHi : '#3A4147';
    ctx.fill();
    if (flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = flash;
      const g = ctx.createRadialGradient(x, ly, 0, x, ly, 90);
      g.addColorStop(0, 'rgba(228,231,234,0.9)');
      g.addColorStop(1, 'rgba(228,231,234,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 90, ly - 90, 180, 180);
      ctx.restore();
    }
  }

  function drawBelt(t) {
    const y = L.beltY, r = L.roller.r, h = r * 2 + 18;
    const pos = beltN(t) * L.pitch;
    ctx.fillStyle = C.fill;
    rr(-40, y, W + 80, h, h / 2);
    ctx.fill();
    stroke(working(t, 0, 0.02));
    ctx.stroke();
    // 굴림대: 띠가 움직이면 돈다
    for (let x = -L.roller.step; x < W + L.roller.step; x += L.roller.step) {
      const cx = x + 40, cy = y + h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const a = pos / r;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const aa = a + (k * Math.PI * 2) / 3;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(aa) * r * 0.7, cy + Math.sin(aa) * r * 0.7);
      }
      ctx.stroke();
    }
    // 띠 윗면의 눈금이 부품과 같이 움직인다
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    for (let x = (pos % 40) - 40; x < W + 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, y + 6);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 불량 부품의 금 (부품 크기 비율)
  const CRACK = [[0.3, -0.34], [0.06, -0.08], [0.18, 0.06], [-0.1, 0.3], [-0.04, 0.42]];
  function drawPart(x, y, o = {}) {
    const s = L.part;
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.fillStyle = C.part;
    rr(-s / 2, -s / 2, s, s, s * 0.1);
    ctx.fill();
    ctx.strokeStyle = o.judged > 0 ? C.amber : C.partLine;
    ctx.lineWidth = o.judged > 0 ? 3 + 2 * o.judged : 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(142,151,159,0.5)';
    ctx.lineWidth = 1.5;
    rr(-s / 2 + 8, -s / 2 + 8, s - 16, s - 16, s * 0.06);
    ctx.stroke();
    if (o.defect) {
      ctx.lineJoin = 'miter';
      ctx.strokeStyle = C.crack;
      ctx.lineWidth = 3;
      ctx.beginPath();
      CRACK.forEach(([u, v], i) => (i ? ctx.lineTo(u * s, v * s) : ctx.moveTo(u * s, v * s)));
      ctx.stroke();
      if (o.trace > 0) {
        // 판정: 금을 따라 노란 선이 그려진다
        const n = CRACK.length - 1, upto = o.trace * n;
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(CRACK[0][0] * s, CRACK[0][1] * s);
        for (let i = 1; i <= n; i++) {
          const k = clamp(upto - (i - 1));
          if (k <= 0) break;
          const p = lerp2(CRACK[i - 1], CRACK[i], k);
          ctx.lineTo(p[0] * s, p[1] * s);
        }
        ctx.stroke();
      }
    }
    if (o.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * o.flash})`;
      rr(-s / 2, -s / 2, s, s, s * 0.1);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParts(t) {
    const n = beltN(t);
    const cy = L.beltY - L.part / 2;
    const flash = 1 - prog(t - lastLand(t), 0, 0.2);
    for (let k = -30; k <= 30; k++) {
      const x = W / 2 + (k + n) * L.pitch;
      if (x < -L.part || x > W + L.part) continue;
      const defect = k === DEFECT_SLOT;
      if (defect && t >= 7.0) continue; // 로봇팔이 집어 감
      const atCenter = Math.abs(x - W / 2) < 1;
      drawPart(x, cy, {
        defect,
        judged: defect ? E.outCubic(prog(t, 5.0, 5.2)) : 0,
        trace: defect ? E.inOutCubic(prog(t, 5.0, 5.35)) : 0,
        flash: atCenter ? flash : 0,
      });
    }
  }

  // 3~6초: 카메라가 불량을 잡는다 (모서리 괄호가 오므라들고, 훑는 선, 3초에 노란 검출 상자)
  function drawDetection(t) {
    if (t < 2.0 || t >= 7.0) return;
    const cx = W / 2, cy = L.beltY - L.part / 2, s = L.part;
    const k = E.outBack(prog(t, 2.0, 2.4), 1.6);
    const half = lerp(s * 1.3, s * 0.68, k);
    const locked = t >= 3.0;
    const fade = 1 - prog(t, 6.6, 7.0);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = locked ? C.amber : C.lineHi;
    ctx.lineWidth = locked ? 4 : 3;
    ctx.lineCap = 'square';
    const arm = s * 0.28;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = cx + sx * half, py = cy + sy * half;
      ctx.beginPath();
      ctx.moveTo(px, py - sy * arm);
      ctx.lineTo(px, py);
      ctx.lineTo(px - sx * arm, py);
      ctx.stroke();
    }
    // 훑는 선
    const ks = prog(t, 2.4, 3.0);
    if (ks > 0 && ks < 1) {
      const y = cy - half + 2 * half * E.inOutSine(ks);
      const g = ctx.createLinearGradient(0, y - 40, 0, y);
      g.addColorStop(0, 'rgba(228,231,234,0)');
      g.addColorStop(1, 'rgba(228,231,234,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - half, y - 40, half * 2, 40);
      ctx.strokeStyle = C.lineHi;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - half - 10, y);
      ctx.lineTo(cx + half + 10, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 데이터: 레일을 따라 점이 지나간다
  function along(path, u) {
    const segs = [];
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      segs.push(d);
      total += d;
    }
    let s = clamp(u) * total;
    for (let i = 0; i < segs.length; i++) {
      if (s <= segs[i]) return lerp2(path[i], path[i + 1], segs[i] ? s / segs[i] : 0);
      s -= segs[i];
    }
    return path[path.length - 1];
  }
  function drawData(t) {
    const [sx, sy, sw] = L.server;
    const serverTop = [sx + sw / 2, sy];
    const camTop = [L.cam.x, L.cam.body[1]];
    const toServer = [camTop, [L.cam.x, L.rail + 3], [sx + sw / 2, L.rail + 3], serverTop];
    const toArm = [serverTop, [sx + sw / 2, L.rail + 3], [L.arm.cable, L.rail + 3], [L.arm.cable, L.beltY - 20], [L.arm.S[0] + 70, L.beltY - 20]];
    const dot = (p, r, color, a = 1) => {
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    // 카메라 → 서버 (4.0~4.75)
    for (let i = 0; i < 6; i++) {
      const u = prog(t, 4.0 + i * 0.05, 4.5 + i * 0.05);
      if (u > 0 && u < 1) dot(along(toServer, u), 7, C.amber);
    }
    // 서버 → 카메라: 판정이 돌아온다 (4.8~5.0)
    const back = prog(t, 4.8, 5.0);
    if (back > 0 && back < 1) dot(along([...toServer].reverse(), back), 11, C.amber);
    // 서버 → 로봇팔 (6.0~6.3)
    for (let i = 0; i < 4; i++) {
      const u = prog(t, 6.0 + i * 0.04, 6.3 + i * 0.04);
      if (u > 0 && u < 1) dot(along(toArm, u), 7, C.lineHi);
    }
  }

  /* ── 로봇팔 ── */
  const A = L.arm;
  const above = p => [p[0], p[1] - 120];
  const WRIST = [
    [6.3, A.rest],
    [6.75, above(A.pick), 'outCubic'],
    [6.97, A.pick, 'inOutCubic'],
    [7.03, A.pick],
    [7.35, [A.pick[0] + 20, A.pick[1] - 150], 'outCubic'],
    [7.68, [A.drop[0], A.drop[1] - 40], 'inOutCubic'],
    [7.74, A.drop, 'inOutCubic'],
    [7.8, A.drop],
    [8.5, A.rest, 'inOutCubic'],
  ];
  function wristAt(t) {
    if (t <= WRIST[0][0]) return WRIST[0][1];
    for (let i = 1; i < WRIST.length; i++) {
      const [tb, pb, how] = WRIST[i];
      const [ta, pa] = WRIST[i - 1];
      if (t <= tb) return how ? lerp2(pa, pb, E[how](prog(t, ta, tb))) : pa;
    }
    return WRIST[WRIST.length - 1][1];
  }
  const gripOpen = t => (t < 6.92 ? 14 : t < 7.75 ? 14 * (1 - E.outCubic(prog(t, 6.92, 7.0))) : 14 * E.outCubic(prog(t, 7.75, 7.83)));
  function ik(Wt) {
    const [sx, sy] = A.S;
    let dx = Wt[0] - sx, dy = Wt[1] - sy;
    let d = Math.hypot(dx, dy);
    const dmax = A.L1 + A.L2 - 1;
    if (d > dmax) { dx *= dmax / d; dy *= dmax / d; d = dmax; }
    const a = Math.atan2(dy, dx);
    const b = Math.acos(clamp((A.L1 ** 2 + d * d - A.L2 ** 2) / (2 * A.L1 * d), -1, 1));
    const e1 = [sx + A.L1 * Math.cos(a - b), sy + A.L1 * Math.sin(a - b)];
    const e2 = [sx + A.L1 * Math.cos(a + b), sy + A.L1 * Math.sin(a + b)];
    return { S: A.S, E: e1[1] < e2[1] ? e1 : e2, W: [sx + dx, sy + dy] };
  }
  function capsule(a, b, w) {
    ctx.save();
    ctx.translate(a[0], a[1]);
    ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
    rr(-w / 2, -w / 2, Math.hypot(b[0] - a[0], b[1] - a[1]) + w, w, w / 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function joint(p, r) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p[0], p[1], r * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  }
  const fingerLen = () => L.part * 0.76;
  function drawArmBody(t) {
    const { S, E: El, W: Wr } = ik(wristAt(t));
    const hi = working(t, 6.0, 8.0);
    const u = L.part / 84;
    ctx.fillStyle = C.fill;
    stroke(hi);
    // 받침은 컨베이어 뒤에 있어 아래쪽이 띠에 가려진다
    rr(S[0] - 80 * u, S[1] + 34 * u, 160 * u, L.beltY - S[1], 10);
    ctx.fill();
    ctx.stroke();
    rr(S[0] - 48 * u, S[1] - 40 * u, 96 * u, 84 * u, 14);
    ctx.fill();
    ctx.stroke();
    capsule(S, El, 44 * u);
    capsule(El, Wr, 38 * u);
    joint(S, 30 * u);
    joint(El, 26 * u);
    joint(Wr, 22 * u);
  }
  // 그리퍼는 부품 앞에 그린다 (부품을 양옆에서 쥔다)
  function drawGripper(t) {
    const Wr = ik(wristAt(t)).W;
    const hi = working(t, 6.0, 8.0);
    const o = gripOpen(t);
    const s = L.part, g = s / 2 + 5 + o, fl = fingerLen();
    ctx.fillStyle = C.fill;
    stroke(hi);
    rr(Wr[0] - 17, Wr[1], 34, 50, 6);
    ctx.fill();
    ctx.stroke();
    rr(Wr[0] - g - 16, Wr[1] + 46, 2 * g + 32, 18, 5);
    ctx.fill();
    ctx.stroke();
    // 들고 있는 불량품 (7.0~7.75)
    if (t >= 7.0 && t < 7.75) drawPart(Wr[0], Wr[1] + 62 + s / 2 + 2, { defect: true, judged: 1, trace: 1 });
    for (const sx of [-1, 1]) {
      rr(sx < 0 ? Wr[0] - g - 16 : Wr[0] + g, Wr[1] + 62, 16, fl, 4);
      ctx.fill();
      ctx.stroke();
    }
  }
  function drawBin(t) {
    const [x, y, w, h] = L.bin;
    // 불량함에 떨어진 부품 (7.75에 놓아 7.9에 바닥에 닿는다)
    if (t >= 7.75) {
      const k = prog(t, 7.75, 7.9);
      const from = A.drop[1] + 62 + L.part / 2 + 2;
      const to = y + h - L.part * 0.42;
      const py = lerp(from, to, k * k);
      drawPart(lerp(A.drop[0], x + w / 2 + 6, k), py, { defect: true, judged: 1, trace: 1, rot: 0.2 * k });
    }
    ctx.fillStyle = C.fill;
    stroke(working(t, 7.7, 8.0));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 12, y + h);
    ctx.lineTo(x + w - 12, y + h);
    ctx.lineTo(x + w, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.45);
    ctx.lineTo(x + w, y + h * 0.45);
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 기계 전체 (scene 좌표 = 화면 좌표)
  function drawMachine(t) {
    drawRail(t);
    drawServer(t);
    drawData(t);
    drawArmBody(t);
    drawBelt(t);
    drawParts(t);
    drawCamera(t);
    drawDetection(t);
    drawBin(t);
    drawGripper(t);
  }

  /* ── 판 위의 주어 ── */
  function labelAt(t) {
    let cur = null;
    for (const ev of BOARD) if (t >= ev.at) cur = ev;
    return cur && cur.label ? cur : null;
  }
  function drawLabel(t, x, y, size, align = 'center') {
    const ev = labelAt(t);
    if (!ev) return;
    const k = E.outCubic(prog(t, ev.at, ev.at + 0.3));
    ctx.save();
    font(size, 600);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = k;
    ctx.fillStyle = C.ink2;
    ctx.fillText(ev.label, x, y + (1 - k) * -14);
    ctx.restore();
  }

  /* ── 웹 HMI (10~12초) ── */
  function hmiGeom() {
    const [x, y, w, h] = L.hmi.win;
    const pad = 22;
    if (L.hmi.split === 'side') {
      const lw = 330, cw = w - pad * 3 - lw;
      return { win: { x, y, w, h }, pad, left: { x: x + pad, y: y + pad, w: lw }, cam: { x: x + pad * 2 + lw, y: y + pad, w: cw, h: (cw * 9) / 16 } };
    }
    const cw = w - pad * 2;
    return { win: { x, y, w, h }, pad, cam: { x: x + pad, y: y + pad, w: cw, h: (cw * 9) / 16 } };
  }
  // HMI 카메라 화면 속 탑뷰: 위에서 본 띠와 부품
  function drawTopView(t, r) {
    ctx.save();
    rr(r.x, r.y, r.w, r.h, 6);
    ctx.clip();
    ctx.globalAlpha *= E.outCubic(prog(t, 10.6, 10.85));
    ctx.fillStyle = C.screen;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const bandH = r.h * 0.42, by = r.y + (r.h - bandH) / 2;
    ctx.fillStyle = '#1E2326';
    ctx.fillRect(r.x, by, r.w, bandH);
    ctx.strokeStyle = '#3A4147';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 2, by, r.w + 4, bandH);
    const pitch = r.w * 0.22, s = bandH * 0.58;
    const n = beltN(t);
    const flash = 1 - prog(t - lastLand(t), 0, 0.2);
    for (let k = -12; k <= 12; k++) {
      const x = r.x + r.w / 2 + (k + n) * pitch;
      if (x < r.x - s || x > r.x + r.w + s) continue;
      ctx.fillStyle = C.part;
      rr(x - s / 2, by + (bandH - s) / 2, s, s, s * 0.12);
      ctx.fill();
      if (Math.abs(x - (r.x + r.w / 2)) < 1 && flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 * flash})`;
        ctx.fill();
      }
    }
    // 검사 자리
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = C.green;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(r.x + r.w / 2 - s * 0.75, by + bandH / 2 - s * 0.75, s * 1.5, s * 1.5);
    ctx.setLineDash([]);
    // 탑뷰·그리퍼 단추
    font(16, 600);
    ctx.textBaseline = 'alphabetic';
    let cx = r.x + 14;
    for (const [label, on] of [['탑뷰', true], ['그리퍼', false]]) {
      const w = ctx.measureText(label).width + 28;
      rr(cx, r.y + 14, w, 36, 6);
      ctx.fillStyle = on ? 'rgba(14,17,19,0.85)' : 'rgba(14,17,19,0.5)';
      ctx.fill();
      ctx.strokeStyle = on ? C.ink : 'rgba(228,231,234,0.45)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.fillText(label, cx + 14, r.y + 38);
      cx += w + 8;
    }
    ctx.restore();
  }
  function drawHmi(t, k) {
    const g = hmiGeom();
    const { win, cam } = g;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate(0, (1 - k) * 40);
    ctx.fillStyle = C.plate;
    rr(win.x, win.y, win.w, win.h, 18);
    ctx.fill();
    ctx.strokeStyle = '#424A51';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawTopView(t, cam);
    const key = (x, y, w, h, label, o = {}) => {
      ctx.fillStyle = o.fill || C.key;
      rr(x, y, w, h, 8);
      ctx.fill();
      if (o.border) {
        ctx.strokeStyle = o.border;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      font(o.size || 20, 600);
      ctx.fillStyle = o.ink || C.ink;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, y + h / 2 + (o.size || 20) * 0.36);
      ctx.textAlign = 'left';
    };
    const lamp = (x, y, color, r = 8) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const good = 41 + Math.round(beltN(t)) - 8;
    const stat = (x, y, w, h, label, value, color) => {
      ctx.fillStyle = C.bg;
      rr(x, y, w, h, 8);
      ctx.fill();
      font(18, 600);
      ctx.fillStyle = C.ink2;
      ctx.fillText(label, x + 18, y + 32);
      font(46, 600);
      ctx.fillStyle = color;
      ctx.fillText(String(value), x + 18, y + h - 20);
    };
    const devices = (x, y) => {
      font(17, 600);
      ctx.fillStyle = C.ink2;
      ctx.fillText('장치 연결', x, y + 6);
      let dx = x + 104;
      for (const name of ['서버', '컨베이어', '로봇팔', '리더암', '카메라']) {
        lamp(dx + 7, y, C.green, 7);
        font(18, 600);
        ctx.fillStyle = C.ink;
        ctx.fillText(name, dx + 20, y + 6);
        dx += 26 + ctx.measureText(name).width + 24;
      }
    };
    const sy = cam.y + cam.h + 16;
    const sw = (cam.w - 12) / 2;
    stat(cam.x, sy, sw, 104, '양품', good, C.ink);
    stat(cam.x + sw + 12, sy, sw, 104, '불량', 1, C.amber);
    if (L.hmi.split === 'side') {
      const lp = g.left;
      ctx.fillStyle = C.bg;
      rr(lp.x, lp.y, lp.w, 92, 8);
      ctx.fill();
      lamp(lp.x + 30, lp.y + 46, C.green);
      font(24, 600);
      ctx.fillStyle = C.ink;
      ctx.fillText('자동 운전 중', lp.x + 52, lp.y + 42);
      font(15, 400);
      ctx.fillStyle = C.ink2;
      ctx.fillText('라인 가동 · 원점 설정됨', lp.x + 52, lp.y + 68);
      const ey = lp.y + 108;
      ctx.fillStyle = C.yellow;
      rr(lp.x, ey, 104, 104, 10);
      ctx.fill();
      lamp(lp.x + 52, ey + 52, C.red, 36);
      font(20, 600);
      ctx.fillStyle = C.ink;
      ctx.fillText('긴급정지', lp.x + 124, ey + 46);
      font(15, 400);
      ctx.fillStyle = C.ink2;
      ctx.fillText('누르면 라인이 멈춥니다', lp.x + 124, ey + 72);
      key(lp.x, ey + 122, lp.w, 84, '정지', { fill: C.ink, ink: C.dark, size: 26 });
      key(lp.x, ey + 222, (lp.w - 10) / 2, 58, '원점 복귀', { size: 18 });
      key(lp.x + (lp.w + 10) / 2, ey + 222, (lp.w - 10) / 2, 58, '원점 잡기', { size: 18, fill: 'rgba(0,0,0,0)', ink: C.ink3 });
      const toggle = (y, title, items, sel) => {
        font(16, 600);
        ctx.fillStyle = C.ink2;
        ctx.fillText(title, lp.x, y - 10);
        const iw = (lp.w - 8) / items.length;
        items.forEach((it, i) => key(lp.x + i * (iw + 8), y, iw, 52, it, i === sel ? { border: C.ink } : { fill: 'rgba(0,0,0,0)', ink: C.ink2 }));
      };
      toggle(ey + 330, '운전 모드', ['자동', '수동'], 0);
      toggle(ey + 420, '로봇팔이 옮길 부품', ['양품', '불량품'], 1);
      devices(cam.x, sy + 104 + 44);
    } else {
      const cy = sy + 104 + 16;
      ctx.fillStyle = C.yellow;
      rr(cam.x, cy, 104, 104, 10);
      ctx.fill();
      lamp(cam.x + 52, cy + 52, C.red, 36);
      key(cam.x + 120, cy, cam.w - 120 - 220, 104, '정지', { fill: C.ink, ink: C.dark, size: 30 });
      ctx.fillStyle = C.bg;
      rr(cam.x + cam.w - 204, cy, 204, 104, 8);
      ctx.fill();
      lamp(cam.x + cam.w - 176, cy + 52, C.green);
      font(22, 600);
      ctx.fillStyle = C.ink;
      ctx.fillText('자동 운전', cam.x + cam.w - 158, cy + 60);
      devices(cam.x, cy + 104 + 46);
    }
    ctx.restore();
  }

  /* ── 끝 판 ── */
  function drawFinal(t) {
    const F = L.final;
    // 12초 타격과 함께 판이 크게 들어와 박히고, 제목이 다 내려앉은 뒤에는 아주 천천히 다가간다
    const slam = E.outCubic(prog(t, FINAL.appear, FINAL.appear + 0.35));
    const drift = 0.025 * E.inOutSine(prog(t, 13.3, DURATION));
    const zoom = lerp(1.1, 1, slam) + drift;
    const rows = finalCells.length;
    const totalH = rows * F.ch + (rows - 1) * F.rowGap;
    const pad = 22;
    const space = F.cw * 0.38;
    const cellW = cell => (cell.blank ? space : F.cw);
    const widths = finalCells.map(cells => cells.reduce((w, cell) => w + cellW(cell), 0) + (cells.length - 1) * F.gap);
    const maxW = Math.max(...widths);
    ctx.save();
    ctx.translate(W / 2, F.cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -F.cy);
    const px = W / 2 - maxW / 2 - pad, py = F.cy - totalH / 2 - pad;
    ctx.fillStyle = C.panel;
    rr(px, py, maxW + pad * 2, totalH + pad * 2, 18);
    ctx.fill();
    ctx.strokeStyle = C.panelLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 표시등: 제목이 내려앉으면 초록으로 켜져 천천히 깜빡인다 (라인 가동 중)
    const on = t >= 13.25;
    ctx.beginPath();
    ctx.arc(px + pad / 2 + 1, py + pad / 2 + 1, 7, 0, Math.PI * 2);
    ctx.fillStyle = on ? C.green : '#3A4147';
    ctx.globalAlpha = on ? 0.65 + 0.35 * Math.cos((t - 13.25) * Math.PI * 2) : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    finalCells.forEach((cells, r) => {
      let x = W / 2 - widths[r] / 2;
      const y = F.cy - totalH / 2 + r * (F.ch + F.rowGap);
      for (const cell of cells) {
        if (!cell.blank) flapCell(x, y, F.cw, F.ch, cellState(cell.flips, t), F.ch * 0.62);
        x += cellW(cell) + F.gap;
      }
    });
    ctx.restore();
    // 학교와 팀
    const k = E.outCubic(prog(t, 13.5, 14.1));
    if (k > 0) {
      const Cr = L.credits;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.textBaseline = 'alphabetic';
      font(Cr.size, 600);
      const line1 = tall ? '대림대학교 스마트소프트웨어학과' : '대림대학교 스마트소프트웨어학과 · 2026 캡스톤 디자인';
      const w1 = ctx.measureText(line1).width;
      const markS = Cr.size * 1.5;
      const x1 = W / 2 - (w1 + markS + 16) / 2;
      if (assets.markLight) ctx.drawImage(assets.markLight, x1, Cr.y1 - markS * 0.78 + (1 - k) * 12, markS, markS);
      ctx.fillStyle = C.ink;
      ctx.fillText(line1, x1 + markS + 16, Cr.y1 + (1 - k) * 12);
      ctx.textAlign = 'center';
      ctx.fillStyle = C.ink2;
      const line2 = tall ? '2026 캡스톤 디자인 · 이강현 전범수 황재준' : '이강현    전범수    황재준';
      ctx.fillText(line2, W / 2, Cr.y2 + (1 - k) * 12);
      ctx.restore();
    }
  }

  /* ── 한 프레임 ── */
  function draw(t) {
    t = clamp(t, 0, DURATION - 1e-6);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(bgCanvas, 0, 0);
    const B = L.board;
    if (t < FINAL.appear) {
      // 기계: 2~8초에 불량 쪽으로 아주 조금 다가가고, 10.4초부터 HMI 카메라 화면으로 줄어들며 사라진다
      const push = 1 + 0.045 * E.inOutSine(prog(t, 2.0, 7.0)) * (1 - E.inOutCubic(prog(t, 7.8, 8.6)));
      const shrink = E.inOutCubic(prog(t, 10.4, 10.9));
      const g = hmiGeom();
      const sc = lerp(1, g.cam.w / W, shrink) * push;
      const fx = W / 2, fy = L.beltY - L.part / 2;
      const tx = lerp(fx, g.cam.x + g.cam.w / 2, shrink), ty = lerp(fy, g.cam.y + g.cam.h * 0.62, shrink);
      if (shrink > 0) drawHmi(t, E.outCubic(prog(t, 10.5, 10.9)));
      ctx.save();
      ctx.globalAlpha = 1 - E.inCubic(prog(t, 10.45, 10.7));
      ctx.translate(tx, ty);
      ctx.scale(sc, sc);
      ctx.translate(-fx, -fy);
      if (ctx.globalAlpha > 0) drawMachine(t);
      ctx.restore();
      // 1.5~2초: 이상 — 화면 테두리에 노란 신호
      const warn = t >= 1.5 && t < 2.6 ? 1 - prog(t, 2.0, 2.6) : 0;
      if (warn > 0) {
        ctx.save();
        ctx.strokeStyle = C.amber;
        ctx.globalAlpha = warn * (0.75 + 0.25 * Math.sin(t * 30));
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, W - 10, H - 10);
        ctx.restore();
      }
      // 판: 10.4초부터 위로 올라가 HMI의 제목줄이 된다
      const capK = E.inOutCubic(prog(t, 10.4, 10.9));
      const scale = lerp(1, L.hmi.capScale, capK);
      let cx = B.cx;
      const cy = lerp(B.cy, L.hmi.capCy, capK);
      const labelSize = lerp(L.label.size, L.label.size * 0.86, capK);
      if (capK > 0) {
        font(labelSize, 600);
        const lw = ctx.measureText('웹 HMI로').width + 24;
        const bw = (B.cw * 4 + B.gap * 3 + B.pad * 2) * scale;
        cx = lerp(B.cx, W / 2 + lw / 2, capK);
        // 판 위의 주어는 잠깐 사라졌다가 판 왼쪽에 다시 나타나 한 줄이 된다: "웹 HMI로 [운전한다]"
        const out = 1 - prog(t, 10.4, 10.5), back = prog(t, 10.72, 10.9);
        ctx.save();
        ctx.fillStyle = C.ink2;
        if (out > 0) {
          font(L.label.size, 600);
          ctx.textAlign = 'center';
          ctx.globalAlpha = out;
          ctx.fillText('웹 HMI로', B.cx, L.label.y);
        }
        if (back > 0) {
          font(L.label.size * 0.86, 600);
          ctx.textAlign = 'right';
          ctx.globalAlpha = back;
          ctx.fillText('웹 HMI로', cx - bw / 2 - 18, cy + L.label.size * 0.86 * 0.36);
        }
        ctx.restore();
      } else {
        drawLabel(t, B.cx, L.label.y, L.label.size);
      }
      drawBoard(t, cx, cy, scale);
    } else {
      drawFinal(t);
      // 타격: 짧게 밝아졌다 사라진다
      const f = 1 - E.outCubic(prog(t, FINAL.appear, FINAL.appear + 0.25));
      if (f > 0) {
        ctx.fillStyle = `rgba(228,231,234,${0.22 * f})`;
        ctx.fillRect(0, 0, W, H);
      }
    }
    ctx.restore();
  }

  return { draw, duration: DURATION };
}
