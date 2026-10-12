"""시험용 '변형 서버' — 서버를 기준 형식(docs/API.md v0.2)과 다르게 만들었을 때를 흉내 낸다.

HMI가 실제 브라우저에서 형식 차이를 흡수하는지 확인하는 개발용 시험 고정물이다. 실제 서버(서버 담당 몫)가 아니다.
FastAPI·Flask로 만들면 흔히 나오는 모양을 일부러 골랐다:
  - 상태: {"state": "IDLE" | "RUNNING" | "EMERGENCY_STOP", "emergency": ..., "operation_mode": "AUTO" | "MANUAL", "counts": {"ok", "ng"}}
  - 장치: {"robot": true, "teleop": "offline", "conveyor": "ok", "cam": 1}, 카메라: {"active", "stream"}
  - 오류: {"detail": {...}} · {"detail": "글자"} · FastAPI 검증 실패 목록(422), 서버 정보(GET /info) 없음(404)
  - 실시간(WebSocket /ws): {"event": "status", "payload": ...}, 하트비트 {"type": "ping"},
    판정 {"type": "result", "data": {"part_id", "judgement": "OK"|"NG", "score": 0~100, "latency": 초, "timestamp": "공백·시간대 없음"}}(통계 없음),
    이벤트 {"event": "LINE_STARTED", "severity": "INFO"}, 리더암 {"type": "joint_state", "data": {"source": "teleop", "shoulder_pan.pos": …}},
    서보 {"type": "servos", "data": {"arm": "follower", "motors": [{"id", "temperature", "voltage"(0.1V), "load"(0.1%)}]}}
  - 운전 모드는 대문자만 받는다(소문자를 보내면 422) — config.js server.modeValues 시험용
  - 영상: GET /video_feed (MJPEG) · GET /snapshot.jpg (한 장씩) · WebSocket /ws/camera (바이너리 JPEG), CORS 허용
  - 같은 실시간 메시지를 다른 방식으로도: SSE GET /api/events · Socket.IO /socket.io/ (Engine.IO 4, 서버 ping)
실행: python hmi-web-mockup/tests/variant-server.py 8765
그다음 http://localhost:5173/?mock=0&api=http://localhost:8765/api&ws=ws://localhost:8765/ws
"""
import base64
import hashlib
import json
import random
import socketserver
import struct
import sys
import threading
import time
from datetime import datetime

# 160×90 JPEG 두 장 (컨베이어 위 부품이 옮겨 가는 모습)
FRAME_A = "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABaAKADASIAAhEBAxEB/8QAGgABAQEBAQEBAAAAAAAAAAAAAAQCBwUDAf/EAC8QAQABAQYDBQkBAQAAAAAAAAACAwEEExRRUgUGkRESMTZVFRYiQWGDlLLRITL/xAAWAQEBAQAAAAAAAAAAAAAAAAAAAQL/xAAVEQEBAAAAAAAAAAAAAAAAAAAAEf/aAAwDAQACEQMRAD8A5wA0yAAAAAAAAAAAAAAAAAACrKw1kZWGsliJRVlYayMrDWRBKKsrDWRlYayIJRVlYayMrDWRBKKsrDWRlYayIJRVlYayMrDWRBKKsrDWRlYayIJRVlYayMrDWRBKKsrDWRlYayIJRVlYayMrDWRB9gFAAAAHSuUuFcOvPLN0rV+H3WrUl3+2c6MZW2/HKzxtsez7D4R6Vcvx4fxByX5UuX3P3kxxi+3qnfracKk6cI2WWx7tvZ2/VB6XsPhHpVy/Hh/HNObaFG7czXujQpQpU49zshCNkbLPgjb4WOocPq1K1xpVKv8A3Kz/AH6/VzPnTzXfft/pFR4YAAAAAAAAAAziQ3x6mJDfHqDQziQ3x6mJDfHqDQziQ3x6mJDfHqDq3JflS5fc/eT2qlGlV7MSnCfZ4d6NlvY4zR4zfrtSjRocSvFKnHwhCvKNlnz8LLX094OKesXv8mX9B2RyvnTzXfft/pF5/vBxT1i9/ky/qSte5XmrKtXvFtWpLxnOfett+XjaD8GcSG+PUxIb49QaGcSG+PUxIb49QaGcSG+PUxIb49QaGcSG+PUxIb49QaGcSG+PUxIb49QQgMqAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//Z"
FRAME_B = "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABaAKADASIAAhEBAxEB/8QAGQABAQEBAQEAAAAAAAAAAAAAAAQCBwMF/8QALxABAAEBBgMFCQEBAAAAAAAAAAIDAQQTFFFSBQaRERIxNlUVFiJBYYOUstEhMv/EABYBAQEBAAAAAAAAAAAAAAAAAAABAv/EABURAQEAAAAAAAAAAAAAAAAAAAAR/9oADAMBAAIRAxEAPwDnADTIAAAAAAAAAAAAAAAAAAKsrDWRlYayWIlFWVhrIysNZEEoqysNZGVhrIglFWVhrIysNZEEoqysNZGVhrIglFWVhrIysNZEEoqysNZGVhrIglFWVhrIysNZEEoqysNZGVhrIglFWVhrIysNZEHsAoAAAAAAAA+xylQo3nma6Ua9KFWnLv8AbCcbJWW/BK3wtdL9h8I9KuX48P45xyX5ruX3P0k6ZxCrUo3GrUpf9xs/z6fUHl7D4R6Vcvx4fx8bm3hXDrtyze61Dh91pVI9zsnCjGNtnxxs8bLHvwe+3qpfrKc6k6kJWW2y71vb2fVvnTypfft/vFBysBQAAAAGcSG+PUxIb49QaGcSG+PUxIb49QaGcSG+PUxIb49QaGcSG+PUxIb49QaGcSG+PUxIb49Qfe5L813L7n6SdUcQo3uV2qxrULxbSqR8Jwn3bbPl42K/eDinrF7/ACZf0HYqdGlS7cOnCHb492Nlna+Lzp5Uvv2/3i5v7wcU9Yvf5Mv6863Gb9eaUqNfiV4q05eMJ15Sst+fhbaCcZxIb49TEhvj1BoZxIb49TEhvj1BoZxIb49TEhvj1BCAyoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/9k="
FRAMES = [base64.b64decode(FRAME_A), base64.b64decode(FRAME_B)]
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]
CORS = (
    "Access-Control-Allow-Origin: *\r\n"
    "Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type, Authorization\r\n"
)

lock = threading.Lock()
clients = set()
S = {"state": "IDLE", "emergency": False, "mode": "AUTO", "ok": 0, "ng": 0, "cam": False, "part": 0}


def status_payload():
    return {
        "state": S["state"],
        "emergency": S["emergency"],
        "operation_mode": S["mode"],
        "devices": {"robot": True, "teleop": "offline" if S["mode"] == "AUTO" else "online", "conveyor": "ok", "cam": 1},
        "counts": {"ok": S["ok"], "ng": S["ng"]},
        "camera": {"active": S["cam"], "stream": "/video_feed" if S["cam"] else None},
        "timestamp": time.time(),
    }


def ws_frame(data, opcode=0x1):
    if isinstance(data, str):
        data = data.encode("utf-8")
    n = len(data)
    first = 0x80 | opcode
    if n < 126:
        head = bytes([first, n])
    elif n < 65536:
        head = bytes([first, 126]) + struct.pack(">H", n)
    else:
        head = bytes([first, 127]) + struct.pack(">Q", n)
    return head + data


def ws_read(sock):
    """브라우저가 보낸 프레임 하나를 읽는다 (마스크 풀기). 닫히면 None."""
    def exact(n):
        out = b""
        while len(out) < n:
            chunk = sock.recv(n - len(out))
            if not chunk:
                raise OSError("closed")
            out += chunk
        return out
    b1, b2 = exact(2)
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack(">H", exact(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", exact(8))[0]
    mask = exact(4) if b2 & 0x80 else b"\0\0\0\0"
    data = bytes(b ^ mask[i % 4] for i, b in enumerate(exact(n)))
    if b1 & 0x0F == 0x8:
        return None
    return data.decode("utf-8", "replace")


# 실시간 받는 쪽: 'ws'(그대로 JSON) · 'sse'(EventSource) · 'sio'(Socket.IO 이벤트)
socks = {"ws": set(), "sse": set(), "sio": set()}
clients = socks["ws"]


def sio_event(obj):
    """같은 메시지를 소켓IO 이벤트 이름·값으로 바꾼다."""
    if obj.get("event") == "status":
        return "status", obj["payload"]
    if "type" in obj:
        return obj["type"], obj.get("data", {k: v for k, v in obj.items() if k != "type"})
    return "event", obj


def broadcast(obj):
    text = json.dumps(obj)
    name, data = sio_event(obj)
    outs = {
        "ws": ws_frame(text),
        "sse": ("data: " + text + "\n\n").encode(),
        "sio": ws_frame("42" + json.dumps([name, data])),
    }
    with lock:
        for kind, group in socks.items():
            dead = []
            for sock in group:
                try:
                    sock.sendall(outs[kind])
                except OSError:
                    dead.append(sock)
            for sock in dead:
                group.discard(sock)


def event(code, severity="INFO"):
    broadcast({"event": code, "severity": severity, "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})


def push_status():
    broadcast({"event": "status", "payload": status_payload()})


def ticker():
    n = 0
    while True:
        time.sleep(0.2)
        n += 1
        if n % 10 == 0:
            broadcast({"type": "ping", "t": time.time()})
        if S["state"] == "RUNNING" and n % 8 == 0:
            S["part"] += 1
            ng = random.random() < 0.15
            S["ng" if ng else "ok"] += 1
            broadcast({"type": "result", "data": {
                "part_id": S["part"], "judgement": "NG" if ng else "OK", "score": round(random.uniform(85, 99), 1),
                "latency": round(random.uniform(0.018, 0.03), 3), "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }})
            if S["part"] % 5 == 0:
                push_status()
        if S["state"] == "RUNNING" and S["mode"] == "MANUAL":
            angles = {j + ".pos": round(random.uniform(-30, 30), 1) for j in JOINTS[:-1]}
            angles["gripper.pos"] = round(random.uniform(0, 100), 1)
            broadcast({"type": "joint_state", "data": dict(source="teleop", **angles)})
        if n % 5 == 0:
            broadcast({"type": "servos", "data": {"arm": "follower", "motors": [
                {"id": i + 1, "temperature": 34 + i, "voltage": 120 + random.randint(-1, 1), "load": random.randint(0, 300)} for i in range(6)
            ]}})


class Handler(socketserver.BaseRequestHandler):
    def setup(self):
        self.request.settimeout(None)
        self.buf = b""

    def read_request(self):
        while b"\r\n\r\n" not in self.buf:
            chunk = self.request.recv(4096)
            if not chunk:
                return None
            self.buf += chunk
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        method, path, _ = lines[0].split(" ", 2)
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        length = int(headers.get("content-length", "0") or 0)
        while len(self.buf) < length:
            self.buf += self.request.recv(4096)
        body, self.buf = self.buf[:length], self.buf[length:]
        return method, path.split("?")[0], headers, body

    def reply(self, code, obj=None, text=None, ctype="application/json"):
        reasons = {200: "OK", 202: "Accepted", 204: "No Content", 404: "Not Found", 409: "Conflict", 422: "Unprocessable Entity"}
        payload = b"" if code == 204 else (json.dumps(obj).encode() if obj is not None else (text or "").encode())
        head = f"HTTP/1.1 {code} {reasons.get(code, 'OK')}\r\n{CORS}Content-Type: {ctype}\r\nContent-Length: {len(payload)}\r\nConnection: keep-alive\r\n\r\n"
        self.request.sendall(head.encode() + payload)

    def handle(self):
        while True:
            req = self.read_request()
            if not req:
                return
            method, path, headers, body = req
            upgrade = headers.get("upgrade", "").lower() == "websocket"
            if upgrade and path == "/ws":
                self.websocket(headers)
                return
            if upgrade and path == "/ws/camera":
                self.camera_ws(headers)
                return
            if upgrade and path.startswith("/socket.io/"):
                self.socketio(headers)
                return
            if path == "/api/events":
                self.sse()
                return
            if path == "/video_feed":
                self.mjpeg()
                return
            if path == "/snapshot.jpg":
                jpg = FRAMES[int(time.time() * 5) % 2]
                self.request.sendall((f"HTTP/1.1 200 OK\r\n{CORS}Content-Type: image/jpeg\r\nContent-Length: {len(jpg)}\r\n\r\n").encode() + jpg)
                continue
            self.api(method, path, body)

    def upgrade(self, headers):
        accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + GUID).encode()).digest()).decode()
        self.request.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                              f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())

    def join(self, kind, first=None):
        if first is not None:
            self.request.sendall(first)
        with lock:
            socks[kind].add(self.request)

    def leave(self, kind):
        with lock:
            socks[kind].discard(self.request)

    def websocket(self, headers):
        self.upgrade(headers)
        self.join("ws", ws_frame(json.dumps({"event": "status", "payload": status_payload()})))
        try:
            while ws_read(self.request) is not None:  # 받은 글(HMI ping 등)은 읽고 버린다
                pass
        except OSError:
            pass
        self.leave("ws")

    def camera_ws(self, headers):
        """카메라 영상을 웹소켓 바이너리 JPEG로 보낸다 (camera.js의 'ws' 방식 시험)."""
        self.upgrade(headers)
        i = 0
        try:
            while True:
                self.request.sendall(ws_frame(FRAMES[i % 2], opcode=0x2))
                i += 1
                time.sleep(0.2)
        except OSError:
            pass

    def socketio(self, headers):
        """Engine.IO 4 / Socket.IO 5 (웹소켓 전송만): 열림 → 네임스페이스 연결 → 이벤트, 서버가 ping."""
        self.upgrade(headers)
        self.request.sendall(ws_frame('0{"sid":"v1","upgrades":[],"pingInterval":3000,"pingTimeout":5000,"maxPayload":1000000}'))
        stop = threading.Event()

        def pinger():
            while not stop.wait(3):
                try:
                    self.request.sendall(ws_frame("2"))
                except OSError:
                    return
        threading.Thread(target=pinger, daemon=True).start()
        try:
            while True:
                text = ws_read(self.request)
                if text is None:
                    break
                if text.startswith("40"):  # 네임스페이스 연결
                    self.join("sio", ws_frame('40{"sid":"n1"}') + ws_frame("42" + json.dumps(["status", status_payload()])))
                elif text.startswith("42"):  # 소켓IO 명령(응답 번호가 있으면 ack)
                    rest = text[2:]
                    ack = ""
                    while rest and rest[0].isdigit():
                        ack += rest[0]
                        rest = rest[1:]
                    if ack:
                        self.request.sendall(ws_frame("43" + ack + json.dumps([{"ok": True}])))
        except OSError:
            pass
        stop.set()
        self.leave("sio")

    def sse(self):
        self.request.sendall((f"HTTP/1.1 200 OK\r\n{CORS}Content-Type: text/event-stream\r\nCache-Control: no-cache\r\n\r\n").encode())
        self.join("sse", ("event: status\ndata: " + json.dumps(status_payload()) + "\n\n").encode())
        try:
            while self.request.recv(1024):
                pass
        except OSError:
            pass
        self.leave("sse")

    def mjpeg(self):
        self.request.sendall(("HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\n"
                              "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n").encode())
        i = 0
        try:
            while S["cam"]:
                jpg = FRAMES[i % 2]
                self.request.sendall(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                i += 1
                time.sleep(0.2)
        except OSError:
            pass

    def api(self, method, path, body):
        if method == "OPTIONS":
            return self.reply(204)
        data = {}
        if body:
            try:
                data = json.loads(body)
            except ValueError:
                pass
        if path == "/api/status" and method == "GET":
            return self.reply(200, status_payload())
        if path == "/api/line/start" and method == "POST":
            if S["emergency"]:
                return self.reply(409, {"detail": {"code": "E_STOP_ACTIVE"}})
            if S["state"] != "IDLE":
                return self.reply(409, {"detail": "line is busy"})
            S["state"] = "RUNNING"
            push_status()
            event("LINE_STARTED")
            return self.reply(200, {"ok": True})
        if path == "/api/line/stop" and method == "POST":
            if S["state"] != "RUNNING":
                return self.reply(409, {"detail": "line is not running"})
            S["state"] = "IDLE"
            push_status()
            event("LINE_STOPPED")
            return self.reply(200, {"ok": True})
        if path == "/api/estop" and method == "POST":
            already = S["emergency"]
            S["emergency"], S["state"] = True, "EMERGENCY_STOP"
            push_status()
            if not already:
                event("EMERGENCY_STOP_PRESSED", "CRITICAL")
            return self.reply(200, {"ok": True})
        if path == "/api/estop/release" and method == "POST":
            if not S["emergency"]:
                return self.reply(409, {"detail": "not in emergency"})
            S["emergency"], S["state"] = False, "IDLE"
            push_status()
            event("EMERGENCY_STOP_RELEASED")
            return self.reply(200, {"ok": True})
        if path == "/api/mode" and method == "PUT":
            mode = data.get("mode")
            if mode not in ("AUTO", "MANUAL"):
                return self.reply(422, {"detail": [{"loc": ["body", "mode"], "msg": "value is not a valid enumeration member", "type": "type_error.enum"}]})
            if S["state"] != "IDLE":
                return self.reply(409, {"detail": {"code": "NOT_IDLE"}})
            S["mode"] = mode
            push_status()
            event("MODE_CHANGED")
            return self.reply(200, {"ok": True})
        if path == "/api/robot/home" and method == "POST":
            threading.Timer(1.5, lambda: broadcast({"type": "homed"})).start()
            return self.reply(202, {"accepted": True})
        if path == "/api/camera/start" and method == "POST":
            S["cam"] = True
            push_status()
            return self.reply(200, {"url": "/video_feed"})
        if path == "/api/camera/stop" and method == "POST":
            S["cam"] = False
            push_status()
            return self.reply(200, {"ok": True})
        if path == "/api/system/shutdown" and method == "POST":
            threading.Timer(1.0, lambda: broadcast({"type": "bye"})).start()
            return self.reply(202, {"accepted": True})
        return self.reply(404, {"detail": "Not Found"})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    threading.Thread(target=ticker, daemon=True).start()
    with Server(("127.0.0.1", port), Handler) as srv:
        print(f"variant server on http://localhost:{port}/api  ws://localhost:{port}/ws", flush=True)
        srv.serve_forever()
