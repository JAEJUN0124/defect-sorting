"""로그인 비밀번호를 Worker에 넣기 — 밖 주소(hmi.hypefree.net)에서 원점 잡기에만 쓰는 공용 비밀번호 하나 (사용자 2026-10-27).

비밀번호는 화면에 보이지 않게 두 번 받고(getpass) 출력·파일에 남기지 않는다. 로그인 쿠키를 서명하는 키(SESSION_KEY)는 새로 만들어
함께 넣는다 — 그래서 비밀번호를 바꾸면 전에 로그인한 사람은 모두 다시 로그인해야 한다 (docs/cloudflare.md).
실행: python hmi-web-mockup/cloudflare/set-password.py
"""
import getpass
import os
import secrets
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WRANGLER = os.path.join(HERE, "node_modules", "wrangler", "bin", "wrangler.js")
MIN_LENGTH = 10
MAX_LENGTH = 256  # worker.js MAX_PASSWORD와 같음


def problem(password):
    """Worker에 넣지 않을 비밀번호면 그 이유"""
    if len(password) < MIN_LENGTH:
        return f"{MIN_LENGTH}글자 이상으로 정하세요 (넣은 값: {len(password)}글자) — 주소가 공개라 짧으면 맞히기 쉽습니다"
    if len(password) > MAX_LENGTH:
        return f"{MAX_LENGTH}글자 이하로 정하세요"
    if password != password.strip():
        return "앞이나 뒤에 띄어쓰기가 있습니다"
    return None


def put(name, value):
    run = subprocess.run(["node", WRANGLER, "secret", "put", name], input=value, text=True,
                         encoding="utf-8", cwd=HERE, capture_output=True)
    if run.returncode != 0:
        sys.exit(f"{name}를 넣지 못했습니다: {run.stderr.strip()[-300:]}")
    print(f"{name} 넣음")


def main():
    print("팀이 같이 쓸 로그인 비밀번호를 정하세요. 입력한 값은 화면에 보이지 않습니다.")
    password = getpass.getpass("비밀번호: ")
    why = problem(password)
    if why:
        sys.exit("Worker에 넣지 않았습니다 — " + why)
    if getpass.getpass("한 번 더: ") != password:
        sys.exit("두 번 넣은 값이 다릅니다. Worker에 넣지 않았습니다")
    put("SESSION_KEY", secrets.token_urlsafe(32))
    put("HMI_PASSWORD", password)
    print("끝났습니다. 전에 로그인한 사람은 다시 로그인해야 합니다.")


if __name__ == "__main__":
    main()
