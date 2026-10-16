// 설정(js/config.js) 시험 — 실행: node --test "hmi-web-mockup/tests/*.test.js"
// 메인 서버에 HMI를 올리면(wsUrl 'auto') 화면을 내준 서버의 /ws/hmi에 붙는다. 메인 서버용 묶음(tools/make-server-bundle.py)도 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

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
  assert.equal(loadConfig('https://hmi.example:8443/dashboard.html', src).wsUrl, 'wss://hmi.example:8443/ws/hmi');
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

test('make-server-bundle.py: wwwroot/에 화면 파일, 설정은 메인 서버용(가짜 서버 끔·wsUrl auto), 시험·개발 도구는 뺌', { skip: !PY && 'python 없음' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmi-bundle-'));
  const zip = path.join(dir, 'bundle.zip');
  const run = spawnSync(PY, [path.join(__dirname, '..', 'tools', 'make-server-bundle.py'), zip]);
  assert.equal(run.status, 0, String(run.stderr));
  // 묶음 안의 설정을 파이썬으로 꺼내 본다 (node에는 zip 읽기가 없다)
  const read = spawnSync(PY, ['-I', '-c', [
    'import json, sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    "print(json.dumps({'names': z.namelist(), 'config': z.read('wwwroot/js/config.js').decode('utf-8')}))",
  ].join('\n'), zip]);
  assert.equal(read.status, 0, String(read.stderr));
  const { names, config } = JSON.parse(String(read.stdout));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(names.includes('README-server.md'));
  ['index.html', 'dashboard.html', 'dashboard-tabs.html', 'js/store.js', 'tools/server-check.html'].forEach((f) => assert.ok(names.includes('wwwroot/' + f), f));
  assert.ok(!names.some((n) => n.startsWith('wwwroot/tests/')));
  assert.ok(!names.includes('wwwroot/tools/dev-server.py'));
  const cfg = loadConfig('http://10.108.108.98:5080/', config);
  assert.equal(cfg.useMock, false);
  assert.equal(cfg.wsUrl, 'ws://10.108.108.98:5080/ws/hmi');
});
