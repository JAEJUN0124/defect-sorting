// 밖에서 여는 HMI (Cloudflare Worker). 화면 파일(site/)은 Cloudflare가 바로 내주고, 파일이 아닌 요청만 여기로 온다.
// /ws/hmi 웹소켓만 터널 주소(ORIGIN, Access 서비스 토큰이 있어야 통과)로 넘긴다 — 메인 서버의 다른 경로는 밖에 열지 않는다.
// 이 Worker가 서비스 토큰을 들고 있으므로 화면 주소(hmi.<도메인>) 앞에 사람용 Access 앱이 꼭 있어야 한다 (docs/cloudflare.md)
const WS_PATH = '/ws/hmi';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === WS_PATH) return proxyWebSocket(request, env, url);
    return env.ASSETS.fetch(request); // 없는 파일 → 404
  },
};

// 서버(터널 주소) 쪽 웹소켓을 Worker가 열고, 브라우저 쪽 웹소켓은 따로 받아 둘 사이에 메시지를 그대로 옮긴다 (Cloudflare 문서의 방식).
// 서버의 답(101)을 브라우저에 그대로 돌려주는 방식은 이 PC(wrangler dev)에서는 됐지만 Cloudflare에서는 브라우저 쪽이 열리지 않았다 (2026-10-17).
// 서버가 101이 아닌 답(토큰이 틀려 401, 서버가 꺼져 502 등)을 주면 그 답이 그대로 가서 HMI는 끊김으로 보고 다시 붙는다
export async function proxyWebSocket(request, env, url) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('웹소켓 연결만 받습니다', { status: 426, headers: { Upgrade: 'websocket' } });
  }
  if (!env.ORIGIN || !env.CF_ACCESS_CLIENT_ID || !env.CF_ACCESS_CLIENT_SECRET) {
    return new Response('Worker 설정이 비어 있습니다 (ORIGIN · CF_ACCESS_CLIENT_ID · CF_ACCESS_CLIENT_SECRET)', { status: 500 });
  }
  const target = new URL(WS_PATH + url.search, env.ORIGIN);
  // 사람의 Access 쿠키와 Cloudflare 머리글은 넘기지 않고, 웹소켓에 필요한 것과 서비스 토큰만 붙인다
  const headers = new Headers({
    Upgrade: 'websocket',
    'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
  });
  const protocol = request.headers.get('Sec-WebSocket-Protocol');
  if (protocol) headers.set('Sec-WebSocket-Protocol', protocol);
  const upstream = await fetch(target, { headers });
  const server = upstream.webSocket;
  if (!server) return upstream;

  const pair = new WebSocketPair();
  const [client, worker] = Object.values(pair);
  server.accept();
  worker.accept();
  relay(server, worker);
  relay(worker, server);
  const chosen = upstream.headers.get('Sec-WebSocket-Protocol');
  return new Response(null, { status: 101, webSocket: client, headers: chosen ? { 'Sec-WebSocket-Protocol': chosen } : {} });
}

// 한쪽에서 온 메시지와 닫힘을 다른 쪽으로 옮긴다. 1005·1006·1015는 보낼 수 없는 닫힘 코드라 1000으로 바꾼다
export function relay(from, to) {
  from.addEventListener('message', (e) => { try { to.send(e.data); } catch (err) { /* 다른 쪽이 이미 닫힘 */ } });
  from.addEventListener('close', (e) => {
    const code = [1005, 1006, 1015].includes(e.code) || !e.code ? 1000 : e.code;
    try { to.close(code, e.reason || ''); } catch (err) { /* 이미 닫힘 */ }
  });
  from.addEventListener('error', () => { try { to.close(1011, 'relay error'); } catch (err) { /* 이미 닫힘 */ } });
}
