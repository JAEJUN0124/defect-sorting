"""프로젝트 포스터를 만든다.

    python poster/build.py

poster.svg(원본), poster.pdf(인쇄용, 글꼴 포함), poster.png(미리보기)를 이 폴더에 쓴다.
PDF·PNG는 Edge나 Chrome을 화면 없이 띄워 뽑는다. 글꼴은 Noto Sans KR이 설치돼 있어야 한다.
"""
import math
import random
import shutil
import subprocess
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent

# A1(594 x 841 mm) 기준 단위 1 = 1 mm. A 규격은 비율이 같아 A0~A3 어디로 뽑아도 그대로 맞는다.
W, H = 594, 841

# 동작 과정은 docs/line-sequence.md, 시스템 구성은 docs/API.md · docs/robot-arm.md를 따른다.
TEXT = {
    'school': '대림대학교',
    'program': '2026 경기도 앵커 사업',
    'title': '불량을 골라내는 눈과 손',
    'subtitle': '카메라로 찾고, 로봇팔로 골라내는 불량품 자동 선별 라인',
    'steps': [                                   # (단계, 누가 무엇을)
        ('옮기고,', '컨베이어가 검사 자리로'),
        ('보고,', '카메라로 양품·불량 판정'),
        ('골라낸다.', '불량품만 로봇팔이 상자로'),
    ],
    'nodes': [                                   # 시스템 구성 (이름, 하는 일)
        ('웹 HMI', '조작과 모니터링'),
        ('서버', '공정 제어와 판정'),
        ('장치', '컨베이어·카메라·로봇팔'),
    ],
    'links': ['HTTP·WebSocket', 'USB'],          # 이름 사이 화살표 위 글자
    'department': '스마트소프트웨어학과',
    'members': ['이강현', '전범수', '황재준'],
}

FONT = "'Noto Sans KR', 'Malgun Gothic', sans-serif"


# ---------- 색: 두 기본색과 그 둘을 섞은 색만 쓴다 ----------

def _to_linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _to_srgb(c):
    c = min(1.0, max(0.0, c))
    v = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return round(v * 255)


def _oklab(hex_color):
    r, g, b = (_to_linear(int(hex_color[i:i + 2], 16)) for i in (1, 3, 5))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def _hex(lab):
    L, a, b = lab
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    return '#%02X%02X%02X' % tuple(_to_srgb(v) for v in rgb)


def mix(c1, c2, t):
    """OKLab에서 곧게 섞는다. 흰색 쪽으로 밝힐 때 쓴다."""
    a, b = _oklab(c1), _oklab(c2)
    return _hex(tuple(x + (y - x) * t for x, y in zip(a, b)))


def dusk(c1, c2, t, turn=0.5):
    """두 색을 노을처럼 섞는다.
    turn=0은 OKLab에서 곧게 섞기 — 두 색이 색상환 반대쪽이라 가운데가 탁한 갈색이 된다.
    turn=1은 OKLCH에서 색상각이 가까운 쪽(로즈→자두→남보라)으로 돌기 — 보라가 세 번째 색처럼 보인다.
    0.5는 그 가운데로, 두 색 계열 안에 머물면서 노을빛이 난다."""
    def lch(c):
        L, a, b = _oklab(c)
        return L, math.hypot(a, b), math.degrees(math.atan2(b, a))
    (L1, C1, h1), (L2, C2, h2) = lch(c1), lch(c2)
    dh = (h2 - h1 + 180) % 360 - 180
    L, C, h = L1 + (L2 - L1) * t, C1 + (C2 - C1) * t, math.radians(h1 + dh * t)
    arc = (L, C * math.cos(h), C * math.sin(h))
    line = tuple(x + (y - x) * t for x, y in zip(_oklab(c1), _oklab(c2)))
    return _hex(tuple(a + (b - a) * turn for a, b in zip(line, arc)))


NAVY = '#051230'
CORAL = '#F48067'
WHITE = '#FFFFFF'
DAELIM_BLUE = '#0095C8'            # 학교 브랜드 색 (.ai 원본 표기: PANTONE 639 C, R0 G149 B200)
SHELL = mix(CORAL, WHITE, 0.84)    # 부품·별·밝은 글자
PEACH = mix(CORAL, WHITE, 0.45)    # 역광 테두리
STEEL = mix(NAVY, CORAL, 0.07)     # 로봇팔·카메라 (하늘보다 아주 조금 밝게)
MUTED = mix(SHELL, NAVY, 0.32)     # 남색 위 보조 글자

# 검사 자리. 모든 원이 이 한 점에서 컨베이어에 닿는다 — 라인의 시선이 불량품 하나에 모인다.
PX, PY = 297, 462
BELT_TOP, BELT_BOTTOM = PY, PY + 13

# 띠: 남색(제목·그림) → 산호(동작 과정, 컨베이어 아래부터) → 남색(시스템 구성·팀, 여기부터)
BAND_Y = 660

# 아래 설명의 세 칸. 그림의 ①②③(왼쪽 → 오른쪽)과 같은 순서로 놓인다.
COLS = [40, 218, 396]
COL_W = 158

# (반지름, 색) 안쪽부터. 가운데는 흰빛, 바깥으로 갈수록 산호에서 남색으로 섞인다.
RINGS = [
    (8, mix(CORAL, WHITE, 0.86)),
    (14, mix(CORAL, WHITE, 0.62)),
    (22, mix(CORAL, WHITE, 0.33)),
    (32, CORAL),
    (45, dusk(CORAL, NAVY, 0.14)),
    (60, dusk(CORAL, NAVY, 0.30)),
    (79, dusk(CORAL, NAVY, 0.47)),
    (103, dusk(CORAL, NAVY, 0.64)),
    (132, dusk(CORAL, NAVY, 0.80)),
]


def f(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def text(x, y, s, size, weight=400, fill=NAVY, anchor='start'):
    a = '' if anchor == 'start' else f' text-anchor="{anchor}"'
    return (f'<text x="{f(x)}" y="{f(y)}" font-size="{f(size)}" font-weight="{weight}" '
            f'fill="{fill}"{a}>{escape(s)}</text>')


def rect(color, d, x, y, w, h, rx=0):
    return (f'<rect x="{f(x + d[0])}" y="{f(y + d[1])}" width="{f(w)}" height="{f(h)}" '
            f'rx="{f(rx)}" fill="{color}"/>')


def circle(color, d, cx, cy, r):
    return f'<circle cx="{f(cx + d[0])}" cy="{f(cy + d[1])}" r="{f(r)}" fill="{color}"/>'


def link(color, d, a, b, width):
    return (f'<path d="M{f(a[0] + d[0])} {f(a[1] + d[1])}L{f(b[0] + d[0])} {f(b[1] + d[1])}" '
            f'stroke="{color}" stroke-width="{f(width)}" stroke-linecap="round"/>')


def rimlit(shapes):
    """빛을 등진 실루엣. 같은 모양을 복숭앗빛으로 살짝 비켜 깔아 테두리가 빛나게 한다."""
    return shapes(PEACH, (-1.8, -1.2)) + shapes(STEEL, (0, 0))


# ---------- 그림 ----------

def glow():
    out = ['<g id="glow">']
    for r, color in reversed(RINGS):
        out.append(f'<circle cx="{PX}" cy="{f(PY - r)}" r="{r}" fill="{color}"/>')
    out.append('</g>')
    return out


def stars():
    rng = random.Random(11)
    keep_out = [(30, 26, 250, 104), (380, 50, 566, 92), (30, 104, 564, 198)]   # 글자 자리
    reach = RINGS[-1][0]
    out, count, tries = ['<g id="stars" fill="%s">' % SHELL], 0, 0
    while count < 40 and tries < 3000:
        tries += 1
        x, y = rng.uniform(14, W - 14), rng.uniform(14, PY - 24)
        if math.hypot(x - PX, y - (PY - reach)) < reach + 12:   # 빛 바깥 하늘에만
            continue
        if any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in keep_out):
            continue
        r = 0.45 + rng.random() ** 3 * 1.15
        out.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}" opacity="{f(rng.uniform(.35, .95))}"/>')
        count += 1
    out.append('</g>')
    return out


def reflection(reach=30):
    """물에 비친 원. 가로 띠마다 비친 원의 너비를 계산해 그리고, 깊어질수록 흐리게 한다."""
    rng = random.Random(5)
    out = ['<g id="reflection">']
    y, k = BELT_BOTTOM + 2, 0
    while y - BELT_BOTTOM < reach:
        h = 1.5 + k * 0.3
        depth = y + h / 2 - BELT_BOTTOM
        shift = rng.uniform(-2.5, 2.5)
        band = []
        for r, color in reversed(RINGS):
            ry = r * 0.5                       # 물에 비친 모습은 세로로 눌린다
            if depth >= 2 * ry:
                continue
            half = r * math.sqrt(1 - ((depth - ry) / ry) ** 2)
            band.append(f'<rect x="{f(PX - half + shift)}" y="{f(y)}" width="{f(2 * half)}" '
                        f'height="{f(h)}" rx="{f(h / 2)}" fill="{mix(CORAL, color, 0.5)}"/>')
        out.append(f'<g opacity="{f(1 - depth / reach)}">' + ''.join(band) + '</g>')
        y += h + 1.2 + k * 0.22
        k += 1
    out.append('</g>')
    return out


def ground():
    return ['<g id="ground">',
            f'<rect y="{BELT_BOTTOM}" width="{W}" height="{BAND_Y - BELT_BOTTOM}" fill="{CORAL}"/>',
            *reflection(), '</g>']


def part(x, bottom, color, chipped=False):
    """12 x 12 부품. x는 가운데, bottom은 바닥 높이."""
    s = 12
    x0, x1, y1 = x - s / 2, x + s / 2, bottom
    y0 = y1 - s
    if chipped:
        c = 5   # 오른쪽 위 모서리가 깨진 불량품
        d = f'M{f(x0)} {f(y0)}H{f(x1 - c)}L{f(x1)} {f(y0 + c)}V{f(y1)}H{f(x0)}Z'
        return [f'<path d="{d}" fill="{color}"/>']
    return [f'<rect x="{f(x0)}" y="{f(y0)}" width="{s}" height="{s}" rx="1.2" fill="{color}"/>']


def conveyor():
    out = ['<g id="conveyor">',
           f'<rect x="40" y="{BELT_TOP}" width="514" height="{BELT_BOTTOM - BELT_TOP}" rx="6.5" fill="{STEEL}"/>',
           f'<path d="M47 {f(BELT_TOP + .6)}H547" stroke="{SHELL}" stroke-width="1.1" stroke-opacity=".9"/>']
    for k in range(-6, 6):          # 흐르는 방향(왼쪽 → 오른쪽)
        x = PX + 21 + 42 * k
        out.append(f'<path d="M{f(x - 1.8)} {f(PY + 3.8)}L{f(x + 1.6)} {f(PY + 6.5)}L{f(x - 1.8)} {f(PY + 9.2)}" '
                   f'fill="none" stroke="{SHELL}" stroke-width="1" stroke-opacity=".6" '
                   f'stroke-linecap="round" stroke-linejoin="round"/>')
    for x in (46.5, 547.5):
        out.append(f'<circle cx="{x}" cy="{f(PY + 6.5)}" r="3.2" fill="none" stroke="{SHELL}" '
                   f'stroke-opacity=".9" stroke-width="1"/>')
    for k in range(-5, 6):
        if k:
            out += part(PX + 42 * k, BELT_TOP, SHELL)
    out.append('</g>')
    return out


CAM_TOP = PY - 170


def camera_shapes(color, d):
    """키트의 탑 뷰 마운트처럼 옆 기둥에 매단 카메라. 렌즈가 검사 자리를 내려다본다."""
    return [
        rect(color, d, PX - 60, CAM_TOP, 4.5, PY - CAM_TOP),      # 기둥
        rect(color, d, PX - 60, CAM_TOP - 2, 62, 4.5, 1.5),       # 팔
        rect(color, d, PX - 18, CAM_TOP + 3, 36, 20, 3.5),        # 몸체
        rect(color, d, PX - 8, CAM_TOP + 23, 16, 9, 2),           # 렌즈
    ]


def camera():
    lens = CAM_TOP + 32
    view = (f'fill="none" stroke="{SHELL}" stroke-width="1" stroke-dasharray="3 3" '
            f'stroke-opacity=".75" stroke-linecap="round"')
    return ['<g id="camera">',
            f'<path d="M{PX - 6} {lens}L{PX - 22} {PY - 14}M{PX + 6} {lens}L{PX + 22} {PY - 14}" {view}/>',
            *rimlit(camera_shapes),
            f'<path d="M{PX - 5} {lens - .6}H{PX + 5}" stroke="{SHELL}" stroke-width="1.2"/>',
            f'<circle cx="{PX + 11}" cy="{CAM_TOP + 9.5}" r="2" fill="{CORAL}"/>',   # 녹화 표시
            '</g>']


def arm_shapes(color, d):
    S, E, Wr = (423, PY - 40), (381, PY - 126), (PX, PY - 66)
    return [
        rect(color, d, 399, PY - 12, 48, 16, 4),            # 받침 (아래는 컨베이어에 가림)
        rect(color, d, 408, PY - 36, 30, 30, 5),            # 어깨 모터
        link(color, d, S, E, 17), link(color, d, E, Wr, 15),  # 위팔, 아래팔
        circle(color, d, *S, 11), circle(color, d, *E, 10.5), circle(color, d, *Wr, 8.5),
        rect(color, d, PX - 7, PY - 66, 14, 32, 3),         # 손목
        rect(color, d, PX - 14, PY - 37, 28, 10, 2.5),      # 그리퍼 몸
        rect(color, d, PX - 14, PY - 30, 5.5, 24, 1.6),     # 손가락
        rect(color, d, PX + 8.5, PY - 30, 5.5, 24, 1.6),
    ]


def arm():
    return ['<g id="arm">', *rimlit(arm_shapes), *part(PX, BELT_TOP - 6, NAVY, chipped=True), '</g>']


BIN_X = 478


def bin_shapes(color, d):
    top, bottom = PY + 6, PY + 40
    body = (f'M{f(BIN_X - 25 + d[0])} {f(top + d[1])}H{f(BIN_X + 25 + d[0])}'
            f'L{f(BIN_X + 21 + d[0])} {f(bottom + d[1])}H{f(BIN_X - 21 + d[0])}Z')
    return [f'<path d="{body}" fill="{color}"/>', rect(color, d, BIN_X - 28, PY + 3, 56, 5, 1.5)]


def defect_bin():
    """컨베이어 바로 앞에 둔 불량 상자."""
    return ['<g id="defect-bin">', *rimlit(bin_shapes),
            text(BIN_X, PY + 28, '불량', 10, 700, CORAL, 'middle'), '</g>']


def marker(cx, cy, n, r=9, size=11):
    """그림과 동작 과정을 잇는 단계 번호."""
    return [f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="{NAVY}" stroke="{CORAL}" stroke-width="1.2"/>',
            text(cx, cy + size * 0.36, str(n), size, 700, CORAL, 'middle')]


def scene_markers():
    return ['<g id="steps-in-picture">',
            *marker(PX - 42 * 4, PY - 34, 1),            # 들어오는 부품
            *marker(PX + 34, CAM_TOP + 12, 2),            # 카메라
            *marker(BIN_X + 44, PY + 22, 3),               # 불량 상자
            '</g>']


# ---------- 글자 ----------

def mark(x, y, size):
    src = (HERE / 'assets' / 'daelim-authority-mark.svg').read_text(encoding='utf-8')
    d = src.split(' d="', 1)[1].split('"', 1)[0]
    vb = float(src.split('viewBox="0 0 ', 1)[1].split(' ', 1)[0])
    return [f'<g id="authority-mark" transform="translate({f(x)} {f(y)}) scale({size / vb:.5f})">',
            f'<path fill="{DAELIM_BLUE}" d="{d}"/>', '</g>']


def headline():
    t = TEXT
    return ['<g id="headline">', *mark(40, 38, 58),
            text(110, 74, t['school'], 20, 700, WHITE),
            text(554, 74, t['program'], 13.5, 500, MUTED, 'end'),
            f'<text x="38" y="152" font-size="44" font-weight="700" letter-spacing="-1" '
            f'fill="{WHITE}">{escape(t["title"])}</text>',
            text(40, 186, t['subtitle'], 16, 500, CORAL),
            '</g>']


def double_arrow(x0, x1, y, color):
    h = 3.2
    return [f'<path d="M{f(x0 + h)} {f(y)}H{f(x1 - h)}" stroke="{color}" stroke-width="1.3"/>',
            f'<path d="M{f(x0)} {f(y)}l{f(h * 1.6)} {f(-h)}v{f(2 * h)}Z" fill="{color}"/>',
            f'<path d="M{f(x1)} {f(y)}l{f(-h * 1.6)} {f(-h)}v{f(2 * h)}Z" fill="{color}"/>']


def process():
    """산호 띠. 세 단계 이름을 이어 읽으면 한 문장이 된다."""
    out = ['<g id="process">']
    for i, (name, desc) in enumerate(TEXT['steps']):
        x = COLS[i]
        out += marker(x + 13, 544, i + 1, 13, 15)
        out.append(text(x, 590, name, 26, 700))
        out.append(text(x, 615, desc, 14))
    out.append('</g>')
    return out


def system():
    """아래 남색 띠. 이름은 흰색, 하는 일은 보조색, 연결 방식은 산호."""
    out = ['<g id="system">']
    y = 716
    centers = [c + COL_W / 2 for c in COLS]
    for (name, desc), cx in zip(TEXT['nodes'], centers):
        out.append(text(cx, y, name, 18, 700, WHITE, 'middle'))
        out.append(text(cx, y + 23, desc, 13, 400, MUTED, 'middle'))
    for i, label in enumerate(TEXT['links']):
        x0, x1 = centers[i] + 44, centers[i + 1] - 44
        out += double_arrow(x0, x1, y - 6, CORAL)
        out.append(text((x0 + x1) / 2, y - 13, label, 10, 500, CORAL, 'middle'))
    out.append('</g>')
    return out


def footer():
    t = TEXT
    out = ['<g id="team">', text(40, 806, t['department'], 14, 500, MUTED)]
    out += [text(554 - 64 * i, 806, name, 16, 500, WHITE, 'end') for i, name in enumerate(reversed(t['members']))]
    out.append('</g>')
    return out


def poster_svg():
    body = [f'<rect width="{W}" height="{H}" fill="{NAVY}"/>']
    body += (stars() + glow() + ground() + camera() + arm() + conveyor() + defect_bin()
             + scene_markers() + headline() + process() + system() + footer())
    return '\n'.join([
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}mm" height="{H}mm" '
        f'font-family="{FONT}">',
        f'<title>{escape(TEXT["title"])} — {TEXT["school"]} {TEXT["department"]}</title>',
        *body,
        '</svg>',
    ]) + '\n'


# ---------- PDF·PNG 뽑기 ----------

BROWSERS = [
    Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
    Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe'),
    Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe'),
]


def browser():
    for path in BROWSERS:
        if path.exists():
            return str(path)
    for name in ('msedge', 'google-chrome', 'chromium', 'chrome'):
        found = shutil.which(name)
        if found:
            return found
    raise SystemExit('Edge나 Chrome을 찾지 못했습니다. PDF·PNG 없이 poster.svg만 만들었습니다.')


def render(svg):
    exe = browser()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        page = tmp / 'print.html'
        page.write_text(
            '<!doctype html><meta charset="utf-8"><style>@page{size:594mm 841mm;margin:0}'
            'html,body{margin:0}svg{display:block;width:594mm;height:841mm}</style>' + svg,
            encoding='utf-8')
        shot = tmp / 'shot.html'
        shot.write_text(
            '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}'
            'svg{display:block;width:100vw;height:100vh}</style>' + svg,
            encoding='utf-8')
        common = [exe, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={tmp / "profile"}']
        subprocess.run(common + [f'--print-to-pdf={HERE / "poster.pdf"}', '--no-pdf-header-footer',
                                 page.as_uri()], check=True, capture_output=True)
        subprocess.run(common + [f'--screenshot={HERE / "poster.png"}', '--window-size=1188,1682',
                                 shot.as_uri()], check=True, capture_output=True)


def main():
    svg = poster_svg()
    (HERE / 'poster.svg').write_text(svg, encoding='utf-8')
    render(svg)
    print('poster.svg, poster.pdf, poster.png')


if __name__ == '__main__':
    main()
