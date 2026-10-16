"""개발용 정적 서버 — `python -m http.server`와 같지만 브라우저가 파일을 캐시하지 않게 한다.

화면 파일을 고친 뒤 새로고침하면 늘 새 파일을 받는다(고치기 전 스크립트가 남아 헷갈리는 일을 막는다).
실행: python hmi-web-mockup/tools/dev-server.py 5173
다른 PC에서도 열려면: python hmi-web-mockup/tools/dev-server.py 8080 --host 0.0.0.0
  (이 PC의 장비망 주소로 접속. Windows 방화벽이 막으면 허용해야 함. 인증이 없으니 믿을 수 있는 망에서만)
"""
import argparse
import functools
import http.server
import os
import socket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # hmi-web-mockup


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


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
    args = p.parse_args()
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as server:
        print(f"http://localhost:{args.port}/  (캐시 끔, 폴더: {ROOT})", flush=True)
        if args.host not in ("127.0.0.1", "localhost"):
            for addr in lan_addresses():
                print(f"다른 PC에서: http://{addr}:{args.port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
