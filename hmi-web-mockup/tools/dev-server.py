"""개발용 정적 서버 — `python -m http.server`와 같지만 브라우저가 파일을 캐시하지 않게 한다.

메인 서버 묶음(make-server-bundle.py의 wwwroot/)과 같은 배치로 내준다:
  /            React 조작 화면을 빌드한 것 (react/dist — 먼저 hmi-web-mockup/react에서 npm run build)
  /tools/…     점검 페이지와 그 밖의 hmi-web-mockup 파일
빌드한 화면은 서버에 붙는 것이 기본이라 주소 뒤에 ?mock=0&ws=ws://서버:5080/ws/hmi (가짜 서버로 보려면 ?mock=1).
React 화면을 고치면서 볼 때는 Vite 개발 서버(npm run dev, http://localhost:5174)를 쓴다.
실행: python hmi-web-mockup/tools/dev-server.py 5173
다른 PC에서도 열려면: python hmi-web-mockup/tools/dev-server.py 8080 --host 0.0.0.0
  (이 PC의 장비망 주소로 접속. Windows 방화벽이 막으면 허용해야 함. 인증이 없으니 믿을 수 있는 망에서만)
--server http://<메인 서버>:5080 이면 /ws/hmi(웹소켓)와 카메라 영상(/video/…)을 그 서버로 그대로 잇는다 — 화면과 서버가 같은 주소가 되어
  주소 뒤에 아무것도 붙이지 않아도 서버에 붙고, 브라우저가 카메라 상태(/video/status)를 막지 않는다 (서버 담당 안내 2026-10-17, 8장)
"""
import argparse
import functools
import http.server
import os
import socket
import threading
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # hmi-web-mockup
DIST = os.path.join(ROOT, "react", "dist")  # React 조작 화면 빌드


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # React 빌드에 있는 파일이 먼저 (/ → 조작 화면), 없으면 hmi-web-mockup 폴더
        local = super().translate_path(path)
        rel = os.path.relpath(local, ROOT)
        built = os.path.join(DIST, rel)
        if not rel.startswith("..") and os.path.exists(built):
            return built
        return local

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if self.server.upstream and (path == "/ws/hmi" or path.startswith("/video/")):
            self.relay()
            return
        super().do_GET()

    def relay(self):
        """--server: 이 연결을 메인 서버로 그대로 잇는다 (웹소켓도, 계속 흐르는 MJPEG도). 웹소켓이 아니면 한 번 답하고 닫게 한다 —
        같은 연결로 오는 다음 요청(화면 파일)까지 서버로 흘러가지 않게"""
        host, port = self.server.upstream
        try:
            up = socket.create_connection((host, port), timeout=10)
        except OSError:
            self.send_error(502, "Main server unreachable")
            return
        up.settimeout(None)
        upgrade = self.headers.get("Upgrade", "").lower() == "websocket"
        lines = [f"{self.command} {self.path} HTTP/1.1"]
        for k, v in self.headers.items():
            if k.lower() == "host":
                v = f"{host}:{port}"
            elif k.lower() == "connection" and not upgrade:
                continue
            lines.append(f"{k}: {v}")
        if not upgrade:
            lines.append("Connection: close")
        up.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
        client = self.connection

        def pump(read, dst):
            try:
                while True:
                    data = read(65536)
                    if not data:
                        break
                    dst.sendall(data)
            except OSError:
                pass
            finally:
                for s in (up, client):
                    try:
                        s.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

        to_server = threading.Thread(target=pump, args=(self.rfile.read1, up), daemon=True)
        to_server.start()
        pump(up.recv, client)
        to_server.join(timeout=1)
        up.close()
        self.close_connection = True


def lan_addresses():
    """이 PC의 IPv4 주소들 (다른 PC에서 접속할 주소 안내용)"""
    try:
        names = socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        names = []
    return [a for a in names if not a.startswith("127.")]


def main():
    p = argparse.ArgumentParser(description="개발용 정적 서버 (캐시 끔)")
    p.add_argument("port", nargs="?", type=int, default=5173)
    p.add_argument("--host", default="127.0.0.1", help="기본은 이 PC에서만. 0.0.0.0이면 다른 PC에서도 접속")
    p.add_argument("--server", help="메인 서버 주소 (예: http://192.168.219.101:8000). /ws/hmi와 /video/…를 그 서버로 잇는다")
    args = p.parse_args()
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as server:
        server.upstream = None
        if args.server:
            u = urllib.parse.urlsplit(args.server)
            if u.scheme != "http" or not u.hostname:
                raise SystemExit("--server는 http://호스트:포트 모양이어야 합니다")
            server.upstream = (u.hostname, u.port or 80)
        port = server.server_address[1]  # 0이면 비어 있는 포트 (시험용)
        print(f"http://localhost:{port}/  (캐시 끔, 폴더: {ROOT})", flush=True)
        if server.upstream:
            print(f"메인 서버로 잇기: /ws/hmi · /video/… → http://{server.upstream[0]}:{server.upstream[1]}", flush=True)
        if not os.path.isfile(os.path.join(DIST, "index.html")):
            print("react/dist가 없어 / 에 조작 화면이 없습니다. hmi-web-mockup/react에서 npm install, npm run build를 하세요", flush=True)
        if args.host not in ("127.0.0.1", "localhost"):
            for addr in lan_addresses():
                print(f"다른 PC에서: http://{addr}:{port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
