"""프로젝트 포스터를 만든다.

    python poster/build.py          최신 안을 이 폴더에
    python poster/build.py v4       그 안을 이 폴더의 v4/에

poster.svg(원본), poster.pdf(인쇄용, 글꼴 포함), poster.png(미리보기)를 쓴다.
PDF·PNG는 Edge나 Chrome을 화면 없이 띄워 뽑는다. 글꼴은 Noto Sans KR이 설치돼 있어야 한다.
"""
import math
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent

# A1(594 x 841 mm) 기준 단위 1 = 1 mm. A 규격은 비율이 같아 A0~A3 어디로 뽑아도 그대로 맞는다.
W, H = 594, 841

# 작동 과정은 docs/line-sequence.md, 시스템 구성은 docs/API.md · docs/robot-arm.md를 따른다.
# 연결 방식(소켓 종류·USB 등)은 일부러 적지 않는다. 그림이 설명하고 글은 차례만 짚는다.
TEXT = {
    'school': '대림대학교',
    'program': '2026 경기도 앵커 사업',
    'title': ['불량을 골라내는', '눈과 손'],          # 줄마다 하나 (6안은 1안 파일의 제목을 그대로 쓴다)
    'subtitle': '카메라로 찾고, 로봇팔로 골라내는 불량품 자동 선별 라인',          # 4·5안
    'description': '카메라가 양품과 불량을 가리고, 로봇팔이 불량품만 골라 옮깁니다.',   # 6안. 1안의 두 줄 설명을 한 줄로
    'flows': [                                   # (이름, 차례, 사이 기호)
        ('작동 과정', ['이송', '촬영·판정', '분류'], '→'),
        ('시스템 구성', ['웹 HMI', '서버', '장치'], '↔'),
    ],
    'department': '스마트소프트웨어학과',
    'members': ['이강현', '전범수', '황재준'],
}

# 4·5안은 하늘과 바닥의 경계, 그림 크기, 글자 자리만 다르고 그림과 글은 같다.
# 6안은 1안 파일을 바탕으로 만든다 (restored_v1).
LAYOUTS = {
    'v4': {                          # 경계가 가운데보다 조금 아래
        'ground': 471,               # 산호 바닥이 시작하는 높이 (컨베이어 바로 아래)
        'scale': 1,                  # 장치(컨베이어·카메라·로봇팔·부품) 크기
        'glow': 1,                   # 원 크기
        'reflection': 34,            # 바닥에 비친 원의 깊이 (원 단위)
        'stars': 14,
        'title': (586, 58, 64),      # 첫 줄 기준선, 글자 크기, 줄 간격
        'subtitle': (692, 17),       # 기준선, 글자 크기
        'flows': (738, 762, 11.5, 17),   # 이름 기준선, 차례 기준선, 이름 크기, 차례 크기
        'footer': (808, 14, 16),     # 기준선, 학과 크기, 팀원 크기
    },
    'v5': {                          # 세로 3분할의 1 : 2. 위 1은 하늘, 아래 2는 바닥
        'ground': H / 3,
        'scale': 0.82,               # 하늘이 낮아 원은 띠에 맞춰 줄이고, 장치는 덜 줄여 불량품이 보이게
        'glow': 0.7,
        'reflection': 80,
        'stars': 10,
        'title': (H * 2 / 3 - 80, 72, 80),   # 둘째 줄이 아래 3분할선에 앉는다
        'subtitle': (612, 20),
        'flows': (670, 697, 12.5, 19),
        'footer': (806, 15, 17),
    },
}
LATEST = 'v6'

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
SHELL = mix(CORAL, WHITE, 0.84)    # 양품·별·밝은 글자
PEACH = mix(CORAL, WHITE, 0.45)    # 역광 테두리
STEEL = mix(NAVY, CORAL, 0.07)     # 로봇팔·카메라 (하늘보다 아주 조금 밝게)
MUTED = mix(SHELL, NAVY, 0.32)     # 남색 위 보조 글자
INK_SOFT = mix(NAVY, CORAL, 0.42)  # 산호 위 보조 글자


# ---------- 그림 단위 ----------
# 그림은 검사 자리를 원점(0, 0)으로 두고 그린 뒤, 안마다 정한 크기로 줄여 포스터 가운데에 놓는다.
# 원점은 컨베이어 윗면이고, 카메라가 바로 위에서 내려다보며, 모든 원이 이 한 점에서 컨베이어에 닿는다.
# 원은 카메라가 살피는 자리이고, 가장 밝은 한가운데에 불량품이 있다.
PX = W / 2         # 검사 자리의 가로 위치 (포스터 단위)
BELT = 13          # 컨베이어 두께
PART = 15          # 부품 한 변
PITCH = 46         # 부품 사이
LIFT = 11          # 불량품을 들어 올린 높이

# (반지름, 색) 안쪽부터. 가운데는 흰빛, 바깥으로 갈수록 산호에서 남색으로 섞인다.
RINGS = [
    (9, mix(CORAL, WHITE, 0.86)),
    (15, mix(CORAL, WHITE, 0.62)),
    (23, mix(CORAL, WHITE, 0.33)),
    (33, CORAL),
    (46, dusk(CORAL, NAVY, 0.12)),
    (62, dusk(CORAL, NAVY, 0.26)),
    (82, dusk(CORAL, NAVY, 0.40)),
    (106, dusk(CORAL, NAVY, 0.55)),
    (134, dusk(CORAL, NAVY, 0.70)),
    (164, dusk(CORAL, NAVY, 0.84)),
]


def horizon(L):
    """검사 자리(컨베이어 윗면)의 세로 위치. 바닥 경계에서 컨베이어 두께만큼 위."""
    return L['ground'] - BELT * L['scale']


def f(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def text(x, y, s, size, weight=400, fill=NAVY, anchor='start', spacing=0):
    a = '' if anchor == 'start' else f' text-anchor="{anchor}"'
    ls = f' letter-spacing="{f(spacing)}"' if spacing else ''
    return (f'<text x="{f(x)}" y="{f(y)}" font-size="{f(size)}" font-weight="{weight}" '
            f'fill="{fill}"{a}{ls}>{escape(s)}</text>')


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


def placed(y, scale, *parts):
    """그림 단위로 그린 것을 포스터 가운데 세로 위치 y에 scale 크기로 놓는다."""
    return ([f'<g transform="translate({f(PX)} {f(y)}) scale({f(scale)})">']
            + [line for part in parts for line in part] + ['</g>'])


# ---------- 그림 ----------

def glow():
    out = ['<g id="glow">']
    for r, color in reversed(RINGS):
        out.append(f'<circle cx="0" cy="{f(-r)}" r="{r}" fill="{color}"/>')
    out.append('</g>')
    return out


def stars(L):
    """빛 바깥 하늘에 몇 개만. 시선이 검사 자리에서 흩어지지 않게 적고 흐리게 둔다. 포스터 단위."""
    rng = random.Random(7)
    keep_out = [(30, 26, 566, 108)]                    # 머리글 자리
    py, reach = horizon(L), RINGS[-1][0] * L['glow']
    out, count, tries = ['<g id="stars" fill="%s">' % SHELL], 0, 0
    while count < L['stars'] and tries < 3000:
        tries += 1
        x, y = rng.uniform(16, W - 16), rng.uniform(16, py - 40)
        if math.hypot(x - PX, y - (py - reach)) < reach + 22:
            continue
        if any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in keep_out):
            continue
        r = 0.5 + rng.random() ** 3 * 0.9
        out.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}" opacity="{f(rng.uniform(.3, .75))}"/>')
        count += 1
    out.append('</g>')
    return out


def reflection(reach):
    """바닥에 비친 원. 원점은 바닥 경계. 가로 띠마다 비친 원의 너비를 계산해 그리고, 깊어질수록 흐리게 한다."""
    rng = random.Random(5)
    out = ['<g id="reflection">']
    y, k = 2, 0
    while y < reach:
        h = 1.5 + k * 0.3
        depth = y + h / 2
        shift = rng.uniform(-2.5, 2.5)
        band = []
        for r, color in reversed(RINGS):
            ry = r * 0.5                       # 비친 모습은 세로로 눌린다
            if depth >= 2 * ry:
                continue
            half = r * math.sqrt(1 - ((depth - ry) / ry) ** 2)
            band.append(f'<rect x="{f(-half + shift)}" y="{f(y)}" width="{f(2 * half)}" '
                        f'height="{f(h)}" rx="{f(h / 2)}" fill="{mix(CORAL, color, 0.5)}"/>')
        out.append(f'<g opacity="{f(1 - depth / reach)}">' + ''.join(band) + '</g>')
        y += h + 1.2 + k * 0.22
        k += 1
    out.append('</g>')
    return out


def ground(L):
    """산호 바닥. 포스터 단위."""
    return [f'<rect id="ground" y="{f(L["ground"])}" width="{W}" height="{f(H - L["ground"])}" fill="{CORAL}"/>']


def good_part(x, bottom):
    """양품. 모서리가 반듯한 밝은 정사각형."""
    s = PART
    return [f'<rect x="{f(x - s / 2)}" y="{f(bottom - s)}" width="{s}" height="{s}" rx="1.4" fill="{SHELL}"/>']


def bad_part(x, bottom, s=PART):
    """불량품. 양품과 색이 반대(남색)이고, 오른쪽 위 모서리가 깨져 금이 가 있다. s는 한 변."""
    k = s / 15                      # 모양은 한 변 15에 맞춰 그렸다
    c = 6 * k
    x0, x1, y1 = x - s / 2, x + s / 2, bottom
    y0 = y1 - s
    body = f'M{f(x0)} {f(y0)}H{f(x1 - c)}L{f(x1)} {f(y0 + c)}V{f(y1)}H{f(x0)}Z'
    crack = (f'M{f(x1 - c / 2)} {f(y0 + c / 2)}L{f(x0 + 8 * k)} {f(y0 + 6.6 * k)}'
             f'L{f(x0 + 5.4 * k)} {f(y0 + 8.6 * k)}L{f(x0 + 3.4 * k)} {f(y0 + 12.6 * k)}')
    return [f'<path d="{body}" fill="{NAVY}"/>',
            f'<path d="{crack}" fill="none" stroke="{CORAL}" stroke-width="{f(1.4 * k)}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>']


def conveyor(L):
    """포스터 양옆 여백(40)까지 닿는 컨베이어. 그림을 줄이면 그만큼 길어져 부품이 더 놓인다."""
    half = (PX - 40) / L['scale']
    out = ['<g id="conveyor">',
           f'<rect x="{f(-half)}" y="0" width="{f(2 * half)}" height="{BELT}" rx="6.5" fill="{STEEL}"/>',
           f'<path d="M{f(-half + 7)} .6H{f(half - 7)}" stroke="{SHELL}" stroke-width="1.1" stroke-opacity=".9"/>']
    k = -int(half / (PITCH / 2)) - 1
    while PITCH / 4 + PITCH / 2 * k < half - 12:     # 롤러
        x = PITCH / 4 + PITCH / 2 * k
        if x > -half + 12:
            out.append(f'<circle cx="{f(x)}" cy="6.5" r=".9" fill="{SHELL}" fill-opacity=".45"/>')
        k += 1
    for x in (-half + 6.5, half - 6.5):
        out.append(f'<circle cx="{f(x)}" cy="6.5" r="3.2" fill="none" stroke="{SHELL}" '
                   f'stroke-opacity=".9" stroke-width="1"/>')
    k = 1                           # 검사 자리는 로봇팔이 불량품을 들어 올려 비어 있다
    while PITCH * k + PART / 2 <= half - 12:
        out += good_part(-PITCH * k, 0) + good_part(PITCH * k, 0)
        k += 1
    out.append('</g>')
    return out


CAM_TOP = -198
LENS = CAM_TOP + 38                 # 렌즈 아래 끝


def camera_shapes(color, d):
    """키트의 탑 뷰 마운트처럼 옆 기둥에 매단 카메라. 렌즈가 검사 자리를 바로 내려다본다."""
    return [
        rect(color, d, -68, CAM_TOP, 5, -CAM_TOP),         # 기둥
        rect(color, d, -68, CAM_TOP - 2, 72, 5, 1.6),      # 팔
        rect(color, d, -23, CAM_TOP + 3, 46, 25, 4),       # 몸체
        rect(color, d, -10, CAM_TOP + 27, 20, 11, 2.2),    # 렌즈
    ]


def camera():
    view = (f'fill="none" stroke="{SHELL}" stroke-width="1" stroke-dasharray="3 3" '
            f'stroke-opacity=".7" stroke-linecap="round"')
    return ['<g id="camera">',
            f'<path d="M-7 {LENS}L-27 -8M7 {LENS}L27 -8" {view}/>',
            *rimlit(camera_shapes),
            f'<path d="M-6 {f(LENS - .7)}H6" stroke="{SHELL}" stroke-width="1.3"/>',
            f'<circle cx="14" cy="{CAM_TOP + 10}" r="2.2" fill="{CORAL}"/>',   # 녹화 표시
            '</g>']


def arm_shapes(color, d):
    S, E, Wr = (131, -44), (91, -136), (0, -80)
    part_top = -LIFT - PART
    grip_bottom = part_top - 4      # 그리퍼 몸과 부품 사이로 빛이 보이게 띄운다
    grip_top = grip_bottom - 9
    finger_x = PART / 2 + 1.3       # 손가락 안쪽 끝. 부품과 손가락 사이에도 가는 빛이 보인다
    finger_h = -LIFT - 2 - (grip_bottom - 2)
    return [
        rect(color, d, 107, -14, 48, 18, 4),                # 받침 (아래는 컨베이어에 가림)
        rect(color, d, 116, -40, 30, 30, 5),                # 어깨 모터
        link(color, d, S, E, 17), link(color, d, E, Wr, 15),  # 위팔, 아래팔
        circle(color, d, *S, 11), circle(color, d, *E, 10.5), circle(color, d, *Wr, 8.5),
        rect(color, d, -7, Wr[1], 14, grip_top - Wr[1] + 2, 3),           # 손목
        rect(color, d, -18, grip_top, 36, 9, 2.5),                         # 그리퍼 몸
        rect(color, d, -finger_x - 5, grip_bottom - 2, 5, finger_h, 1.6),  # 손가락
        rect(color, d, finger_x, grip_bottom - 2, 5, finger_h, 1.6),
    ]


def arm():
    return ['<g id="arm">', *rimlit(arm_shapes), *bad_part(0, -LIFT), '</g>']


BIN_X = 187


def bin_shapes(color, d):
    top, bottom = 6, 42
    body = (f'M{f(BIN_X - 26 + d[0])} {f(top + d[1])}H{f(BIN_X + 26 + d[0])}'
            f'L{f(BIN_X + 22 + d[0])} {f(bottom + d[1])}H{f(BIN_X - 22 + d[0])}Z')
    return [f'<path d="{body}" fill="{color}"/>', rect(color, d, BIN_X - 29, 3, 58, 5, 1.5)]


def defect_bin():
    """컨베이어 바로 앞에 둔 불량 상자. 로봇팔이 든 불량품이 갈 곳."""
    return ['<g id="defect-bin">', *rimlit(bin_shapes),
            text(BIN_X, 30, '불량', 10.5, 700, CORAL, 'middle'), '</g>']


# ---------- 글자 (포스터 단위) ----------

def mark(x, y, size):
    src = (HERE / 'assets' / 'daelim-authority-mark.svg').read_text(encoding='utf-8')
    d = src.split(' d="', 1)[1].split('"', 1)[0]
    vb = float(src.split('viewBox="0 0 ', 1)[1].split(' ', 1)[0])
    return [f'<g id="authority-mark" transform="translate({f(x)} {f(y)}) scale({size / vb:.5f})">',
            f'<path fill="{DAELIM_BLUE}" d="{d}"/>', '</g>']


def header():
    """하늘 위쪽. 학교와 사업명."""
    t = TEXT
    return ['<g id="header">', *mark(40, 38, 58),
            text(110, 74, t['school'], 20, 700, WHITE),
            text(554, 74, t['program'], 13.5, 500, MUTED, 'end'),
            '</g>']


def headline(L):
    """바닥 위쪽. 제목과 한 줄 설명. 제목 자간은 글자 크기에 비례해 좁힌다."""
    t = TEXT
    y, size, gap = L['title']
    out = ['<g id="headline">']
    for i, line in enumerate(t['title']):
        out.append(text(37, y + gap * i, line, size, 700, NAVY, spacing=-size * 0.0276))
    sub_y, sub_size = L['subtitle']
    out.append(text(40, sub_y, t['subtitle'], sub_size, 500, NAVY))
    out.append('</g>')
    return out


def chain(items, sep, gap, first_dx=0):
    """차례 글자. 사이 기호는 흐리게."""
    spans = []
    for i, item in enumerate(items):
        if i:
            spans.append(f'<tspan dx="{f(gap)}" fill="{INK_SOFT}" font-weight="400">{escape(sep)}</tspan>')
        spans.append(f'<tspan dx="{f(gap) if i else f(first_dx)}">{escape(item)}</tspan>')
    return spans


def flows(L):
    """작동 과정과 시스템 구성. 상자나 번호 없이 이름과 차례만 두 칸에 적는다."""
    name_y, item_y, name_size, item_size = L['flows']
    out = ['<g id="flows">']
    for (name, items, sep), x in zip(TEXT['flows'], (40, PX)):   # 오른쪽 칸은 검사 자리와 같은 세로선
        out.append(text(x, name_y, name, name_size, 700, INK_SOFT))
        out.append(f'<text x="{f(x)}" y="{f(item_y)}" font-size="{f(item_size)}" font-weight="500" fill="{NAVY}">'
                   + ''.join(chain(items, sep, item_size * 0.206)) + '</text>')
    out.append('</g>')
    return out


def flows_inline(y, item_size, name_size):
    """작동 과정과 시스템 구성을 한 줄에. 학과·팀원 줄처럼 앞 칸은 왼쪽, 뒤 칸은 오른쪽 여백에 맞춘다.
    이름은 작고 흐리게 앞에 붙인다."""
    out = ['<g id="flows">']
    for (name, items, sep), (x, anchor) in zip(TEXT['flows'], ((40, ''), (554, ' text-anchor="end"'))):
        label = f'<tspan font-size="{f(name_size)}" font-weight="700" fill="{INK_SOFT}">{escape(name)}</tspan>'
        out.append(f'<text x="{f(x)}" y="{f(y)}" font-size="{f(item_size)}" font-weight="500" fill="{NAVY}"{anchor}>'
                   + label + ''.join(chain(items, sep, item_size * 0.206, item_size * 0.45)) + '</text>')
    out.append('</g>')
    return out


def footer(L):
    t = TEXT
    y, dept_size, name_size = L['footer']
    out = ['<g id="team">', text(40, y, t['department'], dept_size, 500, NAVY)]
    out += [text(554 - 4 * name_size * i, y, name, name_size, 500, NAVY, 'end')
            for i, name in enumerate(reversed(t['members']))]
    out.append('</g>')
    return out


def poster_svg(L):
    body = [f'<rect width="{W}" height="{H}" fill="{NAVY}"/>']
    py = horizon(L)
    body += (stars(L) + placed(py, L['glow'], glow()) + ground(L)
             + placed(L['ground'], L['glow'], reflection(L['reflection']))
             + placed(py, L['scale'], camera(), arm(), conveyor(L), defect_bin())
             + header() + headline(L) + flows(L) + footer(L))
    return '\n'.join([
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}mm" height="{H}mm" '
        f'font-family="{FONT}">',
        f'<title>{escape(" ".join(TEXT["title"]))} — {TEXT["school"]} {TEXT["department"]}</title>',
        *body,
        '</svg>',
    ]) + '\n'


# ---------- 6안: 1안을 되살린 안 ----------
# 1안의 구도·제목 크기·색 면적을 그대로 두고, 4안 이후의 카메라와 불량품 모양만 옮겨 온다.
# 1안을 만든 스크립트는 남아 있지 않아 v1/poster.svg를 읽어 아래 세 곳만 바꾼다.
V1_INSPECT_Y = 480                  # 1안의 검사 자리 (컨베이어 윗면). 모든 원이 여기서 닿는다
V1_DEFECT = '<path d="M291 462H298L303 467V474H291Z" fill="#051230"/>'   # 1안의 불량품 (한 변 12)
V1_DESCRIPTION = ('<text x="40" y="735"', '<text x="40" y="762"')        # 1안의 두 줄 설명
V1_TEXTS = [                        # 1안의 글자 줄. 모양과 자리는 두고 글자만 TEXT에서 넣는다
    ('<text x="110" y="74"', 'school'), ('<text x="554" y="74"', 'program'),
    ('<text x="38" y="628"', ('title', 0)), ('<text x="38" y="692"', ('title', 1)),
    ('<text x="40" y="805"', 'department'),
    ('<text x="430" y="805"', ('members', 0)), ('<text x="492" y="805"', ('members', 1)),
    ('<text x="554" y="805"', ('members', 2)),
]


def restored_v1():
    lines = (HERE / 'v1' / 'poster.svg').read_text(encoding='utf-8').split('\n')

    def find(prefix):
        hits = [i for i, line in enumerate(lines) if line.startswith(prefix)]
        if len(hits) != 1:
            raise SystemExit(f'v1/poster.svg에서 {prefix!r}를 찾지 못했습니다. 1안 파일이 바뀌었는지 확인하세요.')
        return hits[0]

    for prefix, key in V1_TEXTS:
        value = TEXT[key[0]][key[1]] if isinstance(key, tuple) else TEXT[key]
        i = find(prefix)
        head, _, rest = lines[i].partition('>')
        lines[i] = f'{head}>{escape(value)}</text>{rest.partition("</text>")[2]}'

    # 불량품: 1안과 같은 자리·크기에 금 간 모양으로
    lines[find(V1_DEFECT)] = '\n'.join(bad_part(PX, 474, 12))
    # 설명 두 줄: 첫 줄은 한 줄로 줄인 설명, 둘째 줄은 작동 과정·시스템 구성
    first, second = (find(prefix) for prefix in V1_DESCRIPTION)
    lines[first] = text(40, 735, TEXT['description'], 17, 500, NAVY)
    lines[second] = '\n'.join(flows_inline(762, 16, 11))   # 설명(17)보다 한 단계 작게
    # 카메라: 로봇팔 뒤, 검사 자리 바로 위
    arm_at = find('<g id="arm">')
    lines[arm_at] = '\n'.join(placed(V1_INSPECT_Y, 1, camera())) + '\n' + lines[arm_at]
    return '\n'.join(lines)


def build(name):
    return restored_v1() if name == 'v6' else poster_svg(LAYOUTS[name])


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


def render(svg, out):
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
        subprocess.run(common + [f'--print-to-pdf={out / "poster.pdf"}', '--no-pdf-header-footer',
                                 page.as_uri()], check=True, capture_output=True)
        subprocess.run(common + [f'--screenshot={out / "poster.png"}', '--window-size=1188,1682',
                                 shot.as_uri()], check=True, capture_output=True)


def main():
    names = [*LAYOUTS, 'v6']
    name = sys.argv[1] if len(sys.argv) > 1 else LATEST
    if name not in names:
        raise SystemExit(f'안 이름은 {", ".join(names)} 중 하나입니다.')
    out = HERE / name if len(sys.argv) > 1 else HERE
    out.mkdir(exist_ok=True)
    svg = build(name)
    (out / 'poster.svg').write_text(svg, encoding='utf-8')
    render(svg, out)
    print(f'{name}: {out.relative_to(HERE.parent).as_posix()}/poster.svg, poster.pdf, poster.png')


if __name__ == '__main__':
    main()
