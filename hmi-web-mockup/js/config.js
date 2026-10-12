// HMI 설정 — 환경에 따라 바꾸는 값만 모아 둡니다.
// 화면이 그려지기 전에 테마를 정해야 해서 index.html의 <head>에서 가장 먼저 읽습니다.
window.HMI_CONFIG = {
  locale: 'ko',

  // 화면 테마: 'auto'(PC의 라이트/다크 설정을 따름), 'light', 'dark'
  // 우선순위: 주소의 ?theme= > 화면의 "다크 모드" 버튼으로 고른 값(브라우저에 저장) > 이 값
  theme: 'auto',

  // true: 브라우저 안의 가짜 서버(mock-server.js)로 동작합니다. 실제 서버가 생기면 false.
  useMock: true,
  apiBase: 'http://localhost:8000/api',
  wsUrl: 'ws://localhost:8000/ws',

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
    primary: 'auto',       // 조작 화면에 띄울 카메라 id. 'auto' = 서버 목록의 첫 번째
    transport: 'auto',     // 'auto'(서버가 알려 준 방식) · 'mjpeg' · 'snapshot' · 'ws' · 'webrtc' · 'video' · 'local'
    snapshotFps: 5,        // transport가 'snapshot'일 때 초당 장수
    bboxFormat: 'xywh',    // 판정 상자 좌표: 'xywh' · 'xyxy' · 'cxcywh'(YOLO)
    overlay: true,         // 서버가 판정 상자 좌표를 보내면 영상 위에 그림 (서버가 영상에 직접 그리면 false)
    // 화면에 쓰는 카메라 이름. 서버의 카메라 id를 키로 씁니다
    labels: { main: '카메라', top: '위 카메라', close: '근접 카메라', side: '옆 카메라', wrist: '손목 카메라', front: '앞 카메라' },
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

  // 시험할 때 설정 파일을 고치지 않고 서버를 바꿔 끼운다: ?mock=0&api=http://서버:8000/api&ws=ws://서버:8000/ws&push=socketio
  const mock = params.get('mock');
  if (mock === '0' || mock === '1') cfg.useMock = mock === '1';
  if (params.get('api')) cfg.apiBase = params.get('api');
  if (params.get('ws')) cfg.wsUrl = params.get('ws');
  if (['ws', 'socketio', 'sse', 'poll'].includes(params.get('push'))) cfg.server.push = params.get('push');

  let saved = null;
  try { saved = localStorage.getItem('hmi.theme'); } catch (e) { /* 저장소가 막힌 브라우저 */ }
  if (saved === 'light' || saved === 'dark') cfg.theme = saved;

  const theme = params.get('theme');
  if (theme === 'auto' || theme === 'light' || theme === 'dark') cfg.theme = theme;
  // 'auto'면 속성을 비워 두어 CSS가 PC 설정(prefers-color-scheme)을 따르게 한다
  if (cfg.theme === 'light' || cfg.theme === 'dark') document.documentElement.dataset.theme = cfg.theme;
})();
