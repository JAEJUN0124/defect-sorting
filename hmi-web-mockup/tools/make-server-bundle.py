"""메인 서버용 HMI 묶음 만들기 — 서버 담당의 메인 서버(.NET)가 HMI 화면도 내주게 할 때 쓴다.

결과 zip:
  wwwroot/             메인 서버가 내줄 파일. 서버 프로젝트 폴더(src/Ecp.HmiServer/)에 그대로 넣는다
    index.html, assets/  조작 화면 (React — react/ 를 빌드한 것). 화면을 내준 서버의 /ws/hmi에 알아서 붙는다
    tools/               서버 점검·장치 점검 페이지 (기존 그대로)
    js/ css/ config/     점검 페이지가 읽는 파일만. js/config.js는 메인 서버용(useMock false, wsUrl 'auto')
  README-server.md     서버에 올리는 방법
대시보드는 없앴다 (사용자 2026-10-17: 조작 화면 하나만 React로). tools/dev-server.py도 이 배치로 내준다.

실행: python hmi-web-mockup/tools/make-server-bundle.py <만들 zip 경로>
  먼저 react/를 빌드한다 (npm 필요). 이미 빌드했으면 --no-build
"""
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # hmi-web-mockup
REACT = os.path.join(ROOT, "react")
DIST = os.path.join(REACT, "dist")
TOOL_PAGES = ["tools/server-check.html", "tools/devices.html"]

SERVER_README = """# HMI를 메인 서버에 올리는 방법

이 압축의 `wwwroot/`가 HMI 화면 파일입니다. 메인 서버가 이 파일을 내주면 `http://서버:5080/`에서 HMI 조작 화면(React)이 열리고,
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
   - 서버 점검 `http://서버IP:5080/tools/server-check.html` (형식 XML)
4. HMI를 새 판으로 바꿀 때는 `wwwroot/`를 통째로 바꾸고, 브라우저는 Ctrl+F5로 새로 고칩니다.

`/ws/hmi`의 웹소켓 규약과 그 밖의 서버 동작은 바꾸지 않습니다. HTTPS로 띄우면 HMI는 `wss://`로 붙습니다.
조작 화면은 모듈 스크립트라 파일을 더블클릭해서는 열리지 않습니다 — 서버로 열어 주세요.
"""


def server_config(text):
    """js/config.js를 메인 서버용으로: 가짜 서버를 끄고 화면을 내준 서버에 붙는다 (점검 페이지용)"""
    out, n1 = re.subn(r"useMock:\s*true", "useMock: false", text, count=1)
    out, n2 = re.subn(r"wsUrl:\s*'[^']*'", "wsUrl: 'auto'", out, count=1)
    if not (n1 and n2):
        raise SystemExit("js/config.js에서 useMock·wsUrl 값을 찾지 못했습니다")
    return out


def tool_files():
    """점검 페이지와 그 페이지가 읽는 파일 (../js/…, ../css/…, ../config/…, 같은 폴더의 .js)"""
    files = set()
    for page in TOOL_PAGES:
        files.add(page)
        with open(os.path.join(ROOT, page), encoding="utf-8") as f:
            html = f.read()
        for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
            if ref.startswith(("http:", "https:", "#")) or ref.endswith(".html"):
                continue
            rel = os.path.normpath(os.path.join(os.path.dirname(page), ref)).replace(os.sep, "/")
            if not rel.startswith("..") and os.path.isfile(os.path.join(ROOT, rel)):
                files.add(rel)
    return sorted(files)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit("사용: python hmi-web-mockup/tools/make-server-bundle.py <만들 zip 경로> [--no-build]")
    if "--no-build" not in sys.argv:
        subprocess.run("npm run build", cwd=REACT, shell=True, check=True)
    if not os.path.isfile(os.path.join(DIST, "index.html")):
        raise SystemExit("react/dist가 없습니다. hmi-web-mockup/react에서 npm install, npm run build를 먼저 하세요")
    out = os.path.abspath(args[0])
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README-server.md", SERVER_README)
        for dirpath, _, filenames in os.walk(DIST):
            for name in sorted(filenames):
                full = os.path.join(dirpath, name)
                z.write(full, "wwwroot/" + os.path.relpath(full, DIST).replace(os.sep, "/"))
                count += 1
        for rel in tool_files():
            arc = "wwwroot/" + rel
            if rel == "js/config.js":
                with open(os.path.join(ROOT, rel), encoding="utf-8", newline="") as f:
                    z.writestr(arc, server_config(f.read()))
            else:
                z.write(os.path.join(ROOT, rel), arc)
            count += 1
    print(f"wwwroot/ 파일 {count}개 + README-server.md -> {out}")


if __name__ == "__main__":
    main()
