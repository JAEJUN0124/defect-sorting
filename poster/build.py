"""프로젝트 포스터를 만든다.

    python poster/build.py          최신 안을 이 폴더에
    python poster/build.py v4       그 안을 이 폴더의 v4/에

poster.svg(원본), poster.pdf(인쇄용, 글꼴 포함), poster.png(미리보기)를 쓴다.
PDF·PNG는 Edge나 Chrome을 화면 없이 띄워 뽑는다. 글꼴은 Noto Sans KR이 설치돼 있어야 한다.
"""
import math
import random
import re
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
    'program_v8': '2026 캡스톤 디자인',               # 8안 (사용자 2026-10-27)
    'title': ['불량을 골라내는', '눈과 손'],          # 줄마다 하나 (6안은 1안 파일의 제목을 그대로 쓴다)
    'title_v8': ['불량을 찾는 눈,', '골라내는 손'],   # 8안. 눈(카메라)이 찾고 손(로봇팔)이 고른다는 것이 제목에서 읽히게
    'subtitle': '카메라로 찾고, 로봇팔로 골라내는 불량품 자동 선별 라인',          # 4·5안
    'description': '카메라가 양품과 불량을 가리고, 로봇팔이 불량품만 골라 옮깁니다.',   # 6안. 1안의 두 줄 설명을 한 줄로
    'flows': [                                   # (이름, 차례, 사이 기호)
        ('작동 과정', ['이송', '촬영·판정', '분류'], '→'),
        ('시스템 구성', ['웹 HMI', '서버', '장치'], '↔'),
    ],
    # 7안. 단계마다 한 줄씩만. 판정 방법(모델 등)은 정해지지 않아 적지 않는다.
    'steps': [
        ('이송', '컨베이어가 부품을 검사 자리로 옮깁니다'),
        ('판정', '카메라 영상으로 양품과 불량을 가립니다'),
        ('분류', '로봇팔이 불량품을 집어 따로 옮깁니다'),
    ],
    'system': {                                   # (이름, 한 줄 보충)
        'hmi': ('웹 HMI', 'React · 조작 화면'),
        'server': ('서버', '.NET · 공정 제어'),
        'link': '웹소켓 · XML',
        'video': '영상 · MJPEG',                  # 9안: 카메라 영상은 서버의 HTTP 주소에서 따로 받는다 (D-019)
        'devices': [('컨베이어', '부품 이송'), ('카메라 2대', '탑뷰 · 그리퍼'),
                    ('로봇팔', 'SO-ARM101'), ('리더암', '수동 조작')],
    },
    'department': '스마트소프트웨어학과',
    'members': ['이강현', '전범수', '황재준'],
    # 9안: 8안에 설명을 더한 안 (사용자 2026-10-27 — 교수 의견 "설명이 부족"). 공정 순서·HMI 문서와 결정에 있는 것만 쓰고,
    # 팀이 아직 정하지 않은 장치 규칙(긴급정지 때 로봇팔 힘 빼기 등)과 판정 방법은 적지 않는다
    'lead_v9': ['카메라가 양품과 불량을 가리고, 로봇팔이 불량품만 골라 옮기는 자동 선별 라인입니다.',
                '작업자는 웹 HMI에서 라인을 켜고 끄며, 카메라 영상과 생산 통계를 봅니다.'],
    'steps_v9': [                                 # (이름, 두 줄 설명) — docs/line-sequence.md
        ('이송', ['컨베이어가 부품을', '검사 자리로 옮깁니다']),
        ('촬영', ['위에서 내려다보는', '카메라가 부품을 찍습니다']),
        ('판정', ['영상으로 양품과 불량을', '가리고 HMI에 알립니다']),
        ('분류', ['로봇팔이 불량품을 집어 옮기고,', '양품은 컨베이어가 내보냅니다']),
    ],
    'pairs_v9': [                                 # (칸 이름, [(이름, 한 줄)]) — D-003 운전 모드, D-004 · D-007 긴급정지
        ('운전 모드', [('자동', '이송 · 촬영 · 판정 · 분류를 스스로 되풀이합니다'),
                      ('수동', '사람이 리더암을 움직이면 로봇팔이 따라 움직입니다')]),
        ('긴급정지', [('누르면', '컨베이어와 로봇팔을 바로 멈춥니다'),
                     ('해제', '확인 창을 거쳐 풀고, 원점 복귀 뒤에 다시 시작합니다')]),
    ],
    'features_v9': [                              # 웹 HMI 조작 화면 (hmi-web-mockup/README.md). (이름, 보충 두 줄)
        ('시작 · 정지', ['키 하나로', '켜고 끄기']),
        ('원점', ['잡기 · 복귀', '수동에서 저장']),
        ('옮길 부품', ['양품 · 불량품', '중에서 고르기']),
        ('카메라', ['탑뷰 · 그리퍼', '바꿔 보기']),
        ('생산 통계', ['검사 · 양품 · 불량', '불량률']),
        ('장치 연결', ['서버 · 로봇팔', '카메라 · 컨베이어']),
        ('로그 · 알림', ['고장 · 경고를', '이유와 함께']),
        ('밖에서 접속', ['웹 주소로 열기', 'Cloudflare 경유']),
    ],
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


# ---------- 7안: 1안에 작동 과정·시스템 구성을 더한 안 ----------
# 1안의 별·원·로봇팔은 그대로 쓰되 검사 자리를 중심으로 조금 줄여 올리고, 넓어진 산호 바닥에 작동 과정과 시스템 구성을 둔다.
# Make Poster 플러그인 형식의 HTML 한 장이다. @page가 종이 크기를 정하고, .poster의 안쪽 여백(V7_SAFE)이 글자가 넘지 말아야 할 선이다.
# 종이 끝까지 닿는 그림은 .poster 밖의 SVG에 두어 넘침 검사(check-fit)에서 뺀다.
V1_GROUND = 493                    # 1안의 바닥 경계
V7_W, V7_H = 595, 835              # 7안 종이 크기 (제출 규격). A1보다 가로 1 넓고 세로 6 짧다
V7_PX = V7_W / 2                   # 7안의 검사 자리 가로 위치. 가운데가 PX(297)인 1안 그림을 여기로 옮긴다
V7_SCALE = 0.9                     # 원·로봇팔·카메라·부품 크기 (1안 = 1). 원 꼭대기는 1안과 거의 같은 높이에 남는다
V7_INSPECT_Y = 438                 # 검사 자리 (1안보다 42 위)
V7_REFLECTION = 0.45               # 바닥에 비친 원의 깊이 (1안 = 1)
V7_ART = {'scale': V7_SCALE, 'inspect': V7_INSPECT_Y, 'reflection': V7_REFLECTION}   # 그림 자리 (7·8안)
V1_REACH = 174                     # 1안의 가장 큰 원 반지름. 원은 모두 검사 자리에서 컨베이어에 닿아, 꼭대기는 검사 자리 - 2 × 반지름
V7_SAFE = (30, 38)                 # 글자 안전 여백 (위아래, 좌우). 1안의 글자가 이미 이 안에 있다
V7_TITLE = 538                     # 제목 첫 줄 기준선. 줄 간격·설명까지의 거리는 1안과 같다
V7_STEPS = 670                     # "작동 과정" 기준선
V7_SYSTEM = 729                    # "시스템 구성" 기준선
V7_FOOTER = 799                    # 학과·팀원 기준선. 아래 여백은 1안과 같은 36
# 8안은 학과·팀원을 맨 아래 줄에서 머리로 올렸다 (사용자 2026-10-27). 로고 옆에 학교 / 학과, 오른쪽에 사업명 / 팀원 두 줄씩.
V8_HEAD = (63, 86)                 # 머리 두 줄의 기준선. 두 줄 덩어리가 로고(38~96)의 가운데 67에 온다
# 머리 글자 둘레 8 안에는 별을 두지 않는다 — 팀원 이름 바로 아래(5)의 별 하나가 점처럼 읽혀서.
# 글자 상자는 브라우저로 잰 값: 왼쪽 두 줄 110~234 × 46~87, 오른쪽 두 줄 406~555 × 52~87
V8_STAR_CLEAR = [(102, 38, 242, 95), (398, 44, 563, 95)]
# 빠진 아래 줄 자리: 시스템 구성 상자(이름 기준선 + 7, 높이 32)의 아래 끝을 그 줄의 기준선에 맞춰 아래 여백을 7안과 같게 두고,
# 늘어난 31을 작동 과정 위·아래 두 틈에 반씩 나눈다 (두 틈은 7안에서도 25 · 23으로 거의 같다)
V8_SYSTEM = V7_FOOTER - 39
V8_STEPS = V7_STEPS + (V8_SYSTEM - V7_SYSTEM) / 2
# 9안: 8안의 머리 · 그림 · 제목 · 시스템 구성을 그대로 쓰되 그림과 제목을 줄이고, 생긴 자리에 설명 칸을 더한다 (v9_content)
V9_ART = {'scale': 0.68, 'inspect': 353, 'reflection': 0.34}   # 원 꼭대기 353 - 2 × 174 × 0.68 ≈ 116 (머리 아래 20)
V9_TITLE = (433, 44, 52)           # 제목 첫 줄 기준선, 글자 크기, 줄 간격 (8안 538 · 54 · 64)
V9_LEAD = (519, 14, 20)            # 소개 두 줄: 첫 줄 기준선, 글자 크기, 줄 간격
V9_STEPS = 565                     # 작동 과정 (네 단계, 두 줄 설명)
V9_PAIRS = 637                     # 운전 모드 · 긴급정지
V9_FEATURES = 692                  # 웹 HMI 주요 기능 (여덟 칸)
V9_SYSTEM = V8_SYSTEM              # 시스템 구성은 8안 자리 그대로 — 상자 아래 끝 799, 아래 여백 36
V7_VERSIONS = {                    # 7안 틀로 만드는 안. 그림·크기·설명은 같고 아래 값만 다르다
    'v7': {'title': TEXT['title']},
    'v8': {'title': TEXT['title_v8'], 'program': TEXT['program_v8'], 'team_on_top': True,
           'steps': V8_STEPS, 'system': V8_SYSTEM},
    'v9': {'title': TEXT['title_v8'], 'program': TEXT['program_v8'], 'team_on_top': True,
           'art': V9_ART, 'layout': 'v9'},
}


def v1_group(lines, gid):
    """1안 파일에서 <g id="gid"> 묶음을 통째로 꺼낸다."""
    starts = [i for i, line in enumerate(lines) if line.startswith(f'<g id="{gid}"')]
    if len(starts) != 1:
        raise SystemExit(f'v1/poster.svg에서 {gid} 묶음을 찾지 못했습니다. 1안 파일이 바뀌었는지 확인하세요.')
    out, depth = [], 0
    for line in lines[starts[0]:]:
        out.append(line)
        depth += line.count('<g') - line.count('</g>')
        if depth == 0:
            return out


def v7_shrunk(lines, art=V7_ART):
    """1안 그림을 검사 자리를 중심으로 art['scale']만큼 줄여 (V7_PX, art['inspect'])로 옮긴다."""
    return [f'<g transform="translate({f(V7_PX)} {f(art["inspect"])}) scale({f(art["scale"])}) '
            f'translate({f(-PX)} {-V1_INSPECT_Y})">', *lines, '</g>']


def v7_conveyor(art=V7_ART):
    """1안 모양의 컨베이어. 띠는 1안처럼 양옆 여백(40)까지 닿고, 롤러·부품만 줄여 그만큼 더 놓는다."""
    s, y = art['scale'], art['inspect']
    belt, part = 13 * s, 12 * s
    out = ['<g id="line">',
           f'<rect x="40" y="{f(y)}" width="{V7_W - 80}" height="{f(belt)}" rx="{f(belt / 2)}" fill="{STEEL}"/>',
           f'<path d="M47 {f(y + .6)}H{V7_W - 47}" stroke="{SHELL}" stroke-width="1.1" stroke-opacity=".9"/>']
    for k in range(-20, 21):                       # 롤러: 1안처럼 21 간격
        x = V7_PX + (21 * k - 8) * s
        if 56 <= x <= V7_W - 56:
            out.append(f'<circle cx="{f(x)}" cy="{f(y + 6.8 * s)}" r="{f(1.25 * s)}" fill="{SHELL}" opacity=".35"/>')
    for x in (46.5, V7_W - 46.5):
        out.append(f'<circle cx="{x}" cy="{f(y + belt / 2)}" r="{f(3.2 * s)}" fill="none" stroke="{SHELL}" '
                   f'stroke-opacity=".9" stroke-width="1"/>')
    # 부품: 1안처럼 42 간격. 검사 자리는 로봇팔이 들어 올려 비어 있다. 가장 바깥 부품이 7·8안처럼 양끝 롤러 안쪽
    # (가운데에서 230 안)에 오도록 그림 크기에 맞춰 수를 정한다 — 0.9배면 6개씩, 9안(0.68배)은 8개씩
    for k in range(1, int(230 / (42 * s)) + 1):
        for x in (V7_PX - 42 * k * s, V7_PX + 42 * k * s):
            out.append(f'<rect x="{f(x - part / 2)}" y="{f(y - part)}" width="{f(part)}" height="{f(part)}" '
                       f'rx="{f(1.2 * s)}" fill="{SHELL}"/>')
    out.append('</g>')
    return out


def v7_stars(lines, clear=(), art=V7_ART):
    """1안의 별. 원이 작아지고 컨베이어가 올라와 새로 드러나는 별 가운데, 원이나 컨베이어에 붙는 것은 뺀다.
    clear: 별을 두지 않을 곳 (x0, y0, x1, y1) — 8안의 머리 글자 둘레."""
    reach = V1_REACH * art['scale']
    cy = art['inspect'] - reach
    out = []
    for line in v1_group(lines, 'stars'):
        m = re.search(r'cx="([\d.]+)" cy="([\d.]+)"', line)
        if m:
            x, y = float(m[1]), float(m[2])
            if y > art['inspect'] - 25 or math.hypot(x - V7_PX, y - cy) < reach + 12:
                continue
            if any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in clear):
                continue
        out.append(line)
    return out


def v7_art(lines, clear=(), art=V7_ART):
    """종이 끝까지 닿는 그림. 1안에서 별·원·비친 원·로봇팔을 가져오고, 6안처럼 카메라와 금 간 불량품을 넣는다."""
    s, y = art['scale'], art['inspect']
    ground = y + 13 * s                            # 산호 바닥 (컨베이어 아래 끝)
    arm = v1_group(lines, 'arm')
    arm[arm.index(V1_DEFECT)] = '\n'.join(bad_part(PX, 474, 12))
    return [f'<svg viewBox="0 0 {V7_W} {V7_H}" aria-hidden="true">',
            f'<rect width="{V7_W}" height="{V7_H}" fill="{NAVY}"/>',
            *v7_stars(lines, clear, art),
            *v7_shrunk(v1_group(lines, 'glow'), art),
            f'<rect y="{f(ground)}" width="{V7_W}" height="{f(V7_H - ground)}" fill="{CORAL}"/>',
            f'<g transform="translate({f(V7_PX)} {f(ground)}) scale({f(s)} {f(art["reflection"])}) '
            f'translate({f(-PX)} {-V1_GROUND})">', *v1_group(lines, 'reflection'), '</g>',
            f'<g transform="translate({f(V7_PX)} {f(y)}) scale({f(s)})">', *camera(), '</g>',
            *v7_shrunk(arm, art),
            *v7_conveyor(art),
            '</svg>']


def v7_steps(y, steps=None):
    """작동 과정. 단계를 나란히: 번호와 이름, 그 아래 설명(한 줄, 9안은 두 줄). 단계 사이는 가는 화살표로 잇는다."""
    steps, gutter = steps or TEXT['steps'], 12
    width = (V7_W - 80 - (len(steps) - 1) * gutter) / len(steps)
    badge = y + 16                                 # 번호 원의 가운데 높이
    out = ['<g id="steps">', text(40, y, '작동 과정', 8, 700, INK_SOFT)]
    for i, (name, desc) in enumerate(steps):
        x = 40 + i * (width + gutter)
        out += [circle(NAVY, (0, 0), x + 6.5, badge, 6.5),
                text(x + 6.5, badge + 3.2, str(i + 1), 9, 700, CORAL, 'middle'),
                text(x + 17, badge + 4.2, name, 12, 700)]
        # 단계 사이가 25쯤 비어 한 줄로 이어 읽히지 않게
        out += [text(x, y + 36 + 12 * k, line, 9, 500) for k, line in enumerate([desc] if isinstance(desc, str) else desc)]
        if i < len(steps) - 1:
            x0, x1 = x + 48, x + width + gutter - 4
            out += [f'<path d="M{f(x0)} {f(badge)}H{f(x1 - 3)}" stroke="{INK_SOFT}" stroke-width=".5"/>',
                    f'<path d="M{f(x1)} {f(badge)}L{f(x1 - 3.5)} {f(badge - 1.8)}V{f(badge + 1.8)}Z" '
                    f'fill="{INK_SOFT}"/>']
    out.append('</g>')
    return out


def v9_pairs(y):
    """9안: 운전 모드와 긴급정지 두 칸. 칸마다 이름(굵게)과 한 줄 설명을 두 줄씩."""
    cols, gutter = TEXT['pairs_v9'], 12
    width = (V7_W - 80 - (len(cols) - 1) * gutter) / len(cols)
    out = ['<g id="pairs">']
    for c, (label, items) in enumerate(cols):
        x = 40 + c * (width + gutter)
        out.append(text(x, y, label, 8, 700, INK_SOFT))
        for k, (name, desc) in enumerate(items):
            row = y + 17 + 14 * k
            out += [text(x, row, name, 10.5, 700), text(x + 36, row, desc, 9.5, 500)]
    out.append('</g>')
    return out


def v9_features(y):
    """9안: 웹 HMI 주요 기능. 시스템 구성의 장치 칸처럼 상자 하나를 여덟 칸으로 나눈다 — 이름과 보충 두 줄."""
    items = TEXT['features_v9']
    top, h = y + 7, 40
    cell = (V7_W - 80) / len(items)
    out = ['<g id="features">', text(40, y, '웹 HMI 주요 기능', 8, 700, INK_SOFT),
           f'<rect x="40" y="{f(top)}" width="{V7_W - 80}" height="{h}" rx="3.5" fill="none" '
           f'stroke="{NAVY}" stroke-width=".7"/>']
    for i, (name, notes) in enumerate(items):
        x = 40 + cell * i
        if i:
            out.append(f'<path d="M{f(x)} {f(top + 7)}V{f(top + h - 7)}" stroke="{INK_SOFT}" stroke-width=".4"/>')
        out.append(text(x + cell / 2, top + 15, name, 10, 700, NAVY, 'middle'))
        out += [text(x + cell / 2, top + 26 + 8.5 * k, note, 7.5, 500, INK_SOFT, 'middle') for k, note in enumerate(notes)]
    out.append('</g>')
    return out


def v7_system(y, video=False):
    """시스템 구성. 웹 HMI ↔ 서버 ↔ 장치 네 가지. 상자는 선으로만 그어 산호 바닥을 덮지 않는다.
    video(9안)면 웹 HMI ↔ 서버 화살표 위에 웹소켓 · XML, 아래에 영상을 쓴다."""
    s = TEXT['system']
    top, h = y + 7, 32
    mid = top + h / 2

    def box(x, w):
        return (f'<rect x="{f(x)}" y="{f(top)}" width="{f(w)}" height="{h}" rx="3.5" fill="none" '
                f'stroke="{NAVY}" stroke-width=".7"/>')

    def label(cx, name, note, size=10.5):
        return [text(cx, top + 14.2, name, size, 700, NAVY, 'middle'),
                text(cx, top + 25.5, note, 7.5, 500, INK_SOFT, 'middle')]

    def arrow(x0, x1):                             # 양쪽 화살표
        head = lambda x, d: f'<path d="M{f(x)} {f(mid)}L{f(x - 4 * d)} {f(mid - 2.2)}V{f(mid + 2.2)}Z" fill="{NAVY}"/>'
        return [f'<path d="M{f(x0 + 2)} {f(mid)}H{f(x1 - 2)}" stroke="{NAVY}" stroke-width=".7"/>',
                head(x1 - 2, 1), head(x0 + 2, -1)]

    devices_x, devices_w = 312, V7_W - 40 - 312
    cell = devices_w / len(s['devices'])
    links = ([text(160, mid - 3.5, s['link'], 7.5, 500, INK_SOFT, 'middle'),
              text(160, mid + 10, s['video'], 7.5, 500, INK_SOFT, 'middle')] if video
             else [text(160, mid + 10, s['link'], 7.5, 500, INK_SOFT, 'middle')])
    out = ['<g id="system">', text(40, y, '시스템 구성', 7.5, 700, INK_SOFT),
           box(40, 92), *label(86, *s['hmi']),
           *arrow(132, 188), *links,
           box(188, 92), *label(234, *s['server']),
           *arrow(280, devices_x),
           box(devices_x, devices_w)]
    for i, (name, note) in enumerate(s['devices']):
        x = devices_x + cell * i
        if i:
            out.append(f'<path d="M{f(x)} {f(top + 6)}V{f(top + h - 6)}" stroke="{INK_SOFT}" stroke-width=".4"/>')
        out += label(x + cell / 2, name, note, 10)
    out.append('</g>')
    return out


def v7_head(lines, program, team_on_top):
    """글자 SVG를 열고 학교 마크와 머리 글자를 쓴다. viewBox를 안전 여백 안쪽으로 잡아, 좌표는 포스터 단위 그대로 쓰면서
    넘침 검사가 여백을 재게 한다. team_on_top(8·9안)이면 학과·팀원을 맨 아래 줄 대신 머리 둘째 줄에 쓴다 —
    예전 아래 줄처럼 학과는 왼쪽, 팀원은 오른쪽."""
    t = TEXT
    top, side = V7_SAFE
    right = V7_W - 40                              # 오른쪽 맞춤 글자의 끝. 1안처럼 여백 40
    out = [f'<svg viewBox="{side} {top} {V7_W - 2 * side} {V7_H - 2 * top}" font-family="{FONT}">',
           *v1_group(lines, 'authority-mark')]
    if team_on_top:
        first, second = V8_HEAD
        out += [text(110, first, t['school'], 20, 700, WHITE),
                text(110, second, t['department'], 13.5, 500, WHITE),
                text(right, first, program, 13.5, 500, WHITE, 'end')]
        # 팀원 사이는 아래 줄(15에 62)과 같은 비율로 13.5에 56
        out += [text(right - 56 * i, second, name, 13.5, 500, WHITE, 'end')
                for i, name in enumerate(reversed(t['members']))]
    else:
        out += [text(110, 74, t['school'], 20, 700, WHITE),
                text(right, 74, program, 13.5, 500, WHITE, 'end')]
    return out


def v7_content(lines, title, program=TEXT['program'], team_on_top=False, steps=V7_STEPS, system=V7_SYSTEM):
    """7·8안의 글자와 도표: 머리, 제목 두 줄, 한 줄 설명, 작동 과정, 시스템 구성, (7안) 학과·팀원 줄."""
    t = TEXT
    right = V7_W - 40
    out = v7_head(lines, program, team_on_top)
    for i, line in enumerate(title):
        out.append(text(38, V7_TITLE + 64 * i, line, 54, 600, NAVY, spacing=-1.2))
    out.append(text(40, V7_TITLE + 64 + 43, t['description'], 17, 500, NAVY))
    out += v7_steps(steps) + v7_system(system)
    if not team_on_top:
        out.append(text(40, V7_FOOTER, t['department'], 13, 500, NAVY))
        out += [text(right - 62 * i, V7_FOOTER, name, 15, 500, NAVY, 'end')
                for i, name in enumerate(reversed(t['members']))]
    out.append('</svg>')
    return out


def v9_content(lines, title, program=TEXT['program'], team_on_top=True):
    """9안의 글자와 도표: 8안 머리, 줄인 제목, 소개 두 줄, 작동 과정 네 단계, 운전 모드 · 긴급정지, 웹 HMI 주요 기능, 시스템 구성."""
    t = TEXT
    out = v7_head(lines, program, team_on_top)
    y, size, gap = V9_TITLE
    for i, line in enumerate(title):                # 글자 사이는 8안(54에 -1.2)과 같은 비율
        out.append(text(38, y + gap * i, line, size, 600, NAVY, spacing=-1.2 * size / 54))
    y, size, gap = V9_LEAD
    out += [text(40, y + gap * i, line, size, 500, NAVY) for i, line in enumerate(t['lead_v9'])]
    out += (v7_steps(V9_STEPS, t['steps_v9']) + v9_pairs(V9_PAIRS) + v9_features(V9_FEATURES)
            + v7_system(V9_SYSTEM, video=True))
    out.append('</svg>')
    return out


def v7_html(title=TEXT['title'], art=V7_ART, layout='v7', **options):
    """art는 그림 자리(V7_ART · V9_ART), layout 'v9'면 9안 본문. options는 본문의 program · team_on_top · steps · system
    (V7_VERSIONS)."""
    body = v9_content if layout == 'v9' else v7_content
    lines = (HERE / 'v1' / 'poster.svg').read_text(encoding='utf-8').split('\n')
    top, side = V7_SAFE
    return '\n'.join([
        '<!doctype html>',
        '<html lang="ko">',
        '<meta charset="utf-8">',
        f'<title>{escape(" ".join(title))} — {TEXT["school"]} {TEXT["department"]}</title>',
        '<style>',
        f'@page {{ size: {V7_W}mm {V7_H}mm; margin: 0 }}',
        'html, body { margin: 0 }',
        f'.page {{ position: relative; width: {V7_W}mm; height: {V7_H}mm; overflow: hidden }}',
        '.page > svg, .poster { position: absolute; inset: 0; width: 100%; height: 100% }',
        f'.poster {{ box-sizing: border-box; padding: {top}mm {side}mm }}',
        '.poster > svg { display: block; width: 100%; height: 100%; overflow: visible }',
        '</style>',
        '<div class="page">',
        *v7_art(lines, V8_STAR_CLEAR if options.get('team_on_top') else (), art),
        '<div class="poster">',
        *body(lines, title, **options),
        '</div>',
        '</div>',
    ]) + '\n'


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
    shoot('<!doctype html><meta charset="utf-8"><style>@page{size:594mm 841mm;margin:0}'
          'html,body{margin:0}svg{display:block;width:594mm;height:841mm}</style>' + svg,
          '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}'
          'svg{display:block;width:100vw;height:100vh}</style>' + svg,
          out)


def render_html(html, out, width, height):
    """7안처럼 종이 크기(width x height mm)로 짠 HTML. 미리보기는 다른 안과 같은 폭(1188)에 맞게 줄여 찍는다."""
    zoom = 1188 / (width / 25.4 * 96)
    shoot(html, html.replace('</style>', f'html {{ zoom: {zoom:.5f}; overflow: hidden }}\n</style>', 1), out,
          (1188, round(1188 * height / width)))


def shoot(print_html, shot_html, out, window=(1188, 1682)):
    exe = browser()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        page = tmp / 'print.html'
        page.write_text(print_html, encoding='utf-8')
        shot = tmp / 'shot.html'
        shot.write_text(shot_html, encoding='utf-8')
        common = [exe, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={tmp / "profile"}']
        subprocess.run(common + [f'--print-to-pdf={out / "poster.pdf"}', '--no-pdf-header-footer',
                                 page.as_uri()], check=True, capture_output=True)
        subprocess.run(common + [f'--screenshot={out / "poster.png"}', '--window-size=%d,%d' % window,
                                 shot.as_uri()], check=True, capture_output=True)


def main():
    names = [*LAYOUTS, 'v6', *V7_VERSIONS]
    name = sys.argv[1] if len(sys.argv) > 1 else LATEST
    if name not in names:
        raise SystemExit(f'안 이름은 {", ".join(names)} 중 하나입니다.')
    out = HERE / name if len(sys.argv) > 1 else HERE
    out.mkdir(exist_ok=True)
    if name in V7_VERSIONS:                        # 7안 틀로 만드는 안은 HTML이 원본이다
        html = v7_html(**V7_VERSIONS[name])
        (out / 'poster.html').write_text(html, encoding='utf-8')
        if '--html' not in sys.argv:
            render_html(html, out, V7_W, V7_H)
        print(f'{name}: {out.relative_to(HERE.parent).as_posix()}/poster.html, poster.pdf, poster.png')
        return
    svg = build(name)
    (out / 'poster.svg').write_text(svg, encoding='utf-8')
    render(svg, out)
    print(f'{name}: {out.relative_to(HERE.parent).as_posix()}/poster.svg, poster.pdf, poster.png')


if __name__ == '__main__':
    main()
