// HMI 설정 — 환경에 따라 바꾸는 값만 모아 둡니다.
// 화면이 그려지기 전에 테마를 정해야 해서 index.html의 <head>에서 가장 먼저 읽습니다.
window.HMI_CONFIG = {
  locale: 'ko',

  // 화면 테마: 'auto'(PC의 라이트/다크 설정을 따름), 'light', 'dark'
  // 우선순위: 주소의 ?theme= > 화면의 "다크 모드" 버튼으로 고른 값(브라우저에 저장) > 이 값
  theme: 'auto',

  // true: 브라우저 안의 가짜 서버(mock-server.js)로 동작합니다. 실제 서버가 생기면 false.
  useMock: true,
  // 서버 주소. XML 서버(서버 담당 규약 v1.0)는 웹소켓 하나만 쓴다: 다른 PC면 localhost를 서버 PC의 IP로.
  // 'auto'면 이 화면을 내준 서버의 /ws/hmi에 붙는다 — 메인 서버에 HMI를 올렸을 때 (http면 ws, https면 wss). 파일로 열면 localhost
  wsUrl: 'ws://localhost:5080/ws/hmi',
  apiBase: 'http://localhost:8000/api', // server.format이 'json'일 때만 씀

  // 개발 단계 전용 표시(장치 연결 상태, 임시 원점값 안내). 배포할 때 false.
  // 주소 뒤에 ?dev=0 또는 ?dev=1 을 붙이면 이 값보다 우선합니다.
  devMode: true,

  // 서버 메시지가 이 시간 동안 없으면 연결 끊김으로 표시합니다.
  // heartbeatRequired: 'auto'면 서버가 heartbeat를 한 번이라도 보낸 뒤부터만 이 시간을 잽니다
  //   (heartbeat를 안 보내는 서버를 6초마다 끊김으로 잘못 표시하지 않도록). true = 늘 잼, false = 재지 않음
  heartbeatTimeoutMs: 6000,
  heartbeatRequired: 'auto',

  // 로그를 최대 몇 줄까지 남길지
  logLimit: 200,

  // ---- 서버 형식 — 서버 담당이 정한 방식에 맞춰 여기만 바꾸면 됩니다 (대응표: docs/server-cases.md) ----
  server: {
    // 주고받는 글 모양: 'xml'(웹소켓 + XML, 서버 담당 규약 v1.0 — docs/server-xml-v1.0.md · docs/xml-protocol.md)
    //                   'json'(예전 초안 docs/API.md — 아래 push·commands·paths… 설정은 이때만 씀)
    format: 'xml',
    xml: {
      version: '1.0',        // 보내는 메시지의 version
      replyTimeoutMs: 5000,  // 이 안에 서버의 답(Reply)이 없으면 "응답 미확인" (실패로 단정하지 않음)
      statusTimeoutMs: 65000, // 서버 메시지(상태·Pong·답)가 이 시간 동안 없으면 끊김으로 보고 다시 붙음. pingMs보다 길게 (짧으면 pingMs + 5초로 씀)
      pingMs: 60000,          // 연결 확인: 이 간격으로 Ping을 보내 Pong을 받음 (사용자 2026-10-16: 60초). 조용히 끊기면 최대 statusTimeoutMs 뒤에 앎. 0이면 보내지 않음
      statusPollMs: 60000,   // 서버 상태가 이 시간 동안 오지 않으면 HMI가 GetStatus로 물음. 원점 잡기 때 각도가 오래됐으면 그때도 한 번 물음. 0이면 묻지 않음
      homePose: true,        // 원점 복귀 때 HMI가 저장한 원점 각도를 함께 보냄 (서버가 받아 검사함). 각도를 받지 않는 옛 서버면 false로 이름만
      // commands: { stop: 'Stop', … } — 서버 명령 이름 바꾸기 (기본값과 요청안 이름: js/xml-protocol.js DEFAULTS)
    },
    push: 'ws',            // 실시간 메시지를 받는 방식: 'ws' · 'socketio' · 'sse' · 'poll'
    commands: 'http',      // 명령을 보내는 방식: 'http'(REST) · 'ws'(push 연결로)
    timeoutMs: 8000,       // 명령 응답을 기다리는 시간
    pollMs: 500,           // push가 'poll'일 때 상태를 묻는 간격
    sseUrl: 'http://localhost:8000/api/events',
    socketioPath: '/socket.io/',
    socketioNamespace: '/',
    paths: {},             // 경로 바꾸기. 예: { start: '/run', mode: 'POST /mode/set' } (이름은 js/transport.js COMMANDS)
    commandNames: {},      // commands가 'ws'일 때 명령 이름 바꾸기. 예: { start: 'line_start' }
    modeValues: {},        // 운전 모드 값 바꾸기. 예: { auto: 'AUTO', manual: 'MANUAL' }
    headers: {},           // 모든 요청에 붙일 머리글. 예: { Authorization: 'Bearer …' }
    startBody: null,       // 시작 요청에 함께 보낼 값. 예: { speed: 40 }
    clientPingMs: 0,       // 0보다 크면 이 간격으로 HMI가 ping을 보냄 (서버가 HMI 끊김을 알아야 할 때, push 'ws'만)
    naiveTime: 'local',    // 시간대 없는 시각을 'local'(이 PC 시간) 또는 'utc'로 읽음. 9시간 어긋나면 'utc'
  },

  // ---- 카메라 ----
  cameras: {
    primary: 'auto',       // 조작 화면에 띄울 카메라 id. 'auto' = 서버 목록의 첫 번째 (브릿지 영상이면 화면의 탑뷰/그리퍼 바꾸기가 정함)
    transport: 'auto',     // 'auto'(서버가 알려 준 방식) · 'mjpeg' · 'snapshot' · 'ws' · 'webrtc' · 'video' · 'local'
    snapshotFps: 5,        // transport가 'snapshot'일 때 초당 장수
    bboxFormat: 'xywh',    // 판정 상자 좌표: 'xywh' · 'xyxy' · 'cxcywh'(YOLO)
    overlay: true,         // 서버가 판정 상자 좌표를 보내면 영상 위에 그림 (서버가 영상에 직접 그리면 false)
    // 화면에 쓰는 카메라 이름. 서버의 카메라 id를 키로 씁니다 (top·close는 서버 담당 안내의 탑뷰·그리퍼 카메라, 2026-10-17)
    labels: { main: '카메라', top: '탑뷰', close: '그리퍼', side: '옆 카메라', wrist: '손목 카메라', front: '앞 카메라' },
    // 브릿지 서버의 영상 (서버 담당 안내 2026-10-17 — docs/hmi-video-integration.md). XML 서버면 /ws/hmi와 같은 호스트·포트의 HTTP로 받는다.
    // Status에 Camera가 없고 CameraStart·CameraStop도 없어, HMI가 주소를 직접 열고 닫는다. 카메라 상태는 statusPath(JSON)로만 본다.
    // 화면을 서버와 다른 주소에서 열면 브라우저가 상태 JSON을 막는다 — 같은 주소로 연다 (메인 서버 · Cloudflare · dev-server.py --server).
    // null이면 쓰지 않고 예전 방식(Status의 Camera · 카메라 명령)으로 돌아간다
    bridge: {
      statusPath: '/video/status',
      pollMs: 1000,        // 상태를 다시 묻는 간격 — 앞 조회가 끝난 뒤부터 잼 (요청이 겹치지 않게)
      timeoutMs: 3000,     // 상태 요청 제한 시간. 넘으면 "영상 상태 확인 불가"
      // HMI 카메라 이름 → 서버 카메라 번호(상태 JSON의 id)와 영상 주소. 먼저 적은 것이 처음 보이는 카메라
      streams: { top: { id: 1, path: '/video/1.mjpg' }, close: { id: 2, path: '/video/2.mjpg' } },
    },
    // transport가 'local'일 때 이 PC에 꽂힌 USB 카메라를 직접 띄움 (tools/devices.html에서 고른 값이 저장됨)
    // upload: 서버가 영상을 HMI에서 받아야 할 때 보낼 주소. 예: 'ws://localhost:8000/ws/camera/{id}/upload'
    local: { upload: null, uploadFps: 10, quality: 0.8 },
  },
};

(function () {
  const cfg = window.HMI_CONFIG;
  const params = new URLSearchParams(location.search);

  const dev = params.get('dev');
  if (dev === '0' || dev === '1') cfg.devMode = dev === '1';

  // 시험할 때 설정 파일을 고치지 않고 서버를 바꿔 끼운다: ?mock=0&ws=ws://서버:5080/ws/hmi
  //   예전 JSON 서버: ?mock=0&format=json&api=http://서버:8000/api&ws=ws://서버:8000/ws&push=socketio
  const mock = params.get('mock');
  if (mock === '0' || mock === '1') cfg.useMock = mock === '1';
  if (['xml', 'json'].includes(params.get('format'))) cfg.server.format = params.get('format');
  if (params.get('api')) cfg.apiBase = params.get('api');
  if (params.get('ws')) cfg.wsUrl = params.get('ws');
  // 메인 서버에 올린 HMI(wsUrl 'auto', 주소 뒤 ?ws=auto로도): 화면을 내준 서버의 웹소켓
  if (cfg.wsUrl === 'auto') {
    const served = /^https?:$/.test(location.protocol) && location.host;
    cfg.wsUrl = served ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/hmi' : 'ws://localhost:5080/ws/hmi';
  }
  if (['ws', 'socketio', 'sse', 'poll'].includes(params.get('push'))) cfg.server.push = params.get('push');
  if (params.get('homePose') === '0' || params.get('homePose') === '1') cfg.server.xml.homePose = params.get('homePose') === '1';

  let saved = null;
  try { saved = localStorage.getItem('hmi.theme'); } catch (e) { /* 저장소가 막힌 브라우저 */ }
  if (saved === 'light' || saved === 'dark') cfg.theme = saved;

  const theme = params.get('theme');
  if (theme === 'auto' || theme === 'light' || theme === 'dark') cfg.theme = theme;
  // 'auto'면 속성을 비워 두어 CSS가 PC 설정(prefers-color-scheme)을 따르게 한다
  if (cfg.theme === 'light' || cfg.theme === 'dark') document.documentElement.dataset.theme = cfg.theme;
})();
