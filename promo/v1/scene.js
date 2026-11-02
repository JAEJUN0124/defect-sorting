// 불량품 선별 프로젝트 홍보 영상 — 한 시각 t(초)의 화면을 캔버스에 그린다.
// 시간표는 ../timeline.json에 있고, 모든 움직임은 t만으로 정해진다(앞 프레임에 기대지 않는다).
// 그래서 어느 프레임이든 따로 그릴 수 있고, 렌더러는 한 프레임 안의 여러 시각을 겹쳐 모션 블러를 만든다.
//
// 막 구성 (timeline.json의 sections와 같다)
//   hook  0~4   똑같은 부품 수백 개가 박자에 맞춰 한 칸씩 움직이고, 하나에만 금이 있다 (3D 들판)
//   eye   4~7   멈춤 → 동심원(카메라의 눈)이 훑다가 불량에 맞춰 오므라든다 → 금 간 곳으로 밀고 들어감
//   hand  7~10  금의 꺾인 선이 갈라지며 로봇팔이 된다 → 불량품을 집어 들어 올림 (옆에서 본 라인)
//   line  10~14 이송·촬영·판정·분류, 12초에 이 장면이 웹 HMI의 카메라 화면이었음이 드러남
//   brand 14~18 포스터 키 비주얼(밤하늘·동심원·카메라·로봇팔·컨베이어) + 제목 + 학교·팀

export const DURATION = 18;

/* ── 색: 포스터 10안(poster/v10/poster.html)에서 가져옴 ── */
const C = { sky: '#051230', navy: '#141A35', coral: '#F48067', rim: '#FEBBAB', pale: '#FFEBE6', blue: '#0095C8' };
const RINGS = [ // [반지름, 색] 바깥 → 안. 모두 검사 자리(0,0)에서 아래쪽이 닿는다
  [174, '#2E2748'], [136, '#533859'], [104, '#7D4965'], [78, '#A95A6B'], [57, '#D26D6B'],
  [40, '#F48067'], [27, '#FCAB99'], [17, '#FFD0C5'], [10, '#FFEEE9'],
];
const REFL = ['#8B545C', '#A05C64', '#B76569', '#CE6D6B', '#E37669', '#F48067', '#F89680', '#FBA996', '#FDB8A8'];
// 웹 HMI 다크 테마 토큰 (hmi-web-mockup/DESIGN.md)
const HMI = {
  plate: '#1E2326', bg: '#262C31', key: '#343C42', screen: '#0E1113', ink: '#E4E7EA', ink2: '#B3BBC2',
  ink3: '#6A737B', line: '#424A51', green: '#34A86E', red: '#C8102E', yellow: '#F2B705', dark: '#1C2024',
};
const FONT = '"Noto Sans KR", "Malgun Gothic", sans-serif';
const UI_FONT = '"IBM Plex Sans KR", "Noto Sans KR", sans-serif';

/* ── 수학 ── */
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const lerp2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const prog = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  inCubic: k => k * k * k,
  outCubic: k => 1 - (1 - k) ** 3,
  inOutCubic: k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  inQuart: k => k ** 4,
  outQuart: k => 1 - (1 - k) ** 4,
  inOutQuart: k => (k < 0.5 ? 8 * k ** 4 : 1 - (-2 * k + 2) ** 4 / 2),
  outQuint: k => 1 - (1 - k) ** 5,
  outExpo: k => (k >= 1 ? 1 : 1 - 2 ** (-10 * k)),
  inExpo: k => (k <= 0 ? 0 : 2 ** (10 * k - 10)),
  inOutSine: k => -(Math.cos(Math.PI * k) - 1) / 2,
  outBack: (k, s = 1.7) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2,
};
// 감쇠 진동: 시작하고 dt초 뒤의 값. 0에서 1로 가며 한 번 넘쳤다가 자리잡는다
function spring(dt, freq = 2.4, damp = 0.45) {
  if (dt <= 0) return 0;
  const w = 2 * Math.PI * freq, wd = w * Math.sqrt(1 - damp * damp);
  return 1 - Math.exp(-damp * w * dt) * (Math.cos(wd * dt) + (damp * w / wd) * Math.sin(wd * dt));
}
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const RGB = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, hexRgb(v)]));
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── 화면 배치: 가로 16:9(1920×1080)와 세로 9:16(1080×1920) ── */
const LAYOUT = {
  wide: {
    fov: 36,
    // 들판 카메라: T 바라보는 점, d 거리, ph 내려다보는 각, ya 옆으로 돈 각
    cam: [
      { t: 0.0, T: [1.5, 0.14, 3.0], d: 1.55, ph: 74, ya: -8 },
      { t: 1.45, T: [0.4, 0, 7.6], d: 15.5, ph: 36, ya: -14 },
      { t: 4.0, T: [2.4, 0, 7.1], d: 13.6, ph: 41, ya: -4 },
      { t: 6.0, T: [3.4, 0, 6.6], d: 12.0, ph: 45, ya: -2 },
    ],
    endD: 0.86,
    scan: { from: [0.14, 0.7], to: [0.9, 0.62], rScan: 0.4, rLock: 0.27 },
    hook: { x: 120, y: 172, size: 54 },
    title: { x: 120, ySmall: 432, yBig: 650, small: 66, big: 236 },
    v3a: { cx: 63, cy: -66, z: 5.0 },
    v3b: { cx: 40, cy: -80, z: 3.55 },
    v3c: { cx: 34, cy: -84, z: 3.3 },
    v4: { cx: -131, cy: -111.5, z: 2.6 },
    beltL: 900,
    words: { x: 120, yNum: 418, y: 572, size: 150, ySeq: 660, seqSize: 30 },
    hmi: { win: [600, 178, 1220, 724], split: 'side' },
    brand: {
      view: { cx: 0, cy: -66.7, z: 1.65 }, beltL: 520,
      title: { x: 120, y1: 874, y2: 980, size: 96 },
      desc: { x: 1800, y1: 918, y2: 964, size: 30, align: 'right' },
      mark: { x: 120, y: 56, size: 96 },
      school: { x: 236, y1: 102, y2: 140 },
      team: { x: 1800, y1: 98, y2: 140, align: 'right' },
    },
  },
  tall: {
    fov: 60,
    cam: [
      { t: 0.0, T: [1.5, 0.14, 3.0], d: 1.75, ph: 74, ya: -8 },
      { t: 1.45, T: [2.2, 0, 7.2], d: 13.2, ph: 46, ya: -13 },
      { t: 4.0, T: [3.4, 0, 6.9], d: 11.8, ph: 49, ya: -4 },
      { t: 6.0, T: [3.9, 0, 6.5], d: 10.6, ph: 54, ya: -2 },
    ],
    endD: 1.02,
    scan: { from: [0.15, 0.74], to: [0.88, 0.68], rScan: 0.22, rLock: 0.16 },
    hook: { x: 80, y: 300, size: 56 },
    title: { x: 80, ySmall: 420, yBig: 640, small: 66, big: 236 },
    title3: { x: 80, ySmall: 1530, yBig: 1770, small: 66, big: 236 },
    v3a: { cx: 63, cy: -66, z: 5.0 },
    v3b: { cx: 52, cy: -95, z: 3.9 },
    v3c: { cx: 50, cy: -98, z: 3.7 },
    v4: { cx: 42, cy: -146, z: 2.6 },
    beltL: 700,
    words: { x: 80, yNum: 400, y: 560, size: 150, ySeq: 650, seqSize: 30 },
    // 세로판 카메라 화면(16:9)은 전체 화면과 비율이 달라 라인을 따로 잡는다 (화면 안 px 기준)
    hmi: { win: [60, 760, 960, 870], split: 'stack', view: { cx: 48, cy: -92, z: 2.05 } },
    brand: {
      view: { cx: 0, cy: -74, z: 1.75 }, beltL: 282,
      title: { x: 80, y1: 1380, y2: 1504, size: 108 },
      desc: { x: 80, y1: 1622, y2: 1674, size: 36, align: 'left' },
      mark: { x: 70, y: 96, size: 104 },
      school: { x: 194, y1: 142, y2: 184 },
      team: { x: 1010, y1: 138, y2: 184, align: 'right' },
    },
  },
};

/* ───────── 1~2막: 부품 들판 (3D) ───────── */
const F = { pitch: 1.5, h: 0.14, rows: 18, cmin: -26, cmax: 26, defRow: 4, defCol: -5 };
const FOG_RGB = [4, 12, 34];

// 짝수 줄은 박마다, 홀수 줄은 엇박마다 한 칸씩 내려앉는다 (0~3.75초, 8분음표 16번)
function rowSteps(r, t) {
  const phase = r % 2 === 0 ? 0 : 0.25;
  let n = 0;
  for (let k = 0; k < 8; k++) {
    const land = phase + k * 0.5;
    n += E.inOutQuart(prog(t, land - 0.15, land));
  }
  return n;
}
const tileX = (r, c, t) => (c + rowSteps(r, t)) * F.pitch;
const defectTop = t => [tileX(F.defRow, F.defCol, t), F.h, F.defRow * F.pitch];

// 둥근 네모(부품 윗면) 윤곽. x-z 평면에서 반시계 방향
function roundSquare(half, r, n = 4) {
  const pts = [];
  const corners = [[half - r, half - r, 0], [-half + r, half - r, 90], [-half + r, -half + r, 180], [half - r, -half + r, 270]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  }
  return pts;
}
const TOP = roundSquare(0.5, 0.12);
const TOP_IN = roundSquare(0.455, 0.085);

// 금: 로봇팔(어깨→팔꿈치→손목→손끝)과 같은 비율로 꺾여 있다. s는 팔 위의 자리(0 어깨 … 3 손끝)
const CRACK_KEYS = [[0.2, -0.02], [0.067, 0.253], [-0.2, 0.063], [-0.2, -0.127]];
const CRACK = [
  [0, 0, 0], [0.35, 0.026, -0.012], [0.7, -0.02, 0.016], [1, 0, 0], [1.3, 0.012, 0.03],
  [1.62, -0.018, -0.026], [2, 0, 0], [2.5, 0.022, 0], [3, 0, 0],
].map(([s, ju, jw]) => {
  const i = Math.min(2, Math.floor(s)), k = s - i;
  const p = lerp2(CRACK_KEYS[i], CRACK_KEYS[i + 1], k);
  return { s, u: p[0] + ju, w: p[1] + jw };
});
const CRACK_BRANCHES = [[4, 0.06, 0.05], [7, -0.05, -0.03]]; // [몇 번째 점에서, 끝 u, 끝 w(상대)]

/* ───────── 3~5막: 옆에서 본 라인 (포스터 v1 단위, 검사 자리 = (0,0), 아래가 +y) ───────── */
const PITCH = 42;            // 부품 간격
const ARM = { S: [126, -40], L1: 95.71, L2: 103.23 };
// 컨베이어가 한 칸씩 내려앉는 때 (10초 본 비트부터 8분음표로 다섯 번, 11초에 두 번째 불량이 검사 자리에 옴)
const BELT_LANDS = [10.0, 10.25, 10.5, 10.75, 11.0];
const beltN = t => BELT_LANDS.reduce((n, land) => n + E.inOutQuart(prog(t, land - 0.16, land)), 0);
const DEFECT1_SLOT = 0, DEFECT2_SLOT = -5;

// 손목이 지나가는 자리 [시각, [x, y], 이 자리로 오는 움직임]
const WRIST_KEYS = [
  [7.0, [0, -66]],
  [7.62, [0, -66]],
  [8.45, [0, -114], 'spring'],
  [8.98, [0, -60], 'inOutCubic'],
  [9.42, [8, -142], 'outCubic'],
  [9.92, [178, -98], 'inOutCubic'],
  [10.5, [40, -126], 'inOutCubic'],
  [12.45, [40, -126]],
  [12.98, [0, -60], 'inOutCubic'],
  [13.45, [0, -112], 'outCubic'],
  [14.0, [0, -112]],
  [14.9, [0, -66], 'spring'],
  [99, [0, -66]],
];
function wristAt(t) {
  for (let i = 1; i < WRIST_KEYS.length; i++) {
    const [tb, pb, how] = WRIST_KEYS[i];
    const [ta, pa] = WRIST_KEYS[i - 1];
    if (t <= tb) {
      if (!how) return pa;
      const k = how === 'spring' ? spring(t - ta, 1.6, 0.42) : E[how](prog(t, ta, tb));
      return lerp2(pa, pb, k);
    }
  }
  return WRIST_KEYS[WRIST_KEYS.length - 1][1];
}
// 그리퍼 손가락 벌림 (0이면 닫힘)
function gripOpen(t) {
  if (t < 8.9) return 4;
  if (t < 10.02) return 4 * (1 - E.outCubic(prog(t, 8.9, 9.0)));
  if (t < 12.9) return 4 * E.outCubic(prog(t, 10.02, 10.1));
  return 4 * (1 - E.outCubic(prog(t, 12.9, 13.0)));
}
// 두 마디 팔의 역기구학. 팔꿈치는 위로 꺾인다
function ik(Wt) {
  const [sx, sy] = ARM.S;
  let dx = Wt[0] - sx, dy = Wt[1] - sy;
  let d = Math.hypot(dx, dy);
  const dmax = ARM.L1 + ARM.L2 - 0.5, dmin = Math.abs(ARM.L1 - ARM.L2) + 0.5;
  if (d > dmax) { dx *= dmax / d; dy *= dmax / d; d = dmax; }
  if (d < dmin) { dx *= dmin / d; dy *= dmin / d; d = dmin; }
  const a = Math.atan2(dy, dx);
  const b = Math.acos(clamp((ARM.L1 ** 2 + d * d - ARM.L2 ** 2) / (2 * ARM.L1 * d), -1, 1));
  const e1 = [sx + ARM.L1 * Math.cos(a - b), sy + ARM.L1 * Math.sin(a - b)];
  const e2 = [sx + ARM.L1 * Math.cos(a + b), sy + ARM.L1 * Math.sin(a + b)];
  return { S: ARM.S, E: e1[1] < e2[1] ? e1 : e2, W: [sx + dx, sy + dy] };
}
// 팔 위의 자리 s(0 어깨, 1 팔꿈치, 2 손목, 3 손끝)
function armPoint(pose, s) {
  const chain = [pose.S, pose.E, pose.W, [pose.W[0], pose.W[1] + 60]];
  const i = Math.min(2, Math.floor(s));
  return lerp2(chain[i], chain[i + 1], s - i);
}
const ARM_WIDTH = s => (s < 1 ? 17 : s < 2 ? 15 : 14);

/* ───────── 장면 ───────── */
export function createScene({ ctx, W, H, format = 'wide', assets = {} }) {
  const L = LAYOUT[format];
  const tall = format === 'tall';

  /* ── 공통 그리기 ── */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }
  function setFont(size, weight = 800, family = FONT) {
    ctx.font = `${weight} ${size}px ${family}`;
  }
  // 음절마다 아래에서 올라와 자리잡고, 나갈 때는 위로 빠진다. 줄 상자 밖은 잘린다
  function riseText(str, x, y, size, o) {
    const { t, tin, tout = 1e9, outDur = 0.32, weight = 900, color = C.pale, stagger = 0.04, dur = 0.6, align = 'left', family = FONT, alpha = 1, track = 0 } = o;
    if (t < tin || t > tout + outDur || alpha <= 0) return 0;
    ctx.save();
    setFont(size, weight, family);
    ctx.textBaseline = 'alphabetic';
    const chars = [...str];
    const xs = [];
    let acc = 0;
    for (const ch of chars) { xs.push(acc); acc += ctx.measureText(ch).width + track; }
    const width = acc - track;
    const x0 = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    ctx.beginPath();
    ctx.rect(x0 - size, y - size * 1.12, width + size * 2, size * 1.42);
    ctx.clip();
    ctx.fillStyle = color;
    const kOut = E.inCubic(prog(t, tout, tout + outDur));
    chars.forEach((ch, i) => {
      const k = E.outExpo(prog(t, tin + i * stagger, tin + i * stagger + dur));
      const dy = (1 - k) * size * 1.1 - kOut * size * 1.15;
      ctx.globalAlpha = alpha * clamp(k * 1.6);
      ctx.fillText(ch, x0 + xs[i], y + dy);
    });
    ctx.restore();
    return width;
  }
  function fadeText(str, x, y, size, o) {
    const { t, tin, dur = 0.5, weight = 700, color = C.pale, align = 'left', family = FONT, dy = 18 } = o;
    const k = E.outCubic(prog(t, tin, tin + dur));
    if (k <= 0) return;
    ctx.save();
    setFont(size, weight, family);
    ctx.textAlign = align;
    ctx.globalAlpha = k;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y + (1 - k) * dy);
    ctx.restore();
  }

  /* ───────── 1~2막 ───────── */
  function fieldCam(t) {
    const K = L.cam;
    let T, d, ph, ya;
    if (t < 6.0) {
      const i = t < K[1].t ? 0 : t < K[2].t ? 1 : 2;
      const a = K[i], b = K[i + 1];
      const k = i === 0 ? E.outQuint(prog(t, a.t, b.t)) : E.inOutSine(prog(t, a.t, b.t));
      T = lerp3(a.T, b.T, k);
      d = a.d * (b.d / a.d) ** k;
      ph = lerp(a.ph, b.ph, k);
      ya = lerp(a.ya, b.ya, k);
    } else {
      // 금 간 곳으로: 처음엔 느리게, 끝으로 갈수록 빨라진다(스피드 램프)
      const a = K[3], k = prog(t, 6.0, 7.0);
      const D = defectTop(t);
      T = lerp3(a.T, [D[0], D[1], D[2] + 0.063], E.inOutCubic(Math.min(1, k * 1.15)));
      d = a.d * (L.endD / a.d) ** E.inCubic(k);
      ph = lerp(a.ph, 89.5, E.inOutCubic(k));
      ya = lerp(a.ya, 0, E.inOutCubic(k));
    }
    return camera(T, d, ph, ya);
  }
  function camera(T, d, phDeg, yaDeg) {
    const ph = (phDeg * Math.PI) / 180, ya = (yaDeg * Math.PI) / 180;
    const dir = [Math.cos(ph) * Math.sin(ya), -Math.sin(ph), Math.cos(ph) * Math.cos(ya)];
    const pos = [T[0] - d * dir[0], T[1] - d * dir[1], T[2] - d * dir[2]];
    const right = [Math.cos(ya), 0, -Math.sin(ya)];
    const up = [
      dir[1] * right[2] - dir[2] * right[1],
      dir[2] * right[0] - dir[0] * right[2],
      dir[0] * right[1] - dir[1] * right[0],
    ];
    const f = H / 2 / Math.tan(((L.fov / 2) * Math.PI) / 180);
    return {
      pos, f,
      project(x, y, z) {
        const v0 = x - pos[0], v1 = y - pos[1], v2 = z - pos[2];
        const zc = v0 * dir[0] + v1 * dir[1] + v2 * dir[2];
        const xc = v0 * right[0] + v1 * right[1] + v2 * right[2];
        const yc = v0 * up[0] + v1 * up[1] + v2 * up[2];
        return [W / 2 + (f * xc) / zc, H / 2 - (f * yc) / zc, zc];
      },
    };
  }
  const fogK = zc => Math.exp(-Math.max(0, zc - 11) / 14);

  // 눈(동심원) 상태: 4초에 피어나 왼쪽→오른쪽으로 훑고, 지나쳤다가 5초에 불량으로 되돌아와 오므라든다(초점)
  function eyeState(t, cam) {
    if (t < 4.0) return null;
    const bloom = E.outExpo(prog(t, 4.0, 4.5));
    const D = defectTop(t);
    const dp = cam.project(D[0], D[1], D[2]);
    const s = L.scan;
    const ks = E.inOutSine(prog(t, 4.0, 4.86));
    const scanC = [lerp(s.from[0], s.to[0], ks) * W, lerp(s.from[1], s.to[1], ks) * H];
    const lock = spring(t - 4.86, 2.2, 0.5);
    const c = lerp2(scanC, dp, clamp(lock, 0, 1.2));
    let R = lerp(s.rScan, s.rLock, lock) * H * bloom;
    if (t > 6.0) {
      // 밀고 들어가는 동안 원도 불량과 같은 비율로 커진다 (눈 속을 지나감)
      const q = defectScale(cam, D);
      R *= q / eyeBaseScale;
    }
    return { cx: c[0], cy: c[1], R, alpha: bloom, lock: clamp(lock), dp };
  }
  let eyeBaseScale = 1;
  function defectScale(cam, D) {
    const a = cam.project(D[0] - 0.5, D[1], D[2]), b = cam.project(D[0] + 0.5, D[1], D[2]);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  // 점이 눈(가장 바깥 원) 안에 있는가
  function inEye(eye, x, y) {
    if (!eye) return false;
    const r = eye.R;
    return (x - eye.cx) ** 2 + (y - (eye.cy - r)) ** 2 < r * r;
  }

  function drawField(t) {
    const cam = fieldCam(t);
    eyeBaseScale = defectScale(fieldCam(6.0), defectTop(6.0));
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#020818');
    g.addColorStop(1, '#081c46');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const dimAll = 0.3 * E.outCubic(prog(t, 4.0, 4.3));
    const dimLock = 0.42 * E.outCubic(prog(t, 5.0, 5.45));

    // 줄마다 어두운 벨트
    for (let r = F.rows - 1; r >= 0; r--) {
      const z = r * F.pitch;
      for (let x0 = -44; x0 < 44; x0 += 4) {
        const p = [cam.project(x0, 0, z - 0.68), cam.project(x0 + 4, 0, z - 0.68), cam.project(x0 + 4, 0, z + 0.68), cam.project(x0, 0, z + 0.68)];
        if (p.some(q => q[2] < 0.15)) continue;
        if (p.every(q => q[0] < -50) || p.every(q => q[0] > W + 50) || p.every(q => q[1] > H + 50) || p.every(q => q[1] < -50)) continue;
        const fog = fogK(p[0][2]) * (1 - dimAll * 0.5);
        ctx.fillStyle = css(mixc(FOG_RGB, [16, 34, 78], fog));
        ctx.beginPath();
        ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
        ctx.closePath();
        ctx.fill();
      }
    }

    const eye = eyeState(t, cam);
    if (eye) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < RINGS.length; i++) {
        const r = (eye.R * RINGS[i][0]) / 174;
        ctx.globalAlpha = 0.92 * eye.alpha;
        ctx.fillStyle = RINGS[i][1];
        ctx.beginPath();
        ctx.arc(eye.cx, eye.cy - r, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 부품: 먼 줄부터
    const D = defectTop(t);
    for (let r = F.rows - 1; r >= 0; r--) {
      const z = r * F.pitch;
      const steps = rowSteps(r, t);
      for (let c = F.cmin; c <= F.cmax; c++) {
        const x = (c + steps) * F.pitch;
        const cp = cam.project(x, F.h, z);
        if (cp[2] < 0.12) continue;
        const m = 260 + 6000 / Math.max(cp[2], 0.3);
        if (cp[0] < -m || cp[0] > W + m || cp[1] < -m || cp[1] > H + m) continue;
        const isDefect = r === F.defRow && c === F.defCol;
        // 훑는 동안 눈 안의 부품은 밝게(살펴보는 중), 고정된 뒤에는 불량만 밝다
        const spot = inEye(eye, cp[0], cp[1]) ? (1 - eye.lock) * eye.alpha : 0;
        const dim = isDefect ? 0 : (dimAll + dimLock) * (1 - 0.85 * spot);
        drawTile(cam, x, z, cp, isDefect, dim, spot);
      }
    }

    // 먼 곳은 밤안개에 잠기고, 자막이 읽히도록 위쪽이 어둡다
    const haze = 1 - prog(t, 6.0, 6.45);
    if (haze > 0) {
      const g2 = ctx.createLinearGradient(0, 0, 0, H * 0.5);
      g2.addColorStop(0, `rgba(2,8,24,${0.88 * haze})`);
      g2.addColorStop(1, 'rgba(2,8,24,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H * 0.5);
    }
    // 끝에서 화면 전체가 부품 윗면(=가장 안쪽 원) 색이 된다
    const pale = E.inCubic(prog(t, 6.84, 7.0));
    vignette(0.62 * (1 - pale));
    if (t >= 4.0) drawEyeOverlay(t, cam, eye, D);
    if (pale > 0) {
      ctx.fillStyle = css(RGB.pale, pale);
      ctx.fillRect(0, 0, W, H);
      drawCrack3D(cam, D, 1, pale);
    }
  }

  function drawTile(cam, x, z, cp, isDefect, dim, spot) {
    const pts = TOP.map(([u, w]) => cam.project(x + u, F.h, z + w));
    if (pts.some(p => p[2] < 0.06)) return;
    const fog = fogK(cp[2]);
    const top = spot > 0 ? mixc(RGB.pale, [255, 214, 200], 0.4 * spot) : RGB.pale;
    const vis = fog * (1 - dim);
    const topC = mixc(FOG_RGB, top, vis);
    // 그림자
    const sh = TOP.map(([u, w]) => cam.project(x + u * 1.02 + 0.07, 0, z + w * 1.02 - 0.1));
    ctx.fillStyle = `rgba(1,5,18,${0.5 * vis})`;
    poly(sh);
    // 옆면: 카메라를 보는 면만
    const bottom = TOP.map(([u, w]) => cam.project(x + u, 0, z + w));
    const n = TOP.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [u0, w0] = TOP[i], [u1, w1] = TOP[j];
      const nx = w1 - w0, nz = -(u1 - u0);
      const mx = x + (u0 + u1) / 2, mz = z + (w0 + w1) / 2;
      if (nx * (cam.pos[0] - mx) + nz * (cam.pos[2] - mz) <= 0) continue;
      const len = Math.hypot(nx, nz) || 1;
      const lit = 0.6 + 0.2 * Math.max(0, (-0.45 * nx - 0.9 * nz) / len);
      ctx.fillStyle = css(mixc(FOG_RGB, mixc([40, 30, 50], top, lit), vis));
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.lineTo(bottom[j][0], bottom[j][1]);
      ctx.lineTo(bottom[i][0], bottom[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    // 윗면: 가장자리를 조금 어둡게 해서 모따기처럼 보이게
    ctx.fillStyle = css(mixc(FOG_RGB, mixc(top, [214, 176, 172], 0.35), vis));
    poly(pts);
    ctx.fillStyle = css(topC);
    poly(TOP_IN.map(([u, w]) => cam.project(x + u, F.h, z + w)));
    if (isDefect) drawCrack3D(cam, [x, F.h, z], vis, 1);
  }
  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  function crackScreen(cam, D) {
    return CRACK.map(({ u, w }) => cam.project(D[0] + u, D[1] + 0.002, D[2] + w));
  }
  function drawCrack3D(cam, D, vis, alpha) {
    const pts = crackScreen(cam, D);
    if (pts.some(p => p[2] < 0.05)) return;
    const a = cam.project(D[0], D[1], D[2]), b = cam.project(D[0] + 1, D[1], D[2]);
    const unit = Math.hypot(b[0] - a[0], b[1] - a[1]);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = css(mixc(FOG_RGB, RGB.coral, vis));
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.8, unit * 0.034);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.lineWidth = Math.max(1, unit * 0.022);
    for (const [i, du, dw] of CRACK_BRANCHES) {
      const p = pts[i], q = cam.project(D[0] + CRACK[i].u + du, D[1] + 0.002, D[2] + CRACK[i].w + dw);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEyeOverlay(t, cam, eye, D) {
    const out = E.inCubic(prog(t, 6.0, 6.3));
    const a = cam.project(D[0] - 0.5, D[1], D[2] - 0.5), b = cam.project(D[0] + 0.5, D[1], D[2] + 0.5);
    const c = cam.project(D[0] - 0.5, D[1], D[2] + 0.5), d = cam.project(D[0] + 0.5, D[1], D[2] - 0.5);
    const xs = [a[0], b[0], c[0], d[0]], ys = [a[1], b[1], c[1], d[1]];
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };

    // 카메라의 시선(점선 두 줄): 화면 위의 카메라에서 내려온다
    const gx = eye.lock > 0.02 ? lerp(eye.cx, (box.x0 + box.x1) / 2, eye.lock) : eye.cx;
    const gy = lerp(eye.cy, box.y0, eye.lock);
    const spread = lerp(0.5, 0.5, eye.lock) * (box.x1 - box.x0);
    ctx.save();
    ctx.globalAlpha = 0.75 * eye.alpha * (1 - out);
    ctx.strokeStyle = C.pale;
    ctx.lineWidth = tall ? 2.6 : 2.2;
    ctx.setLineDash([9, 9]);
    ctx.lineDashOffset = -t * 60;
    const top = -20, apex = gx + (tall ? 0 : -W * 0.04);
    ctx.beginPath();
    ctx.moveTo(apex - 14, top);
    ctx.lineTo(gx - spread, gy);
    ctx.moveTo(apex + 14, top);
    ctx.lineTo(gx + spread, gy);
    ctx.stroke();
    ctx.restore();

    // 고정: 산호색 모서리 괄호가 조여 든다
    const kb = E.outBack(prog(t, 5.0, 5.28), 2.2);
    if (kb > 0) {
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const hw = ((box.x1 - box.x0) / 2) * lerp(2.2, 1.28, kb), hh = ((box.y1 - box.y0) / 2) * lerp(2.2, 1.35, kb);
      const arm = Math.min(hw, hh) * 0.42;
      ctx.save();
      ctx.globalAlpha = clamp(kb * 2) * (1 - out);
      ctx.strokeStyle = C.coral;
      ctx.lineWidth = tall ? 5 : 4.5;
      ctx.lineCap = 'square';
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = cx + sx * hw, py = cy + sy * hh;
        ctx.beginPath();
        ctx.moveTo(px, py - sy * arm);
        ctx.lineTo(px, py);
        ctx.lineTo(px - sx * arm, py);
        ctx.stroke();
      }
      // 판정 표
      const kc = E.outBack(prog(t, 5.12, 5.4), 1.8);
      if (kc > 0) {
        const size = tall ? 34 : 30;
        setFont(size, 800);
        const label = '불량';
        const tw = ctx.measureText(label).width;
        const bw = tw + size * 1.1, bh = size * 1.55;
        const bx = cx + hw + 12, by = cy - hh - bh - 10;
        ctx.save();
        ctx.translate(bx, by + bh);
        ctx.scale(kc, kc);
        ctx.fillStyle = C.coral;
        roundRect(0, -bh, bw, bh, 8);
        ctx.fill();
        ctx.fillStyle = C.sky;
        ctx.fillText(label, size * 0.55, -bh * 0.3);
        ctx.restore();
      }
      ctx.restore();
    }

    // "찾는 / 눈"
    const T = L.title;
    riseText('찾는', T.x, T.ySmall, T.small, { t, tin: 5.0, tout: 6.0, weight: 700, color: C.pale, stagger: 0.05 });
    riseText('눈', T.x - T.big * 0.04, T.yBig, T.big, { t, tin: 5.08, tout: 6.02, weight: 900, color: C.pale });
  }

  function vignette(a) {
    if (a <= 0) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, 'rgba(1,4,14,0)');
    g.addColorStop(1, `rgba(1,4,14,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawHook(t) {
    const h = L.hook;
    // 앞 자막은 2초 박 전에 다 빠지고, 다음 자막이 박에 맞춰 올라온다
    riseText('이 중 하나는 불량입니다.', h.x, h.y, h.size, { t, tin: 0.32, tout: 1.74, outDur: 0.22, weight: 700, color: C.pale, stagger: 0.022 });
    riseText('찾으셨나요?', h.x, h.y, h.size, { t, tin: 2.0, tout: 3.72, outDur: 0.24, weight: 700, color: C.pale, stagger: 0.03 });
  }

  /* ───────── 3~5막: 라인 ───────── */
  // 화면 위 카메라(보기). z는 1 단위가 몇 px인지
  const mixv = (a, b, k) => ({ cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), z: a.z * (b.z / a.z) ** k });
  function worldView(t) {
    const v3a = L.v3a, v3b = L.v3b, v3c = L.v3c, v4 = L.v4, vb = L.brand.view;
    if (t < 7.62) return v3a;
    if (t < 8.6) return mixv(v3a, v3b, E.inOutCubic(prog(t, 7.62, 8.6)));
    if (t < 9.7) return mixv(v3b, v3c, E.inOutSine(prog(t, 8.6, 9.7)));
    if (t < 10.0) return mixv(v3c, v4, E.inQuart(prog(t, 9.7, 10.0)));
    const v4e = { ...v4, cx: v4.cx + 6, z: v4.z * 1.03 };
    if (t < 13.55) return mixv(v4, v4e, prog(t, 10.0, 13.55));
    if (t < 14.0) return mixv(v4e, vb, E.inOutCubic(prog(t, 13.55, 14.0)));
    // 브랜드: 타격과 함께 조금 당겨졌다가 천천히 자리잡는다
    return { ...vb, z: vb.z * (1 + 0.05 * (1 - E.outCubic(prog(t, 14.0, 15.4)))) };
  }

  function drawWorldActs(t) {
    const view = worldView(t);
    // HMI 창: 12초에 전체 화면이던 카메라 화면이 창 안 자리로 줄어들고, 13.62~14초에 다시 커진다
    const hk = t < 12.0 ? 0 : t < 13.55 ? E.inOutCubic(prog(t, 12.0, 12.62)) : 1 - E.inCubic(prog(t, 13.55, 14.0));
    if (hk > 0.0001 && t < 14.0) {
      const g = hmiGeom(hk);
      ctx.fillStyle = C.coral;
      ctx.fillRect(0, 0, W, H);
      drawHmiChrome(t, g, hk);
      ctx.save();
      roundRect(g.cam.x, g.cam.y, g.cam.w, g.cam.h, lerp(0, 6, hk));
      ctx.clip();
      let inner = { ...view, z: (view.z * g.cam.w) / W };
      if (L.hmi.view) inner = mixv(inner, L.hmi.view, hk);
      drawWorld(t, inner, g.cam.x + g.cam.w / 2, g.cam.y + g.cam.h / 2, g.cam);
      drawCamOverlay(t, g, hk, inner);
      ctx.restore();
      // 줄어드는 동안 화면 테두리(베젤)가 보여서 '화면 속'이라는 것이 읽힌다
      ctx.strokeStyle = HMI.plate;
      ctx.lineWidth = 12 * clamp(hk * 2.5);
      roundRect(g.cam.x - ctx.lineWidth / 2, g.cam.y - ctx.lineWidth / 2, g.cam.w + ctx.lineWidth, g.cam.h + ctx.lineWidth, 8);
      ctx.stroke();
    } else {
      drawWorld(t, view, W / 2, H / 2, { x: 0, y: 0, w: W, h: H });
    }
    if (t < 7.42) drawTear(t);
    if (t < 7.62) drawMorph(t, view);
    drawActTexts(t);
    if (t >= 14.0) {
      drawBrandText(t);
      // 가장 큰 타격: 검사 자리에서 빛이 터진다
      const f = 1 - E.outCubic(prog(t, 14.0, 14.22));
      if (f > 0) {
        const px = W / 2 + (0 - view.cx) * view.z, py = H / 2 + (0 - view.cy) * view.z;
        const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(W, H) * 0.55);
        g.addColorStop(0, `rgba(255,238,233,${f})`);
        g.addColorStop(0.3, `rgba(252,171,153,${0.6 * f})`);
        g.addColorStop(1, 'rgba(244,128,103,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }
  }

  function drawWorld(t, view, ox, oy, rect) {
    const brand = t >= 14.0;
    const z = view.z;
    const sx = wx => ox + (wx - view.cx) * z;
    const sy = wy => oy + (wy - view.cy) * z;
    ctx.save();
    // 바탕: 산호색 땅 (브랜드 장면에서는 위가 밤하늘)
    ctx.fillStyle = C.coral;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    const horizon = sy(13);
    if (brand) {
      const drop = E.outExpo(prog(t, 14.0, 14.22));
      const bottom = lerp(rect.y, horizon, drop);
      ctx.fillStyle = C.sky;
      ctx.fillRect(rect.x, rect.y, rect.w, bottom - rect.y);
      drawStars(t, rect, bottom);
    }
    ctx.translate(ox - view.cx * z, oy - view.cy * z);
    ctx.scale(z, z);
    if (brand) drawBrandRings(t);
    if (t >= 11.95 && t < 13.2) drawRingPulse(t);
    if (brand) drawReflection(t);
    const beltL = brand ? L.brand.beltL : L.beltL;
    const beltReveal = t < 7.4 ? 0 : E.outCubic(prog(t, 7.4, 8.05));
    drawFallingDefect(t);
    drawBelt(beltL, brand ? 1 : beltReveal);
    drawParts(t, beltL, brand);
    drawCameraRig(t);
    if (t >= 7.52) drawArm(t, ik(wristAt(t)), clamp(prog(t, 7.52, 7.6)));
    ctx.restore();
  }

  function drawStars(t, rect, bottom) {
    const R = rng(7);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, bottom - rect.y);
    ctx.clip();
    ctx.fillStyle = C.pale;
    const n = tall ? 46 : 64;
    for (let i = 0; i < n; i++) {
      const x = rect.x + R() * rect.w, y = rect.y + R() * (bottom - rect.y) * 0.98;
      const r = (0.8 + R() * R() * 2.4) * (rect.w / W) * (tall ? 1.4 : 1.25);
      const delay = 14.05 + R() * 0.9, ph = R() * 6.28, sp = 1.5 + R() * 2.5;
      const a = E.outCubic(prog(t, delay, delay + 0.4)) * (0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * sp + ph)));
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 브랜드: 안쪽 원부터 터지듯 피어나 조금 넘쳤다가 자리잡는다. 다 핀 뒤에는 아주 느리게 숨 쉰다
  function drawBrandRings(t) {
    const breathe = 1 + 0.008 * Math.sin((t - 14) * Math.PI);
    for (let i = 0; i < RINGS.length; i++) {
      const j = RINGS.length - 1 - i; // 0 = 가장 안쪽
      const start = 14.0 + j * 0.012, dur = 0.42 + j * 0.035;
      const k = prog(t, start, start + dur);
      const r = RINGS[i][0] * (E.outExpo(k) + 0.08 * Math.sin(Math.PI * k)) * breathe;
      if (r <= 0.01) continue;
      ctx.fillStyle = RINGS[i][1];
      ctx.beginPath();
      ctx.arc(0, -r, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 판정: 원이 한 번 뛴다
  function drawRingPulse(t) {
    const k = prog(t, 12.0, 12.9);
    if (k <= 0 || k >= 1) return;
    const s = lerp(0.12, 0.62, E.outCubic(k)), a = 1 - E.inCubic(k);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < RINGS.length; i++) {
      const r = RINGS[i][0] * s;
      ctx.fillStyle = RINGS[i][1];
      ctx.beginPath();
      ctx.arc(0, -r, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawReflection(t) {
    for (let k = 0; k < 7; k++) {
      const y = 13 + 5 + k * 5.6 + k * k * 0.42, h = 2.0 + k * 0.3;
      const kk = E.outCubic(prog(t, 14.22 + k * 0.035, 14.62 + k * 0.035));
      if (kk <= 0) continue;
      const base = (66 + k * 31) * kk;
      ctx.globalAlpha = 0.95 - k * 0.055;
      for (let j = 0; j < REFL.length; j++) {
        const w = base * (1 - j * 0.105);
        ctx.fillStyle = REFL[j];
        roundRect(-w / 2, y, w, h, h / 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBelt(Lh, reveal) {
    if (reveal <= 0) return;
    const half = Lh * reveal;
    ctx.fillStyle = C.navy;
    roundRect(-half, 0, half * 2, 13, 6.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,235,230,0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-half + 9, 0.75);
    ctx.lineTo(half - 9, 0.75);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,235,230,0.35)';
    for (let x = -Lh + 32; x < Lh - 30; x += 21) {
      if (Math.abs(x) > half - 12) continue;
      ctx.beginPath();
      ctx.arc(x, 6.8, 1.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,235,230,0.9)';
    ctx.lineWidth = 1.25;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sgn * (half - 8), 6.5, 3.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPart(x, y, defect, alpha = 1, outline = 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.fillStyle = C.pale;
    roundRect(-6, -12, 12, 12, 1.4);
    ctx.fill();
    if (defect) {
      // 들판의 금과 같은 모양 (윗면 → 옆면)
      ctx.strokeStyle = C.coral;
      ctx.lineWidth = 1.15;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      CRACK.forEach(({ u, w }, i) => {
        const px = u * 24, py = -6 - w * 24;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.stroke();
      if (outline > 0) {
        ctx.globalAlpha = alpha * outline;
        ctx.strokeStyle = C.coral;
        ctx.lineWidth = 1.6;
        roundRect(-9, -15, 18, 18, 3);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawParts(t, Lh, brand) {
    const n = brand ? 5 : beltN(t);
    for (let k = -40; k <= 40; k++) {
      const x = (k + n) * PITCH;
      if (Math.abs(x) > Lh - 26) continue;
      let y = 0, alpha = 1;
      if (!brand && t < 8.4) {
        // 3막: 띠가 펼쳐진 뒤 부품이 위에서 떨어져 내려앉는다
        const delay = 7.62 + Math.abs(x) / 900;
        const k2 = prog(t, delay, delay + 0.34);
        if (k2 <= 0) continue;
        y = -26 * (1 - E.outBack(k2, 2.0));
        alpha = clamp(k2 * 3);
      }
      if (k === DEFECT1_SLOT && t < 14.0) {
        if (t >= 9.0) continue; // 집혀 올라감
        drawPart(x, y, true, alpha, 0.8 * clamp(prog(t, 7.9, 8.2)));
        continue;
      }
      if (k === DEFECT2_SLOT && t < 14.0) {
        if (t >= 13.0) continue;
        const judged = clamp(prog(t, 12.0, 12.15));
        drawPart(x, y, true, alpha, judged);
        if (t >= 11.0 && t < 11.18) {
          // 촬영: 한 번 번쩍
          ctx.save();
          ctx.globalAlpha = 1 - prog(t, 11.0, 11.18);
          ctx.fillStyle = '#FFFFFF';
          roundRect(x - 8, -14, 16, 16, 2);
          ctx.fill();
          ctx.restore();
        }
        continue;
      }
      if (brand && Math.abs(x) < 1) continue; // 검사 자리는 비어 있다 (부품은 그리퍼에)
      drawPart(x, y, false, alpha);
    }
  }

  // 3막에서 집은 첫 불량품: 10.05초에 놓으면 띠 뒤로 떨어져 사라진다
  function drawFallingDefect(t) {
    if (t < 10.02 || t > 10.6) return;
    const pose = ik(wristAt(10.02));
    const x = pose.W[0], y0 = pose.W[1] + 60;
    const dt = t - 10.02;
    const y = y0 + 0.5 * 1400 * dt * dt;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 20, -400, 40, 400 + 6);
    ctx.clip();
    drawPart(x, y, true);
    ctx.restore();
  }

  function drawCameraRig(t) {
    const brand = t >= 14.0;
    const grow = brand ? 1 : E.outCubic(prog(t, 7.85, 8.35));
    if (grow <= 0) return;
    const pop = brand ? 1 : E.outBack(prog(t, 8.1, 8.42), 2);
    ctx.save();
    // 시선(점선): 11초 촬영 때 밝아진다
    const flash = t >= 11.0 && t < 11.5 ? 1 - prog(t, 11.0, 11.5) : 0;
    const gazeA = (brand ? 0.7 : 0.62) * clamp(prog(t, 8.35, 8.6)) + 0.3 * flash;
    if (gazeA > 0) {
      ctx.strokeStyle = C.pale;
      ctx.globalAlpha = Math.min(1, gazeA);
      ctx.lineWidth = 1 + flash * 1.2;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -t * 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-7, -160);
      ctx.lineTo(-27, -8);
      ctx.moveTo(7, -160);
      ctx.lineTo(27, -8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // 기둥이 땅에서 올라오고, 위 팔과 카메라가 붙는다
    ctx.beginPath();
    ctx.rect(-100, -230 * grow, 160, 230 * grow + 2);
    ctx.clip();
    const parts = [
      [-68, -198, 5, 198, 0], [-68, -200, 72, 5, 1.6],
    ];
    for (const [off, col] of [[[-1.8, -1.2], C.rim], [[0, 0], C.navy]]) {
      ctx.fillStyle = col;
      for (const [x, y, w, h, r] of parts) {
        roundRect(x + off[0], y + off[1], w, h, r);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(0, -182);
      ctx.scale(pop, pop);
      ctx.translate(0, 182);
      roundRect(-23 + off[0], -195 + off[1], 46, 25, 4);
      ctx.fill();
      roundRect(-10 + off[0], -171 + off[1], 20, 11, 2.2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(0, -182);
    ctx.scale(pop, pop);
    ctx.translate(0, 182);
    ctx.strokeStyle = C.pale;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-6, -160.7);
    ctx.lineTo(6, -160.7);
    ctx.stroke();
    // 표시등: 촬영 때 밝게
    const led = brand ? 0.75 + 0.25 * Math.sin(t * 4) : 1;
    ctx.fillStyle = C.coral;
    ctx.globalAlpha = led;
    ctx.beginPath();
    ctx.arc(14, -188, 2.2 + flash * 1.6, 0, Math.PI * 2);
    ctx.fill();
    if (flash > 0) {
      ctx.globalAlpha = flash;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(0, -158, 9 + 30 * (1 - flash), 3 + 8 * (1 - flash), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  function drawArm(t, pose, alpha = 1) {
    const o = gripOpen(t);
    const holding = (t >= 9.0 && t < 10.02) || t >= 13.0;
    const base = t < 7.95 ? E.outBack(prog(t, 7.5, 7.86), 1.6) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    const { S, E: El, W: Wr } = pose;
    for (const [off, col] of [[[-1.8, -1.2], C.rim], [[0, 0], C.navy]]) {
      ctx.save();
      ctx.translate(off[0], off[1]);
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      // 받침: 바닥에서 솟아오른다
      ctx.save();
      ctx.translate(126, 4);
      ctx.scale(1, base);
      ctx.translate(-126, -4);
      roundRect(102, -12, 48, 16, 4);
      ctx.fill();
      roundRect(111, -36, 30, 30, 5);
      ctx.fill();
      ctx.restore();
      ctx.lineCap = 'round';
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(S[0], S[1]);
      ctx.lineTo(El[0], El[1]);
      ctx.stroke();
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(El[0], El[1]);
      ctx.lineTo(Wr[0], Wr[1]);
      ctx.stroke();
      for (const [p, r] of [[S, 11], [El, 10.5], [Wr, 8.5]]) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 손목과 그리퍼 (늘 아래를 본다)
      const wx = Wr[0], wy = Wr[1];
      roundRect(wx - 7, wy, 14, 32, 3);
      ctx.fill();
      roundRect(wx - 14 - o, wy + 29, 28 + 2 * o, 10, 2.5);
      ctx.fill();
      roundRect(wx - 14 - o, wy + 36, 5.5, 24, 1.6);
      ctx.fill();
      roundRect(wx + 8.5 + o, wy + 36, 5.5, 24, 1.6);
      ctx.fill();
      ctx.restore();
    }
    if (holding) drawPart(Wr[0], Wr[1] + 60, true);
    // 3막: 집는 순간 산호색 테두리가 번쩍
    const hit = t >= 9.0 && t < 9.35 ? 1 - prog(t, 9.0, 9.35) : t >= 13.0 && t < 13.35 ? 1 - prog(t, 13.0, 13.35) : 0;
    if (hit > 0) {
      ctx.globalAlpha = hit;
      ctx.strokeStyle = C.pale;
      ctx.lineWidth = 1.4;
      roundRect(Wr[0] - 20 - 8 * (1 - hit), Wr[1] + 24 - 8 * (1 - hit), 40 + 16 * (1 - hit), 42 + 16 * (1 - hit), 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── 매치 컷: 금이 갈라지고 그 선이 로봇팔이 된다 ── */
  let crack7 = null;
  function crackAt7() {
    if (!crack7) {
      const cam = fieldCam(7.0);
      crack7 = crackScreen(cam, defectTop(7.0)).map(p => [p[0], p[1]]);
      const a = cam.project(0, 0, 0), b = cam.project(1, 0, 0);
      crack7.unit = Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return crack7;
  }
  function drawTear(t) {
    const P = crackAt7();
    const k = E.inCubic(prog(t, 7.0, 7.4));
    const big = Math.max(W, H) * 4;
    const first = P[0], last = P[P.length - 1];
    // 금의 양 끝을 금 전체 방향으로 길게 늘여 화면을 두 쪽으로 가른다
    const along = norm([last[0] - first[0], last[1] - first[1]]);
    const e0 = [first[0] - along[0] * big, first[1] - along[1] * big];
    const e1 = [last[0] + along[0] * big, last[1] + along[1] * big];
    const nrm = [-along[1], along[0]];
    const dist = k * Math.max(W, H) * 1.15;
    for (const sgn of [1, -1]) {
      ctx.save();
      ctx.translate(nrm[0] * dist * sgn, nrm[1] * dist * sgn);
      ctx.rotate(sgn * 0.05 * k);
      ctx.beginPath();
      ctx.moveTo(e0[0], e0[1]);
      for (const p of P) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(e1[0], e1[1]);
      ctx.lineTo(e1[0] + nrm[0] * big * sgn, e1[1] + nrm[1] * big * sgn);
      ctx.lineTo(e0[0] + nrm[0] * big * sgn, e0[1] + nrm[1] * big * sgn);
      ctx.closePath();
      ctx.fillStyle = C.pale;
      ctx.fill();
      // 갈라진 가장자리의 얇은 그림자 (벌어지면서 생긴다)
      ctx.strokeStyle = `rgba(160,92,100,${0.35 * clamp(k * 8)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(e0[0], e0[1]);
      for (const p of P) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(e1[0], e1[1]);
      ctx.stroke();
      ctx.restore();
    }
  }
  function norm(v) {
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  }
  function drawMorph(t, view) {
    const P = crackAt7();
    const m = E.inOutCubic(prog(t, 7.03, 7.6));
    const pose = ik(wristAt(t));
    const toScreen = p => [W / 2 + (p[0] - view.cx) * view.z, H / 2 + (p[1] - view.cy) * view.z];
    const pts = CRACK.map((c, i) => lerp2(P[i], toScreen(armPoint(pose, c.s)), m));
    const col = mixc(RGB.coral, RGB.navy, E.outCubic(prog(t, 7.02, 7.32)));
    const fade = 1 - prog(t, 7.56, 7.62);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = css(col);
    ctx.fillStyle = css(col);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const w0 = Math.max(2, P.unit * 0.04);
    for (let i = 0; i < pts.length - 1; i++) {
      const s = (CRACK[i].s + CRACK[i + 1].s) / 2;
      ctx.lineWidth = lerp(w0, ARM_WIDTH(s) * view.z, E.inCubic(m));
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
      ctx.stroke();
    }
    // 마디(관절)가 금의 꺾인 자리에서 부풀어 오른다
    const kj = E.outBack(prog(t, 7.22, 7.55), 2.2);
    for (const [s, r] of [[0, 11], [1, 10.5], [2, 8.5]]) {
      const i = CRACK.findIndex(c => c.s === s);
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], Math.max(0, r * view.z * kj), 0, Math.PI * 2);
      ctx.fill();
    }
    // 잔금은 사라진다
    ctx.globalAlpha = fade * (1 - m);
    ctx.lineWidth = Math.max(1, P.unit * 0.022);
    for (const [i, du, dw] of CRACK_BRANCHES) {
      const q = [P[i][0] + (du / 0.4) * P.unit * 0.4, P[i][1] - (dw / 0.4) * P.unit * 0.4];
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      ctx.lineTo(lerp(q[0], pts[i][0], m), lerp(q[1], pts[i][1], m));
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── 막 제목과 공정 낱말 ── */
  function drawActTexts(t) {
    const T = L.title3 || L.title;
    // 3막 "골라내는 / 손"
    riseText('골라내는', T.x, T.ySmall, T.small, { t, tin: 9.0, tout: 9.66, outDur: 0.2, weight: 700, color: C.sky, stagger: 0.045 });
    riseText('손', T.x - T.big * 0.04, T.yBig, T.big, { t, tin: 9.06, tout: 9.66, outDur: 0.22, weight: 900, color: C.sky });
    // 4막: 박마다 낱말 하나. 아래에는 네 단계 줄
    if (t >= 10.0 && t < 14.0) {
      const w = L.words;
      const words = ['이송', '촬영', '판정', '분류'];
      const exit = E.inCubic(prog(t, 13.55, 13.8));
      for (let i = 0; i < 4; i++) {
        // 앞 낱말은 박 직전에 위로 빠지고, 새 낱말이 박에 맞춰 올라온다
        const tin = 10.0 + i, tout = i < 3 ? 10.86 + i : 13.55, outDur = i < 3 ? 0.14 : 0.25;
        riseText(String(i + 1).padStart(2, '0'), w.x, w.yNum, 34, { t, tin, tout, outDur, weight: 700, color: C.sky, alpha: 0.6, stagger: 0.03 });
        riseText(words[i], w.x - w.size * 0.03, w.y, w.size, { t, tin, tout, outDur, weight: 900, color: C.sky, stagger: 0.05 });
      }
      // 네 단계 줄
      ctx.save();
      setFont(w.seqSize, 700);
      let x = w.x;
      const appear = E.outCubic(prog(t, 10.05, 10.4));
      ctx.globalAlpha = appear * (1 - exit);
      for (let i = 0; i < 4; i++) {
        const on = t >= 10.0 + i;
        const active = on && (i === 3 || t < 11.0 + i);
        ctx.fillStyle = C.sky;
        ctx.globalAlpha = appear * (1 - exit) * (active ? 1 : on ? 0.55 : 0.25);
        ctx.fillText(words[i], x, w.ySeq);
        x += ctx.measureText(words[i]).width;
        if (i < 3) {
          ctx.globalAlpha = appear * (1 - exit) * 0.35;
          ctx.fillText('  →  ', x, w.ySeq);
          x += ctx.measureText('  →  ').width;
        }
      }
      ctx.restore();
    }
  }

  /* ── 웹 HMI (12~14초) ── */
  function hmiGeom(k) {
    const [x, y, w, h] = L.hmi.win;
    const pad = 22;
    let cam, left = null;
    if (L.hmi.split === 'side') {
      const lw = 330;
      const cw = w - pad * 3 - lw;
      cam = { x: x + pad * 2 + lw, y: y + pad, w: cw, h: (cw * 9) / 16 };
      left = { x: x + pad, y: y + pad, w: lw, h: h - pad * 2 };
    } else {
      const cw = w - pad * 2;
      cam = { x: x + pad, y: y + pad, w: cw, h: (cw * 9) / 16 };
    }
    const full = { x: 0, y: 0, w: W, h: H };
    const camK = {
      x: lerp(full.x, cam.x, k), y: lerp(full.y, cam.y, k),
      w: lerp(full.w, cam.w, k), h: lerp(full.h, cam.h, k),
    };
    return { win: { x, y, w, h }, pad, cam: camK, camFinal: cam, left };
  }
  function drawHmiChrome(t, g, hk) {
    const { win } = g;
    // 판은 처음부터 있어서, 카메라 화면이 줄어들면 그 둘레로 창이 드러난다. 조작 요소는 뒤따라 나타난다
    ctx.save();
    ctx.globalAlpha = clamp(hk * 3);
    ctx.fillStyle = 'rgba(5,18,48,0.28)';
    roundRect(win.x + 10, win.y + 18, win.w, win.h, 18);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = HMI.plate;
    roundRect(win.x, win.y, win.w, win.h, 18);
    ctx.fill();
    ctx.strokeStyle = HMI.line;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const a = clamp((hk - 0.45) / 0.4);
    if (a <= 0) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha = a;
    const cam = g.camFinal;
    const judged = t >= 12.0;
    const ui = (size, weight = 600) => setFont(size, weight, UI_FONT);
    const key = (x, y, w, h, label, o = {}) => {
      ctx.fillStyle = o.fill || HMI.key;
      roundRect(x, y, w, h, 8);
      ctx.fill();
      if (o.border) {
        ctx.strokeStyle = o.border;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ui(o.size || 20, 600);
      ctx.fillStyle = o.ink || HMI.ink;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, y + h / 2 + (o.size || 20) * 0.36);
      ctx.textAlign = 'left';
    };
    const toggle = (x, y, w, h, title, items, sel) => {
      ui(16, 600);
      ctx.fillStyle = HMI.ink2;
      ctx.fillText(title, x, y - 10);
      const iw = (w - 8) / items.length;
      items.forEach((it, i) => key(x + i * (iw + 8), y, iw, h, it, i === sel ? { border: HMI.ink } : { fill: 'rgba(0,0,0,0)', ink: HMI.ink2 }));
    };
    const statCard = (x, y, w, h, label, value, hot) => {
      ctx.fillStyle = HMI.bg;
      roundRect(x, y, w, h, 8);
      ctx.fill();
      ui(17, 600);
      ctx.fillStyle = HMI.ink2;
      ctx.fillText(label, x + 18, y + 32);
      ui(44, 600);
      ctx.fillStyle = hot ? C.coral : HMI.ink;
      ctx.fillText(String(value), x + 18, y + h - 20);
    };
    const devices = (x, y, w) => {
      ui(16, 600);
      ctx.fillStyle = HMI.ink2;
      ctx.fillText('장치 연결', x, y + 6);
      let dx = x + 98;
      for (const name of ['서버', '컨베이어', '로봇팔', '리더암', '카메라']) {
        ctx.fillStyle = HMI.green;
        ctx.beginPath();
        ctx.arc(dx + 7, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ui(17, 600);
        ctx.fillStyle = HMI.ink;
        ctx.fillText(name, dx + 20, y + 6);
        dx += 26 + ctx.measureText(name).width + 22;
      }
    };
    const badCount = judged ? 3 : 2;
    const hot = t >= 12.0 && t < 12.6;
    if (L.hmi.split === 'side') {
      const lp = g.left;
      // 상태
      ctx.fillStyle = HMI.bg;
      roundRect(lp.x, lp.y, lp.w, 92, 8);
      ctx.fill();
      ctx.fillStyle = HMI.green;
      ctx.beginPath();
      ctx.arc(lp.x + 30, lp.y + 46, 8, 0, Math.PI * 2);
      ctx.fill();
      ui(24, 600);
      ctx.fillStyle = HMI.ink;
      ctx.fillText('자동 운전 중', lp.x + 52, lp.y + 42);
      ui(15, 400);
      ctx.fillStyle = HMI.ink2;
      ctx.fillText('라인 가동 · 원점 설정됨', lp.x + 52, lp.y + 68);
      // 긴급정지
      const ey = lp.y + 108;
      ctx.fillStyle = HMI.yellow;
      roundRect(lp.x, ey, 104, 104, 10);
      ctx.fill();
      ctx.fillStyle = HMI.red;
      ctx.beginPath();
      ctx.arc(lp.x + 52, ey + 52, 36, 0, Math.PI * 2);
      ctx.fill();
      ui(20, 600);
      ctx.fillStyle = HMI.ink;
      ctx.fillText('긴급정지', lp.x + 124, ey + 46);
      ui(15, 400);
      ctx.fillStyle = HMI.ink2;
      ctx.fillText('누르면 라인이 멈춥니다', lp.x + 124, ey + 72);
      // 시작/정지
      key(lp.x, ey + 122, lp.w, 84, '정지', { fill: HMI.ink, ink: HMI.dark, size: 26 });
      key(lp.x, ey + 222, (lp.w - 10) / 2, 58, '원점 복귀', { size: 18 });
      key(lp.x + (lp.w + 10) / 2, ey + 222, (lp.w - 10) / 2, 58, '원점 잡기', { size: 18, fill: 'rgba(0,0,0,0)', ink: HMI.ink3 });
      toggle(lp.x, ey + 330, lp.w, 52, '운전 모드', ['자동', '수동'], 0);
      toggle(lp.x, ey + 420, lp.w, 52, '로봇팔이 옮길 부품', ['양품', '불량품'], 1);
      // 통계와 장치 연결
      const sy = cam.y + cam.h + 16;
      const sw = (cam.w - 12) / 2;
      statCard(cam.x, sy, sw, 104, '양품', 41, false);
      statCard(cam.x + sw + 12, sy, sw, 104, '불량', badCount, hot);
      devices(cam.x, sy + 104 + 40, cam.w);
    } else {
      // 세로판: 카메라 → 통계 → 조작 줄 → 장치 연결
      const sy = cam.y + cam.h + 16;
      const sw = (cam.w - 12) / 2;
      statCard(cam.x, sy, sw, 104, '양품', 41, false);
      statCard(cam.x + sw + 12, sy, sw, 104, '불량', badCount, hot);
      const cy = sy + 104 + 16;
      ctx.fillStyle = HMI.yellow;
      roundRect(cam.x, cy, 104, 104, 10);
      ctx.fill();
      ctx.fillStyle = HMI.red;
      ctx.beginPath();
      ctx.arc(cam.x + 52, cy + 52, 36, 0, Math.PI * 2);
      ctx.fill();
      key(cam.x + 120, cy, cam.w - 120 - 220, 104, '정지', { fill: HMI.ink, ink: HMI.dark, size: 30 });
      ctx.fillStyle = HMI.bg;
      roundRect(cam.x + cam.w - 204, cy, 204, 104, 8);
      ctx.fill();
      ctx.fillStyle = HMI.green;
      ctx.beginPath();
      ctx.arc(cam.x + cam.w - 176, cy + 52, 8, 0, Math.PI * 2);
      ctx.fill();
      ui(22, 600);
      ctx.fillStyle = HMI.ink;
      ctx.fillText('자동 운전', cam.x + cam.w - 158, cy + 60);
      devices(cam.x, cy + 104 + 44, cam.w);
    }
    ctx.restore();
  }
  function drawCamOverlay(t, g, hk, view) {
    const a = clamp(hk * 2 - 0.6);
    if (a <= 0) return;
    const cam = g.cam;
    ctx.save();
    ctx.globalAlpha = a;
    setFont(15, 600, UI_FONT);
    const chip = (x, label, on) => {
      const w = ctx.measureText(label).width + 28;
      ctx.strokeStyle = on ? HMI.ink : 'rgba(228,231,234,0.5)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.fillStyle = on ? 'rgba(14,17,19,0.75)' : 'rgba(14,17,19,0.45)';
      roundRect(x, cam.y + 14, w, 34, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = HMI.ink;
      ctx.fillText(label, x + 14, cam.y + 36);
      return w;
    };
    const w1 = chip(cam.x + 14, '탑뷰', true);
    chip(cam.x + 14 + w1 + 8, '그리퍼', false);
    // 판정 표: 12초에 불량
    if (t >= 12.0) {
      const k = E.outBack(prog(t, 12.0, 12.25), 2);
      const z = view.z;
      const px = cam.x + cam.w / 2 + (0 - view.cx) * z, py = cam.y + cam.h / 2 + (-20 - view.cy) * z;
      const label = '불량';
      setFont(20, 800);
      const bw = ctx.measureText(label).width + 22, bh = 32;
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(k, k);
      ctx.fillStyle = C.coral;
      roundRect(-bw / 2, -bh - 10, bw, bh, 6);
      ctx.fill();
      ctx.fillStyle = C.sky;
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, -bh - 10 + 23);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ── 브랜드 글 ── */
  function drawBrandText(t) {
    const B = L.brand;
    const T = B.title;
    riseText('불량을 찾는 눈,', T.x, T.y1, T.size, { t, tin: 14.5, weight: 800, color: C.sky, stagger: 0.03, dur: 0.7 });
    riseText('골라내는 손', T.x, T.y2, T.size, { t, tin: 15.0, weight: 800, color: C.sky, stagger: 0.035, dur: 0.7 });
    const D = B.desc;
    fadeText('카메라가 양품과 불량을 가리고,', D.x, D.y1, D.size, { t, tin: 15.6, weight: 500, color: C.sky, align: D.align });
    fadeText('로봇팔이 불량품만 골라 옮깁니다.', D.x, D.y2, D.size, { t, tin: 15.72, weight: 500, color: C.sky, align: D.align });
    // 머리: 학교와 팀
    const k = E.outCubic(prog(t, 16.0, 16.6));
    if (k > 0) {
      const M = B.mark;
      if (assets.mark) {
        ctx.save();
        ctx.globalAlpha = k;
        ctx.drawImage(assets.mark, M.x, M.y + (1 - k) * 14, M.size, M.size);
        ctx.restore();
      }
      const Sc = B.school;
      fadeText('대림대학교', Sc.x, Sc.y1, tall ? 38 : 34, { t, tin: 16.05, weight: 800 });
      fadeText('스마트소프트웨어학과', Sc.x, Sc.y2, tall ? 26 : 24, { t, tin: 16.12, weight: 500 });
      const Tm = B.team;
      fadeText('2026 캡스톤 디자인', Tm.x, Tm.y1, tall ? 28 : 30, { t, tin: 16.2, weight: 600, align: Tm.align });
      fadeText('이강현    전범수    황재준', Tm.x, Tm.y2, tall ? 30 : 30, { t, tin: 16.28, weight: 700, align: Tm.align });
    }
  }

  /* ── 한 프레임 ── */
  function draw(t) {
    t = clamp(t, 0, DURATION - 1e-6);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (t < 7.0) {
      drawField(t);
      drawHook(t);
    } else {
      drawWorldActs(t);
    }
    ctx.restore();
  }

  return { draw, duration: DURATION };
}
