"""메인 서버용 HMI 묶음 만들기 — 서버 담당의 메인 서버(.NET)가 HMI 화면도 내주게 할 때 쓴다.

결과 zip:
  wwwroot/        HMI 화면 파일. 서버 프로젝트 폴더(src/Ecp.HmiServer/)에 그대로 넣는다
  README-server.md  서버에 올리는 방법 (서버 쪽에서 할 일)
묶을 때 js/config.js만 메인 서버용으로 바꾼다: useMock false, wsUrl 'auto'(화면을 내준 서버의 /ws/hmi에 붙음).
시험·개발 도구(tests/, tools/dev-server.py, 이 파일)는 넣지 않는다.

실행: python hmi-web-mockup/tools/make-server-bundle.py <만들 zip 경로>
"""
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # hmi-web-mockup
SKIP_DIRS = {"tests", "__pycache__"}
SKIP_FILES = {"tools/dev-server.py", "tools/make-server-bundle.py"}

SERVER_README = """# HMI를 메인 서버에 올리는 방법

이 압축의 `wwwroot/`가 HMI 화면 파일입니다. 메인 서버가 이 파일을 내주면 `http://서버:5080/`에서 HMI가 열리고,
HMI는 자기를 내준 서버의 `/ws/hmi`에 알아서 붙습니다 (주소 뒤에 아무것도 붙이지 않아도 됨).

1. `wwwroot/` 폴더를 서버 프로젝트 폴더 `src/Ecp.HmiServer/`(appsettings.json이 있는 곳)에 넣습니다.
2. `Program.cs`에서 웹소켓 엔드포인트(`/ws/hmi`) 앞에 정적 파일을 켭니다.

   ```csharp
   app.UseDefaultFiles(); // "/" → index.html
   app.UseStaticFiles();  // wwwroot/ 의 파일
   ```

   지금 `/`에서 돌려주는 안내 글("ECP HMI server: WebSocket /ws/hmi")은 빼거나 다른 경로로 옮겨 주세요 — 그 자리를 `index.html`이 씁니다.
3. 서버를 켜고 다른 PC에서 엽니다.
   - 조작 화면 `http://서버IP:5080/`
   - 대시보드 `http://서버IP:5080/dashboard.html` · `http://서버IP:5080/dashboard-tabs.html`
   - 서버 점검 `http://서버IP:5080/tools/server-check.html` (형식 XML)
4. HMI를 새 판으로 바꿀 때는 `wwwroot/`를 통째로 바꾸고, 브라우저는 Ctrl+F5로 새로 고칩니다.

`/ws/hmi`의 웹소켓 규약과 그 밖의 서버 동작은 바꾸지 않습니다. HTTPS로 띄우면 HMI는 `wss://`로 붙습니다.
"""


def server_config(text):
    """js/config.js를 메인 서버용으로: 가짜 서버를 끄고 화면을 내준 서버에 붙는다"""
    out, n1 = re.subn(r"useMock:\s*true", "useMock: false", text, count=1)
    out, n2 = re.subn(r"wsUrl:\s*'[^']*'", "wsUrl: 'auto'", out, count=1)
    if not (n1 and n2):
        raise SystemExit("js/config.js에서 useMock·wsUrl 값을 찾지 못했습니다")
    return out


def main():
    if len(sys.argv) < 2:
        raise SystemExit("사용: python hmi-web-mockup/tools/make-server-bundle.py <만들 zip 경로>")
    out = os.path.abspath(sys.argv[1])
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README-server.md", SERVER_README)
        for dirpath, dirnames, filenames in os.walk(ROOT):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
            for name in sorted(filenames):
                rel = os.path.relpath(os.path.join(dirpath, name), ROOT).replace(os.sep, "/")
                if rel in SKIP_FILES or name.startswith(".") or name.endswith(".pyc"):
                    continue
                arc = "wwwroot/" + rel
                if rel == "js/config.js":
                    with open(os.path.join(dirpath, name), encoding="utf-8", newline="") as f:
                        z.writestr(arc, server_config(f.read()))
                else:
                    z.write(os.path.join(dirpath, name), arc)
                count += 1
    print(f"wwwroot/ 파일 {count}개 + README-server.md → {out}")


if __name__ == "__main__":
    main()
