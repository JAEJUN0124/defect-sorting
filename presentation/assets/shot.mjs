// 발표 자료용 HMI 화면 사진: 시뮬레이션 XML 서버(5092)에 붙은 조작 화면을 라이트·다크로 찍는다.
// 카메라 칸은 시험 프레임 대신 그린 탑뷰 그림으로 바꿔 보인다(요청 가로채기).
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
const out = process.argv[3];
mkdirSync(out, { recursive: true });
const require = createRequire(join(repo, 'promo', 'package.json'));
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--hide-scrollbars'],
});

// 탑뷰: 컨베이어 위 부품 셋, 가운데 하나는 모서리가 깨짐 (표시 없음)
function part(x, y, s, broken) {
  const body = broken
    ? `<path d="M${x} ${y + 18} q0 -18 18 -18 h${s - 70} l52 46 v${s - 64} q0 18 -18 18 h${-(s - 36)} q-18 0 -18 -18 z" fill="#b9c0c7"/>
       <path d="M${x + s - 52} ${y} l52 46" stroke="#6d757d" stroke-width="3"/>
       <path d="M${x + s - 30} ${y + 26} l-38 34 l-14 40" stroke="#4c5359" stroke-width="4" fill="none" stroke-linecap="round"/>`
    : `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="18" fill="#b9c0c7"/>`;
  return `${body}<rect x="${x + 34}" y="${y + 34}" width="${s - 68}" height="${s - 68}" rx="10" fill="none" stroke="#9aa2aa" stroke-width="4"/>`;
}
function scene(zoom) {
  const slats = Array.from({ length: 40 }, (_, i) => `<rect x="${i * 36}" y="0" width="3" height="720" fill="#262b2f"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs><radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>
    <rect width="1280" height="720" fill="#1a1e21"/>
    <g transform="${zoom ? 'translate(-680 -420) scale(2)' : ''}">
      <rect x="0" y="190" width="1280" height="340" fill="#30363b"/>
      <g clip-path="none" opacity="0.9"><svg x="0" y="190" width="1280" height="340">${slats}</svg></g>
      <rect x="0" y="176" width="1280" height="14" fill="#596169"/><rect x="0" y="530" width="1280" height="14" fill="#596169"/>
      ${part(150, 285, 150, false)}${part(565, 285, 150, true)}${part(980, 285, 150, false)}
    </g>
    <rect width="1280" height="720" fill="url(#v)"/>
  </svg>`;
}
async function frame(zoom) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  await p.setContent(`<body style="margin:0">${scene(zoom)}</body>`);
  const jpg = await p.screenshot({ type: 'jpeg', quality: 92 });
  await p.close();
  return jpg;
}
const frames = { 1: await frame(false), 2: await frame(true) };

const home = {
  angles: { shoulder_pan: 0, shoulder_lift: -32.5, elbow_flex: 41.2, wrist_flex: 12.4, wrist_roll: 0, gripper: 18 },
  units: {}, source: 'arm', setAt: new Date().toISOString(),
};
async function open(theme) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1600, height: 960, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument((h) => { localStorage.setItem('hmi.home', h); }, JSON.stringify(home));
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const m = r.url().match(/\/video\/([12])\.mjpg/);
    if (m) r.respond({ status: 200, contentType: 'image/jpeg', body: frames[m[1]] });
    else r.continue();
  });
  await p.goto(`http://127.0.0.1:5092/?theme=${theme}`, { waitUntil: 'networkidle2' });
  return p;
}
const pages = { light: await open('light'), dark: await open('dark') };
await new Promise((r) => setTimeout(r, 3000));
const clicked = await pages.light.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '시작');
  if (b && !b.disabled) { b.click(); return true; }
  return b ? 'disabled' : 'none';
});
console.log('start clicked:', clicked);
for (const p of Object.values(pages)) {
  const cam = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '카메라 연결');
    if (b) { b.click(); return true; }
    return false;
  });
  console.log('camera clicked:', cam);
}
await new Promise((r) => setTimeout(r, Number(process.argv[4] || 30000)));
// 뒤에 있는 탭은 영상 상태를 묻지 않으므로(숨은 탭) 찍기 전에 앞으로 가져온다
for (const [t, p] of Object.entries(pages)) {
  await p.bringToFront();
  await new Promise((r) => setTimeout(r, 5000));
  await p.screenshot({ path: join(out, `hmi-${t}.png`) });
  console.log('saved', t);
}
await browser.close();
