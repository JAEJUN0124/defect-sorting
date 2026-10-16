// 빌드한 화면(메인 서버에 올리는 것)의 기본값: 가짜 서버 대신 화면을 내준 서버의 /ws/hmi에 붙는다 (http면 ws, https면 wss).
// 개발 서버(npm run dev)는 그대로 가짜 서버가 기본이다. 주소 뒤에 ?mock= · ?ws= 를 붙이면 그것이 먼저다.
// api.js가 불러올 때 설정을 읽으므로 config.js 바로 뒤에 불러야 한다 (legacy.js)
const cfg = window.HMI_CONFIG;
const params = new URLSearchParams(location.search);

if (import.meta.env.PROD) {
  if (!params.has('mock')) cfg.useMock = false;
  if (!params.has('ws')) {
    const served = /^https?:$/.test(location.protocol) && location.host;
    cfg.wsUrl = served ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/hmi' : 'ws://localhost:5080/ws/hmi';
  }
}
