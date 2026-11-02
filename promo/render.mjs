// 홍보 영상 렌더: 헤드리스 크롬에서 scene을 한 프레임씩 그려 ffmpeg로 MP4(H.264 + AAC)를 만든다.
//
//   node promo/render.mjs                         최신 판(v3)의 가로판 promo/out/v3/promo-16x9.mp4
//   node promo/render.mjs --v v1 --format tall    v1의 세로판 promo/out/v1/promo-9x16.mp4
//   node promo/render.mjs --stills 0,5.2,14.9     그 시각(초)의 정지 화면만 promo/out/<판>/stills/에 PNG로
//   node promo/render.mjs --mux                   소리만 바꿨을 때: 그려 둔 영상에 promo/out/<판>/soundtrack.wav를 다시 입힘
//   --samples 16  모션 블러 표본 수(1이면 끔)   --crf 16  화질   --from/--to 프레임 범위(시험용)
//
// 그림만 담은 영상은 promo/out/<판>/.video-<비율>.mp4에 남겨 두고, 소리를 입힌 완성본을 promo/out/<판>/promo-<비율>.mp4로 만든다.
//
// ffmpeg는 PATH에 있거나 FFMPEG 환경 변수로 준다. 크롬은 CHROME 환경 변수가 없으면 설치된 Chrome·Edge를 찾는다.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startServer } from './tools/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const VERSIONS = ['v1', 'v2', 'v3'];
const version = VERSIONS.includes(args.v) ? args.v : VERSIONS[VERSIONS.length - 1];
const OUT = path.join(HERE, 'out', version);
const format = args.format === 'tall' ? 'tall' : 'wide';
const samples = Number(args.samples ?? 16);
const crf = Number(args.crf ?? 17);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const NAME = format === 'tall' ? '9x16' : '16x9';
const VIDEO = path.join(OUT, `.video-${NAME}.mp4`);
const FINAL = path.join(OUT, `promo-${NAME}.mp4`);
const AUDIO = path.join(OUT, 'soundtrack.wav');

function run(cmd, argv, opts = {}) {
  const p = spawn(cmd, argv, { stdio: ['pipe', 'inherit', 'inherit'], ...opts });
  const done = new Promise((resolve, reject) => p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} 종료 코드 ${code}`)))));
  return { p, done };
}
// 그림만 담은 영상에 소리를 입힌다(영상은 다시 압축하지 않음). 소리가 없으면 그대로 옮긴다
async function mux() {
  const withAudio = existsSync(AUDIO) && !args['no-audio'];
  await run(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', VIDEO,
    ...(withAudio ? ['-i', AUDIO, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest'] : []),
    '-c:v', 'copy', '-movflags', '+faststart', FINAL,
  ]).done;
  console.log(`${FINAL}${withAudio ? ' (소리 포함)' : ' (소리 없음)'}`);
}
if (args.mux) {
  await mux();
  process.exit(0);
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('크롬을 찾지 못했습니다. CHROME 환경 변수로 경로를 주세요.');
  return found;
}

const server = await startServer(0);
const { port } = server.address();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  const size = format === 'tall' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  await page.setViewport({ ...size, deviceScaleFactor: 1 });
  page.on('console', m => console.log('[page]', m.text()));
  page.on('pageerror', e => console.error('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/promo/player.html?v=${version}&format=${format}&render=1`);
  await page.waitForFunction('window.__ready === true', { timeout: 60000 });
  const info = await page.evaluate(() => ({ frames: window.__render.frames, FPS: window.__render.FPS }));
  const grab = async (i, s) => {
    const url = await page.evaluate((i, s) => window.__render.renderFrame(i, s), i, s);
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };

  if (args.stills) {
    const dir = path.join(OUT, 'stills');
    mkdirSync(dir, { recursive: true });
    for (const sec of String(args.stills).split(',').map(Number)) {
      const i = Math.round(sec * info.FPS);
      const file = path.join(dir, `${format}-${String(i).padStart(3, '0')}.png`);
      writeFileSync(file, await grab(i, samples));
      console.log(file);
    }
  } else {
    mkdirSync(OUT, { recursive: true });
    const from = Number(args.from ?? 0), to = Number(args.to ?? info.frames);
    const whole = from === 0 && to === info.frames;
    const out = whole ? VIDEO : path.join(OUT, `test-${NAME}.mp4`);
    // 캔버스는 sRGB라 BT.709로 바꿔 담는다 (ffmpeg 기본값 BT.601이면 산호색이 틀어진다)
    const { p: ff, done } = run(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(info.FPS), '-c:v', 'png', '-i', '-',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-tune', 'film',
      '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', out,
    ]);
    const started = Date.now();
    for (let i = from; i < to; i++) {
      const png = await grab(i, samples);
      if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 30 === 0 || i === to - 1) {
        const per = (Date.now() - started) / (i - from + 1);
        process.stdout.write(`\r프레임 ${i + 1}/${to}  (${(per / 1000).toFixed(2)}초/프레임, 남은 시간 약 ${Math.round(((to - i - 1) * per) / 1000)}초)   `);
      }
    }
    ff.stdin.end();
    await done;
    console.log('');
    if (whole) await mux();
    else console.log(out);
  }
} finally {
  await browser.close();
  server.close();
}
