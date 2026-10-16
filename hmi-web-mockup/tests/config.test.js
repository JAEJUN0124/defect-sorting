// 설정(js/config.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 메인 서버에 HMI를 올리면(wsUrl 'auto') 화면을 내준 서버의 /ws/hmi에 붙는다. 메인 서버용 묶음(tools/make-server-bundle.py)과 같은 배치로 내주는 개발용 서버(tools/dev-server.py)도 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');

const CONFIG = path.join(__dirname, '..', 'js', 'config.js');

// config.js를 브라우저처럼 실행한다: 주소(location)를 정하고 window.HMI_CONFIG를 돌려준다
function loadConfig(href, source) {
  const url = new URL(href);
  const window = {};
  const ctx = {
    window,
    location: { protocol: url.protocol, host: url.host, search: url.search },
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem: () => null },
    URLSearchParams,
  };
  vm.runInNewContext(source || fs.readFileSync(CONFIG, 'utf8'), ctx);
  return window.HMI_CONFIG;
}

const auto = (src) => src.replace(/wsUrl:\s*'[^']*'/, "wsUrl: 'auto'");

test("config.js: wsUrl 'auto'면 화면을 내준 서버의 /ws/hmi (http는 ws, https는 wss), 파일로 열면 localhost", () => {
  const src = auto(fs.readFileSync(CONFIG, 'utf8'));
  assert.equal(loadConfig('http://10.108.108.98:5080/', src).wsUrl, 'ws://10.108.108.98:5080/ws/hmi');
  assert.equal(loadConfig('https://hmi.example:8443/tools/server-check.html', src).wsUrl, 'wss://hmi.example:8443/ws/hmi');
  assert.equal(loadConfig('file:///C:/hmi/index.html', src).wsUrl, 'ws://localhost:5080/ws/hmi');
});

test('config.js: 주소 뒤 ?ws=auto도 같고, ?ws=주소는 그 주소를 쓴다 (기본 설정)', () => {
  assert.equal(loadConfig('http://10.108.108.216:8080/?mock=0&ws=auto').wsUrl, 'ws://10.108.108.216:8080/ws/hmi');
  assert.equal(loadConfig('http://localhost:5173/?mock=0&ws=ws://10.108.108.98:5080/ws/hmi').wsUrl, 'ws://10.108.108.98:5080/ws/hmi');
  const plain = loadConfig('http://localhost:5173/');
  assert.equal(plain.wsUrl, 'ws://localhost:5080/ws/hmi');
  assert.equal(plain.useMock, true); // 기본은 브라우저 안 가짜 서버
});

const PY = ['python', 'python3'].find((cmd) => { try { return spawnSync(cmd, ['--version']).status === 0; } catch (e) { return false; } });

const REACT = path.join(__dirname, '..', 'react');
const NO_REACT = !fs.existsSync(path.join(REACT, 'node_modules')) && 'react/에서 npm install 안 함';

test('make-server-bundle.py: wwwroot/에 React 조작 화면과 점검 페이지, 점검 페이지 설정은 메인 서버용, 시험·개발 도구·React 소스는 뺌', { skip: (!PY && 'python 없음') || NO_REACT }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-bundle-'));
  const zip = path.join(dir, 'bundle.zip');
  const run = spawnSync(PY, [path.join(__dirname, '..', 'tools', 'make-server-bundle.py'), zip]); // React 빌드 포함
  assert.equal(run.status, 0, String(run.stderr));
  // 묶음 안을 파이썬으로 꺼내 본다 (node에는 zip 읽기가 없다)
  const read = spawnSync(PY, ['-I', '-c', [
    'import json, sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    "print(json.dumps({'names': z.namelist(), 'config': z.read('wwwroot/js/config.js').decode('utf-8'), 'index': z.read('wwwroot/index.html').decode('utf-8')}))",
  ].join('\n'), zip]);
  assert.equal(read.status, 0, String(read.stderr));
  const { names, config, index } = JSON.parse(String(read.stdout));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(names.includes('README-server.md'));
  assert.match(index, /<div id="root">/); // 조작 화면은 React 빌드
  assert.ok(names.some((n) => /^wwwroot\/assets\/.+\.js$/.test(n)));
  ['tools/server-check.html', 'tools/server-check.js', 'tools/devices.html', 'js/config.js', 'js/xml.js', 'css/base.css'].forEach((f) => assert.ok(names.includes('wwwroot/' + f), f));
  ['tools/dev-server.py', 'tools/make-server-bundle.py'].forEach((f) => assert.ok(!names.includes('wwwroot/' + f), f));
  assert.ok(!names.some((n) => n.startsWith('wwwroot/tests/') || n.startsWith('wwwroot/react/')));
  const cfg = loadConfig('http://10.108.108.98:5080/', config);
  assert.equal(cfg.useMock, false);
  assert.equal(cfg.wsUrl, 'ws://10.108.108.98:5080/ws/hmi');
});

// 위 시험이 react/dist를 새로 빌드한 뒤에 돈다 (같은 파일 안의 시험은 차례로 돈다)
const NO_DIST = !fs.existsSync(path.join(REACT, 'dist', 'index.html')) && 'react/dist 없음 (npm run build 안 함)';

test('dev-server.py: / 는 React 조작 화면(react/dist), 그 밖은 hmi-web-mockup 파일 (메인 서버 묶음과 같은 배치)', { skip: (!PY && 'python 없음') || NO_DIST }, async (t) => {
  const proc = spawn(PY, [path.join(__dirname, '..', 'tools', 'dev-server.py'), '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  const base = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = /http:\/\/localhost:\d+\//.exec(out); if (m) resolve(m[0]); });
    proc.on('exit', (code) => reject(new Error('dev-server.py 종료 ' + code + ' ' + out)));
  });
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
  assert.match((await get('')).text, /<div id="root">/);
  assert.match((await get('index.html')).text, /<div id="root">/);
  assert.equal((await get('tools/devices.html')).status, 200);
  assert.match((await get('js/config.js')).text, /HMI_CONFIG/); // 점검 페이지가 읽는 파일
});
