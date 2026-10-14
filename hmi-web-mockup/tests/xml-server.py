"""시험용 XML 서버 — 서버 담당의 HMI 통신 서버(규약 v1.0, docs/server-xml-v1.0.md)를 흉내 낸다.

HMI가 실제 브라우저에서 XML 규약으로 연결·상태·명령·답을 주고받는지 확인하는 개발용 시험 고정물이다. 실제 서버(서버 담당 몫, .NET)가 아니다.
표준 라이브러리만 쓴다 (WebSocket도 직접 구현).

v1.0과 같게 하는 것:
  - 주소 ws://<호스트>:<포트>/ws/hmi, 텍스트 메시지 한 개에 XML 문서 한 개 (UTF-8)
  - 접속 직후 상태 한 번, 그 뒤 간격(--interval-ms, 기본 1000)마다 상태 (자동 전송에는 id 없음)
  - GetStatus · Ping(→ Pong) · Command (id 필수). 명령은 형식만 검증하고 Reply(받음 확인, executed="false")
  - 명령 이름 EmergencyStop · ProgramStart · ProgramStop · Home · SetMode(mode Auto|Manual), 오류 InvalidCommand · UnknownCommand · InvalidMode
  - 오류(Error) InvalidXml · InvalidRequest · UnsupportedVersion · UnknownType · MissingRequestId, DTD 거절
  - 바이너리 메시지는 닫기 코드 1003, 16KiB 넘는 요청은 1009
  - --simulation: 연결·가동 true, 각도 -45~45도, 2초마다 검사 1개(5번째마다 불량)

--extended: v1.0 다음으로 HMI가 요청한 모양(docs/xml-protocol.md 4장)도 낸다 — 라인 상태(Line)·리더암 연결(LeaderArm)·이벤트(Event)·
  판정(Inspection)·명령 실행(executed="true")·상태에 따른 거절 코드·원점 각도가 붙은 Home·EmergencyStopRelease·Stop·CameraStart·CameraStop

실행: python hmi-web-mockup/tests/xml-server.py 5080 --simulation
그다음 http://localhost:5173/?mock=0&ws=ws://localhost:5080/ws/hmi
"""
import argparse
import base64
import hashlib
import math
import random
import socket
import socketserver
import struct
import sys
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from xml.sax.saxutils import escape, quoteattr

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MESSAGE = 16 * 1024
V10_COMMANDS = {"EmergencyStop", "ProgramStart", "ProgramStop", "Home", "SetMode"}
EXT_COMMANDS = {"EmergencyStopRelease", "Stop", "CameraStart", "CameraStop"}
JOINTS = 6

ARGS = None
lock = threading.Lock()
clients = set()
started = time.time()
# 요청안(--extended)의 라인 상태
S = {
    "line": "Stopped", "mode": "Auto", "estop": False, "home_required": False, "started_at": None,
    "cameras": {"top": False}, "seq": 0, "good": 0, "defect": 0, "part": 0,
}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def attrs(**kw):
    return "".join(f" {k}={quoteattr(str(v))}" for k, v in kw.items() if v is not None)


def message(kind, inner="", req_id=None):
    head = f'<Message version="1.0" type="{kind}" timestamp="{now_iso()}"{attrs(id=req_id)}'
    return head + (f">{inner}</Message>" if inner else " />")


# ---------- 상태 ----------

def inspection_counts():
    """v1.0 시뮬레이션: 서버를 켠 뒤 2초마다 1개, 5번째마다 불량"""
    if ARGS.extended:
        return S["good"], S["defect"]
    n = int((time.time() - started) / 2)
    defect = n // 5
    return n - defect, defect


def status_xml(req_id=None):
    sim = ARGS.simulation
    t = time.time() - started
    motors = []
    for i in range(1, JOINTS + 1):
        if sim:
            angle = round(45 * math.sin(t / 3 + i), 2)
            motors.append(f'<Motor id="{i}"><Angle unit="deg" valid="true">{angle}</Angle></Motor>')
        else:
            motors.append(f'<Motor id="{i}"><Angle unit="deg" valid="false" /></Motor>')
    running = "true" if (sim and (not ARGS.extended or S["line"] == "Running")) else "false"
    equipment = (
        f'<Conveyor connected="{str(sim).lower()}" running="{running}" />'
        f'<RobotArm connected="{str(sim).lower()}"><Motors>{"".join(motors)}</Motors></RobotArm>'
    )
    line = ""
    if ARGS.extended:
        equipment += f'<LeaderArm connected="{str(sim).lower()}" />'
        equipment += "".join(f'<Camera id="{cid}" connected="{str(sim).lower()}" streaming="{str(on).lower()}" />' for cid, on in S["cameras"].items())
        line = "<Line" + attrs(state=S["line"], mode=S["mode"], emergencyStop=str(S["estop"]).lower(),
                               homeRequired=str(S["home_required"]).lower(), startedAt=S["started_at"]) + " />"
    good, defect = inspection_counts()
    valid = "true" if sim else "false"
    if not sim:
        good, defect = 0, 0
    inspection = f'<Inspection valid="{valid}"><GoodCount>{good}</GoodCount><DefectCount>{defect}</DefectCount></Inspection>'
    source = "simulation" if sim else "unavailable"
    return message("Status", f'<Status source="{source}">{line}<Equipment>{equipment}</Equipment>{inspection}</Status>', req_id)


def error_xml(code, text, req_id=None):
    return message("Error", f'<Error code="{code}">{escape(text)}</Error>', req_id)


def reply_xml(req_id, result, code, command=None, mode=None, executed=False, detail=""):
    a = attrs(command=command, result=result, code=code, executed=str(executed).lower(), mode=mode)
    return message("Reply", f"<Reply{a}><Detail>{escape(detail)}</Detail></Reply>", req_id)


def event_xml(code, level="Info", **params):
    S["seq"] += 1
    inner = "".join(f'<Param name="{k}">{escape(str(v))}</Param>' for k, v in params.items())
    return message("Event", f'<Event code="{code}" level="{level}" seq="{S["seq"]}">{inner}</Event>')


# ---------- WebSocket ----------

class Closed(Exception):
    pass


class Client:
    def __init__(self, sock, addr):
        self.sock = sock
        self.addr = addr
        self.send_lock = threading.Lock()
        self.alive = True

    def send_frame(self, opcode, data):
        n = len(data)
        if n < 126:
            head = struct.pack("!BB", 0x80 | opcode, n)
        elif n < 65536:
            head = struct.pack("!BBH", 0x80 | opcode, 126, n)
        else:
            head = struct.pack("!BBQ", 0x80 | opcode, 127, n)
        with self.send_lock:
            if not self.alive:
                return
            try:
                self.sock.sendall(head + data)
            except OSError:
                self.alive = False

    def send_text(self, text):
        self.send_frame(0x1, text.encode("utf-8"))

    def close(self, code, reason=""):
        self.send_frame(0x8, struct.pack("!H", code) + reason.encode("utf-8"))
        self.alive = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise Closed()
            buf += chunk
        return buf

    def read_frame(self):
        b1, b2 = self.recv_exact(2)
        fin, opcode, masked, n = b1 & 0x80, b1 & 0x0F, b2 & 0x80, b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self.recv_exact(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self.recv_exact(8))[0]
        if n > MAX_MESSAGE + 1024:
            return fin, opcode, None
        mask = self.recv_exact(4) if masked else b"\0\0\0\0"
        data = bytes(c ^ mask[i % 4] for i, c in enumerate(self.recv_exact(n)))
        return fin, opcode, data


def broadcast(text):
    with lock:
        targets = list(clients)
    for c in targets:
        c.send_text(text)


# ---------- 요청 처리 (서버 규약 v1.0 "XML 규약") ----------

def handle_text(client, text):
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        client.send_text(error_xml("InvalidXml", "DTD is not allowed."))
        return
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        client.send_text(error_xml("InvalidXml", "Message is not well-formed XML."))
        return
    req_id = root.get("id")
    id_ok = req_id is None or (1 <= len(req_id) <= 64 and req_id.strip() != "")
    echo = req_id if id_ok else None
    if root.tag != "Message" or set(root.attrib) - {"version", "type", "id"} or not id_ok:
        client.send_text(error_xml("InvalidRequest", "Root must be Message with version, type and a valid id.", echo))
        return
    if root.get("version") != "1.0":
        client.send_text(error_xml("UnsupportedVersion", "Supported version: 1.0.", echo))
        return
    kind = root.get("type")
    if kind in ("GetStatus", "Ping"):
        if len(root) or (root.text or "").strip():
            client.send_text(error_xml("InvalidRequest", f"{kind} has no content.", echo))
        elif kind == "GetStatus":
            client.send_text(status_xml(req_id))
        else:
            client.send_text(message("Pong", "", req_id))
        return
    if kind != "Command":
        client.send_text(error_xml("UnknownType", "Supported requests: GetStatus, Ping, Command.", echo))
        return
    if req_id is None:
        client.send_text(error_xml("MissingRequestId", "Command requires an id."))
        return
    handle_command(client, root, req_id)


def handle_command(client, root, req_id):
    cmds = list(root)
    if len(cmds) != 1 or cmds[0].tag != "Command" or (root.text or "").strip():
        client.send_text(reply_xml(req_id, "Rejected", "InvalidCommand", detail="Message must contain exactly one Command."))
        return
    cmd = cmds[0]
    name = cmd.get("name")
    if not name:
        client.send_text(reply_xml(req_id, "Rejected", "InvalidCommand", detail="Command requires a name."))
        return
    known = V10_COMMANDS | (EXT_COMMANDS if ARGS.extended else set())
    if name not in known:
        client.send_text(reply_xml(req_id, "Rejected", "UnknownCommand", command=name, detail=f"Unknown command {name}."))
        return
    allowed = {"name"} | ({"mode"} if name == "SetMode" else set()) | ({"camera"} if ARGS.extended and name.startswith("Camera") else set())
    # v1.0은 Command 안에 하위 요소를 받지 않는다. 요청안(--extended)은 Home에 <Motors>를 받는다
    children_ok = len(cmd) == 0 or (ARGS.extended and name == "Home" and [c.tag for c in cmd] == ["Motors"])
    if set(cmd.attrib) - allowed or not children_ok or (cmd.text or "").strip():
        client.send_text(reply_xml(req_id, "Rejected", "InvalidCommand", command=name, detail="Unexpected attribute, element or text in Command."))
        return
    mode = cmd.get("mode")
    if name == "SetMode" and mode not in ("Auto", "Manual"):
        client.send_text(reply_xml(req_id, "Rejected", "InvalidMode", command=name, detail="SetMode requires mode Auto or Manual."))
        return
    if not ARGS.extended:
        client.send_text(reply_xml(req_id, "Received", "ReceiptOnly", command=name, mode=mode,
                                   detail="Command validated and received. No equipment action was executed or queued."))
        print(f"[cmd] {client.addr[0]} {name}{' ' + mode if mode else ''} (receipt only)", flush=True)
        return
    execute(client, req_id, name, cmd, mode)


# ---------- 요청안(--extended): 명령을 실제로 해 보는 흉내 ----------

def execute(client, req_id, name, cmd, mode):
    def reject(code, detail):
        client.send_text(reply_xml(req_id, "Rejected", code, command=name, mode=mode, detail=detail))

    events = []
    with lock:
        if name == "EmergencyStop":
            if not S["estop"]:
                events.append(("EstopPressed", "Alarm", {}))
            S.update(estop=True, line="Stopped", home_required=True, started_at=None)
        elif name == "EmergencyStopRelease":
            if not S["estop"]:
                return reject("EstopNotActive", "Emergency stop is not active.")
            S["estop"] = False
            events.append(("EstopReleased", "Info", {}))
        elif name == "ProgramStart":
            if S["estop"]:
                return reject("EstopActive", "Release the emergency stop first.")
            if S["line"] != "Stopped":
                return reject("InvalidState", "Line is not stopped.")
            if S["mode"] == "Auto" and S["home_required"]:
                return reject("HomeRequired", "Return to home before starting in Auto.")
            S.update(line="Running", started_at=now_iso())
            events.append(("LineStarted", "Info", {}))
        elif name == "Stop":
            if S["line"] != "Running":
                return reject("InvalidState", "Line is not running.")
            S.update(line="Stopped", started_at=None)
            events.append(("LineStopped", "Info", {}))
        elif name == "ProgramStop":
            S.update(line="Stopped", started_at=None, cameras={k: False for k in S["cameras"]})
            events.append(("ShutdownStarted", "Info", {}))
            threading.Timer(1.0, lambda: broadcast(event_xml("ShutdownCompleted"))).start()
        elif name == "SetMode":
            if S["estop"]:
                return reject("EstopActive", "Release the emergency stop first.")
            if S["line"] != "Stopped":
                return reject("NotStopped", "Stop the line first.")
            if S["mode"] != mode:
                S["mode"] = mode
                events.append(("ModeChanged", "Info", {"mode": mode}))
        elif name == "Home":
            if S["estop"]:
                return reject("EstopActive", "Release the emergency stop first.")
            if S["mode"] != "Auto":
                return reject("NotAuto", "Return to home in Auto mode.")
            if S["line"] != "Stopped":
                return reject("NotStopped", "Stop the line first.")
            motors = cmd.find("Motors")
            if motors is None:
                return reject("HomeNotSet", "Home requires the angles saved by the HMI.")
            angles = {}
            for m in motors.findall("Motor"):
                a = m.find("Angle")
                try:
                    angles[int(m.get("id"))] = float(a.text)
                except (TypeError, ValueError, AttributeError):
                    pass
            if sorted(angles) != list(range(1, JOINTS + 1)):
                return reject("InvalidAngles", "Home needs six angles.")
            S["line"] = "Homing"
            events.append(("HomeStarted", "Info", {}))
            print(f"[home] target {angles}", flush=True)

            def done():
                with lock:
                    S.update(line="Stopped", home_required=False)
                broadcast(event_xml("HomeCompleted"))
                broadcast(status_xml())
            threading.Timer(1.5, done).start()
        elif name in ("CameraStart", "CameraStop"):
            cid = cmd.get("camera")
            for k in S["cameras"]:
                if cid is None or cid == k:
                    S["cameras"][k] = name == "CameraStart"
            events.append(("CameraStarted" if name == "CameraStart" else "CameraStopped", "Info", {}))
    client.send_text(reply_xml(req_id, "Received", "Accepted", command=name, mode=mode, executed=True, detail="Command accepted."))
    for code, level, params in events:
        broadcast(event_xml(code, level, **params))
    broadcast(status_xml())
    print(f"[cmd] {client.addr[0]} {name}{' ' + mode if mode else ''} (executed)", flush=True)


# ---------- 연결 ----------

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        sock = self.request
        sock.settimeout(None)
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = sock.recv(4096)
            if not chunk:
                return
            head += chunk
            if len(head) > 16384:
                return
        lines = head.split(b"\r\n\r\n")[0].decode("latin-1").split("\r\n")
        parts = lines[0].split(" ")
        path = parts[1] if len(parts) > 1 else ""
        headers = {k.strip().lower(): v.strip() for k, v in (ln.split(":", 1) for ln in lines[1:] if ":" in ln)}
        if path.split("?")[0] != "/ws/hmi" or headers.get("upgrade", "").lower() != "websocket":
            body = b"HMI WebSocket is at /ws/hmi\n"
            sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
            return
        accept = base64.b64encode(hashlib.sha1((headers["sec-websocket-key"] + GUID).encode()).digest()).decode()
        sock.sendall(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        client = Client(sock, self.client_address)
        print(f"[open] {self.client_address[0]}:{self.client_address[1]}", flush=True)
        client.send_text(status_xml())  # 접속 직후 상태 한 번
        with lock:
            clients.add(client)
        parts_buf = None
        kind = None
        try:
            while client.alive:
                fin, opcode, data = client.read_frame()
                if data is None:
                    client.close(1009, "Message too big")
                    break
                if opcode == 0x8:
                    client.close(1000)
                    break
                if opcode == 0x9:
                    client.send_frame(0xA, data)
                    continue
                if opcode == 0xA:
                    continue
                if opcode in (0x1, 0x2):
                    kind, parts_buf = opcode, bytearray(data)
                elif opcode == 0x0 and parts_buf is not None:
                    parts_buf += data
                else:
                    continue
                if len(parts_buf) > MAX_MESSAGE:
                    client.close(1009, "Message too big")
                    break
                if not fin:
                    continue
                if kind == 0x2:
                    client.close(1003, "Binary messages are not supported")
                    break
                text = bytes(parts_buf).decode("utf-8", errors="replace")
                parts_buf = None
                handle_text(client, text)
        except (Closed, OSError):
            pass
        finally:
            client.alive = False
            with lock:
                clients.discard(client)
            print(f"[close] {self.client_address[0]}:{self.client_address[1]}", flush=True)


def ticker():
    """설정한 간격마다 상태를 보낸다. 요청안 + 시뮬레이션이면 가동 중 2초마다 판정 하나"""
    last_part = time.time()
    while True:
        time.sleep(ARGS.interval_ms / 1000)
        if ARGS.extended and ARGS.simulation and S["line"] == "Running" and time.time() - last_part >= 2:
            last_part = time.time()
            with lock:
                S["part"] += 1
                defect = S["part"] % 5 == 0
                S["defect" if defect else "good"] += 1
                S["seq"] += 1
                seq, part, good, bad = S["seq"], S["part"], S["good"], S["defect"]
            result = "Defect" if defect else "Good"
            conf = round(random.uniform(0.86, 0.99), 2)
            broadcast(message("Inspection", f'<Inspection seq="{seq}" id="{part}" result="{result}" confidence="{conf}" camera="top" latencyMs="{random.randint(15, 30)}">'
                                            f"<GoodCount>{good}</GoodCount><DefectCount>{bad}</DefectCount></Inspection>"))
        broadcast(status_xml())


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global ARGS
    p = argparse.ArgumentParser(description="시험용 XML 서버 (서버 규약 v1.0 흉내)")
    p.add_argument("port", nargs="?", type=int, default=5080)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--simulation", action="store_true", help="연결·가동 true, 각도·검사 개수가 변함")
    p.add_argument("--extended", action="store_true", help="v1.0 다음 요청안(docs/xml-protocol.md 4장)도 흉내")
    p.add_argument("--interval-ms", type=int, default=1000, help="상태 전송 간격 (100~60000)")
    ARGS = p.parse_args()
    ARGS.interval_ms = max(100, min(60000, ARGS.interval_ms))
    threading.Thread(target=ticker, daemon=True).start()
    with Server((ARGS.host, ARGS.port), Handler) as srv:
        mode = ("simulation" if ARGS.simulation else "unavailable") + (" + extended" if ARGS.extended else "")
        print(f"xml-server ws://{ARGS.host}:{srv.server_address[1]}/ws/hmi ({mode})", flush=True)  # 포트 0이면 빈 포트
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    sys.exit(main())
