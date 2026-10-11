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
  heartbeatTimeoutMs: 6000,

  // 로그를 최대 몇 줄까지 남길지
  logLimit: 200,
};

(function () {
  const cfg = window.HMI_CONFIG;
  const params = new URLSearchParams(location.search);

  const dev = params.get('dev');
  if (dev === '0' || dev === '1') cfg.devMode = dev === '1';

  let saved = null;
  try { saved = localStorage.getItem('hmi.theme'); } catch (e) { /* 저장소가 막힌 브라우저 */ }
  if (saved === 'light' || saved === 'dark') cfg.theme = saved;

  const theme = params.get('theme');
  if (theme === 'auto' || theme === 'light' || theme === 'dark') cfg.theme = theme;
  // 'auto'면 속성을 비워 두어 CSS가 PC 설정(prefers-color-scheme)을 따르게 한다
  if (cfg.theme === 'light' || cfg.theme === 'dark') document.documentElement.dataset.theme = cfg.theme;
})();
