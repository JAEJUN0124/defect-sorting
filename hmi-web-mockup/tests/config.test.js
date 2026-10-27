// 설정(js/config.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 메인 서버에 HMI를 올리면(wsUrl 'auto') 화면을 내준 서버의 /ws/hmi에 붙는다. 메인 서버용 묶음(tools/make-server-bundle.py)과 그 Cloudflare용 폴더(--dir),
// 같은 배치로 내주는 개발용 서버(tools/dev-server.py)도 본다.
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

// 컨베이어가 늦어져 장치 연결 줄에 늘 켜짐으로 보인다 (사용자 2026-10-19). 배열은 다른 실행 공간에서 만들어져 펼쳐서 비교한다
test('config.js: alwaysOn 기본은 컨베이어이고, 주소 뒤 ?alwaysOn=으로 바꾸거나(쉼표로 여럿) 비운다', () => {
  assert.deepEqual([...loadConfig('http://localhost:5174/').alwaysOn], ['conveyor']);
  assert.deepEqual([...loadConfig('http://localhost:5174/?alwaysOn=').alwaysOn], []);
  assert.deepEqual([...loadConfig('http://localhost:5174/?alwaysOn=conveyor,%20leader').alwaysOn], ['conveyor', 'leader']);
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

// 폴더 안 파일 목록 (/로 이은 상대 경로)
const listFiles = (dir) => fs.readdirSync(dir, { recursive: true })
  .filter((rel) => fs.statSync(path.join(dir, rel)).isFile())
  .map((rel) => rel.split(path.sep).join('/'))
  .sort();

test('make-server-bundle.py --dir: wwwroot/ 내용을 폴더에 씀(README 빼고, Cloudflare용) — 다시 쓰면 지난번에만 있던 파일이 없어지고, 묶음이 아닌 것이 든 폴더는 지우지 않음', { skip: (!PY && 'python 없음') || NO_DIST }, () => {
  const tool = path.join(__dirname, '..', 'tools', 'make-server-bundle.py');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-site-'));
  const site = path.join(dir, 'site');
  try {
    let run = spawnSync(PY, [tool, '--no-build', '--dir', site]);
    assert.equal(run.status, 0, String(run.stderr));
    const files = listFiles(site);
    assert.ok(files.includes('index.html'));
    // 검색에 걸리지 않게: 맨 위 robots.txt는 모두 막고, 조작 화면은 noindex (사용자 2026-10-28)
    assert.match(fs.readFileSync(path.join(site, 'robots.txt'), 'utf8'), /^User-agent: \*\r?\nDisallow: \/\r?$/m);
    assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), /<meta name="robots" content="noindex, nofollow">/);
    assert.ok(files.some((f) => /^assets\/.+\.js$/.test(f)));
    ['tools/server-check.html', 'tools/devices.html', 'js/config.js', 'js/xml.js', 'css/base.css'].forEach((f) => assert.ok(files.includes(f), f));
    assert.ok(!files.includes('README-server.md'));
    assert.ok(!files.some((f) => f.startsWith('tests/') || f.startsWith('react/') || f.endsWith('.py')));
    // Cloudflare에 올리면 점검 페이지도 같은 주소의 /ws/hmi에 붙는다 (Worker가 터널로 넘김)
    const cfg = loadConfig('https://hmi.example.net/tools/server-check.html', fs.readFileSync(path.join(site, 'js', 'config.js'), 'utf8'));
    assert.equal(cfg.useMock, false);
    assert.equal(cfg.wsUrl, 'wss://hmi.example.net/ws/hmi');

    fs.writeFileSync(path.join(site, 'assets', 'old.js'), '');
    run = spawnSync(PY, [tool, '--no-build', '--dir', site]);
    assert.equal(run.status, 0, String(run.stderr));
    assert.ok(!fs.existsSync(path.join(site, 'assets', 'old.js')));

    fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
    run = spawnSync(PY, [tool, '--no-build', '--dir', dir]);
    assert.notEqual(run.status, 0);
    assert.ok(fs.existsSync(path.join(dir, 'keep.txt')));
    assert.ok(fs.existsSync(path.join(site, 'index.html')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

// 시험 서버를 띄우고 출력에서 주소를 읽는다
function spawnAndRead(t, args, re) {
  const proc = spawn(PY, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  return new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (d) => { out += d; const m = re.exec(out); if (m) resolve(m[0]); });
    proc.on('exit', (code) => reject(new Error(args[0] + ' 종료 ' + code + ' ' + out)));
  });
}

test('dev-server.py --server: /ws/hmi(웹소켓)와 /video/…를 메인 서버로 그대로 잇고 화면 파일은 그대로 — 화면과 서버가 같은 주소 (브라우저가 상태 JSON을 막지 않음)', { skip: (!PY && 'python 없음') || NO_DIST }, async (t) => {
  // 메인 서버 흉내: 시험용 XML 서버 + 브릿지 영상
  const wsUrl = await spawnAndRead(t, [path.join(__dirname, 'xml-server.py'), '0', '--video'], /ws:\/\/[^\s]+\/ws\/hmi/);
  const upstream = wsUrl.replace(/^ws/, 'http').replace(/\/ws\/hmi$/, '');
  const base = await spawnAndRead(t, [path.join(__dirname, '..', 'tools', 'dev-server.py'), '0', '--server', upstream], /http:\/\/localhost:\d+\//);
  const st = await (await fetch(base + 'video/status')).json();
  assert.equal(typeof st.connected, 'boolean');
  assert.equal(st.cameras.length, 2);
  const first = await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + 'ws/hmi');
    ws.onmessage = (e) => { resolve(String(e.data)); ws.close(); };
    ws.onerror = () => reject(new Error('ws error'));
  });
  assert.match(first, /type="Status"/); // 서버가 접속 직후 보내는 상태
  assert.match(await (await fetch(base + 'index.html')).text(), /<div id="root">/);
});
