# -*- coding: utf-8 -*-
"""v3 소리: 120 BPM 펑키 하우스와 화면에 맞춘 효과음. 사람 목소리는 없다.

모든 큐 시각은 같은 폴더의 timeline.json에서 읽는다(`node promo/v3/timeline.mjs`가 만든다).
타이핑 소리는 글자마다, 빛줄기 소리는 줄기마다 timeline.json의 시각에 놓는다.

출력 (기본 promo/out/v3/)
  soundtrack.wav   최종 믹스 — 48 kHz 스테레오 16비트, 정확히 15.0초
  stem_music.wav   음악만 (마스터 게인을 똑같이 곱함)
  stem_sfx.wav     효과음만

사용
  python promo/v3/music.py
  python promo/v3/music.py --ffmpeg PATH/TO/ffmpeg.exe   # ffmpeg로 재서 −14 LUFS에 맞춘다
"""
import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy import signal

SR = 48000
HERE = Path(__file__).resolve().parent
PROMO = HERE.parent


def at(t):
    return int(round(t * SR))


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


R = np.random.default_rng(20261103)


def noise(n):
    return R.standard_normal(n)


# ═════════ 1. 기본 도구 ═════════

def biquad(kind, f, q=0.707):
    f = float(np.clip(f, 20, SR * 0.45))
    w0 = 2 * np.pi * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    al = sw / (2 * q)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
    else:  # bp (봉우리 0 dB)
        b = [al, 0, -al]
    a = [1 + al, -2 * cw, 1 - al]
    return np.array(b) / a[0], np.array(a) / a[0]


def filt(x, kind, f, q=0.707):
    b, a = biquad(kind, f, q)
    return signal.lfilter(b, a, x)


def sweep(x, kind, freqs, q=0.707, block=96):
    """시간에 따라 바뀌는 필터. freqs는 x와 길이가 같은 주파수 배열"""
    y = np.zeros_like(x)
    zi = np.zeros(2)
    for i in range(0, len(x), block):
        b, a = biquad(kind, freqs[min(i, len(freqs) - 1)], q)
        y[i:i + block], zi = signal.lfilter(b, a, x[i:i + block], zi=zi)
    return y


def saw(freq, n, phase=0.0):
    """폴리BLEP으로 앨리어싱을 줄인 톱니파"""
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    dt = f / SR
    ph = (phase + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def square(freq, n):
    return 0.5 * (saw(freq, n) - saw(freq, n, 0.5))


def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, float), (n,))
    return np.sin(2 * np.pi * np.cumsum(f) / SR + phase)


def env(n, a=0.002, d=0.1, s=0.0, r=0.05, hold=None):
    """a 오르고, d 동안 s까지 내려가 hold만큼 머문 뒤 r 동안 사라진다 (초 단위)"""
    t = np.arange(n) / SR
    e = np.ones(n)
    e[t < a] = t[t < a] / max(a, 1e-6)
    dm = (t >= a) & (t < a + d)
    e[dm] = 1 - (1 - s) * (t[dm] - a) / max(d, 1e-6)
    hold = (n / SR - a - d - r) if hold is None else hold
    sm = (t >= a + d) & (t < a + d + hold)
    e[sm] = s
    rm = t >= a + d + hold
    e[rm] = s * np.clip(1 - (t[rm] - a - d - hold) / max(r, 1e-6), 0, 1)
    return e


def decay(n, tau, a=0.0015):
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    k = t < a
    e[k] *= t[k] / a
    return e


def pan(x, p):
    """p: -1(왼) ~ 1(오른), 또는 x와 길이가 같은 배열. 일정한 세기 법칙"""
    p = np.broadcast_to(np.asarray(p, float), x.shape)
    th = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(th), x * np.sin(th)])


class Bus:
    def __init__(self, n):
        self.x = np.zeros((2, n))

    def add(self, sig, t, gain=1.0, p=0.0):
        s = sig if sig.ndim == 2 else pan(sig, p)
        i = at(t)
        if i < 0:
            s = s[:, -i:]
            i = 0
        j = min(self.x.shape[1], i + s.shape[1])
        if j > i:
            self.x[:, i:j] += gain * s[:, : j - i]


def make_ir(seconds=2.0, tone=3800):
    n = at(seconds)
    t = np.arange(n) / SR
    irs = []
    for _ in range(2):
        x = noise(n) * np.exp(-t / (seconds / 6.5))
        x = filt(x, 'lp', tone)
        x[: at(0.012)] = 0  # 앞 지연
        irs.append(x / np.sqrt(np.sum(x * x)))
    return np.stack(irs)


IR = make_ir()


def reverb(st, mix=0.25):
    wet = np.stack([signal.fftconvolve(st[i], IR[i])[: st.shape[1]] for i in range(2)])
    return st + mix * wet


# ═════════ 2. 악기 ═════════

def kick(gain=1.0, punch=1.0):
    n = at(0.45)
    t = np.arange(n) / SR
    f = 46 + 104 * np.exp(-t / 0.032) * punch
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.2)
    click = filt(noise(n), 'hp', 2500) * np.exp(-t / 0.0035) * 0.35
    y = np.tanh(1.6 * (body + click)) / np.tanh(1.6)
    return gain * y


def clap():
    n = at(0.35)
    t = np.arange(n) / SR
    burst = np.zeros(n)
    for k, off in enumerate((0.0, 0.011, 0.022)):
        i = at(off)
        m = n - i
        burst[i:] += np.exp(-np.arange(m) / SR / (0.006 if k < 2 else 0.09)) * (0.8 if k < 2 else 1.0)
    y = filt(filt(noise(n) * burst, 'bp', 1300, 0.9), 'hp', 500)
    return y / (np.max(np.abs(y)) + 1e-9) * 0.9


def hat(open_=False):
    n = at(0.32 if open_ else 0.07)
    t = np.arange(n) / SR
    metal = sum(square(f, n) for f in (3150, 4150, 5390, 6100, 7720, 8650))
    y = filt(0.6 * noise(n) + 0.25 * metal, 'hp', 7200)
    y = filt(y, 'bp', 10000, 0.6) * 0.5 + y * 0.5
    y *= np.exp(-t / (0.11 if open_ else 0.018))
    return y / (np.max(np.abs(y)) + 1e-9) * 0.6


def bass_note(midi, dur, bright=1.0):
    n = at(dur)
    f = mtof(midi)
    x = 0.75 * saw(f, n) + 0.3 * square(f, n) + 0.45 * sine(f, n)
    t = np.arange(n) / SR
    cut = 380 + 2600 * bright * np.exp(-t / 0.11)
    y = sweep(x, 'lp', cut, 1.2)
    y *= env(n, 0.003, 0.08, 0.7, 0.03)
    return np.tanh(1.3 * y)


def supersaw(midis, n, detune=0.12, voices=5):
    left = np.zeros(n)
    right = np.zeros(n)
    for m in midis:
        f = mtof(m)
        for v in range(voices):
            d = (v - (voices - 1) / 2) / ((voices - 1) / 2) * detune
            s = saw(f * 2 ** (d / 12), n, R.random())
            w = (v + 0.5) / voices
            left += s * (1 - w)
            right += s * w
    return np.stack([left, right]) / (len(midis) * voices * 0.5)


def stab(midis, dur=0.22, bright=1.0):
    n = at(dur)
    t = np.arange(n) / SR
    st = supersaw(midis, n, 0.1)
    cut = 900 + 3600 * bright * np.exp(-t / 0.09)
    st = np.stack([sweep(st[i], 'lp', cut, 0.9) for i in range(2)])
    return st * env(n, 0.002, 0.06, 0.7, 0.08)


def pad(midis, dur, attack=0.35, cut=1800):
    n = at(dur)
    st = supersaw(midis, n, 0.18, 7)
    st = np.stack([filt(st[i], 'lp', cut, 0.8) for i in range(2)])
    return st * env(n, attack, 0.2, 0.85, min(0.6, dur * 0.4))


def pluck(midi, dur=0.5, index=2.5, bright=1.0):
    n = at(dur)
    t = np.arange(n) / SR
    f = mtof(midi)
    mod = sine(f * 2, n) * index * np.exp(-t / (0.08 * bright))
    y = np.sin(2 * np.pi * f * t + mod)
    return y * decay(n, 0.22)


def bell(midi, dur=2.4):
    n = at(dur)
    t = np.arange(n) / SR
    f = mtof(midi)
    mod = sine(f * 3.5, n) * 1.8 * np.exp(-t / 0.5)
    y = np.sin(2 * np.pi * f * t + mod) * decay(n, 0.9)
    y += 0.3 * np.sin(2 * np.pi * f * 2.0 * t) * decay(n, 0.35)
    return y


# ═════════ 3. 효과음 ═════════

def whoosh(dur, f0, f1, p0=0.0, p1=0.0, q=1.1, shape=0.55):
    n = at(dur)
    k = np.linspace(0, 1, n)
    freqs = f0 * (f1 / f0) ** k
    y = sweep(noise(n), 'bp', freqs, q)
    e = np.where(k < shape, (k / shape) ** 2, ((1 - k) / (1 - shape)) ** 1.5)
    return pan(0.75 * y * e, p0 + (p1 - p0) * k)


def riser(dur, f0=300, f1=6000):
    n = at(dur)
    k = np.linspace(0, 1, n)
    nz = sweep(noise(n), 'hp', f0 * (f1 / f0) ** k, 0.8)
    tone = saw(110 * 2 ** (k * 2.5), n) * 0.25
    tone = sweep(tone, 'lp', 400 * (12000 / 400) ** k, 0.9)
    y = (nz * 0.7 + tone) * k ** 2.2
    return y


def impact(size=1.0):
    n = at(1.6)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.05)) / SR) * np.exp(-t / 0.55)
    crash = filt(noise(n), 'hp', 900) * np.exp(-t / (0.35 * size))
    body = filt(noise(n), 'lp', 2500) * np.exp(-t / 0.08)
    y = sub * 0.65 + crash * 0.35 + body * 0.55
    return np.tanh(1.2 * y) * size


def mech_click(weight=1.0):
    n = at(0.09)
    t = np.arange(n) / SR
    tick = filt(noise(n), 'hp', 1800) * np.exp(-t / 0.0025)
    body = filt(noise(n), 'bp', 2600, 6) * np.exp(-t / 0.012) * 3
    thock = np.sin(2 * np.pi * 170 * t) * np.exp(-t / 0.022) * weight
    return (tick * 0.6 + body * 0.5 + thock * 0.8) * 0.8


def key_click(space=False):
    n = at(0.05)
    t = np.arange(n) / SR
    f = R.uniform(2200, 3400)
    tick = filt(noise(n), 'hp', 2500) * np.exp(-t / 0.0018)
    body = filt(noise(n), 'bp', f, 7) * np.exp(-t / 0.008) * 2.5
    low = np.sin(2 * np.pi * (140 if space else 230) * t) * np.exp(-t / 0.015) * (0.9 if space else 0.4)
    return (tick * 0.7 + body * 0.5 + low) * R.uniform(0.75, 1.0)


def blip(freqs, gap=0.06, dur=0.14, wave='sine'):
    n = at(gap * (len(freqs) - 1) + dur + 0.05)
    y = np.zeros(n)
    for i, f in enumerate(freqs):
        m = at(dur)
        t = np.arange(m) / SR
        s = sine(f * (1 + 0.02 * (1 - np.exp(-t / 0.01))), m) if wave == 'sine' else square(f, m) * 0.5
        y[at(i * gap): at(i * gap) + m] += s * decay(m, dur / 3.5)
    return y


def buzz():
    n = at(0.32)
    t = np.arange(n) / SR
    y = square(110, n) + square(116.5, n) + 0.6 * saw(233, n)
    y = filt(y, 'lp', 1600, 1.2) * env(n, 0.002, 0.05, 0.6, 0.12)
    return np.tanh(1.5 * y) * 0.6


def tick(f=3800):
    n = at(0.02)
    t = np.arange(n) / SR
    return filt(noise(n), 'bp', f, 4) * np.exp(-t / 0.004) * 2


def suction(dur):
    """빨려 들어가는 소리: 거꾸로 돌린 잔향 + 내려가는 음"""
    n = at(dur)
    k = np.linspace(0, 1, n)
    nz = sweep(noise(n), 'bp', 6000 * (300 / 6000) ** k, 1.5) * k ** 1.8
    tone = sine(880 * 2 ** (-k * 2), n) * k ** 2 * 0.3
    return nz + tone


# ═════════ 4. 편곡 — 시각은 모두 timeline.json에서 ═════════

# 화음: [시작 초, 뿌리음, 화음 음들] (D 장조 둘레). 시각은 arrange()가 시간표의 큐로 채운다
CHORDS = []


def chord_at(t):
    cur = CHORDS[0]
    for c in CHORDS:
        if t >= c[0] - 1e-9:
            cur = c
    return cur


def cue_times(tl, cid):
    out = []
    for c in tl['cues']:
        if c['id'] != cid:
            continue
        if 'every' in c:
            k = 0
            while c['t'] + k * c['every'] <= c.get('until', c['t']) + 1e-9:
                out.append(c['t'] + k * c['every'])
                k += 1
        else:
            out.append(c['t'])
    return out


def cue(tl, cid):
    for c in tl['cues']:
        if c['id'] == cid:
            return c
    raise KeyError(cid)


def arrange(tl):
    dur = tl['duration']
    n = at(dur)
    beat = 60.0 / tl['bpm']
    mus, fx = Bus(n), Bus(n)
    sc = np.ones(n)  # 킥에 맞춰 눌리는 사이드체인 게인

    def kick_at(t, g=1.0, punch=1.0):
        mus.add(kick(g, punch), t)
        i = at(t)
        m = min(n - i, at(0.3))
        if m > 0:
            dip = 1 - 0.6 * g * np.exp(-np.arange(m) / SR / 0.09)
            sc[i:i + m] = np.minimum(sc[i:i + m], dip)

    tagline = cue(tl, 'tagline')['t']
    collapse = cue(tl, 'collapse')
    logo = cue(tl, 'logo')['t']
    key_in = cue(tl, 'key_in')
    press = cue(tl, 'press')['t']
    hmi_on = cue(tl, 'hmi_on')['t']
    bad = cue(tl, 'bad')['t']
    morph = cue(tl, 'morph')['t']
    head = cue(tl, 'headline')['t']
    scroll_t = cue(tl, 'scroll_in')['t']
    cube_land = cue(tl, 'cube')['until']
    streak_t = cue(tl, 'streaks')['t']
    typing_win = (morph, head)
    CHORDS[:] = [
        (0.0, 50, [54, 57, 61, 64]),          # Dmaj9
        (key_in['t'], 47, [50, 54, 57, 61]),  # Bm9 — 시작 키
        (hmi_on, 43, [47, 50, 54, 57]),       # Gmaj9 — HMI
        (bad, 40, [43, 47, 50, 54]),          # Em9 — 불량과 타이핑
        (head, 45, [50, 52, 55, 59]),         # A9sus4 — 큰 제목
        (scroll_t, 42, [45, 49, 52, 57]),     # F#m7 — 스크롤
        (tagline, 43, [47, 50, 54, 57]),      # Gmaj9 — 태그라인
        (tagline + 1.0, 45, [49, 52, 57, 61]),  # A
        (logo, 50, [54, 57, 61, 64]),         # Dmaj9 — 끝에서 풀림
    ]

    # ── 북: 1초부터 박마다 킥. 키가 날아오는 동안과 빛줄기 뒤 차오름에서는 비운다
    beats = [k * beat for k in range(int(dur / beat) + 1)]
    for b in beats:
        if b < cube_land - 1e-9 or b >= collapse['t'] - 1e-9:
            continue
        if key_in['t'] <= b < press - 1e-9:
            continue
        if streak_t - 1e-9 <= b < tagline - 1e-9:
            continue
        typing = typing_win[0] <= b < typing_win[1]
        kick_at(b, 0.7 if typing else 0.95)
    kick_at(0.0, 1.0, 1.2)
    # 손뼉: 2·4박 (마디 안 둘째·넷째 박)
    for b in beats:
        k = round(b / beat)
        if k % 2 == 1 and cube_land - 0.1 < b < collapse['t'] and not (key_in['t'] <= b < press) and not (streak_t - 0.3 < b < tagline):
            mus.add(clap(), b, 0.42 if typing_win[0] <= b < typing_win[1] else 0.55, 0.05)
    # 하이햇: 엇박 8분, 태그라인 뒤에는 16분
    t = 0.25
    while t < collapse['t']:
        if not (key_in['t'] <= t < press):
            mus.add(hat(open_=(tagline <= t)), t, 0.13, 0.25)
        t += beat
    t = tagline
    while t < collapse['t'] - 1e-9:
        mus.add(hat(), t + beat / 4, 0.08, -0.3)  # 16분의 사이사이
        t += beat / 2
    for t in np.arange(cube_land - 0.5, cube_land, beat / 4):
        mus.add(hat(), t, 0.07, -0.2)

    # ── 베이스: 3초(누름)부터 16분 무늬. 타이핑 중에는 어둡게
    step = beat / 4
    pattern = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0]
    octave = [0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 12, 0, 7, 0, 0]
    k = 0
    t = press
    while t < collapse['t'] - 1e-9:
        if not (streak_t <= t < tagline):
            i = k % 16
            if pattern[i]:
                root = chord_at(t)[1]
                bright = 0.35 if typing_win[0] <= t < typing_win[1] else 1.0
                mus.add(np.stack([bass_note(root - 12 + octave[i], step * 1.8, bright)] * 2) * 0.5, t, 0.5)
        k += 1
        t = press + k * step

    # ── 화음
    mus.add(stab(chord_at(0.0)[2], 0.5, 1.2), 0.0, 0.6)
    mus.add(pad(chord_at(0.0)[2], cube_land, 0.05, 2200), 0.0, 0.3)
    mus.add(pad(chord_at(cube_land)[2] + [69], key_in['t'] - cube_land, 0.1, 2400), cube_land, 0.3)
    # 엇박 찌르기: HMI · 제목 · 태그라인 구간
    for a, b in [(hmi_on, bad), (head, scroll_t), (tagline, collapse['t'])]:
        t = a + beat / 2
        while t < b - 1e-9:
            mus.add(stab(chord_at(t)[2], 0.24, 1.0), t, 0.55)
            t += beat
    # 깔리는 화음: 네온이 자리잡을 때, 타이핑, 스크롤
    mus.add(pad(chord_at(morph)[2] + [62], head - morph, 0.3, 1600), morph, 0.42)
    mus.add(pad(chord_at(scroll_t)[2], streak_t - scroll_t + 0.25, 0.2, 2400), scroll_t, 0.4)
    mus.add(pad(chord_at(10.5)[2] + [62, 66], 1.0, 0.02, 3000), tagline, 0.45)
    mus.add(pad(chord_at(tagline + 1.0)[2] + [64], 1.0, 0.05, 3000), tagline + 1.0, 0.45)

    # ── 정육면체가 위로 굴러 넘어가 1초 박에 닿는다
    cu = cue(tl, 'cube')
    fx.add(whoosh(cu['until'] - cu['t'], 400, 3500, 0, 0, 1.1, 0.8), cu['t'], 0.4)
    fx.add(impact(0.45), cu['until'], 0.3)
    fx.add(np.stack([mech_click(0.8)] * 2), cu['until'], 0.35)
    # ── 이름 글자가 하나씩 빛으로 그려진다: 글자마다 짧게 반짝이고, 2초 박에 모두 파래지며 화음이 울린다
    notes = [74, 78, 81, 83, 86, 88, 90, 93]
    syl = tl['name_syllables']
    for i, c in enumerate(syl):
        fx.add(pluck(notes[i % len(notes)], 0.35, 1.4, 1.8), c['t'], 0.1, -0.7 + 1.4 * i / max(1, len(syl) - 1))
    nb = cue(tl, 'name_blue')['t']
    fx.add(bell(86, 1.0), nb, 0.16)
    mus.add(stab(chord_at(nb)[2] + [69], 0.3, 1.2), nb, 0.35)
    no = cue(tl, 'name_out')
    fx.add(whoosh(no['until'] - no['t'] + 0.06, 600, 7000, 0, 0, 1.0, 0.85), no['t'], 0.42)

    # ── 시작 키
    fx.add(whoosh(key_in['until'] - key_in['t'], 4000, 400, 0.6, -0.1, 0.9, 0.35), key_in['t'], 0.45)
    fx.add(np.stack([mech_click(1.4)] * 2), press, 1.0)
    fx.add(impact(0.8), press, 0.5)
    zo = cue(tl, 'zoom_out')
    fx.add(whoosh(zo['until'] - zo['t'], 300, 3000, -0.2, 0.2, 0.9, 0.6), zo['t'], 0.4)

    # ── HMI · 판정
    fx.add(blip([mtof(78), mtof(85)], 0.07, 0.2), cue(tl, 'hmi_on')['t'], 0.22)
    ex = cue(tl, 'expand')
    fx.add(whoosh(ex['until'] - ex['t'] + 0.05, 600, 5000, 0, 0, 1.2, 0.7), ex['t'], 0.35)
    for t in cue_times(tl, 'good'):
        fx.add(blip([mtof(88), mtof(93)], 0.05, 0.12), t, 0.28, 0.15)
    fx.add(buzz(), bad, 0.55)
    mus.add(stab([57, 58, 63], 0.18, 0.6), bad, 0.25)
    mo = cue(tl, 'morph')
    fx.add(whoosh(mo['until'] - mo['t'] + 0.1, 2000, 600, 0, 0, 1.4, 0.4), mo['t'], 0.3)

    # ── 타이핑: 글자마다
    for c in tl['typing']:
        fx.add(key_click(c['ch'] == ' '), c['t'], 0.38, R.uniform(-0.25, 0.25))
    en = cue(tl, 'enter')['t']
    fx.add(np.stack([mech_click(1.0)] * 2), en, 0.7)
    fx.add(riser(0.4, 800, 9000), en - 0.3, 0.12)

    # ── 큰 제목
    fx.add(impact(0.55), head, 0.35)
    mus.add(stab(chord_at(head)[2] + [62], 0.5, 1.3), head, 0.5)
    sh = cue(tl, 'shimmer')
    notes = [81, 83, 86, 88, 90, 93, 95, 98]
    for i, m in enumerate(notes):
        fx.add(pluck(m, 0.3, 1.0, 1.8), sh['t'] + i * (sh['until'] - sh['t']) / len(notes), 0.09, -0.7 + 1.4 * i / len(notes))

    # ── 스크롤: 카드가 올라올 때는 점점 느려지며 멈추고, 빠질 때는 점점 빨라진다
    for cid, speed_up in (('scroll_in', False), ('scroll_out', True)):
        c = cue(tl, cid)
        t = c['t']
        while t < c['until'] - 0.01:
            k = (t - c['t']) / (c['until'] - c['t'])
            fx.add(tick(R.uniform(3200, 4600)), t, 0.22, R.uniform(-0.4, 0.4))
            t += 0.025 + 0.06 * ((1 - k) if speed_up else k)
        fx.add(whoosh(c['until'] - c['t'] + 0.05, 400, 7000 if speed_up else 2500, 0, 0, 1.0, 0.8 if speed_up else 0.3), c['t'], 0.3)

    # ── 빛줄기: 줄기마다 휙, 방향대로 지나간다
    for s in tl['streaks']:
        d = s['dir']
        fx.add(whoosh(s['dur'], 900 + 2500 * s['y'], 5000, -0.9 * d, 0.9 * d, 1.6, 0.5), s['t'], 0.28)
    ri = cue(tl, 'riser')
    fx.add(riser(ri['until'] - ri['t']), ri['t'], 0.35)
    # 스네어 굴림이 빨라지며 태그라인으로
    t = ri['t']
    k = 0
    while t < tagline - 0.02:
        g = 0.15 + 0.35 * (t - ri['t']) / (tagline - ri['t'])
        mus.add(clap(), t, g * 0.6)
        k += 1
        t = ri['t'] + (tagline - ri['t']) * (1 - 0.5 ** (k / 4))

    # ── 태그라인: 가장 큰 타격
    fx.add(impact(1.3), tagline, 0.7)
    kick_at(tagline, 1.0, 1.3)
    mus.add(stab(chord_at(tagline)[2] + [62, 66], 0.6, 1.4), tagline, 0.55)
    for i, m in enumerate([74, 78, 81, 86]):
        fx.add(pluck(m, 0.6, 2.0), tagline + 0.03 * i, 0.12, -0.3 + 0.2 * i)

    # ── 점으로 줄어듦 → 마크
    fx.add(suction(collapse['until'] - collapse['t'] + 0.05), collapse['t'], 0.45)
    fx.add(impact(0.9), logo, 0.45)
    for i, m in enumerate([69, 74, 78]):
        fx.add(bell(m + 12, 2.8), logo + 0.12 * i, 0.3 - 0.04 * i, -0.25 + 0.25 * i)
    mus.add(pad(chord_at(logo)[2] + [62, 69], tl['duration'] - logo - 0.05, 0.01, 2600), logo, 0.5)
    mus.add(np.stack([bass_note(38, 1.2, 0.5)] * 2) * 0.6, logo, 0.5)

    # 사이드체인: 북을 뺀 음악을 킥에 맞춰 누른다 (킥은 위에서 이미 더함 — 북 버스를 따로 두지 않으므로
    # 킥 뒤의 낮은 소리만 눌리도록 저역을 기준으로 적용)
    low = np.stack([filt(mus.x[i], 'lp', 180) for i in range(2)])
    mus.x = mus.x - low + low * sc
    mus.x = reverb(mus.x, 0.1)
    fx.x = reverb(fx.x, 0.13)
    return mus.x, fx.x


# ═════════ 5. 마스터 ═════════

def lufs(path, ffmpeg):
    out = subprocess.run([ffmpeg, '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True, encoding='utf-8', errors='replace').stderr
    m = re.search(r'I:\s+(-?[\d.]+) LUFS', out[out.rfind('Integrated loudness'):])
    p = re.search(r'Peak:\s+(-?[\d.]+) dBFS', out[out.rfind('True peak'):])
    return float(m.group(1)), float(p.group(1))


def limiter_gain(x, ceiling_db=-2.0, release=0.06):
    """넘칠 곳만 부드럽게 누르는 게인 곡선. 2 ms 앞을 보고, 풀릴 때는 천천히"""
    from scipy.ndimage import maximum_filter1d, minimum_filter1d
    c = 10 ** (ceiling_db / 20)
    look = at(0.002)
    need = maximum_filter1d(np.maximum(np.max(np.abs(x), axis=0) / c, 1.0), size=look * 2 + 1)
    target = 1 / need
    a = np.exp(-1 / (release * SR))
    smooth = signal.lfilter([1 - a], [1, -a], target - 1) + 1
    return np.minimum(minimum_filter1d(smooth, size=look * 2 + 1), target)


def write_wav(path, st):
    from scipy.io import wavfile
    y = np.clip(st.T, -1, 1)
    # 16비트로 줄일 때 삼각 디더. 완전한 무음에는 넣지 않는다
    d = (R.random(y.shape) - R.random(y.shape)) / 32768
    d[y == 0] = 0
    wavfile.write(path, SR, np.round((y + d) * 32767).astype(np.int16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeline', type=Path, default=HERE / 'timeline.json')
    ap.add_argument('--out', type=Path, default=PROMO / 'out' / HERE.name)
    ap.add_argument('--ffmpeg', default=None, help='있으면 ffmpeg로 재서 --lufs에 맞춘다')
    ap.add_argument('--lufs', type=float, default=-14.0)
    args = ap.parse_args()
    tl = json.loads(args.timeline.read_text(encoding='utf-8'))
    n = at(tl['duration'])
    mus, fx = arrange(tl)

    # 기울기 보정: 중음(800 Hz 둘레)을 조금 올리고 6 kHz 위를 조금 내린다. 선형이라 스템에도 같게 건다
    def tilt(st):
        out = []
        for ch in st:
            hi = ch - filt(ch, 'lp', 6000)
            out.append(ch - 0.32 * hi + 0.3 * filt(ch, 'bp', 850, 0.45))
        return np.stack(out)

    mus, fx = tilt(mus), tilt(fx)
    mix = mus + fx
    # 버스를 살짝 데운다(포화). 같은 비율을 스템에도 곱해 스템의 합이 믹스와 같게 한다
    drive = 1.25
    scale = 0.5 / (np.percentile(np.abs(mix), 99.9) + 1e-9)
    pre = mix * scale
    sat = np.tanh(drive * pre) / np.tanh(drive)
    ratio = np.divide(sat, pre, out=np.ones_like(sat), where=np.abs(pre) > 1e-9)
    # 끝: 14.6초부터 잦아들어 마지막 10 ms는 완전한 무음
    fade = np.ones(n)
    f0, f1 = cue(tl, 'fade')['t'], tl['duration'] - 0.01
    k = (np.arange(n) / SR - f0) / (f1 - f0)
    fade[k > 0] = np.clip(1 - k[k > 0], 0, 1) ** 2
    fade[at(f1):] = 0
    gain = 1.0
    args.out.mkdir(parents=True, exist_ok=True)
    for _ in range(4):
        lim = limiter_gain(sat * gain)
        out = sat * gain * lim * fade
        if not args.ffmpeg:
            break
        with tempfile.TemporaryDirectory() as td:
            pth = Path(td) / 'm.wav'
            write_wav(pth, out)
            I, tp = lufs(pth, args.ffmpeg)
        print(f'  잰 값: {I:.1f} LUFS, 트루 피크 {tp:.1f} dBTP')
        if abs(I - args.lufs) < 0.15 and tp <= -1.0:
            break
        gain *= 10 ** ((args.lufs - I) / 20)
    common = scale * ratio * gain * lim * fade
    write_wav(args.out / 'soundtrack.wav', out)
    write_wav(args.out / 'stem_music.wav', mus * common)
    write_wav(args.out / 'stem_sfx.wav', fx * common)
    assert out.shape[1] == n
    assert np.all(out[:, at(tl['duration'] - 0.01):] == 0)
    print(f"  썼음: {args.out / 'soundtrack.wav'} ({n} 표본, {n / SR:.3f}초)")


if __name__ == '__main__':
    main()
