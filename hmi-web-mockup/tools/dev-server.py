"""개발용 정적 서버 — `python -m http.server`와 같지만 브라우저가 파일을 캐시하지 않게 한다.

화면 파일을 고친 뒤 새로고침하면 늘 새 파일을 받는다(고치기 전 스크립트가 남아 헷갈리는 일을 막는다).
실행: python hmi-web-mockup/tools/dev-server.py 5173
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # hmi-web-mockup


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"http://localhost:{port}/  (캐시 끔, 폴더: {ROOT})", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
