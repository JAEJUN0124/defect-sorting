// v3 — 소개 영상. 검은 바탕, 가운데 큰 글자, 빛나는 테두리, 한 모양이 다음 모양으로 이어지는 모션그래픽.
// 2D 캔버스로 층과 카드를 그리고, gl.js가 3D로 기울여 겹친 뒤 빛 번짐을 더한다.
// 흐름: 소개합니다 →(정육면체가 구르듯) "불량품 선별 시스템" → 3D 시작 키 → 웹 HMI → 카메라 판정 → 입력창 타이핑
//       → 큰 제목 → 기능 카드 스크롤 → 빛줄기 → 태그라인 → 점 → 학교 마크
// 바탕은 완전한 검정이고, 색은 진한 빨강 · 초록 · 파랑 세 가지를 덩어리로 또렷하게 쓴다.
import { DURATION, SENTENCE, typeTimes, LANDS, VERDICTS, STREAKS, NAME_DRAW, NAME_BLUE } from './timeline.mjs';
import { createCompositor } from './gl.js';

export { DURATION };

/* ── 색과 글꼴 ── */
const SPEC = ['#FF2A3D', '#00D35F', '#2D63FF']; // 빨강 · 초록 · 파랑
const SEAM = ['#FFD000', '#00D8FF', '#B83CFF']; // 두 색이 맞닿는 짧은 이음새 (가운데가 흐려지지 않게)
const GOOD = '#00D35F', BAD = '#FF2A3D';
const INK = '#FFFFFF', INK2 = '#A3AAB8', INK3 = '#5D6472';
const PANEL = '#0D0F15', PANEL2 = '#141822', LINE = '#232836';
const DISPLAY = '"Noto Sans KR", "Malgun Gothic", sans-serif';
const UI = '"IBM Plex Sans KR", "Noto Sans KR", sans-serif';

/* ── 수학 ── */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  inCubic: k => k * k * k,
  outCubic: k => 1 - (1 - k) ** 3,
  inOutCubic: k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  inQuart: k => k ** 4,
  outQuart: k => 1 - (1 - k) ** 4,
  outQuint: k => 1 - (1 - k) ** 5,
  inOutQuart: k => (k < 0.5 ? 8 * k ** 4 : 1 - (-2 * k + 2) ** 4 / 2),
  outExpo: k => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
  inExpo: k => (k <= 0 ? 0 : 2 ** (10 * k - 10)),
  inOutExpo: k => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 2 ** (20 * k - 10) / 2 : (2 - 2 ** (-20 * k + 10)) / 2),
  inOutSine: k => -(Math.cos(Math.PI * k) - 1) / 2,
  outBack: (k, s = 1.7) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2,
};
function spring(dt, freq = 2.2, damp = 0.5) {
  if (dt <= 0) return 0;
  const w = 2 * Math.PI * freq, wd = w * Math.sqrt(1 - damp * damp);
  return 1 - Math.exp(-damp * w * dt) * (Math.cos(wd * dt) + ((damp * w) / wd) * Math.sin(wd * dt));
}
const deg = d => (d * Math.PI) / 180;

/* ── 화면 배치 ── */
const LAYOUT = {
  wide: {
    meetSize: 168, nameSize: 150, nameWeight: 400, nameTrack: 0.14, nameStroke: 2.6, nameCore: 1.1, nameLines: ['불량품 선별 시스템'], face: { w: 1800, h: 300 },
    hmi: { w: 1500, h: 860 }, key: { x: -710, y: -306, w: 420, h: 176 },
    input: { w: 1360, padX: 56, padY: 44, size: 52, lh: 74 },
    lines: ['카메라가 양품과 불량을 가리고,', '로봇팔이 불량품만 골라 옮깁니다.'],
    headSize: 84, headLh: 112, subSize: 34,
    cards: { cols: 2, w: 700, h: 126, gap: 22 },
    pill: { w: 1300, h: 176, size: 64, lines: ['불량을 찾는 눈, 골라내는 손'] },
    mark: 180, endSize: 56, endSize2: 34,
  },
  tall: {
    meetSize: 150, nameSize: 140, nameWeight: 400, nameTrack: 0.14, nameStroke: 2.5, nameCore: 1.1, nameLines: ['불량품', '선별 시스템'], face: { w: 1040, h: 420 },
    hmi: { w: 920, h: 1460 }, key: { x: -420, y: 66, w: 840, h: 176 },
    input: { w: 940, padX: 52, padY: 46, size: 50, lh: 72 },
    lines: ['카메라가 양품과', '불량을 가리고,', '로봇팔이 불량품만', '골라 옮깁니다.'],
    headSize: 92, headLh: 122, subSize: 34,
    cards: { cols: 1, w: 920, h: 132, gap: 20 },
    pill: { w: 900, h: 330, size: 74, lines: ['불량을 찾는 눈,', '골라내는 손'] },
    mark: 230, endSize: 56, endSize2: 34,
  },
};

const FEATURES = [
  ['시작 · 정지', '키 하나로 라인을 켜고 끕니다'],
  ['원점', '수동 모드에서 잡고, 자동에서 복귀'],
  ['옮길 부품', '양품 · 불량품 중에서 고릅니다'],
  ['카메라', '탑뷰 · 그리퍼를 바꿔 봅니다'],
  ['생산 통계', '검사 · 양품 · 불량을 셉니다'],
  ['장치 연결', '서버 · 컨베이어 · 로봇팔 · 카메라'],
  ['로그 · 알림', '고장 · 경고를 이유와 함께'],
  ['밖에서 접속', '웹 주소로 어디서나 엽니다'],
];

// HMI 카메라 화면 속 컨베이어: 시간표의 LANDS마다 한 칸씩 내려앉는다. 마지막(5초)에 오는 부품이 불량
const DEFECT = -LANDS.length;
const beltN = t => LANDS.reduce((n, land) => n + E.inOutQuart(prog(t, land - 0.13, land)), 0);

export function createScene({ ctx, W, H, format = 'wide', assets = {} }) {
  const L = LAYOUT[format];
  const tall = format === 'tall';
  const cx = W / 2, cy = H / 2;
  const comp = createCompositor(W, H);
  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    return [c, c.getContext('2d')];
  };
  const [bgC, bg] = mk(W, H);
  const [mainC, m] = mk(W, H);
  const [tmpC, tmp] = mk(W, H);
  // 정육면체의 두 면: "소개합니다"와 "불량품 선별 시스템"
  const [faceAC, fa] = mk(L.face.w, L.face.h);
  const [faceBC, fb] = mk(L.face.w, L.face.h);
  // 이름 글자: 바깥 윤곽 띠와 가운데 빛줄(심)의 모양, 글자마다 드러난 만큼, 색을 입힐 때 쓰는 판
  const [bandC, bandX] = mk(L.face.w, L.face.h);
  const [coreC, coreX] = mk(L.face.w, L.face.h);
  const [revealC, rc] = mk(L.face.w, L.face.h);
  const [paintAC, paintA] = mk(L.face.w, L.face.h);
  const [paintBC, paintB] = mk(L.face.w, L.face.h);
  // 3D 카드: 시작 키(2배 해상도), HMI 화면(1.5배)
  const KEY_RES = 2, KEY_PAD = 70;
  const [keyC, kc] = mk((L.key.w + KEY_PAD * 2) * KEY_RES, (L.key.h + KEY_PAD * 2) * KEY_RES);
  const HMI_RES = 1.5;
  const [hmiC, hc] = mk(L.hmi.w * HMI_RES, L.hmi.h * HMI_RES);
  const TYPE = typeTimes();
  const D = H / 2 / Math.tan(deg(20)); // 초점 거리 (세로 화각 40°)

  /* ── 그리기 도구 ── */
  const rr = (c, x, y, w, h, r) => {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  };
  const font = (c, size, weight = 700, family = DISPLAY) => {
    c.font = `${weight} ${size}px ${family}`;
  };
  // 색 테두리: 빨강 · 초록 · 파랑 세 덩어리가 도는 원뿔 그라디언트. 이음새만 짧게 섞인다
  function rgbConic(c, angle, x, y) {
    const g = c.createConicGradient(angle, x, y);
    const n = SPEC.length, e = 0.03;
    for (let i = 0; i < n; i++) {
      g.addColorStop(i / n + (i ? e : 0), SPEC[i]);
      g.addColorStop((i + 1) / n - e, SPEC[i]);
      g.addColorStop(i === n - 1 ? 0.9999 : (i + 1) / n, SEAM[i]);
    }
    return g;
  }
  function auroraRim(c, x, y, w, h, r, lw, angle, glow = 8, alpha = 1) {
    c.save();
    c.strokeStyle = rgbConic(c, angle, x + w / 2, y + h / 2);
    if (glow > 0) {
      c.globalAlpha = alpha * 0.8;
      c.filter = `blur(${glow}px)`;
      c.lineWidth = lw * 2.6;
      rr(c, x, y, w, h, r);
      c.stroke();
      c.filter = 'none';
    }
    c.globalAlpha = alpha;
    c.lineWidth = lw;
    rr(c, x, y, w, h, r);
    c.stroke();
    c.restore();
  }
  // 빨강 · 초록 · 파랑 띠 (x0~x1). 흰 글자 위를 쓸고 지나갈 때 쓴다
  function rgbBand(c, x0, x1) {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.1, SPEC[0]);
    g.addColorStop(0.3, SPEC[0]);
    g.addColorStop(0.36, SPEC[1]);
    g.addColorStop(0.62, SPEC[1]);
    g.addColorStop(0.68, SPEC[2]);
    g.addColorStop(0.9, SPEC[2]);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    return g;
  }
  // 글자를 한 줄씩 가운데에 (각 줄의 x는 왼쪽 끝)
  function centeredLines(c, lines, size, lh, ccx, ccy, weight = 700, family = DISPLAY) {
    font(c, size, weight, family);
    const total = (lines.length - 1) * lh;
    return lines.map((line, i) => ({ text: line, w: c.measureText(line).width, x: ccx - c.measureText(line).width / 2, y: ccy - total / 2 + i * lh }));
  }

  /* ── 3D: 그룹(시작 키 + HMI)의 변환과 투영 ── */
  function clipOf([x, y, z]) {
    const vz = z + D;
    return [((x - cx) * D) / (W / 2), (-(y - cy) * D) / (H / 2), 0, vz];
  }
  function rotate([x, y, z], rx, ry, rz) {
    let y1 = y * Math.cos(rx) - z * Math.sin(rx), z1 = y * Math.sin(rx) + z * Math.cos(rx);
    let x2 = x * Math.cos(ry) + z1 * Math.sin(ry), z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
    return [x2 * Math.cos(rz) - y1 * Math.sin(rz), x2 * Math.sin(rz) + y1 * Math.cos(rz), z2];
  }
  const keyCenter = [L.key.x + L.key.w / 2, L.key.y + L.key.h / 2];
  function groupAt(t) {
    // 2.5~3.0 날아옴, 3.0 눌림, 3.0~3.5 천천히 돌며 멈춤, 3.5~4.0 물러나며 HMI 전체가 바로 섬
    const sKey = (W * (tall ? 0.86 : 0.6)) / L.key.w;
    const kIn = E.outQuart(prog(t, 2.5, 3.0));
    const kRot = E.outCubic(prog(t, 2.5, 3.35));
    const drift = E.inOutSine(prog(t, 3.0, 3.5));
    const out = E.inOutCubic(prog(t, 3.5, 4.0));
    let rx = lerp(deg(-72), deg(-18), kRot), ry = lerp(deg(48), deg(-12), kRot), rz = lerp(deg(-22), deg(4), kRot);
    rx = lerp(rx, deg(-8), drift);
    ry = lerp(ry, deg(-5), drift);
    rz = lerp(rz, deg(1), drift);
    const Z = lerp(3400, 0, kIn);
    const hmiS = Math.min((W * 0.86) / L.hmi.w, (H * 0.86) / L.hmi.h);
    const s = lerp(sKey, hmiS, out) * (1 + 0.03 * E.inOutSine(prog(t, 4.0, 5.0)));
    return {
      s,
      P: [lerp(keyCenter[0], 0, out), lerp(keyCenter[1], 0, out)],
      rx: lerp(rx, 0, out), ry: lerp(ry, 0, out), rz: lerp(rz, 0, out),
      Z: Z * (1 - out),
    };
  }
  const worldOf = (g, [x, y]) => {
    const r = rotate([(x - g.P[0]) * g.s, (y - g.P[1]) * g.s, 0], g.rx, g.ry, g.rz);
    return [cx + r[0], cy + r[1], g.Z + r[2]];
  };
  const rectClip = (g, x, y, w, h) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(p => clipOf(worldOf(g, p)));
  // HMI가 바로 선 뒤(4초~) 화면 위의 자리: 확대만 있으므로 단순 계산
  const flatRect = (g, x, y, w, h) => ({ x: cx + (x - g.P[0]) * g.s, y: cy + (y - g.P[1]) * g.s, w: w * g.s, h: h * g.s });

  /* ── 시작 키 카드 ── */
  function drawKeyCard(t) {
    const c = kc, S = KEY_RES;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, keyC.width, keyC.height);
    c.setTransform(S, 0, 0, S, KEY_PAD * S, KEY_PAD * S);
    const { w, h } = L.key, r = h / 2;
    const press = t >= 2.95 && t < 3.25 ? Math.sin(prog(t, 2.95, 3.25) * Math.PI) : 0;
    const flash = t >= 3.0 ? Math.exp(-(t - 3.0) * 6) : 0;
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(1 - 0.05 * press, 1 - 0.05 * press);
    c.translate(-w / 2, -h / 2);
    // 유리처럼 반들거리는 검은 몸통
    const body = c.createLinearGradient(0, 0, 0, h);
    body.addColorStop(0, '#2A2F3B');
    body.addColorStop(0.5, '#12151C');
    body.addColorStop(1, '#07080C');
    c.fillStyle = body;
    rr(c, 0, 0, w, h, r);
    c.fill();
    const shine = c.createLinearGradient(0, 0, 0, h * 0.5);
    shine.addColorStop(0, 'rgba(255,255,255,0.22)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = shine;
    rr(c, 6, 4, w - 12, h * 0.5, [r - 6, r - 6, 20, 20]);
    c.fill();
    auroraRim(c, 2, 2, w - 4, h - 4, r - 2, 4 + 3 * flash, t * 1.8, 12 + 10 * flash, 0.9 + 0.1 * flash);
    // 재생 표시와 "시작"
    const icx = r, icy = h / 2;
    c.fillStyle = flash > 0.05 ? GOOD : 'rgba(255,255,255,0.12)';
    c.beginPath();
    c.arc(icx, icy, h * 0.3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = flash > 0.05 ? '#06140F' : INK;
    c.beginPath();
    c.moveTo(icx - h * 0.08, icy - h * 0.13);
    c.lineTo(icx + h * 0.14, icy);
    c.lineTo(icx - h * 0.08, icy + h * 0.13);
    c.closePath();
    c.fill();
    font(c, h * 0.38, 700);
    c.fillStyle = INK;
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillText('시작', (r * 1.9 + w) / 2, h / 2 + 2);
    c.textAlign = 'left';
    c.restore();
  }

  /* ── HMI 카드 ── */
  const hmiRects = () => {
    const { w, h } = L.hmi;
    const x0 = -w / 2, y0 = -h / 2;
    if (!tall) {
      return {
        cam: { x: x0 + 500, y: y0 + 120, w: 960, h: 540 },
        stats: { x: x0 + 500, y: y0 + 690, w: 960, h: 130 },
        estop: { x: x0 + 40, y: y0 + 330, w: 420, h: 150 },
        toggles: { x: x0 + 40, y: y0 + 520, w: 420 },
      };
    }
    return {
      cam: { x: x0 + 40, y: y0 + 130, w: 840, h: 472 },
      stats: { x: x0 + 40, y: y0 + 630, w: 840, h: 130 },
      estop: { x: x0 + 40, y: y0 + 1010, w: 840, h: 150 },
      toggles: { x: x0 + 40, y: y0 + 1200, w: 840 },
    };
  };
  function drawTopView(c, r, t, o = {}) {
    // 위에서 본 띠와 부품. o.boxes면 판정 상자를 그린다
    c.save();
    rr(c, r.x, r.y, r.w, r.h, o.radius ?? 16);
    c.clip();
    c.fillStyle = '#05060A';
    c.fillRect(r.x, r.y, r.w, r.h);
    const u = Math.min(r.w / 16, r.h / 9);
    const bandH = u * 4.2, by = r.y + r.h / 2 - bandH / 2;
    const band = c.createLinearGradient(0, by, 0, by + bandH);
    band.addColorStop(0, '#171B25');
    band.addColorStop(0.5, '#1E2330');
    band.addColorStop(1, '#171B25');
    c.fillStyle = band;
    c.fillRect(r.x, by, r.w, bandH);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    const n = beltN(t);
    const pitch = u * 3.6, s = u * 2.4;
    for (let x = ((n * pitch) % (u * 0.9)) - u; x < r.w + u; x += u * 0.9) c.fillRect(r.x + x, by + 4, 2, bandH - 8);
    const mid = r.x + r.w / 2;
    for (let k = -16; k <= 6; k++) {
      const x = mid + (k + n) * pitch;
      if (x < r.x - s || x > r.x + r.w + s) continue;
      const y = r.y + r.h / 2;
      c.fillStyle = 'rgba(0,0,0,0.45)';
      rr(c, x - s / 2 + u * 0.12, y - s / 2 + u * 0.18, s, s, s * 0.16);
      c.fill();
      const pg = c.createLinearGradient(x - s / 2, y - s / 2, x + s / 2, y + s / 2);
      pg.addColorStop(0, '#F2F5F9');
      pg.addColorStop(1, '#C9D0DA');
      c.fillStyle = pg;
      rr(c, x - s / 2, y - s / 2, s, s, s * 0.16);
      c.fill();
      if (k === DEFECT) {
        c.strokeStyle = '#3A2028';
        c.lineWidth = Math.max(2, s * 0.035);
        c.beginPath();
        [[0.28, -0.32], [0.05, -0.06], [0.16, 0.06], [-0.12, 0.3]].forEach(([a, b], i) => (i ? c.lineTo(x + a * s, y + b * s) : c.moveTo(x + a * s, y + b * s)));
        c.stroke();
      }
    }
    // 검사 자리
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.setLineDash([u * 0.3, u * 0.3]);
    c.lineWidth = Math.max(1.5, u * 0.05);
    c.strokeRect(mid - s * 0.78, r.y + r.h / 2 - s * 0.78, s * 1.56, s * 1.56);
    c.setLineDash([]);
    if (o.boxes) {
      for (const [at, good] of VERDICTS) {
        const a = t >= at && (good ? t < at + 0.22 : true) ? 1 : 0;
        if (!a) continue;
        const pop = E.outBack(prog(t, at, at + 0.12), 2.2);
        const bw = s * lerp(1.9, 1.3, pop);
        const col = good ? GOOD : BAD;
        c.save();
        c.globalAlpha = o.boxAlpha ?? 1;
        c.strokeStyle = col;
        c.lineWidth = u * 0.12;
        rr(c, mid - bw / 2, r.y + r.h / 2 - bw / 2, bw, bw, u * 0.25);
        c.stroke();
        const label = good ? '양품' : '불량';
        font(c, u * 0.62, 800);
        const lw = c.measureText(label).width + u * 0.7;
        c.fillStyle = col;
        rr(c, mid - lw / 2, r.y + r.h / 2 - bw / 2 - u * 1.25, lw, u * 0.95, u * 0.3);
        c.fill();
        c.fillStyle = good ? '#04140F' : '#FFFFFF';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, mid, r.y + r.h / 2 - bw / 2 - u * 0.77);
        c.restore();
      }
    }
    c.restore();
  }
  function drawHmiCard(t) {
    const c = hc, S = HMI_RES, { w, h } = L.hmi;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, hmiC.width, hmiC.height);
    c.setTransform(S, 0, 0, S, (w / 2) * S, (h / 2) * S);
    const x0 = -w / 2, y0 = -h / 2;
    c.fillStyle = PANEL;
    rr(c, x0, y0, w, h, 34);
    c.fill();
    c.strokeStyle = LINE;
    c.lineWidth = 2;
    c.stroke();
    // 머리줄
    font(c, 28, 600, UI);
    c.textBaseline = 'middle';
    c.fillStyle = INK;
    c.fillText('불량품 선별 HMI', x0 + 40, y0 + 62);
    const pillW = 230;
    c.fillStyle = 'rgba(46,242,182,0.12)';
    rr(c, x0 + w - 40 - pillW, y0 + 36, pillW, 52, 26);
    c.fill();
    c.fillStyle = GOOD;
    c.beginPath();
    c.arc(x0 + w - 40 - pillW + 30, y0 + 62, 8, 0, Math.PI * 2);
    c.fill();
    font(c, 24, 600, UI);
    c.fillText('자동 운전 중', x0 + w - 40 - pillW + 50, y0 + 63);
    if (!tall) {
      font(c, 19, 500, UI);
      let dx = x0 + 330;
      for (const name of ['서버', '컨베이어', '로봇팔', '리더암', '카메라']) {
        c.fillStyle = GOOD;
        c.beginPath();
        c.arc(dx, y0 + 62, 6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = INK2;
        c.fillText(name, dx + 14, y0 + 63);
        dx += c.measureText(name).width + 46;
      }
    }
    const R = hmiRects();
    // 카메라 화면 (시간에 따라 움직임)
    drawTopView(c, R.cam, t, { radius: 18 });
    font(c, 18, 600, UI);
    let chipX = R.cam.x + 18;
    for (const [label, on] of [['탑뷰', true], ['그리퍼', false]]) {
      const cw = c.measureText(label).width + 30;
      c.fillStyle = on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
      rr(c, chipX, R.cam.y + 16, cw, 38, 19);
      c.fill();
      c.fillStyle = on ? INK : INK2;
      c.fillText(label, chipX + 15, R.cam.y + 36);
      chipX += cw + 8;
    }
    // 통계
    const sw = (R.stats.w - 24) / 3;
    [['검사', 44, INK], ['양품', 41, GOOD], ['불량', 3, BAD]].forEach(([label, v, col], i) => {
      const x = R.stats.x + i * (sw + 12);
      c.fillStyle = PANEL2;
      rr(c, x, R.stats.y, sw, R.stats.h, 18);
      c.fill();
      font(c, 20, 600, UI);
      c.fillStyle = INK2;
      c.fillText(label, x + 24, R.stats.y + 34);
      font(c, 48, 600, UI);
      c.fillStyle = col;
      c.fillText(String(v), x + 24, R.stats.y + 88);
    });
    // 긴급정지
    const es = R.estop;
    c.fillStyle = PANEL2;
    rr(c, es.x, es.y, es.w, es.h, 22);
    c.fill();
    c.fillStyle = 'rgba(255,61,110,0.18)';
    c.beginPath();
    c.arc(es.x + 75, es.y + es.h / 2, 52, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = BAD;
    c.beginPath();
    c.arc(es.x + 75, es.y + es.h / 2, 38, 0, Math.PI * 2);
    c.fill();
    font(c, 28, 700, UI);
    c.fillStyle = INK;
    c.fillText('긴급정지', es.x + 150, es.y + es.h / 2 - 12);
    font(c, 19, 500, UI);
    c.fillStyle = INK2;
    c.fillText('누르면 라인이 바로 멈춥니다', es.x + 150, es.y + es.h / 2 + 22);
    // 운전 모드 · 옮길 부품
    const tg = R.toggles;
    const toggle = (y, title, items, sel) => {
      font(c, 19, 600, UI);
      c.fillStyle = INK2;
      c.fillText(title, tg.x + 4, y);
      const iw = (tg.w - 10) / items.length;
      items.forEach((it, i) => {
        const x = tg.x + i * (iw + 10);
        c.fillStyle = i === sel ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)';
        rr(c, x, y + 20, iw, 58, 16);
        c.fill();
        if (i === sel) {
          c.strokeStyle = 'rgba(255,255,255,0.6)';
          c.lineWidth = 2;
          c.stroke();
        }
        font(c, 23, 600, UI);
        c.fillStyle = i === sel ? INK : INK2;
        c.textAlign = 'center';
        c.fillText(it, x + iw / 2, y + 50);
        c.textAlign = 'left';
      });
    };
    toggle(tg.y, '운전 모드', ['자동', '수동'], 0);
    toggle(tg.y + 112, '로봇팔이 옮길 부품', ['양품', '불량품'], 1);
    // 시작 키 자리 (키는 따로 그린 카드가 덮는다)
    c.fillStyle = 'rgba(255,255,255,0.03)';
    rr(c, L.key.x, L.key.y, L.key.w, L.key.h, L.key.h / 2);
    c.fill();
  }

  /* ── 장면 조각 ── */
  // 0~2초: "소개합니다"가 적힌 면이 정육면체처럼 위로 굴러 넘어가고 "불량품 선별 시스템" 면이 앞에 선다
  function drawFaceA(t) {
    const F = L.face, size = L.meetSize;
    fa.clearRect(0, 0, F.w, F.h);
    font(fa, size, 800);
    fa.textBaseline = 'middle';
    fa.fillStyle = INK;
    const chars = [...'소개합니다'];
    const widths = chars.map(ch => fa.measureText(ch).width);
    const gap = size * 0.02;
    let x = F.w / 2 - (widths.reduce((p, q) => p + q, 0) + gap * (chars.length - 1)) / 2;
    chars.forEach((ch, i) => {
      // 글자마다 아래에서 올라온다 (첫 프레임부터 움직이고 있다)
      const k = E.outExpo(prog(t, -0.18 + i * 0.06, 0.32 + i * 0.06));
      fa.globalAlpha = clamp(k * 1.4);
      fa.fillText(ch, x, F.h / 2 + (1 - k) * size * 0.7);
      x += widths[i] + gap;
    });
    fa.globalAlpha = 1;
  }
  // "불량품 선별 시스템": 레퍼런스처럼 가는 관(튜브) 같은 윤곽선 글자.
  // 글자(음절)마다 한 색이고, 빛이 윤곽을 따라 돌며 그려진 뒤 2초 박에 모두 파란빛이 된다.
  // 한글 글꼴은 한 글자 안의 자모 윤곽이 서로 겹쳐 있어, 굵은 선을 그린 뒤 채운 글자 모양으로 안쪽을 지워 바깥 윤곽만 남긴다
  const NAME_COLORS = [SPEC[0], SPEC[2], SPEC[1]];
  const lighten = (hex, k) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return `rgb(${c.map(v => Math.round(v + (255 - v) * k)).join(',')})`;
  };
  let glyphs = null;
  function nameGlyphs() {
    if (glyphs) return glyphs;
    const F = L.face;
    font(bandX, L.nameSize, L.nameWeight);
    const track = L.nameSize * L.nameTrack;
    glyphs = [];
    L.nameLines.forEach((line, li) => {
      const chars = [...line];
      const widths = chars.map(ch => bandX.measureText(ch).width);
      const total = widths.reduce((p, q) => p + q, 0) + track * (chars.length - 1);
      let x = F.w / 2 - total / 2;
      const y = F.h / 2 + (li - (L.nameLines.length - 1) / 2) * L.nameSize * 1.25;
      chars.forEach((ch, i) => {
        if (ch !== ' ') glyphs.push({ ch, x, y, w: widths[i] });
        x += widths[i] + track;
      });
    });
    // 바깥 윤곽 띠와 심은 글자가 바뀌지 않으므로 한 번만 만든다
    for (const [c, lw] of [[bandX, L.nameStroke], [coreX, L.nameCore]]) {
      c.clearRect(0, 0, F.w, F.h);
      font(c, L.nameSize, L.nameWeight);
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.strokeStyle = '#FFFFFF';
      c.fillStyle = '#FFFFFF';
      c.lineWidth = lw * 2;
      for (const g of glyphs) c.strokeText(g.ch, g.x, g.y);
      c.globalCompositeOperation = 'destination-out';
      for (const g of glyphs) c.fillText(g.ch, g.x, g.y);
      c.globalCompositeOperation = 'source-over';
    }
    return glyphs;
  }
  const glyphBox = g => [g.x - g.w * 0.25, g.y - L.nameSize * 0.8, g.w * 1.5, L.nameSize * 1.6];
  function drawFaceB(t) {
    const F = L.face;
    const gs = nameGlyphs();
    const blue = t >= NAME_BLUE;
    const flash = blue ? Math.exp(-(t - NAME_BLUE) * 8) : 0;
    // 글자마다 빛이 윤곽을 따라 한 바퀴 돌며 드러난다 (위에서 시작해 시계 방향)
    rc.clearRect(0, 0, F.w, F.h);
    rc.fillStyle = '#FFFFFF';
    gs.forEach((g, i) => {
      const t0 = NAME_DRAW.start + i * NAME_DRAW.stagger;
      const k = E.inOutSine(prog(t, t0, t0 + NAME_DRAW.dur));
      if (k <= 0) return;
      const [bx, by, bw, bh] = glyphBox(g);
      rc.save();
      rc.beginPath();
      rc.rect(bx, by, bw, bh);
      rc.clip();
      rc.beginPath();
      rc.moveTo(g.x + g.w / 2, g.y);
      rc.arc(g.x + g.w / 2, g.y, L.nameSize * 1.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      rc.closePath();
      rc.fill();
      rc.restore();
    });
    // 모양(띠 · 심)에 글자마다 색을 입히고, 드러난 만큼만 남긴다
    const paint = (c, cv, shape, colorOf) => {
      c.clearRect(0, 0, F.w, F.h);
      gs.forEach((g, i) => {
        c.fillStyle = colorOf(i);
        c.fillRect(...glyphBox(g));
      });
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(shape, 0, 0);
      c.drawImage(revealC, 0, 0);
      c.globalCompositeOperation = 'source-over';
      return cv;
    };
    const colorOf = i => (blue ? SPEC[2] : NAME_COLORS[i % NAME_COLORS.length]);
    const band = paint(paintA, paintAC, bandC, colorOf);
    const core = paint(paintB, paintBC, coreC, i => lighten(colorOf(i), 0.72 + 0.2 * flash));
    fb.clearRect(0, 0, F.w, F.h);
    fb.save();
    fb.filter = 'blur(16px)';
    fb.globalAlpha = 1;
    fb.drawImage(band, 0, 0);
    fb.drawImage(band, 0, 0);
    fb.filter = 'blur(5px)';
    fb.globalAlpha = 0.9 + 0.1 * flash;
    fb.drawImage(band, 0, 0);
    fb.restore();
    fb.drawImage(band, 0, 0);
    fb.drawImage(core, 0, 0);
  }
  function cubeIntro(t) {
    if (t >= 2.52) return;
    const F = L.face, w2 = F.w / 2, h2 = F.h / 2;
    // 1.25~1.5 굴러 넘어가 1.5 박에 닿고, 살짝 흔들리다 선다. 2.35~2.5 앞으로 빠지며 사라진다
    const k = E.inOutCubic(prog(t, 1.25, 1.5));
    const settle = t > 1.5 ? Math.exp(-(t - 1.5) * 14) * Math.sin((t - 1.5) * 38) * deg(5) : 0;
    const th = -deg(90) * k + settle;
    const out = E.inCubic(prog(t, 2.35, 2.5));
    const zc = h2 - out * D * 0.7;
    const place = p => {
      const r = rotate(p, th, 0, 0);
      return clipOf([cx + r[0], cy + r[1], zc + r[2]]);
    };
    const faceA = [[-w2, -h2, -h2], [w2, -h2, -h2], [-w2, h2, -h2], [w2, h2, -h2]];
    const faceB = [[-w2, h2, -h2], [w2, h2, -h2], [-w2, h2, h2], [w2, h2, h2]];
    // 돌아가며 기울어지는 면은 어두워진다
    const aA = Math.max(0, Math.cos(th)) ** 0.8, aB = Math.max(0, Math.sin(-th)) ** 0.8;
    if (aA > 0.01) {
      drawFaceA(t);
      comp.card(faceAC, faceA.map(place), aA);
    }
    if (aB > 0.01) {
      drawFaceB(t);
      comp.card(faceBC, faceB.map(place), aB * (1 - out));
    }
  }

  // 3~5초: 3D 시작 키와 HMI
  function threeD(t, g) {
    if (t < 2.5 || t >= 5.37) return null;
    const hmiA = clamp(prog(t, 3.45, 3.85)) * (1 - E.inCubic(prog(t, 5.15, 5.35)));
    if (hmiA > 0) {
      drawHmiCard(t);
      const { w, h } = L.hmi;
      comp.card(hmiC, rectClip(g, -w / 2, -h / 2, w, h), hmiA);
    }
    drawKeyCard(t);
    const k = L.key;
    const keyA = clamp(prog(t, 2.5, 2.6)) * (1 - E.inCubic(prog(t, 5.15, 5.35)));
    comp.card(keyC, rectClip(g, k.x - KEY_PAD, k.y - KEY_PAD, k.w + KEY_PAD * 2, k.h + KEY_PAD * 2), keyA);
    return hmiA;
  }

  // 4.2~5.2초: HMI 카메라 화면이 커져 판정을 보이고, 불량 상자가 입력창이 된다
  function camRectAt(t, g) {
    const R = hmiRects();
    const from = flatRect(g, R.cam.x, R.cam.y, R.cam.w, R.cam.h);
    const k = E.inOutCubic(prog(t, 5.0, 5.35));
    const to = { x: 0, y: 0, w: W, h: H };
    return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), w: lerp(from.w, to.w, k), h: lerp(from.h, to.h, k), k };
  }
  function detect(t, g) {
    if (t < 5.0 || t >= 6.72) return;
    const r = camRectAt(t, g);
    const fade = 1 - E.outCubic(prog(t, 6.5, 6.7));
    m.save();
    m.globalAlpha = fade;
    drawTopView(m, r, t, { radius: lerp(18 * g.s, 0, r.k), boxes: true, boxAlpha: t < 6.5 ? 1 : 0 });
    m.restore();
  }

  // 입력창: 불량 상자에서 바뀌어 커지고, 문장이 쳐진다
  const IN = L.input;
  function typedCount(t) {
    let n = 0;
    for (const tt of TYPE) if (t >= tt) n++;
    return n;
  }
  // 문장을 줄로 나눈 자리: [줄 번호][그 줄의 시작 글자 번호]
  const lineStarts = (() => {
    const starts = [];
    let i = 0;
    for (const line of L.lines) {
      starts.push(i);
      i += [...line].length + 1; // 줄 사이 띄어쓰기 하나
    }
    return starts;
  })();
  function inputLayout(t) {
    const n = typedCount(t);
    let lines = 1;
    for (let i = 1; i < lineStarts.length; i++) if (n > lineStarts[i]) lines = i + 1;
    const growK = (() => {
      // 새 줄이 생기면 높이가 부드럽게 늘어난다
      let target = 1;
      for (let i = 1; i < lineStarts.length; i++) {
        const tt = TYPE[lineStarts[i]] ?? 99;
        target += E.outCubic(prog(t, tt, tt + 0.12));
      }
      return target;
    })();
    const h = IN.padY * 2 + IN.lh * growK - (IN.lh - IN.size) * 0.4;
    return { x: cx - IN.w / 2, y: cy - h / 2, w: IN.w, h, n, lines };
  }
  function typing(t) {
    if (t < 6.5 || t >= 9.36) return;
    const box = inputLayout(t);
    const k = E.outCubic(prog(t, 6.5, 6.7));
    // 판정 상자(화면 가운데 부품)에서 커진다
    const u = Math.min(W / 16, H / 9), s0 = u * 2.4 * 1.3;
    const r = { x: lerp(cx - s0 / 2, box.x, k), y: lerp(cy - s0 / 2, box.y, k), w: lerp(s0, box.w, k), h: lerp(s0, box.h, k) };
    const gone = E.inCubic(prog(t, 9.0, 9.3));
    m.save();
    m.globalAlpha = 1 - gone;
    m.fillStyle = 'rgba(10,12,18,0.96)';
    rr(m, r.x, r.y, r.w, r.h, lerp(u * 0.25, 40, k));
    m.fill();
    const flash = t >= 8.9 ? Math.exp(-(t - 8.9) * 10) : 0;
    const rimColor = k < 0.5 ? BAD : null;
    if (rimColor) {
      m.strokeStyle = BAD;
      m.lineWidth = u * 0.12;
      rr(m, r.x, r.y, r.w, r.h, u * 0.25);
      m.stroke();
    }
    auroraRim(m, r.x, r.y, r.w, r.h, lerp(u * 0.25, 40, k), 3 + 3 * flash, t * 2.2, 14 + 10 * flash, clamp(k * 2 - 0.4));
    m.restore();
    if (k < 1) return;
    if (gone > 0) return; // 7초부터는 제목으로 넘어간다
    drawTyped(m, t, box);
  }
  function drawTyped(c, t, box) {
    const n = box.n;
    font(c, IN.size, 500);
    c.textBaseline = 'middle';
    c.fillStyle = INK;
    let lastX = box.x + IN.padX, lastY = box.y + IN.padY + IN.size * 0.5;
    L.lines.forEach((line, i) => {
      const start = lineStarts[i];
      const shown = clamp(n - start, 0, [...line].length);
      if (shown <= 0) return;
      const text = [...line].slice(0, shown).join('');
      const x = box.x + IN.padX, y = box.y + IN.padY + IN.size * 0.5 + i * IN.lh;
      c.fillText(text, x, y);
      lastX = x + c.measureText(text).width + 4;
      lastY = y;
    });
    // 깜빡이는 커서 (치는 동안은 켜짐)
    const typingNow = t < TYPE[TYPE.length - 1] + 0.1;
    if (typingNow || Math.floor(t * 2.6) % 2 === 0) {
      c.fillStyle = SPEC[2];
      c.fillRect(lastX, lastY - IN.size * 0.55, 4, IN.size * 1.1);
    }
  }

  // 7~9.75초: 큰 제목, 색이 쓸고 지나감, 그리고 기능 카드가 스크롤
  function scrollAt(t) {
    const cardsH = Math.ceil(FEATURES.length / L.cards.cols) * (L.cards.h + L.cards.gap);
    const bring = H * 0.62 + cardsH * 0.35; // 카드가 화면 가운데에 오는 거리
    const away = H + cardsH; // 다 지나가는 거리
    const a = E.inOutCubic(prog(t, 11.0, 11.5)) * bring;
    const b = E.inOutSine(prog(t, 11.5, 12.75)) * H * 0.03;
    const c2 = E.inQuart(prog(t, 12.75, 13.28)) * (away - bring - H * 0.03);
    return a + b + c2;
  }
  function headline(t) {
    if (t < 9.0 || t >= 13.3) return;
    const box = inputLayout(8.99);
    const k = E.inOutCubic(prog(t, 9.0, 9.34));
    const scroll = scrollAt(t);
    const head = centeredLines(m, L.lines, L.headSize, L.headLh, cx, cy - (tall ? 40 : 30), 800);
    tmp.clearRect(0, 0, W, H);
    tmp.textBaseline = 'middle';
    L.lines.forEach((line, i) => {
      const x0 = box.x + IN.padX, y0 = box.y + IN.padY + IN.size * 0.5 + i * IN.lh;
      const size = lerp(IN.size, L.headSize, k);
      font(tmp, size, Math.round(lerp(500, 800, k)));
      tmp.fillStyle = INK;
      const x = lerp(x0, head[i].x, k), y = lerp(y0, head[i].y, k) - scroll;
      tmp.fillText(line, x, y);
    });
    // 색이 왼쪽에서 오른쪽으로 쓸고 지나간다
    const sw = prog(t, 9.34, 10.1);
    if (sw > 0 && sw < 1) {
      const span = W * 0.9;
      const sx = lerp(cx - span, cx + span, E.inOutSine(sw));
      tmp.globalCompositeOperation = 'source-atop';
      tmp.fillStyle = rgbBand(tmp, sx - 560, sx + 560);
      tmp.fillRect(0, 0, W, H);
      tmp.globalCompositeOperation = 'source-over';
    }
    m.drawImage(tmpC, 0, 0);
    // 밑줄: 시스템 구성
    const sk = E.outCubic(prog(t, 9.55, 9.95));
    if (sk > 0) {
      m.save();
      m.globalAlpha = sk;
      font(m, L.subSize, 500, UI);
      m.textAlign = 'center';
      m.textBaseline = 'middle';
      m.fillStyle = INK2;
      const last = head[head.length - 1].y;
      m.fillText('웹 HMI  ·  카메라 2대  ·  서버  ·  로봇팔  ·  컨베이어', cx, last + L.headLh * 0.95 + (1 - sk) * 20 - scroll);
      m.restore();
    }
    // 기능 카드
    if (t >= 10.9) {
      const C = L.cards;
      const totalW = C.cols * C.w + (C.cols - 1) * 28;
      const top = H + 60 - scroll;
      FEATURES.forEach(([title, desc], i) => {
        const col = i % C.cols, row = Math.floor(i / C.cols);
        const x = cx - totalW / 2 + col * (C.w + 28), y = top + row * (C.h + C.gap);
        if (y > H + 20 || y + C.h < -20) return;
        m.fillStyle = PANEL;
        rr(m, x, y, C.w, C.h, 26);
        m.fill();
        m.strokeStyle = LINE;
        m.lineWidth = 2;
        m.stroke();
        const icx = x + 64, icy = y + C.h / 2;
        m.fillStyle = SPEC[i % SPEC.length];
        m.beginPath();
        m.arc(icx, icy, 32, 0, Math.PI * 2);
        m.fill();
        font(m, 26, 700, UI);
        m.fillStyle = '#FFFFFF';
        m.textAlign = 'center';
        m.textBaseline = 'middle';
        m.fillText(String(i + 1).padStart(2, '0'), icx, icy + 1);
        m.textAlign = 'left';
        font(m, 38, 700);
        m.fillStyle = INK;
        m.fillText(title, x + 124, y + C.h / 2 - 20);
        font(m, 25, 500, UI);
        m.fillStyle = INK2;
        m.fillText(desc, x + 124, y + C.h / 2 + 24);
      });
    }
  }

  // 9.75~10.5초: 빛줄기
  function streaks(t) {
    if (t < 13.2 || t >= 14.1) return;
    m.save();
    m.globalCompositeOperation = 'lighter';
    for (const [t0, dur, dir, yf, th, ci] of STREAKS) {
      const k = prog(t, t0, t0 + dur);
      if (k <= 0 || k >= 1) continue;
      const head = lerp(-0.3 * W, 1.3 * W, E.inOutSine(k));
      const hx = dir > 0 ? head : W - head;
      const len = W * 0.75;
      const tx = hx - dir * len;
      const y = yf * H;
      const g = m.createLinearGradient(tx, 0, hx, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.75, SPEC[ci]);
      g.addColorStop(1, '#FFFFFF');
      m.fillStyle = g;
      m.beginPath();
      m.roundRect(Math.min(tx, hx), y - th / 2, Math.abs(hx - tx), th, th / 2);
      m.fill();
    }
    m.restore();
  }

  // 10.5~13초: 태그라인 알약 → 점
  function tagline(t) {
    if (t < 13.96 || t >= 16.55) return;
    const P = L.pill;
    const open = E.outExpo(prog(t, 14.0, 14.35));
    const collapse1 = E.inCubic(prog(t, 16.0, 16.22));
    const collapse2 = E.inCubic(prog(t, 16.22, 16.45));
    let w = lerp(P.w * 0.5, P.w, open), h = lerp(8, P.h, open);
    w = lerp(w, P.h, collapse1);
    const d = lerp(P.h, 18, collapse2);
    if (collapse1 >= 1) {
      w = d;
      h = d;
    }
    const x = cx - w / 2, y = cy - h / 2;
    const beat = [14.5, 15.0, 15.5].reduce((a, bt) => a + (t >= bt ? Math.exp(-(t - bt) * 7) : 0), 0);
    m.save();
    m.fillStyle = 'rgba(8,9,14,0.92)';
    rr(m, x, y, w, h, Math.min(w, h) / 2);
    m.fill();
    auroraRim(m, x, y, w, h, Math.min(w, h) / 2, 4 + 2 * beat, t * 1.6, 14 + 10 * beat, 1);
    m.restore();
    const ta = E.outCubic(prog(t, 14.12, 14.48)) * (1 - E.inCubic(prog(t, 15.86, 16.02)));
    if (ta > 0) {
      const lines = centeredLines(m, P.lines, P.size, P.size * 1.28, cx, cy, 700);
      m.save();
      m.globalAlpha = ta;
      m.textBaseline = 'middle';
      m.fillStyle = INK;
      font(m, P.size, 700);
      for (const l of lines) m.fillText(l.text, l.x, l.y + (1 - ta) * 24);
      m.restore();
    }
    // 점이 다 줄어든 뒤 빛나는 알맹이
    if (collapse2 > 0.6) {
      m.save();
      m.fillStyle = '#FFFFFF';
      m.filter = 'blur(6px)';
      m.beginPath();
      m.arc(cx, cy, d * 0.45, 0, Math.PI * 2);
      m.fill();
      m.restore();
    }
  }

  // 13~15초: 학교 마크와 이름
  function ending(t) {
    if (t < 16.48) return;
    const pop = E.outBack(prog(t, 16.5, 16.82), 1.8);
    const ring = prog(t, 16.5, 17.0);
    if (ring > 0 && ring < 1) {
      m.save();
      m.globalAlpha = 1 - ring;
      m.strokeStyle = rgbConic(m, t * 3, cx, cy - (tall ? 140 : 90));
      m.lineWidth = 10 * (1 - ring) + 2;
      m.beginPath();
      m.arc(cx, cy - (tall ? 140 : 90), lerp(20, tall ? 520 : 460, E.outCubic(ring)), 0, Math.PI * 2);
      m.stroke();
      m.restore();
    }
    const ms = L.mark * pop;
    const my = cy - (tall ? 140 : 90);
    if (assets.markLight && ms > 1) {
      m.save();
      m.globalAlpha = clamp(pop * 1.5);
      m.drawImage(assets.markLight, cx - ms / 2, my - ms / 2, ms, ms);
      m.restore();
    }
    const tk = E.outCubic(prog(t, 16.8, 17.3));
    if (tk > 0) {
      m.save();
      m.globalAlpha = tk;
      m.textAlign = 'center';
      m.textBaseline = 'middle';
      font(m, L.endSize, 700);
      m.fillStyle = INK;
      const y1 = my + L.mark / 2 + (tall ? 110 : 90) + (1 - tk) * 20;
      m.fillText('대림대학교 스마트소프트웨어학과', cx, y1);
      font(m, L.endSize2, 500, UI);
      m.fillStyle = INK2;
      m.fillText('2026 캡스톤 디자인  ·  이강현  전범수  황재준', cx, y1 + L.endSize * 1.35);
      m.restore();
    }
  }

  // 바탕: 완전한 검정
  function background() {
    bg.fillStyle = '#000000';
    bg.fillRect(0, 0, W, H);
  }

  /* ── 한 프레임 ── */
  function draw(t) {
    t = clamp(t, 0, DURATION - 1e-6);
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, W, H);
    background(t);
    comp.begin();
    comp.layer(bgC);
    const g = groupAt(t);
    threeD(t, g);
    cubeIntro(t);
    detect(t, g);
    typing(t);
    headline(t);
    streaks(t);
    tagline(t);
    ending(t);
    // 큰 박자(누름 · 제목 · 태그라인 · 마크)마다 화면이 살짝 튀었다 돌아온다
    const punch = [[3.0, 0.035], [9.0, 0.03], [14.0, 0.05], [16.5, 0.04]].reduce((a, [bt, amt]) => a + (t >= bt ? amt * Math.exp(-(t - bt) * 9) : 0), 0)
      + 0.025 * E.inOutSine(prog(t, 9.3, 10.95));
    if (punch > 0.0005) {
      const s = 1 + punch, hw = (W / 2) * s, hh = (H / 2) * s;
      comp.card(mainC, [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx - hw, cy + hh], [cx + hw, cy + hh]].map(p => clipOf([...p, 0])), 1);
    } else comp.layer(mainC);
    const out = comp.end({ bloom: [0.48, 0.3, 0.12], threshold: 0.68, vignette: 0.22 });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(out, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  return { draw, duration: DURATION };
}
