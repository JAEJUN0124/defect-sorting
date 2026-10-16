"""서비스 토큰을 Worker에 넣기 — Client ID·Client Secret을 받아 터널 주소에서 먼저 시험하고, 통과하면 Worker 비밀값으로 넣는다.

값은 화면에 보이지 않게 받고(getpass) 출력·파일에 남기지 않는다. 서비스 토큰을 새로 만들거나 비밀을 회전했을 때 쓴다 (docs/cloudflare.md).
값의 모양부터 본다: "Client ID" 같은 글자 그대로, 터널 토큰(eyJ…)을 넣는 실수를 막는다.
실행: python hmi-web-mockup/cloudflare/set-token.py
"""
import getpass
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WRANGLER = os.path.join(HERE, "node_modules", "wrangler", "bin", "wrangler.js")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Access가 로그인 페이지로 보내면(정책이 Service Auth가 아님) 따라가지 않고 그 답을 본다"""
    def redirect_request(self, *args, **kwargs):
        return None


def origin():
    """wrangler.jsonc의 터널 주소 (vars.ORIGIN). 주석은 줄 전체로만 쓴다"""
    with open(os.path.join(HERE, "wrangler.jsonc"), encoding="utf-8") as f:
        text = "".join(line for line in f if not line.lstrip().startswith("//"))
    return json.loads(text)["vars"]["ORIGIN"]


def problem(cid, secret):
    """확실히 서비스 토큰이 아닌 값이면 그 이유. 비밀의 길이·형식은 Cloudflare가 바꿀 수 있어 보지 않고, 진짜인지는 터널 주소에서 시험해 정한다"""
    if not cid.endswith(".access") or re.search(r"\s|:", cid):
        return f"Client ID는 .access로 끝나는 값 하나입니다 (넣은 값: {len(cid)}글자)"
    if re.search(r"\s|:", secret):
        return "Client Secret에 띄어쓰기나 콜론(:)이 있습니다 — 'Client Secret' 같은 글자나 머리말까지 복사했는지 보세요"
    if secret.startswith("eyJ"):
        return "Client Secret 자리에 터널 토큰(eyJ…로 시작)을 넣었습니다"
    if secret.endswith(".access"):
        return "Client Secret 자리에 Client ID를 넣었습니다"
    return None


def try_origin(url, cid, secret):
    """터널 주소에 토큰을 붙여 보낸 답의 코드 (Access가 거절하면 401, 로그인으로 보내면 302)"""
    req = urllib.request.Request(url, headers={
        "CF-Access-Client-Id": cid,
        "CF-Access-Client-Secret": secret,
        "User-Agent": "defect-hmi-set-token",
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError as e:
        return f"연결 실패 ({e})"


def main():
    print("서비스 토큰 값을 붙여 넣으세요. 입력한 값은 화면에 보이지 않습니다.")
    cid = getpass.getpass("Client ID: ").strip()
    secret = getpass.getpass("Client Secret: ").strip()
    why = problem(cid, secret)
    if why:
        sys.exit("Worker에 넣지 않았습니다 — " + why)
    url = origin()
    status = try_origin(url + "/", cid, secret)
    if status == 401:
        sys.exit(f"{url}의 Access가 이 토큰을 거절했습니다(401). 다른 토큰의 값이거나, hmi-origin 앱 정책이 "
                 "Service Auth · 이 서비스 토큰이 아닙니다. Worker에는 넣지 않았습니다")
    if status in (301, 302, 303, 307, 308):
        sys.exit(f"{url}의 Access가 로그인 페이지로 보냈습니다({status}). hmi-origin 앱 정책의 Action이 "
                 "Service Auth인지 확인하세요. Worker에는 넣지 않았습니다")
    if status == 200:
        print("토큰이 Access를 통과했고 터널 너머 서버도 답했습니다")
    else:
        print(f"토큰은 Access를 통과했지만 서버 쪽 답이 {status}입니다 (터널·서버가 꺼졌을 수 있음). Worker에는 넣습니다")
    for name, value in (("CF_ACCESS_CLIENT_ID", cid), ("CF_ACCESS_CLIENT_SECRET", secret)):
        run = subprocess.run(["node", WRANGLER, "secret", "put", name], input=value, text=True,
                             encoding="utf-8", cwd=HERE, capture_output=True)
        if run.returncode != 0:
            sys.exit(f"{name}를 넣지 못했습니다: {run.stderr.strip()[-300:]}")
        print(f"{name} 넣음")
    print("끝났습니다. 열어 둔 조작 화면은 몇 초 안에 다시 붙습니다.")


if __name__ == "__main__":
    main()
