#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
불량을 찾는 눈, 골라내는 손 — 18초 홍보 영상 사운드트랙 생성기
=================================================================

음악과 효과음을 numpy·scipy 합성만으로 만든다. 샘플·외부 음원·AI 음악 서비스는 쓰지 않고,
난수는 이름으로 고정한 시드를 쓴다(몇 번을 돌려도 같은 파일).

모든 시간은 같은 폴더의 timeline.json(promo/v1/timeline.json) 에서 읽는다(bpm, 구간, cue 의 t/until/every).
JSON 의 시간을 바꾸고 다시 실행하면 소리도 새 시간표에 맞춰 다시 만들어진다.

출력 (기본 promo/out/v1/)
  soundtrack.wav   최종 믹스 — 48 kHz 스테레오, 16비트(TPDF 디더) 또는 --bits 24
  stem_music.wav   음악 스템
  stem_sfx.wav     효과음 스템
  두 스템에는 마스터의 게인 변화(글루 컴프·소프트 클립·리미터·페이드)를 똑같이 곱했기 때문에
  stem_music + stem_sfx = soundtrack (반올림 오차 안). 비율을 바꿔 다시 섞을 수 있다.

사용
  python promo/v1/music.py
  python promo/v1/music.py --out promo/out/v1 --bits 24 --lufs -14 --tp -1.0
  python promo/v1/music.py --ffmpeg PATH/TO/ffmpeg.exe     # ffmpeg ebur128 로 한 번 더 측정

구성
  1. 시간표       timeline.json 읽기
  2. DSP 기본     오실레이터(PolyBLEP + 오버샘플), 필터(시변 SVF), 엔벌로프, 팬
  3. 공간         노이즈 IR 컨볼루션 잔향, 템포 동기 핑퐁 에코, 사이드체인
  4. 악기         효과음 / 음악 악기 (함수 하나가 소리 하나)
  5. 믹서         스템별 버스, 센드, 브랜드 직전 '숨' 게이트
  6. 편곡         cue 시간으로 모든 소리를 배치
  7. 마스터       DC 제거·저역 모노·글루 컴프·소프트 클립·트루피크 리미터·라우드니스 맞춤·페이드
  8. 자체 점검    길이, NaN, 클리핑, DC, cue 온셋 오차(ms), 끝 무음, 강세 순서, LUFS/TP

소리 설계 요약
  hook   기계 '철컥' + 서브 드롭으로 시작, 두 줄이 엇갈리는 8분 틱(박 위 강세), 낮은 D 드론·서브 펄스.
         마지막 박 위 틱(3.5 s) 하나만 25 ms 플램과 디튠 배음으로 살짝 어긋난다(불량의 힌트).
  eye    깊은 붐(정지) → 왼→오 공진 스윕(32분 점선) → A5 종 '핑' + 점8분 핑퐁 에코 → 스피드 램프.
  hand   유리 갈라짐 + 낮은 타격, 서보 두 번, 금속 '찰칵' + 서브, 휙. 밑에서 D 베이스 8분·패드·아르페지오가
         필터를 열며 쌓인다. 강세는 lock < crack_open < clamp 순으로 커진다.
  line   킥 매 박, 2·4 박 스네어/클랩, 완전히 고른 16분 하이햇·8분 틱(질서 회복), 사이드체인 16분 베이스,
         아르페지오, Dm–Bb–F–C. 단어마다 스탭 + 이송(틱)·촬영(셔터)·판정(블립+동심원 펄스)·분류(찰칵).
         13–14 s 스네어 롤 + 라이저, 브랜드 직전 32분음표만큼 완전한 무음.
  brand  가장 큰 타격(F 에 맞춘 판 울림), F(add9) 패드, 소리 로고 C5–F5–A5(마지막 A5 = '찾는 눈' 핑과
         같은 음, 단조의 5음이 장조의 3음으로 풀린다), 16 s 크레딧 블립 C6–F6, 17.6–18.0 페이드.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import time
import wave
import zlib
from pathlib import Path

import numpy as np
from scipy import signal

SR = 48_000
TAU = 2.0 * np.pi
HERE = Path(__file__).resolve().parent
PROMO = HERE.parent


# ════════════════════════════════════════════════════════════════════
# 1. 시간표
# ════════════════════════════════════════════════════════════════════

def grid(t0: float, t1: float, step: float) -> list[float]:
    """[t0, t1) 를 step 간격으로 나눈 시각들."""
    k = int(math.ceil((t1 - t0) / step - 1e-9))
    return [t0 + i * step for i in range(max(k, 0))]


class Cue:
    """timeline.json 의 cue 하나: t(시작), until(끝, 없으면 t), every(반복 간격)."""

    def __init__(self, d: dict):
        self.id = d["id"]
        self.t = float(d["t"])
        self.until = float(d["until"]) if "until" in d else None
        self.every = float(d["every"]) if "every" in d else None

    @property
    def end(self) -> float:
        return self.until if self.until is not None else self.t

    @property
    def dur(self) -> float:
        return self.end - self.t

    def times(self) -> list[float]:
        return grid(self.t, self.end, self.every)


class Timeline:
    def __init__(self, path: Path):
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        self.fps = int(d["fps"])
        self.bpm = float(d["bpm"])
        self.beat = 60.0 / self.bpm
        self.duration = float(d["duration"])
        self.sections = {s["id"]: (float(s["start"]), float(s["end"])) for s in d["sections"]}
        self.cues = {c["id"]: Cue(c) for c in d["cues"]}

    def __getitem__(self, cue_id: str) -> Cue:
        return self.cues[cue_id]

    def on_beat(self, t: float) -> bool:
        q = t / self.beat
        return abs(q - round(q)) < 1e-6


# ════════════════════════════════════════════════════════════════════
# 2. DSP 기본
# ════════════════════════════════════════════════════════════════════

def ns(t: float) -> int:
    """초 → 샘플 수. 모든 배치가 이 함수 하나를 거치므로 cue 는 샘플 단위로 정확하다."""
    return int(round(t * SR))


def dbg(db) -> float | np.ndarray:
    return 10.0 ** (np.asarray(db, dtype=float) / 20.0)


def tt(n: int) -> np.ndarray:
    return np.arange(n) / SR


def RNG(*key) -> np.random.Generator:
    """이름으로 고정한 난수 — 호출 순서가 바뀌어도 소리는 그대로."""
    return np.random.default_rng(zlib.crc32(repr(key).encode("utf-8")))


_PITCH = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def hz(name: str) -> float:
    """'A4' → 440.0. 'Bb1', 'F#3' 도 된다(평균율, A4 = 440 Hz)."""
    k, i = _PITCH[name[0].upper()], 1
    while i < len(name) and name[i] in "#b":
        k += 1 if name[i] == "#" else -1
        i += 1
    midi = 12 * (int(name[i:]) + 1) + k
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def norm(x: np.ndarray, peak: float = 1.0) -> np.ndarray:
    m = float(np.max(np.abs(x))) if x.size else 0.0
    return x * (peak / m) if m > 0 else x


def rise(n: int) -> np.ndarray:
    """0 → 1 레이즈드 코사인 (첫 샘플이 정확히 0)."""
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / n) if n > 0 else np.zeros(0)


def fall(n: int) -> np.ndarray:
    """1 → 0 (마지막 샘플이 정확히 0)."""
    return rise(n)[::-1]


def edges(x: np.ndarray, a: float = 0.0002, r: float = 0.004) -> np.ndarray:
    """앞뒤 끝을 0 으로 이어 준다 — 모든 소리가 믹서에 들어가기 전에 거치는 클릭 방지."""
    n = x.shape[-1]
    na, nr = min(n, max(2, ns(a))), min(n, max(2, ns(r)))
    x = np.array(x, dtype=float, copy=True)
    x[..., :na] *= rise(na)
    x[..., n - nr:] *= fall(nr)
    return x


def win_tail(n: int, frac: float = 0.3) -> np.ndarray:
    """끝 frac 구간을 코사인으로 0 까지 — 긴 감쇠음이 버퍼 끝에서 잘리지 않게."""
    w = np.ones(n)
    m = max(2, int(n * frac))
    w[n - m:] = fall(m)
    return w


def env_exp(n: int, attack: float = 0.001, decay: float = 0.2, hold: float = 0.0) -> np.ndarray:
    """코사인 어택 → (hold) → 지수 감쇠(시정수 decay 초)."""
    t = tt(n)
    e = np.exp(-np.maximum(t - attack - hold, 0.0) / decay)
    na = min(n, max(1, ns(attack)))
    e[:na] *= rise(na)
    return e


def env_adsr(n: int, gate: float, a: float, d: float, s: float, r: float) -> np.ndarray:
    """gate 초 동안 A-D-S, 그 뒤 r 초 코사인 릴리스, 이후 0."""
    t = tt(n)
    e = s + (1.0 - s) * np.exp(-np.maximum(t - a, 0.0) / max(d / 3.0, 1e-5))
    na = min(n, max(1, ns(a)))
    e[:na] *= rise(na)
    ng = min(n, ns(gate))
    lvl = e[ng - 1] if ng > 0 else 0.0
    nr = max(2, ns(r))
    tail = np.zeros(n - ng)
    m = min(nr, n - ng)
    tail[:m] = lvl * fall(nr)[:m]
    e[ng:] = tail
    return e


def smoothstep(u: np.ndarray) -> np.ndarray:
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


# ── 오실레이터 ───────────────────────────────────────────────────────

def _phase(f, n: int, sr: float, ph0: float = 0.0):
    f = np.broadcast_to(np.asarray(f, dtype=float), (n,))
    inc = f / sr
    ph = np.empty(n)
    ph[0] = 0.0
    np.cumsum(inc[:-1], out=ph[1:])
    ph += ph0
    return ph % 1.0, inc


def _blep(ph: np.ndarray, dt: np.ndarray) -> np.ndarray:
    """PolyBLEP 보정(불연속점 주변 2샘플을 매끈하게 — 대역 제한 근사)."""
    y = np.zeros_like(ph)
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] = x + x - x * x - 1.0
    m = ph > 1.0 - dt
    x = (ph[m] - 1.0) / dt[m]
    y[m] = x * x + x + x + 1.0
    return y


def _oversampled(gen, f, n: int, os: int, ph0: float) -> np.ndarray:
    f = np.broadcast_to(np.asarray(f, dtype=float), (n,))
    if os <= 1:
        ph, dt = _phase(f, n, SR, ph0)
        return gen(ph, dt)
    ph, dt = _phase(np.repeat(f, os), n * os, SR * os, ph0)
    return signal.resample_poly(gen(ph, dt), 1, os)[:n]   # FIR 앤티앨리어싱 후 1/os


def osc_saw(f, n: int, ph0: float = 0.0, os: int = 2) -> np.ndarray:
    """대역 제한 톱니파: PolyBLEP + 오버샘플링(기본 2배)."""
    return _oversampled(lambda ph, dt: 2.0 * ph - 1.0 - _blep(ph, dt), f, n, os, ph0)


def osc_pulse(f, n: int, width: float = 0.5, ph0: float = 0.0, os: int = 2) -> np.ndarray:
    """대역 제한 펄스파(DC 제거)."""
    def gen(ph, dt):
        y = np.where(ph < width, 1.0, -1.0) + _blep(ph, dt) - _blep((ph - width) % 1.0, dt)
        return y - (2.0 * width - 1.0)
    return _oversampled(gen, f, n, os, ph0)


def sine(f, n: int, ph0: float = 0.0) -> np.ndarray:
    ph, _ = _phase(f, n, SR, ph0)
    return np.sin(TAU * ph)


def modes(n: int, freqs, decays, amps, r: np.random.Generator | None = None,
          drop: float = 0.0, drop_tau: float = 0.015) -> np.ndarray:
    """모달 합성: 감쇠하는 사인들의 합(금속·유리 공명). drop = 타격 순간 살짝 높았다 내려오는 음정."""
    t = tt(n)
    bend = 1.0 + drop * np.exp(-t / drop_tau)
    y = np.zeros(n)
    for f, d, a in zip(freqs, decays, amps):
        ph0 = r.random() if r is not None else 0.0
        y += a * np.exp(-t / d) * sine(f * bend, n, ph0)
    return y


# ── 필터 ────────────────────────────────────────────────────────────

def butter(x, kind: str, f, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, f, btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=-1)


def lp(x, f, order=2):
    return butter(x, "lowpass", f, order)


def hp(x, f, order=2):
    return butter(x, "highpass", f, order)


def bp(x, lo, hi, order=2):
    return butter(x, "bandpass", [lo, hi], order)


def svf(x, fc, q=0.707, mode: str = "lp") -> np.ndarray:
    """시변 차단 주파수용 TPT 상태변수 필터(Zavalishin/Simper). 'bp' 는 공진 피크가 0 dB."""
    x = np.asarray(x, dtype=float)
    if x.ndim == 2:
        return np.stack([svf(ch, fc, q, mode) for ch in x])
    n = x.size
    fc = np.clip(np.broadcast_to(np.asarray(fc, dtype=float), (n,)), 5.0, 0.45 * SR)
    k = 1.0 / np.broadcast_to(np.asarray(q, dtype=float), (n,))
    g = np.tan(np.pi * fc / SR)
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    lo, ba = [], []
    ic1 = ic2 = 0.0
    for v0, c1, c2, c3 in zip(x.tolist(), a1.tolist(), a2.tolist(), a3.tolist()):
        v3 = v0 - ic2
        v1 = c1 * ic1 + c2 * v3
        v2 = ic2 + c2 * ic1 + c3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        lo.append(v2)
        ba.append(v1)
    lo, ba = np.asarray(lo), np.asarray(ba)
    if mode == "lp":
        return lo
    if mode == "bp":
        return ba * k
    if mode == "hp":
        return x - k * ba - lo
    raise ValueError(mode)


def sat(x, drive: float = 1.0) -> np.ndarray:
    """tanh 소프트 새츄레이션(작은 신호는 이득 1)."""
    return np.tanh(drive * np.asarray(x)) / drive


def shape(x: np.ndarray, knee: float = 0.45) -> np.ndarray:
    """타격음의 뾰족한 첫 피크만 부드럽게 눌러(knee 아래는 그대로) 몸통은 살리고 피크는 줄인다.
    마스터 리미터가 덜 일하게 해서 큰 타격이 짓눌리지 않게 한다."""
    x = norm(np.asarray(x, dtype=float))
    a = np.abs(x)
    over = np.maximum(a - knee, 0.0)
    y = np.where(a > knee, knee + (1.0 - knee) * np.tanh(over / (1.0 - knee) * 1.6) / 1.6, a)
    return np.sign(x) * y


# ── 스테레오 ─────────────────────────────────────────────────────────

def pan(x: np.ndarray, p=0.0) -> np.ndarray:
    """모노 → 스테레오, 등전력 팬. p: -1(왼쪽) … +1(오른쪽). 배열이면 시간에 따라 움직인다."""
    th = (np.asarray(p, dtype=float) + 1.0) * (np.pi / 4.0)
    return np.stack([x * np.cos(th), x * np.sin(th)])


def balance(st: np.ndarray, p: float) -> np.ndarray:
    return np.stack([st[0] * min(1.0, 1.0 - p), st[1] * min(1.0, 1.0 + p)])


def stereo_noise(n: int, key) -> np.ndarray:
    """서로 상관없는 L/R 노이즈(넓은 소리용)."""
    return np.stack([RNG(key, ch).standard_normal(n) for ch in range(2)])


# ════════════════════════════════════════════════════════════════════
# 3. 공간: 잔향 · 에코 · 사이드체인
# ════════════════════════════════════════════════════════════════════

def make_ir(seconds: float, rt: tuple[float, float, float], predelay: float, key: str,
            early: int = 10, hp_hz: float = 180.0, lp_hz: float = 11000.0) -> np.ndarray:
    """감쇠 노이즈로 만든 스테레오 잔향 IR. rt = 저·중·고역 RT60(초). 고역일수록 빨리 사라진다."""
    n, pre = ns(seconds), ns(predelay)
    t = tt(n)
    r = RNG("ir", key)
    ir = np.zeros((2, pre + n))
    for ch in range(2):
        w = r.standard_normal(n)
        lo, hi = lp(w, 400.0), hp(w, 3500.0)
        mid = w - lo - hi
        k = 6.9078                                     # ln(1000): RT60 = 60 dB 감쇠
        tail = (lo * np.exp(-k * t / rt[0]) + mid * np.exp(-k * t / rt[1]) + hi * np.exp(-k * t / rt[2]))
        tail *= 1.0 - np.exp(-t / 0.012)               # 밀도가 차오르는 앞부분
        for _ in range(early):                         # 초기 반사
            d = r.uniform(0.003, 0.06)
            tail[ns(d)] += r.choice([-1.0, 1.0]) * r.uniform(4.0, 10.0) * (1.0 - d / 0.09)
        tail = lp(hp(tail, hp_hz), lp_hz) * win_tail(n, 0.15)
        ir[ch, pre:] = tail
    return ir / np.sqrt(np.sum(ir ** 2) / 2.0)        # 채널당 에너지 1


def reverb(x: np.ndarray, ir: np.ndarray, cross: float = 0.12) -> np.ndarray:
    n = x.shape[-1]
    a = (1.0 - cross) * x[0] + cross * x[1]
    b = (1.0 - cross) * x[1] + cross * x[0]
    return np.stack([signal.oaconvolve(a, ir[0])[:n], signal.oaconvolve(b, ir[1])[:n]])


def pingpong(x: np.ndarray, delay: float, fb: float = 0.42, repeats: int = 7,
             lp_hz: float = 5000.0, hp_hz: float = 300.0, spread: float = 0.9) -> np.ndarray:
    """템포 동기 핑퐁 에코: 왼쪽·오른쪽을 번갈아 되돌아오며, 돌아올 때마다 조금씩 어두워진다."""
    n, d = x.shape[-1], ns(delay)
    sig = 0.5 * (x[0] + x[1])
    out = np.zeros((2, n))
    for k in range(repeats):
        sh = (k + 1) * d
        if sh >= n:
            break
        sig = lp(hp(sig, hp_hz, 1), lp_hz, 1) * (1.0 if k == 0 else fb)
        th = ((-spread if k % 2 == 0 else spread) + 1.0) * np.pi / 4.0
        out[0, sh:] += np.cos(th) * sig[: n - sh]
        out[1, sh:] += np.sin(th) * sig[: n - sh]
    return out


def duck_env(n: int, times, depth_db: float = -10.0, attack: float = 0.004, release: float = 0.4) -> np.ndarray:
    """킥 사이드체인 게인: 킥 직전 attack 동안 내려가고 release 동안 코사인으로 돌아온다."""
    g = np.ones(n)
    floor = float(dbg(depth_db))
    na, nr = ns(attack), ns(release)
    curve = np.concatenate([1.0 - (1.0 - floor) * rise(na), floor + (1.0 - floor) * rise(nr)])
    for tk in times:
        i0 = ns(tk) - na
        a, b = max(i0, 0), min(i0 + curve.size, n)
        if b > a:
            g[a:b] = np.minimum(g[a:b], curve[a - i0: b - i0])
    return g


# ════════════════════════════════════════════════════════════════════
# 4-a. 악기: 효과음
# ════════════════════════════════════════════════════════════════════

def sfx_tick(accent: bool, k, wrong: bool = False) -> np.ndarray:
    """스테퍼·컨베이어의 정밀한 '틱'. accent = 박 위(짝수 줄) — 몸통 '툭'을 더 크게.
    wrong = 단 하나 어긋난 틱: ~25 ms 늦게 따라오는 작은 플램 + 살짝 어긋난(디튠) 금속 배음."""
    r = RNG("tick", k)
    n = ns(0.16)
    t = tt(n)
    j = 1.0 + 0.008 * r.standard_normal()
    click = hp(r.standard_normal(n), 2500.0) * np.exp(-t / 0.0005)
    f0 = (1880.0 if accent else 2650.0) * j
    ring = modes(n, [f0, f0 * 1.47, f0 * 2.31, f0 * 3.12], [0.022, 0.014, 0.009, 0.006], [1.0, 0.6, 0.35, 0.2], r)
    fb = (165.0 if accent else 240.0) * j
    body = sine(fb * (1.0 + 0.7 * np.exp(-t / 0.005)), n) * env_exp(n, 0.0003, 0.026 if accent else 0.012)
    clack = bp(r.standard_normal(n), 650.0, 2400.0) * np.exp(-t / 0.0045)
    x = 0.5 * norm(click) + 0.28 * norm(ring) + (0.95 if accent else 0.4) * norm(body) + 0.32 * norm(clack)
    x = norm(x) * (1.0 if accent else 0.62)
    if wrong:
        d = ns(0.025)
        flam = np.zeros(n)
        flam[d:] = sfx_tick(False, ("flam", k))[: n - d] * 0.34
        det = modes(n, [f0 * 1.47 * 1.021, f0 * 2.31 * 0.985], [0.05, 0.035], [1.0, 0.7], RNG("tick_wrong"))
        x = x + flam + 0.09 * norm(det * env_exp(n, 0.001, 0.05))
    return x * win_tail(n, 0.3)


def sfx_open_hit():
    """첫 프레임: 무거운 기계 '철컥' + 서브 드롭(95→29 Hz) + 빠르게 뒤로 빠지는 '휙'."""
    r = RNG("open_hit")
    n = ns(2.4)
    t = tt(n)
    metal = modes(n, [181, 423, 771, 1209, 1712, 2583, 3517, 4890],
                  [0.30, 0.22, 0.15, 0.10, 0.07, 0.05, 0.035, 0.022],
                  [1, .85, .7, .5, .4, .3, .22, .15], r, drop=0.012)
    snap = hp(r.standard_normal(n), 3000.0) * np.exp(-t / 0.0012)
    chunk = bp(r.standard_normal(n), 450.0, 1900.0) * np.exp(-t / 0.02)
    thump = sine(50.0 + 85.0 * np.exp(-t / 0.018), n) * env_exp(n, 0.0004, 0.09)
    hit = norm(shape(0.5 * norm(metal) + 0.55 * norm(snap) + 0.45 * norm(chunk) + 0.85 * norm(thump))) * win_tail(n, 0.3)
    sub = norm(sat(sine(29.0 + 66.0 * np.exp(-t / 0.38), n) * env_exp(n, 0.003, 0.6), 1.8)) * win_tail(n, 0.3)
    m = ns(0.6)
    u = np.linspace(0.0, 1.0, m)
    fc = 5200.0 * (350.0 / 5200.0) ** (u ** 0.7)
    pull = svf(stereo_noise(m, "pull"), fc, 1.4, "bp") * (1.0 - u) ** 3
    return hit, sub, norm(pull)


def sfx_boom() -> np.ndarray:
    """정지(freeze): 깊은 붐 — 64→28 Hz 사인 + 낮은 노이즈 '쿵'."""
    r = RNG("boom")
    n = ns(3.5)
    t = tt(n)
    body = sat(sine(28.0 + 36.0 * np.exp(-t / 0.45), n) * env_exp(n, 0.0015, 1.0), 2.2)
    knock = lp(hp(r.standard_normal(n), 400.0), 3000.0) * np.exp(-t / 0.004)
    thump = lp(r.standard_normal(n), 150.0, 4) * np.exp(-t / 0.11)
    return norm(norm(body) + 0.22 * norm(knock) + 0.5 * norm(thump)) * win_tail(n, 0.35)


def sfx_scan(dur: float, beat: float) -> np.ndarray:
    """시선이 왼쪽→오른쪽으로 훑음: 공진 대역 노이즈 스윕 + 가는 빔 음, 32분음표 '점선' 게이트."""
    r = RNG("scan")
    n = ns(dur)
    t = tt(n)
    u = t / dur
    fc = 420.0 * (5600.0 / 420.0) ** u
    x = norm(svf(r.standard_normal(n), fc, 7.0, "bp"))
    beam = 0.10 * sine(fc, n)
    dash = 0.3 + 0.7 * (0.5 + 0.5 * np.cos(TAU * (8.0 / beat) * t)) ** 2
    return pan((x + beam) * dash, -0.85 + 1.7 * u)


def bell(f: float, dur: float = 2.5, bright: float = 1.0, decay: float = 1.0, key="bell") -> np.ndarray:
    """맑은 종/핑: FM(1:3.5, 지수 감쇠 인덱스) + 가산 배음 + 아주 짧은 타격음."""
    r = RNG(key, round(f, 2))
    n = ns(dur)
    t = tt(n)
    idx = bright * (1.9 * np.exp(-t / 0.16) + 0.25)
    fm = np.sin(TAU * f * t + idx * np.sin(TAU * 3.5 * f * t)) * np.exp(-t / (0.5 * decay))
    add = (np.sin(TAU * f * t) * np.exp(-t / (1.25 * decay))
           + 0.28 * np.sin(TAU * 2.0 * f * t + 0.4) * np.exp(-t / (0.55 * decay))
           + 0.10 * np.sin(TAU * 3.0 * f * t + 1.3) * np.exp(-t / (0.28 * decay))
           + 0.05 * np.sin(TAU * 4.17 * f * t + 2.1) * np.exp(-t / (0.14 * decay)))
    strike = hp(r.standard_normal(n), 4000.0) * np.exp(-t / 0.001)      # 말렛이 닿는 순간의 또렷한 '팅'
    return norm(0.42 * fm + 0.85 * add + 0.28 * norm(strike)) * win_tail(n, 0.3)


def sfx_thump(f0: float = 52.0, f1: float = 92.0, decay: float = 0.13) -> np.ndarray:
    """부드러운 서브 '둥' — 핑·집게 같은 짧은 소리에 무게를 더한다."""
    n = ns(0.6)
    t = tt(n)
    x = sine(f0 + (f1 - f0) * np.exp(-t / 0.02), n) * env_exp(n, 0.002, decay)
    return norm(sat(1.4 * x)) * win_tail(n, 0.3)


def sfx_push_in(dur: float, beat: float) -> np.ndarray:
    """밀고 들어가는 스피드 램프: 올라가는 대역 노이즈 + 8분→64분으로 빨라지는 떨림 + D3→D5 상승음."""
    n = ns(dur)
    t = tt(n)
    u = t / dur
    fc = 220.0 * (8000.0 / 220.0) ** (u ** 1.7)
    amp = dbg(-30.0 * (1.0 - u ** 1.3))
    rate = (2.0 / beat) * 8.0 ** (u ** 1.3)
    flutter = 0.55 + 0.45 * np.cos(TAU * np.cumsum(rate) / SR)
    nz = norm(svf(stereo_noise(n, "push"), fc, 1.2, "bp"))
    f = hz("D3") * 4.0 ** (u ** 2.2)
    tone = osc_saw(f, n, 0.1) + osc_saw(f * 1.006, n, 0.6) + 0.5 * osc_saw(f * 2.003, n, 0.3)
    tone = norm(svf(tone, 900.0 + 4500.0 * u ** 2, 0.8, "lp"))
    return (nz * flutter + pan(0.3 * tone, 0.0)) * amp


def reverse_swell(x: np.ndarray, ir: np.ndarray, length: float) -> np.ndarray:
    """소리 x 의 잔향을 뒤집은 '빨려 들어가는' 스웰. 끝이 x 의 시작에 맞물린다."""
    m = ns(length)
    wet = np.stack([signal.fftconvolve(x, ir[ch])[:m] for ch in range(2)])
    return norm(wet[:, ::-1] * np.linspace(0.0, 1.0, m) ** 2)


def sfx_crack():
    """금이 갈라짐: 밀도가 줄어드는 잔금 임펄스 + 유리 공명 + 스냅(넓게) / 낮은 타격(모노)."""
    r = RNG("crack")
    n = ns(2.2)
    t = tt(n)
    imp = np.zeros((2, n))
    imp[:, 0] = 1.0
    tc = 0.0
    while True:
        tc += r.exponential(1.0 / (1400.0 * np.exp(-tc / 0.025) + 40.0))
        if tc > 0.12:
            break
        i, a, p = ns(tc), r.uniform(0.25, 1.0) * np.exp(-tc / 0.045), r.uniform(-0.85, 0.85)
        imp[0, i] += a * np.cos((p + 1) * np.pi / 4)
        imp[1, i] += a * np.sin((p + 1) * np.pi / 4)
    ker = modes(ns(0.012), [3100, 5300, 7900, 10400], [0.0022, 0.0016, 0.0011, 0.0008], [1, .8, .6, .4], RNG("crack_ker"))
    crackle = hp(np.stack([signal.fftconvolve(imp[ch], ker)[:n] for ch in range(2)]), 1500.0)
    fr = [2380.0, 3570.0, 4830.0, 6240.0, 7950.0, 10330.0]
    glass = np.stack([modes(n, [f * (1.0 + 0.004 * (ch - 0.5)) for f in fr], [0.26, 0.20, 0.15, 0.11, 0.08, 0.055],
                            [1.0, 0.8, 0.7, 0.55, 0.4, 0.3], RNG("glass", ch)) for ch in range(2)])
    snap = hp(stereo_noise(n, "snap"), 4000.0) * np.exp(-t / 0.018)
    high = norm(shape(0.75 * norm(crackle) + 0.45 * norm(glass) + 0.4 * norm(snap))) * win_tail(n, 0.35)
    low = sat(sine(36.0 + 44.0 * np.exp(-t / 0.05), n) * env_exp(n, 0.0006, 0.34), 1.6)
    body = bp(r.standard_normal(n), 120.0, 520.0) * np.exp(-t / 0.035)
    low = norm(shape(norm(low) + 0.45 * norm(body))) * win_tail(n, 0.35)
    return high, low


def sfx_servo(dur: float, f0: float, f1: float, key) -> np.ndarray:
    """작은 서보: 음정이 미끄러지는 모터 휘파람(펄스파 배음) + 기어 맞물림 버즈 + 마찰 노이즈."""
    r = RNG("servo", key)
    n = ns(dur)
    t = tt(n)
    u = t / dur
    wob = lp(r.standard_normal(n), 12.0)
    wob /= np.max(np.abs(wob)) + 1e-12
    f = (f0 + (f1 - f0) * smoothstep(u)) * (1.0 + 0.006 * wob)
    speed = np.sin(np.pi * u) ** 0.5
    whine = norm(bp(osc_pulse(f, n, 0.28), 250.0, 4500.0)) + 0.25 * sine(2.0 * f, n) + 0.10 * sine(3.0 * f, n, 0.3)
    am = 1.0 - 0.4 * (0.5 + 0.5 * np.cos(TAU * np.cumsum(f / 7.0) / SR)) ** 4
    fric = 0.14 * norm(bp(r.standard_normal(n), 2200.0, 6500.0))
    return norm((whine + fric) * am * (0.6 + 0.4 * speed))


def sfx_clamp(key="clamp", scale: float = 1.0):
    """그리퍼가 집음: 짧고 단단한 금속 '찰칵'(+걸쇠) / 서브 '둥'."""
    r = RNG(key)
    n = ns(1.4)
    t = tt(n)
    fr = [f * scale for f in (1460.0, 2230.0, 3410.0, 4890.0, 6640.0, 8710.0)]
    metal = modes(n, fr, [0.11, 0.08, 0.055, 0.04, 0.026, 0.016], [1.0, 0.8, 0.65, 0.5, 0.35, 0.25], r, drop=0.008)
    snap = hp(r.standard_normal(n), 3000.0) * np.exp(-t / 0.001)
    clack = bp(r.standard_normal(n), 800.0, 2600.0) * np.exp(-t / 0.009)
    d = ns(0.027)
    latch = np.zeros(n)
    latch[d:] = hp(RNG(key, "latch").standard_normal(n - d), 2500.0) * np.exp(-tt(n - d) / 0.0008)
    hi = norm(shape(0.65 * norm(metal) + 0.55 * norm(snap) + 0.5 * norm(clack) + 0.25 * norm(latch))) * win_tail(n, 0.4)
    sub = sat(sine(44.0 + 34.0 * np.exp(-t / 0.03), n) * env_exp(n, 0.0008, 0.22), 1.6)
    body = lp(r.standard_normal(n), 300.0) * np.exp(-t / 0.03)
    sub = norm(shape(norm(sub) + 0.35 * norm(body))) * win_tail(n, 0.4)
    return hi, sub


def sfx_lift(dur: float) -> np.ndarray:
    """들어 올려 옮기는 '휙': 올라갔다 내려오는 대역 노이즈, 가운데→오른쪽으로 움직임."""
    n = ns(dur)
    t = tt(n)
    u = t / dur
    fc = 380.0 + 2300.0 * np.sin(np.pi * u ** 0.85) ** 1.5
    amp = np.sin(np.pi * u ** 0.8) ** 2
    mono = norm(svf(RNG("lift").standard_normal(n), fc, 1.3, "bp"))
    air = norm(svf(RNG("lift_air").standard_normal(n), fc * 1.9, 4.0, "bp"))
    side = norm(svf(stereo_noise(n, "lift_w"), fc, 1.3, "bp"))
    return (pan(mono + 0.25 * air, -0.25 + 0.9 * u) + 0.35 * side) * amp


def ui_blip(freqs, gap: float = 0.055, decay: float = 0.05, dur: float = 0.5, tick: float = 0.0,
            bright: float = 0.25) -> np.ndarray:
    """깨끗한 UI 블립(사인 + 약한 배음), 여러 음이면 gap 간격으로 이어짐. tick = 앞머리의 아주 작은 '틱'."""
    n = ns(dur)
    y = np.zeros(n)
    if tick:
        y += tick * norm(hp(RNG("blip_tick").standard_normal(n), 3000.0) * np.exp(-tt(n) / 0.0006))
    for i, f in enumerate(freqs):
        i0 = ns(i * gap)
        m = n - i0
        tone = sine(f, m) + bright * sine(2 * f, m) + 0.35 * bright * sine(3 * f, m)
        y[i0:] += tone * env_exp(m, 0.0008, decay) * 0.8 ** i
    return norm(y) * win_tail(n, 0.3)


def ring_pulse(f: float) -> np.ndarray:
    """판정의 '동심원 한 번': 부드럽고 짧게 피어나는 사인 펄스 + 낮은 숨."""
    n = ns(0.6)
    t = tt(n)
    glide = f * (1.0 - 0.10 * np.exp(-t / 0.03))
    tone = (sine(glide, n) + 0.3 * sine(2.0 * glide, n, 0.25)) * env_exp(n, 0.008, 0.10)
    low = sine(f / 4.0 * (1.0 + 0.2 * np.exp(-t / 0.02)), n) * env_exp(n, 0.006, 0.09)
    return norm(norm(tone) + 0.5 * norm(low)) * win_tail(n, 0.3)


def sfx_shutter() -> np.ndarray:
    """카메라 셔터: 46 ms 간격 두 번의 '찰-칵' + 사이의 짧은 휘릭."""
    r = RNG("shutter")
    n = ns(0.3)
    t = tt(n)
    y = np.zeros(n)
    for j, (d, f) in enumerate([(0.0, 3300.0), (0.046, 2900.0)]):
        i0 = ns(d)
        m = n - i0
        click = hp(r.standard_normal(m), 2500.0) * np.exp(-tt(m) / 0.0007)
        ring = modes(m, [f, f * 1.43, f * 2.1], [0.006, 0.004, 0.003], [1.0, 0.6, 0.4], r)
        y[i0:] += (0.8 * norm(click) + 0.5 * norm(ring)) * (1.0 if j == 0 else 0.7)
    whir = bp(r.standard_normal(n), 1500.0, 5000.0) * np.exp(-((t - 0.023) / 0.012) ** 2) * 0.15
    return norm(y + whir) * win_tail(n, 0.3)


def sfx_impact():
    """브랜드 타격: 서브 붐 + 킥 펀치(모노) / 넓은 노이즈 + F 에 맞춘 판 금속 울림(스테레오)."""
    r = RNG("impact")
    n = ns(4.0)
    t = tt(n)
    sub = sat(sine(30.0 + 36.0 * np.exp(-t / 0.33), n) * env_exp(n, 0.001, 1.2), 2.0)
    k = kick(1.0, tail=48.0, punch=190.0, decay=0.22, k="impact")
    punch = np.zeros(n)
    punch[: k.size] = k
    body = lp(r.standard_normal(n), 380.0, 4) * np.exp(-t / 0.16)
    low = norm(shape(norm(sub) + 0.7 * norm(punch) + 0.35 * norm(body))) * win_tail(n, 0.3)
    mid = bp(stereo_noise(n, "imp_mid"), 900.0, 3500.0) * np.exp(-t / 0.12)
    air = hp(stereo_noise(n, "imp_air"), 6000.0) * np.exp(-t / 0.15)
    f0 = hz("F3")
    ratios = [1.0, 1.5, 2.0, 2.76, 3.0, 4.07, 5.4]
    metal = np.stack([modes(n, [f0 * q * (1 + 0.003 * (ch - 0.5)) for q in ratios],
                            [1.6, 1.3, 1.0, 0.7, 0.6, 0.4, 0.28], [1.0, 0.8, 0.7, 0.5, 0.45, 0.3, 0.22],
                            RNG("imp_metal", ch), drop=0.01) for ch in range(2)])
    wide = norm(shape(0.55 * norm(mid) + 0.5 * norm(air) + 0.3 * norm(metal))) * win_tail(n, 0.3)
    return low, wide


def burst(dur: float, key, lo: float = 1500.0, hi: float = 9000.0, decay: float = 0.18,
          attack: float = 0.010) -> np.ndarray:
    """넓게 터지는 짧은 공기(대역 노이즈, L/R 무상관) — 큰 순간의 밀도를 채운다(피크는 앞 타격에 양보)."""
    n = ns(dur)
    x = bp(stereo_noise(n, ("burst", key)), lo, hi) * env_exp(n, attack, decay)
    return norm(shape(x)) * win_tail(n, 0.3)


def riser(dur: float, f0: float, f1: float, key, tone_lvl: float = 0.3, q: float = 1.2) -> np.ndarray:
    """차오르는 소리: 대역 노이즈 400 Hz→7 kHz + 5도로 쌓은 톱니 상승음, 끝으로 갈수록 커짐."""
    n = ns(dur)
    t = tt(n)
    u = t / dur
    fc = 400.0 * (7000.0 / 400.0) ** (u ** 1.5)
    nz = norm(svf(stereo_noise(n, ("riser", key)), fc, q, "bp"))
    f = f0 * (f1 / f0) ** (u ** 1.6)
    tone = osc_saw(f, n) + 0.5 * osc_saw(f * 1.5, n, 0.37) + osc_saw(f * 1.004, n, 0.71)
    tone = norm(svf(tone, 600.0 + 5000.0 * u ** 2, 0.8, "lp"))
    return (nz + pan(tone_lvl * tone, 0.0)) * u ** 2.2


# ════════════════════════════════════════════════════════════════════
# 4-b. 악기: 음악
# ════════════════════════════════════════════════════════════════════

def kick(vel: float = 1.0, tail: float = 46.0, punch: float = 165.0, decay: float = 0.20, k=0) -> np.ndarray:
    """킥: 165→46 Hz 피치 드롭 사인 + 비터 클릭, 살짝 새츄레이션."""
    r = RNG("kick", k)
    n = ns(0.6)
    t = tt(n)
    f = tail + (punch - tail) * np.exp(-t / 0.026)
    body = sine(f, n) * env_exp(n, 0.0004, decay, hold=0.012)
    click = hp(r.standard_normal(n), 3500.0) * np.exp(-t / 0.0007)
    knock = sine(1050.0, n) * np.exp(-t / 0.0035)
    return norm(sat(1.5 * (body + 0.16 * norm(click) + 0.10 * knock))) * vel * win_tail(n, 0.3)


def snare(vel: float = 1.0, tune: float = 1.0, k=0, clap: bool = True, decay: float = 0.14) -> np.ndarray:
    """스네어(톤 + 노이즈) + 클랩(세 번 겹친 짧은 노이즈 + 꼬리)."""
    r = RNG("snare", k)
    n = ns(0.6)
    t = tt(n)
    tone = (sine(185.0 * tune * (1.0 + 0.25 * np.exp(-t / 0.008)), n) * env_exp(n, 0.0005, 0.065)
            + 0.5 * sine(330.0 * tune, n) * env_exp(n, 0.0005, 0.04))
    nz = lp(hp(r.standard_normal(n), 1300.0), 9500.0) * (0.65 * np.exp(-t / decay) + 0.35 * np.exp(-t / 0.006))
    x = 0.5 * norm(tone) + 0.8 * norm(nz)
    if clap:
        cn = bp(r.standard_normal(n), 900.0, 2600.0)
        c = np.zeros(n)
        for j, d in enumerate((0.0, 0.0085, 0.0185)):
            i0 = ns(d)
            c[i0:] += cn[i0:] * np.exp(-tt(n - i0) / 0.0032) * 0.85 ** j
        i0 = ns(0.026)
        c[i0:] += cn[i0:] * np.exp(-tt(n - i0) / 0.085) * 0.9
        x = x + 0.7 * norm(c)
    return norm(x) * vel * win_tail(n, 0.3)


_HAT_F = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)      # 금속성 사각파 묶음(비조화)


def hat(vel: float = 1.0, k=0, open_: bool = False) -> np.ndarray:
    r = RNG("hat", k, open_)
    n = ns(0.45 if open_ else 0.12)
    t = tt(n)
    metal = sum(osc_pulse(f * 1.7, n, 0.5, r.random()) for f in _HAT_F)
    metal = hp(bp(metal, 6000.0, 15000.0), 7000.0)
    nz = hp(r.standard_normal(n), 8500.0)
    x = (0.6 * norm(metal) + 0.5 * norm(nz)) * env_exp(n, 0.0003, 0.13 if open_ else 0.022)
    return norm(x) * vel * win_tail(n, 0.3)


def crash(dur: float = 2.4, k=0, attack: float = 0.0005) -> np.ndarray:
    """크래시 심벌. attack 을 몇 ms 주면 킥과 첫 피크가 겹치지 않아 피크는 덜 오르고 소리는 크게 남는다."""
    n = ns(dur)
    t = tt(n)
    out = []
    for ch in range(2):
        r = RNG("crash", k, ch)
        metal = sum(osc_pulse(f * (2.1 + 0.03 * ch), n, 0.5, r.random()) for f in _HAT_F)
        x = 0.5 * norm(hp(metal, 3000.0)) + 0.6 * norm(hp(r.standard_normal(n), 3000.0))
        out.append(lp(x, 14000.0) * (0.7 * np.exp(-t / 0.9) + 0.3 * np.exp(-t / 0.08)))
    na = max(1, ns(attack))
    st = np.stack(out)
    st[:, :na] *= rise(na)
    return norm(st) * win_tail(n, 0.3)


def supersaw(freqs, n: int, key, voices: int = 5, detune: float = 14.0, spread: float = 0.95, os: int = 1) -> np.ndarray:
    """음마다 voices 개의 톱니를 ±detune 센트로 흩고 좌우로 벌린다(저역은 마스터에서 모노)."""
    rr = RNG("ss", key)
    L, R = np.zeros(n), np.zeros(n)
    for i, f in enumerate(freqs):
        for v in range(voices):
            d = (v - (voices - 1) / 2) / max((voices - 1) / 2, 1)
            c = d * detune + rr.normal(0.0, 1.0)
            th = (d * spread * (1 if i % 2 == 0 else -1) + 1.0) * np.pi / 4.0
            s = osc_saw(f * 2.0 ** (c / 1200.0), n, rr.random(), os=os)
            L += s * np.cos(th)
            R += s * np.sin(th)
    return np.stack([L, R]) / np.sqrt(voices * len(freqs))


def pad(freqs, dur: float, key, cutoff: float = 2400.0, a: float = 0.02, d: float = 0.3, s: float = 0.85,
        r: float = 0.08, voices: int = 5, detune: float = 14.0) -> np.ndarray:
    n = ns(dur + r)
    x = lp(supersaw(freqs, n, ("pad", key), voices, detune), cutoff)
    return x * env_adsr(n, dur, a, d, s, r)


def stab(freqs, key, dur: float = 0.8, bright: float = 1.0, decay: float = 0.17, attack: float = 0.002) -> np.ndarray:
    """짧은 코드 스탭: 넓게 벌린 톱니 + 빠르게 닫히는 필터."""
    n = ns(dur)
    t = tt(n)
    x = supersaw(freqs, n, ("stab", key), voices=3, detune=16.0, spread=0.85, os=2)
    x = svf(x, 900.0 + 7500.0 * bright * np.exp(-t / 0.07), 0.9, "lp")
    return norm(x * env_exp(n, attack, decay)) * win_tail(n, 0.3)


def pluck(f: float, key, dur: float = 0.45, bright: float = 1.0) -> np.ndarray:
    """아르페지오 플럭: 톱니 + 펄스, 필터 엔벌로프."""
    r = RNG("pluck", key)
    n = ns(dur)
    t = tt(n)
    x = 0.65 * osc_saw(f, n, r.random()) + 0.35 * osc_pulse(f * 1.003, n, 0.4, r.random())
    y = svf(x, 600.0 + 6500.0 * bright * np.exp(-t / 0.05), 1.0, "lp") * env_exp(n, 0.001, 0.13)
    return norm(y) * win_tail(n, 0.3)


def bass_pluck(f: float, gate: float, key, bright: float = 1.0) -> np.ndarray:
    """16분 롤링 베이스의 한 음(중저역 톱니, 필터 엔벌로프). 서브는 sub_note 가 따로."""
    r = RNG("bass", key)
    n = ns(gate + 0.03)
    t = tt(n)
    x = osc_saw(f, n, r.random()) + 0.5 * osc_pulse(f * 1.003, n, 0.5, r.random())
    y = svf(x, 150.0 + 1300.0 * bright * np.exp(-t / 0.045), 1.1, "lp")
    return norm(y) * env_adsr(n, gate, 0.002, 0.06, 0.6, 0.025)


def sub_note(f: float, dur: float, a: float = 0.006, r: float = 0.02) -> np.ndarray:
    n = ns(dur + r)
    return sat(1.2 * sine(f, n) * env_adsr(n, dur, a, 0.05, 1.0, r))


def build_bass(f: float, gate: float, key, cutoff: float) -> np.ndarray:
    """손 구간에서 쌓아 올리는 필터 베이스 8분음(차단 주파수가 점점 열림)."""
    r = RNG("bbass", key)
    n = ns(gate + 0.03)
    t = tt(n)
    x = osc_saw(f, n, r.random()) + 0.6 * sine(f, n)
    y = svf(x, cutoff * (1.0 + 1.5 * np.exp(-t / 0.04)), 1.0, "lp")
    return y * env_adsr(n, gate, 0.003, 0.08, 0.5, 0.03)


def sub_pulse(f: float) -> np.ndarray:
    """훅의 부드러운 서브 펄스."""
    n = ns(0.45)
    x = (sine(f, n) + 0.22 * sine(2.0 * f, n)) * env_exp(n, 0.025, 0.13)
    return norm(x) * win_tail(n, 0.3)


def heartbeat(vel: float, key) -> np.ndarray:
    """눈 구간의 드문 심장 박동 같은 서브."""
    n = ns(0.45)
    t = tt(n)
    x = sat(1.6 * sine(46.0 + 28.0 * np.exp(-t / 0.03), n) * env_exp(n, 0.006, 0.11))
    x = x + 0.05 * lp(RNG("hb", key).standard_normal(n), 900.0) * np.exp(-t / 0.01)
    return norm(x) * vel * win_tail(n, 0.3)


def drone(dur: float) -> np.ndarray:
    """훅의 조용하고 팽팽한 D 드론: 톱니 D2·A2·D3, 필터가 200→800 Hz 로 천천히 열림."""
    n = ns(dur)
    u = tt(n) / dur
    st = supersaw([hz("D2"), hz("A2"), hz("D3")], n, "drone", voices=3, detune=8.0, spread=0.6)
    st = svf(st, 200.0 * 4.0 ** u, 0.9, "lp")
    air = hp(stereo_noise(n, "drone_air"), 5000.0) * 0.02
    return (norm(st) + pan(0.4 * sine(hz("D2"), n), 0.0) + air) * (0.5 + 0.5 * u)


def frozen_pad(dur: float) -> np.ndarray:
    """멈춘 시간: 높은 D5·A5·E6 사인 쌍(±2센트로 느리게 맥놀이) + 낮은 D3."""
    n = ns(dur)
    t = tt(n)
    L, R = np.zeros(n), np.zeros(n)
    for i, (name, p) in enumerate((("D5", -0.5), ("A5", 0.5), ("E6", 0.0))):
        f = hz(name)
        trem = 0.75 + 0.25 * np.sin(TAU * (0.23 + 0.07 * i) * t + i)
        for c in (-2.0, 2.0):
            s = sine(f * 2.0 ** (c / 1200.0), n, RNG("fz", i, c).random()) * trem
            th = (np.clip(p + 0.3 * np.sign(c), -1, 1) + 1.0) * np.pi / 4.0
            L += s * np.cos(th)
            R += s * np.sin(th)
    return np.stack([L, R]) / 6.0 + pan(0.3 * sine(hz("D3"), n), 0.0)


def build_pad(dur: float, c0: float, c1: float) -> np.ndarray:
    """손 구간의 Dm 패드, 저역 통과가 c0→c1 로 열린다."""
    n = ns(dur)
    u = tt(n) / dur
    x = supersaw([hz("D3"), hz("A3"), hz("D4"), hz("F4")], n, "bpad", voices=5, detune=12.0)
    return svf(x, c0 * (c1 / c0) ** u, 0.8, "lp") * (0.35 + 0.65 * u ** 1.5)


def mallet(f: float, dur: float = 1.6) -> np.ndarray:
    """소리 로고 밑에 깔리는 따뜻한 한 옥타브 아래 말렛(사인)."""
    n = ns(dur)
    t = tt(n)
    x = (sine(f, n) + 0.12 * sine(2.0 * f, n) * np.exp(-t / 0.2)) * env_exp(n, 0.003, 0.6)
    return norm(x) * win_tail(n, 0.3)


# ════════════════════════════════════════════════════════════════════
# 5. 믹서
# ════════════════════════════════════════════════════════════════════

class Mixer:
    """스템(music / sfx)마다 드라이 버스와 센드(hall, room, echo)를 둔다.
    브랜드 타격 전('pre')과 후('post')를 따로 모아, 'pre' 에만 직전의 '숨'(무음) 게이트를 건다."""

    STEMS = ("music", "sfx")
    FX = ("hall", "room", "echo")

    def __init__(self, n: int, split_t: float):
        self.n = n
        self.split = ns(split_t)
        self.duck = np.ones(n)
        self.dry = {(s, g): np.zeros((2, n)) for s in self.STEMS for g in ("pre", "post")}
        self.send = {(s, g, fx): np.zeros((2, n)) for s in self.STEMS for g in ("pre", "post") for fx in self.FX}
        self.events: list[dict] = []

    def add(self, stem: str, t: float, sig: np.ndarray, db: float = 0.0, pan_: float = 0.0,
            hall: float = 0.0, room: float = 0.0, echo: float = 0.0, dry: float = 1.0,
            duck: bool = False, name: str = "", fin: float = 0.0002, fout: float = 0.004) -> None:
        x = np.asarray(sig, dtype=float)
        x = pan(x, pan_) if x.ndim == 1 else (balance(x, pan_) if pan_ else x)
        x = edges(x, fin, fout) * float(dbg(db))       # 모든 음의 시작·끝이 0 에서 출발·도착
        i0 = ns(t)
        a, b = max(i0, 0), min(i0 + x.shape[1], self.n)
        if b <= a:
            return
        seg = x[:, a - i0: b - i0]
        if duck:
            seg = seg * self.duck[a:b]
        g = "pre" if i0 < self.split else "post"
        if dry:
            self.dry[stem, g][:, a:b] += dry * seg
        for fx, amt in zip(self.FX, (hall, room, echo)):
            if amt:
                self.send[stem, g, fx][:, a:b] += amt * seg
        env = np.max(np.abs(seg), axis=0)
        live = np.flatnonzero(env > 1e-3 * max(env.max(), 1e-12))      # -60 dB 위로 들리는 구간
        self.events.append(dict(name=name, stem=stem, i0=i0, i1=i0 + x.shape[1],
                                first=a + int(live[0]) if live.size else a,
                                last=a + int(live[-1]) if live.size else a,
                                edge=float(max(np.abs(x[:, 0]).max(), np.abs(x[:, -1]).max()))))

    def render(self, irs: dict, echo_delay: float, gate_pre: np.ndarray) -> dict[str, np.ndarray]:
        stems = {}
        for s in self.STEMS:
            out = np.zeros((2, self.n))
            for g in ("pre", "post"):
                y = self.dry[s, g].copy()
                e = self.send[s, g, "echo"]
                hall_in = self.send[s, g, "hall"].copy()
                if np.any(e):
                    ret = pingpong(e, echo_delay)
                    y += ret
                    hall_in += 0.3 * ret                 # 에코도 잔향 속으로
                if np.any(hall_in):
                    y += reverb(hall_in, irs["hall"])
                if np.any(self.send[s, g, "room"]):
                    y += reverb(self.send[s, g, "room"], irs["room"])
                y = cleanup(y)                       # 필터 울림까지 게이트가 자르도록 게이트 앞에서
                out += y * gate_pre if g == "pre" else y
            stems[s] = out
        return stems


def place(buf: np.ndarray, t: float, sig: np.ndarray, db: float = 0.0, pan_: float = 0.0) -> None:
    """서브 버스(드럼 등)에 직접 더하기 — Mixer.add 와 같은 끝 처리."""
    x = np.asarray(sig, dtype=float)
    x = edges(pan(x, pan_) if x.ndim == 1 else x) * float(dbg(db))
    i0 = ns(t)
    a, b = max(i0, 0), min(i0 + x.shape[1], buf.shape[1])
    if b > a:
        buf[:, a:b] += x[:, a - i0: b - i0]


# ════════════════════════════════════════════════════════════════════
# 6. 편곡 — 모든 시각은 timeline.json 에서
# ════════════════════════════════════════════════════════════════════

# line 구간 코드: Dm – Bb – F – C (word_1..4 에서 바뀜), 브랜드는 F(add9)
CHORDS = {
    "Dm": dict(root="D2", pad=["A3", "D4", "F4", "A4"], low="D3", arp=["D4", "F4", "A4", "C5", "D5"]),
    "Bb": dict(root="Bb1", pad=["Bb3", "D4", "F4", "Bb4"], low="Bb2", arp=["D4", "F4", "Bb4", "C5", "D5"]),
    "F": dict(root="F2", pad=["A3", "C4", "F4", "A4"], low="F3", arp=["C4", "F4", "A4", "C5", "E5"]),
    "C": dict(root="C2", pad=["G3", "C4", "E4", "G4"], low="C3", arp=["C4", "E4", "G4", "C5", "D5"]),
}
ARP_STEPS = [0, 2, 4, 3, 1, 3, 4, 2]          # 한 마디(8개 16분음) 아르페지오 모양
LOGO = ["C5", "F5", "A5"]                      # 소리 로고: 오르는 4도 + 장3도. 마지막 A5 는 '찾는 눈' 핑과 같은 음
BRAND_PAD = ["F3", "C4", "G4", "A4", "C5"]     # F(add9)


def arrange(tl: Timeline, mx: Mixer, irs: dict) -> np.ndarray:
    """cue 시간에 모든 소리를 놓는다. 브랜드 직전 '숨' 게이트를 돌려준다."""
    B = tl.beat
    S8, S16, S32 = B / 2, B / 4, B / 8
    c = tl.cues
    hook0, hook1 = tl.sections["hook"]
    eye1 = tl.sections["eye"][1]
    hand0 = tl.sections["hand"][0]
    t_drop, t_brand = c["drop"].t, c["brand_hit"].t
    n = mx.n

    # 킥(=사이드체인) 위치는 먼저 정해 둔다: 드롭부터 브랜드 전까지 매 박
    kicks = grid(t_drop, t_brand, B)
    mx.duck = duck_env(n, kicks, depth_db=-11.0, attack=0.004, release=0.8 * B)
    drums = np.zeros((2, n))

    # ── HOOK 0–4: 첫 타격, 컨베이어 틱, 서브 펄스, 드론, 짧은 라이저 ─────────
    t0 = c["open_hit"].t
    hit, sub, pull = sfx_open_hit()
    mx.add("sfx", t0, hit, -10.0, room=0.18, hall=0.10, name="open_hit")
    mx.add("sfx", t0, sub, -16.5, name="open_hit.sub")
    mx.add("sfx", t0, pull, -24.0, hall=0.12, fin=0.01, name="open_hit.pull")

    # 두 줄이 엇갈려 움직인다: 짝수 줄은 박 위(강세), 홀수 줄은 엇박. 마지막 박 위 틱 하나만 '어긋남'.
    st = c["step_ticks"]
    ticks = st.times()
    wrong_t = max(x for x in ticks if tl.on_beat(x))
    for i, tk in enumerate(ticks):
        on = tl.on_beat(tk)
        mx.add("sfx", tk, sfx_tick(on, i, wrong=(tk == wrong_t)), -10.0 if on else -12.5,
               pan_=-0.2 if on else 0.2, room=0.22, name="step_tick")

    for tb in grid(hook0 + 2 * B, hook1, B):
        mx.add("music", tb, sub_pulse(hz("D2")), -17.0, name="hook.sub_pulse")
    mx.add("music", hook0, drone(c["freeze"].t - hook0), -17.0, hall=0.12, fin=1.2, fout=0.03, name="hook.drone")

    r1 = c["riser_1"]
    mx.add("sfx", r1.t, riser(r1.dur - 0.008, hz("D4"), hz("D5"), "r1"), -18.0, hall=0.12, fin=0.02,
           fout=0.003, name="riser_1")

    # ── EYE 4–7: 정지·붐, 훑기, 고정 핑(+에코), 심장 박동, 밀고 들어감 ───────────
    tf = c["freeze"].t
    mx.add("sfx", tf, sfx_boom(), -10.0, hall=0.22, name="freeze")
    mx.add("music", tf, frozen_pad(eye1 - tf + 0.25), -27.0, hall=0.3, fin=0.6, fout=0.35, name="eye.pad")
    sc = c["scan"]
    mx.add("sfx", sc.t, sfx_scan(sc.dur, B), -15.0, hall=0.15, fin=0.05, fout=0.08, name="scan")

    tl_ = c["lock"].t
    mx.add("sfx", tl_, bell(hz("A5"), 2.0, bright=1.1, decay=0.55, key="lock"), -12.3, echo=0.45, hall=0.22,
           name="lock")
    mx.add("sfx", tl_, sfx_thump(), -9.8, name="lock.thump")

    pi = c["push_in"]
    for i, tb in enumerate([tl_, pi.t, pi.t + B]):           # 드문 '쿵-쿵', 밀고 들어갈수록 간격이 좁아진다
        mx.add("music", tb, heartbeat(1.0, i), -12.0, name="eye.heart")
        mx.add("music", tb + S8, heartbeat(0.6, i + 10), -15.0, name="eye.heart")
    cut = 0.012                                              # 갈라짐 직전의 아주 짧은 빈틈
    mx.add("sfx", pi.t, sfx_push_in(pi.dur - cut, B), -8.0, hall=0.10, fin=0.05, fout=0.003, name="push_in")
    crack_hi, crack_lo = sfx_crack()
    sw = reverse_swell(crack_hi[0] + crack_hi[1], irs["hall"], 1.1)
    mx.add("sfx", c["crack_open"].t - cut - sw.shape[1] / SR, sw, -17.0, fin=0.05, fout=0.003, name="push_in.swell")

    # ── HAND 7–10: 갈라짐, 서보, 집게, 휙 + 밑에서 쌓이는 음악 ───────────────
    tc = c["crack_open"].t
    mx.add("sfx", tc, crack_hi, -7.0, hall=0.30, name="crack_open")
    mx.add("sfx", tc, crack_lo, -7.0, name="crack_open.low")
    for cid, f0, f1, key in (("servo_1", 430.0, 760.0, 1), ("servo_2", 820.0, 610.0, 2)):
        sv = c[cid]
        mx.add("sfx", sv.t, sfx_servo(sv.dur, f0, f1, key), -24.0, pan_=0.2, room=0.2, fin=0.025, fout=0.04, name=cid)
    tk = c["clamp"].t
    clamp_hi, clamp_sub = sfx_clamp()
    mx.add("sfx", tk, clamp_hi, -2.2, room=0.25, hall=0.12, name="clamp")
    mx.add("sfx", tk, clamp_sub, -3.2, name="clamp.sub")
    dm = CHORDS["Dm"]
    mx.add("music", tk, stab([hz(dm["low"])] + [hz(x) for x in dm["pad"]], "clamp", bright=0.6), -13.0, hall=0.2,
           name="clamp.stab")                     # 집는 순간 음악도 한 번 받쳐 준다
    lf = c["lift"]
    mx.add("sfx", lf.t, sfx_lift(lf.dur), -14.0, hall=0.10, fin=0.02, fout=0.02, name="lift")

    build_end = t_drop - S16                     # 드롭 직전 16분음 하나는 비워 둔다
    span = build_end - hand0
    for i, tb in enumerate(grid(hand0, build_end, S8)):
        u = (tb - hand0) / span
        mx.add("music", tb, build_bass(hz("D2"), S8 * 0.8, i, 180.0 * (1600.0 / 180.0) ** u), -14.0 + 8.0 * u,
               name="build.bass")
    mx.add("music", hand0, build_pad(span, 300.0, 2600.0), -17.0, hall=0.2, fin=0.3, fout=0.01, name="build.pad")
    arp0 = hand0 + 2 * B
    pool = [hz(x) for x in CHORDS["Dm"]["arp"]]
    for i, ta in enumerate(grid(arp0, build_end, S16)):
        u = (ta - arp0) / (build_end - arp0)
        mx.add("music", ta, pluck(pool[ARP_STEPS[i % 8]], ("barp", i), bright=0.3 + 0.7 * u), -26.0 + 13.0 * u,
               pan_=0.45 if i % 2 else -0.45, echo=0.18, hall=0.12, name="build.arp")
    for i, th in enumerate(grid(tk, build_end, S16)):
        u = (th - tk) / (build_end - tk)
        place(drums, th, hat(0.4 + 0.6 * u, ("bh", i)), -27.0 + 11.0 * u, 0.3 if i % 2 else -0.05)

    # ── LINE 10–14: 본 비트 ───────────────────────────────────────────
    words = [c[f"word_{i}"].t for i in range(1, 5)]
    names = ["Dm", "Bb", "F", "C"]
    ends = words[1:] + [t_brand]
    r2 = c["riser_2"]
    gap_start = t_brand - S32                    # 브랜드 직전 32분음 하나만큼 '숨'

    for i, tb in enumerate(kicks):                # 드롭의 첫 킥은 조금 눌러 크래시·스탭·공기가 들어설 자리를 준다
        place(drums, tb, kick(0.75 if i == 0 else 1.0, k=i), -2.5)
    for i, ts in enumerate(kicks[1::2]):         # 2·4 박 스네어/클랩
        sn = snare(1.0, k=i)
        place(drums, ts, sn, -10.5)
        mx.add("music", ts, sn, -10.5, dry=0.0, hall=0.25, name="snare.send")
    hat_end = r2.t + B                            # 롤이 몰아칠 때 하이햇은 빠진다
    for i, th in enumerate(grid(t_drop, hat_end, S16)):     # 완전히 고른 16분 격자(스윙 없음)
        place(drums, th, hat(0.85 if i % 2 == 0 else 0.7, ("h", i % 4)), -17.0, 0.3 if i % 2 else -0.05)
    # 라이저 2 의 스네어 롤: 8분 → 16분 → 32분 → 64분, 점점 세고 높게
    roll, t = [], r2.t
    for step, count in ((S8, 2), (S16, 2), (S32, 3), (S32 / 2, 3)):
        for _ in range(count):
            if t < gap_start - 0.01:
                roll.append(t)
            t += step
    for i, tr in enumerate(roll):
        u = (tr - r2.t) / max(gap_start - r2.t, 1e-9)
        sn = snare(0.45 + 0.55 * u, tune=1.0 + 0.45 * u, k=("roll", i), clap=False, decay=0.08)
        place(drums, tr, hp(sn, 200.0 + 900.0 * u), -11.0 + 4.0 * u)
        mx.add("music", tr, sn, -14.0, dry=0.0, hall=0.15, name="roll.send")
    mx.add("music", 0.0, sat(1.25 * drums) / 1.25, name="drums", fin=0.0, fout=0.0)
    mx.add("music", t_drop, crash(2.6, "drop", attack=0.006), -5.5, hall=0.15, name="drop.crash")
    mx.add("sfx", t_drop, burst(0.6, "drop"), -6.5, hall=0.2, name="drop.burst")   # 드롭 순간만 넓게 터지는 공기

    for ci, (tw, te, cname) in enumerate(zip(words, ends, names)):
        ch = CHORDS[cname]
        seg = te - tw
        mx.add("music", tw, pad([hz(x) for x in ch["pad"]], seg, ("line", ci), cutoff=2800.0), -13.0,
               hall=0.18, duck=True, name="line.pad")
        mx.add("music", tw, sub_note(hz(ch["root"]), seg - 0.01), -9.0, duck=True, name="line.sub")
        for j, tb in enumerate(grid(tw, te, S16)):
            if tb >= gap_start:
                break
            acc = 1.0 if j % 4 == 2 else 0.75
            mx.add("music", tb, bass_pluck(hz(ch["root"]), S16 * 0.8, (ci, j), bright=acc), -12.0, duck=True,
                   name="line.bass")
            f = hz(ch["arp"][ARP_STEPS[j % 8]])
            mx.add("music", tb, pluck(f, (ci, j)), -18.0 if j % 4 else -16.5, pan_=0.45 if j % 2 else -0.45,
                   echo=0.16, hall=0.12, name="line.arp")
        # 단어마다 짧은 스탭 + 이야기에 맞는 작은 효과음
        mx.add("music", tw, stab([hz(ch["low"])] + [hz(x) for x in ch["pad"]], ("w", ci),
                                 attack=0.006 if ci == 0 else 0.002, decay=0.3 if ci == 0 else 0.17),
               -7.5 if ci == 0 else -14.0,
               hall=0.2, echo=0.1, name=f"word_{ci + 1}.stab")

    mx.add("sfx", words[0], sfx_tick(True, "w1"), -12.0, room=0.2, name="word_1.conveyor")    # 이송
    mx.add("sfx", words[1], sfx_shutter(), -13.0, room=0.15, name="word_2.shutter")         # 촬영
    mx.add("sfx", words[2], ui_blip([hz("E6"), hz("A6")]), -17.0, echo=0.2, name="word_3.hmi_blip")  # 판정 + HMI
    mx.add("sfx", words[2], ring_pulse(hz("A4")), -13.0, hall=0.18, name="word_3.ring_pulse")
    w4_hi, _ = sfx_clamp("w4", scale=1.25)
    mx.add("sfx", words[3], w4_hi, -14.5, room=0.2, name="word_4.clack")                   # 분류
    # 질서가 돌아온 컨베이어: 드롭부터 완전히 고른 8분 틱(어긋남 없음)
    for i, tk8 in enumerate(grid(t_drop, gap_start, S8)):
        on = tl.on_beat(tk8)
        mx.add("sfx", tk8, sfx_tick(on, ("line", i % 2)), -21.0 if on else -24.0, pan_=-0.2 if on else 0.2,
               room=0.15, name="line.tick")

    mx.add("sfx", r2.t, riser(gap_start - r2.t, hz("C4"), hz("C6"), "r2", tone_lvl=0.35), -12.0, hall=0.12,
           fin=0.03, fout=0.003, name="riser_2")

    # ── BRAND 14–18: 가장 큰 타격, F(add9), 세 음 소리 로고, 크레딧 블립 ─────────
    low, wide = sfx_impact()
    mx.add("sfx", t_brand, low, -6.0, name="brand_hit.low")
    mx.add("sfx", t_brand, wide, -1.5, hall=0.18, name="brand_hit.wide")
    swl = reverse_swell(wide[0] + wide[1], irs["hall"], 0.9)
    mx.add("sfx", gap_start - swl.shape[1] / SR, swl, -18.0, fin=0.05, fout=0.003, name="riser_2.swell")
    brand_dur = tl.duration - t_brand
    mx.add("music", t_brand, stab([hz(x) for x in ["F2", "C3", "F3", "A3", "C4", "F4"]], "brand", dur=2.2,
                                  decay=0.45, attack=0.008), -5.0, hall=0.3, name="brand.chord_hit")
    mx.add("music", t_brand, pad([hz(x) for x in BRAND_PAD], brand_dur - 0.3, "brand", cutoff=1900.0, a=0.45,
                                 d=1.5, s=0.75, r=0.3, voices=7, detune=12.0), -17.0, hall=0.3, name="brand.pad")
    nb = ns(brand_dur)
    bass = (sine(hz("F1"), nb) + 0.35 * lp(osc_saw(hz("F2"), nb), 260.0)) * env_exp(nb, 0.05, 2.2)
    mx.add("music", t_brand, sat(1.2 * bass), -12.0, fout=0.2, name="brand.bass")
    for i, (tn, note) in enumerate(zip([t_brand, c["title_1"].t, c["title_2"].t], LOGO)):
        last = i == len(LOGO) - 1
        mx.add("music", tn, bell(hz(note), 3.0 if last else 2.0, bright=1.0, decay=1.0 if last else 0.75, key="logo"),
               -9.5 if last else -9.0, echo=0.3, hall=0.3, name=f"logo_{i + 1}")
        mx.add("music", tn, mallet(hz(note) / 2.0), -17.0, hall=0.2, name=f"logo_{i + 1}.mallet")
    mx.add("sfx", c["credits"].t, ui_blip([hz("C6"), hz("F6")], gap=0.07, decay=0.06, tick=0.6, bright=0.35),
           -12.5, echo=0.25, hall=0.2, name="credits")       # 로고 첫 음정(4도 위로)을 한 옥타브 위에서 작게

    # 브랜드 직전 '숨': 'pre' 그룹 전체를 gap_start 에서 12 ms 동안 0 으로
    gate = np.ones(n)
    a, b = ns(gap_start - 0.012), ns(gap_start)
    gate[a:b] = fall(b - a)
    gate[b:] = 0.0
    return gate


# ════════════════════════════════════════════════════════════════════
# 7. 마스터
# ════════════════════════════════════════════════════════════════════

def k_filter(x: np.ndarray) -> np.ndarray:
    """ITU-R BS.1770 K 가중(48 kHz 계수)."""
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=-1), axis=-1)


def lufs_integrated(x: np.ndarray) -> float:
    """BS.1770-4 통합 라우드니스(400 ms 블록, 75% 겹침, 절대 -70 / 상대 -10 LU 게이트)."""
    p = (k_filter(x) ** 2).sum(axis=0)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    nb, nh = ns(0.4), ns(0.1)
    st = np.arange(0, p.size - nb + 1, nh)
    e = (cs[st + nb] - cs[st]) / nb
    l = -0.691 + 10.0 * np.log10(e + 1e-20)
    g = l > -70.0
    if not g.any():
        return -math.inf
    g &= l > -0.691 + 10.0 * np.log10(e[g].mean()) - 10.0
    return float(-0.691 + 10.0 * np.log10(e[g].mean()))


def true_peak_db(x: np.ndarray, os: int = 4) -> float:
    up = signal.resample_poly(x, os, 1, axis=-1)
    return float(20.0 * np.log10(np.max(np.abs(up)) + 1e-20))


def cleanup(x: np.ndarray) -> np.ndarray:
    """선형 정리: 18 Hz 아래(DC 포함) 제거, 120 Hz 아래는 모노(사이드 채널 고역 통과)."""
    x = hp(x, 18.0, 2)
    m, s = 0.5 * (x[0] + x[1]), 0.5 * (x[0] - x[1])
    s = hp(s, 120.0, 4)
    return np.stack([m + s, m - s])


def glue_gain(x: np.ndarray, thr_db: float = -14.0, ratio: float = 1.6, knee_db: float = 6.0,
              attack: float = 0.010, release: float = 0.18, hop: int = 32) -> np.ndarray:
    """버스 글루 컴프레서의 게인 곡선(스테레오 링크 RMS, 사이드체인 90 Hz 고역 통과)."""
    pw = np.mean(hp(x, 90.0) ** 2, axis=0)
    w = ns(0.010)
    cs = np.concatenate([[0.0], np.cumsum(pw)])
    idx = np.arange(0, pw.size, hop)
    rms = (cs[idx + 1] - cs[np.maximum(idx + 1 - w, 0)]) / w
    over = 10.0 * np.log10(rms + 1e-12) - thr_db
    slope = 1.0 - 1.0 / ratio
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, slope * over, slope * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    ca, cr = math.exp(-hop / (SR * attack)), math.exp(-hop / (SR * release))
    sm, s = [], 0.0
    for v in gr.tolist():
        k = ca if v > s else cr
        s = k * s + (1.0 - k) * v
        sm.append(s)
    return np.interp(np.arange(x.shape[1]), idx, dbg(-np.asarray(sm)))


def clip_gain(x: np.ndarray, ceiling_db: float, knee_db: float = 3.0) -> np.ndarray:
    """소프트 클리퍼의 샘플별 게인(스테레오 링크). knee 아래는 1, 위는 tanh 로 ceiling 에 다가간다.
    큰 타격의 첫 몇 ms 피크만 둥글게 눌러, 뒤의 리미터가 오래 게인을 내리지 않게 한다."""
    a = np.abs(x).max(axis=0)
    c = float(dbg(ceiling_db))
    k = c * float(dbg(-knee_db))
    g = np.ones_like(a)
    m = a > k
    g[m] = (k + (c - k) * np.tanh((a[m] - k) / (c - k))) / a[m]
    return g


def limiter_gain(x: np.ndarray, ceiling_db: float, lookahead: float = 0.0015, release: float = 0.05,
                 os: int = 4) -> np.ndarray:
    """트루피크 룩어헤드 리미터의 게인 곡선.
    4배 오버샘플 피크로 필요한 게인을 구하고, 앞을 내다보는 최솟값 → 릴리스 → 이동 평균.
    이동 평균 창 안의 값이 모두 그 샘플에 필요한 게인 이하라서 피크를 넘지 않는다."""
    n = x.shape[1]
    up = np.abs(signal.resample_poly(x, os, 1, axis=-1)).max(axis=0)[: n * os]
    pk = np.maximum(np.pad(up, (0, n * os - up.size)).reshape(n, os).max(axis=1), np.abs(x).max(axis=0))
    need = np.minimum(1.0, float(dbg(ceiling_db)) / np.maximum(pk, 1e-12))
    L = max(1, ns(lookahead))
    fwd = np.lib.stride_tricks.sliding_window_view(np.pad(need, (0, L - 1), constant_values=1.0), L).min(axis=1)
    r = math.exp(-1.0 / (SR * release))
    rel, s = [], 1.0
    for v in fwd.tolist():
        s = min(v, 1.0 - (1.0 - s) * r)
        rel.append(s)
    cs = np.concatenate([np.zeros(1), np.cumsum(np.concatenate([np.ones(L - 1), rel]))])
    return (cs[L:] - cs[:-L]) / L


def fade_gain(n: int, tl: Timeline) -> np.ndarray:
    """fade cue 동안 코사인으로 줄여, 끝 10 ms 는 정확히 0(디지털 무음)."""
    f = tl["fade"]
    g = np.ones(n)
    a, b = ns(f.t), ns(min(f.end, tl.duration) - 0.010)
    g[a:b] = fall(b - a)
    g[b:] = 0.0
    return g


def master(stems: dict, tl: Timeline, target: float, tp: float, log=print):
    """스템(정리는 render 에서) → 합 → (게인 G) → 글루 → 소프트 클립 → 리미터 → 페이드.
    모든 단계가 '게인 곡선'이라 스템에도 똑같이 곱하면 두 스템의 합이 최종 믹스와 같다."""
    pre = stems["music"] + stems["sfx"]
    n = pre.shape[1]
    fade = fade_gain(n, tl)
    G = target - lufs_integrated(pre * fade)
    for it in range(10):
        x = pre * float(dbg(G))
        gc = glue_gain(x)
        gk = clip_gain(x * gc, ceiling_db=tp + 1.2)
        gl = limiter_gain(x * gc * gk, ceiling_db=tp - 0.3)
        gain = float(dbg(G)) * gc * gk * gl * fade
        y = pre * gain
        L, TP = lufs_integrated(y), true_peak_db(y)
        log(f"  master pass {it + 1}: gain {G:+.2f} dB  glue max {-20 * np.log10(gc.min()):.1f} dB  "
            f"clip max {-20 * np.log10(gk.min()):.1f} dB  limiter max {-20 * np.log10(gl.min()):.1f} dB"
            f"  →  {L:.2f} LUFS, {TP:.2f} dBTP")
        if abs(L - target) < 0.03 and TP <= tp - 0.1:
            break
        G += target - L
    return y, {k: v * gain for k, v in stems.items()}, dict(lufs=L, tp=TP, gain_db=G,
                                                            glue_db=-20 * np.log10(gc.min()),
                                                            clip_db=-20 * np.log10(gk.min()),
                                                            lim_db=-20 * np.log10(gl.min()))


# ── WAV 입출력(표준 라이브러리 wave) ──────────────────────────────────

def write_wav(path: Path, x: np.ndarray, bits: int = 16, key="dither") -> None:
    x = np.clip(x, -1.0, 1.0)
    if bits == 16:
        r = RNG(key)
        d = r.random(x.shape) - r.random(x.shape)          # TPDF ±1 LSB
        d[np.abs(x) < 1e-7] = 0.0                           # 디지털 무음(-140 dB 아래)은 그대로 0
        q = np.clip(np.round(x * 32767.0 + d), -32768, 32767).astype("<i2")
        data = q.T.tobytes()
    elif bits == 24:
        q = np.clip(np.round(x * 8388607.0), -8388608, 8388607).astype("<i4")
        data = q.T.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    else:
        raise ValueError("bits must be 16 or 24")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(bits // 8)
        w.setframerate(SR)
        w.writeframes(data)


def read_wav(path: Path):
    with wave.open(str(path), "rb") as w:
        nch, sw, sr, nfr = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(nfr)
    if sw == 2:
        a = np.frombuffer(raw, "<i2").astype(float) / 32768.0
    else:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        i = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        a = np.where(i >= 1 << 23, i - (1 << 24), i) / 8388608.0
    return a.reshape(-1, nch).T, sr, sw * 8


# ════════════════════════════════════════════════════════════════════
# 8. 자체 점검
# ════════════════════════════════════════════════════════════════════

TRANSIENT_CUES = ["open_hit", "freeze", "lock", "crack_open", "clamp", "drop", "word_1", "word_2", "word_3",
                  "word_4", "brand_hit", "title_1", "title_2", "credits"]
SFX_CUES = {"open_hit", "freeze", "lock", "crack_open", "clamp", "word_3", "brand_hit", "credits"}
SWEEP_CUES = ("riser_1", "scan", "push_in", "servo_1", "servo_2", "lift", "riser_2")   # 같은 이름으로 배치한 소리


def _ratio_peak(cs: np.ndarray, lo: int, hi: int, W: int):
    """[lo, hi) 에서 (뒤 W 샘플 에너지 / 앞 W 샘플 에너지) 가 가장 큰 곳."""
    idx = np.arange(max(lo, W), min(hi, cs.size - 1 - W))
    ratio = (cs[idx + W] - cs[idx] + 1e-12) / (cs[idx] - cs[idx - W] + 1e-12)
    j = int(np.argmax(ratio))
    return int(idx[j]), float(10 * np.log10(ratio[j]))


def detect_onset(x: np.ndarray, t: float, search: float = 0.025):
    """cue ±search 안의 온셋: '바로 뒤 에너지 / 바로 앞 에너지' 비가 가장 큰 곳.
    타격의 앞머리는 고역에 있으므로 1 kHz 고역 통과 신호에서 4 ms 창으로 대략 찾고
    (배음 맥놀이에 흔들리지 않게), 그 앞뒤 ±4 ms 에서 0.5·1·1.5 ms 창으로 다시 좁혀 가운데값을 쓴다.
    고역 비가 6 dB 미만으로 흐리면 광대역(8 ms 창)을 쓴다. 돌려주는 값: (샘플 위치, 비 dB)."""
    n0 = ns(t)
    if n0 <= ns(0.005):
        live = np.flatnonzero(np.abs(x[: ns(search)]) > 1e-4)
        return (int(live[0]) if live.size else -1), math.inf
    y = hp(x, 1000.0, 4)
    cs = np.concatenate([[0.0], np.cumsum(y * y)])
    k, r = _ratio_peak(cs, n0 - ns(search), n0 + ns(search), ns(0.004))
    if r < 6.0:
        cb = np.concatenate([[0.0], np.cumsum(x * x)])
        kb, rb = _ratio_peak(cb, n0 - ns(search), n0 + ns(search), ns(0.008))
        if rb > r:
            return kb, rb
    fine = sorted(_ratio_peak(cs, k - ns(0.004), k + ns(0.004), ns(w))[0] for w in (0.0005, 0.001, 0.0015))
    return fine[1], r


def self_check(tl: Timeline, out: Path, events: list[dict], ffmpeg: str | None, log=print) -> bool:
    mix, sr, bits = read_wav(out / "soundtrack.wav")
    mus, _, _ = read_wav(out / "stem_music.wav")
    sfx, _, _ = read_wav(out / "stem_sfx.wav")
    N = ns(tl.duration)
    ok = True

    def check(cond: bool, label: str):
        nonlocal ok
        ok &= bool(cond)
        log(f"  [{'ok' if cond else 'FAIL'}] {label}")

    log("\n── 자체 점검 (써 낸 WAV 를 다시 읽어서) ──")
    check(mix.shape == (2, N) and sr == SR,
          f"길이 {mix.shape[1]} 샘플 = {mix.shape[1] / sr:.4f} s, {sr} Hz, {bits}-bit, 스테레오")
    check(all(np.isfinite(a).all() for a in (mix, mus, sfx)), "NaN/Inf 없음")
    full = 32767 / 32768 if bits == 16 else 8388607 / 8388608
    clips = int((np.abs(mix) >= full).sum())
    check(clips == 0, f"클리핑 샘플 {clips}개, 샘플 피크 {20 * np.log10(np.abs(mix).max()):.2f} dBFS")
    dc = mix.mean(axis=1)
    check(np.abs(dc).max() < 1e-4, f"DC 오프셋 L {dc[0]:+.2e}, R {dc[1]:+.2e}")
    tail = np.abs(mix[:, -ns(0.010):]).max()
    check(tail == 0.0, f"마지막 10 ms 디지털 무음 (최대 {tail:.1e})")
    check(np.abs(mix[:, :ns(0.003)]).max() > 0.05, f"첫 소리가 0.000 s 에 시작 (첫 3 ms 피크 "
                                                     f"{20 * np.log10(np.abs(mix[:, :ns(0.003)]).max() + 1e-12):.1f} dBFS)")
    err = np.abs(mus + sfx - mix).max()
    check(err < 4e-4, f"music + sfx 스템 합 = 최종 믹스 (최대 차이 {err:.1e})")
    L, TP = lufs_integrated(mix), true_peak_db(mix)
    check(abs(L + 14.0) < 0.5 and TP <= -1.0, f"라우드니스 {L:.2f} LUFS(통합), 트루피크 {TP:.2f} dBTP")
    edge = max(e["edge"] for e in events)
    check(edge < 1e-9, f"모든 소리 {len(events)}개의 첫·끝 샘플이 0 (클릭 없음, 최대 {edge:.1e})")

    log("\n  cue 온셋 (최종 믹스에서 측정, 오차 = 측정 − cue)")
    mono = mix[0] + mix[1]
    for cid in TRANSIENT_CUES:
        t = tl[cid].t
        k, strength = detect_onset(mono, t)
        where = "믹스"
        if strength < 6.0:                    # 일부러 작게 둔 소리가 믹스에 묻히면 그 소리의 스템에서 잰다
            stem = sfx if cid in SFX_CUES else mus
            k, strength = detect_onset(stem[0] + stem[1], t)
            where = "스템"
        e_ms = (k - ns(t)) / SR * 1000.0
        check(abs(e_ms) <= 2.0, f"{cid:<11} {t:7.3f} s → {k / SR:8.4f} s  오차 {e_ms:+6.2f} ms  "
                                f"({where}, 온셋 대비 {strength:4.1f} dB)")
    errs = []
    for t in tl["step_ticks"].times():
        k, _ = detect_onset(mono, t, search=0.02)
        errs.append((k - ns(t)) / SR * 1000.0)
    check(max(abs(e) for e in errs) <= 2.0,
          f"step_ticks  {len(errs)}개, 최대 오차 {max(abs(e) for e in errs):.2f} ms (평균 {np.mean(np.abs(errs)):.2f} ms)")

    log("\n  지속형 cue (배치 구간 = cue 구간, 들리는 구간은 -60 dB 기준)")
    for cid in SWEEP_CUES:
        ev = [e for e in events if e["name"] == cid]
        if not ev:
            continue
        e, cu = ev[0], tl[cid]
        check(e["i0"] == ns(cu.t) and e["i1"] <= ns(cu.end),
              f"{cid:<9} cue {cu.t:.3f}–{cu.end:.3f} s → 배치 {e['i0'] / SR:.4f}–{e['i1'] / SR:.4f} s, "
              f"들림 {e['first'] / SR:.3f}–{(e['last'] + 1) / SR:.3f} s")

    log("\n  강세 세기 (cue 부터 400 ms / 150 ms K 가중 라우드니스)")
    p = (k_filter(mix) ** 2).sum(axis=0)

    def loud(t, d):
        a, b = ns(t), ns(t + d)
        return -0.691 + 10 * np.log10(p[a:b].mean() + 1e-20)

    acc = {cid: (loud(tl[cid].t, 0.4), loud(tl[cid].t, 0.15)) for cid in
           ["open_hit", "freeze", "lock", "crack_open", "clamp", "drop", "brand_hit"]}
    for cid, (a4, a1) in acc.items():
        log(f"         {cid:<11} {a4:6.1f} LUFS(400ms)  {a1:6.1f} LUFS(150ms)")
    for j in (0, 1):
        o = [acc[c][j] for c in ["lock", "crack_open", "clamp"]]
        check(max(acc["open_hit"][j], acc["freeze"][j]) < o[0] < o[1] < o[2] < min(acc["drop"][j], acc["brand_hit"][j]),
              f"순서 ({'400' if j == 0 else '150'} ms): open_hit·freeze < lock < crack_open < clamp < drop·brand_hit")
    # drop·brand_hit 가 전체에서 가장 큰 두 순간인지: 10 ms 간격으로 민 모든 창 가운데
    # 서로 겹치지 않는(0.3 s 이상 떨어진) 큰 순간 셋을 뽑아 본다
    cs = np.concatenate([[0.0], np.cumsum(p)])
    for d in (0.4, 0.15):
        nb = ns(d)
        st = np.arange(0, p.size - nb, ns(0.01))
        mom = -0.691 + 10 * np.log10((cs[st + nb] - cs[st]) / nb + 1e-20)
        top = []
        for j in np.argsort(mom)[::-1]:
            if all(abs(st[j] / SR - q) > 0.3 for q, _ in top):
                top.append((st[j] / SR, mom[j]))
            if len(top) == 3:
                break
        hits = sorted(tl[cid].t for cid in ("drop", "brand_hit"))
        check(sorted(round(q, 1) for q, _ in top[:2]) == [round(h, 1) for h in hits],
              f"가장 큰 두 순간 ({d * 1000:.0f} ms): " + ", ".join(f"{q:.2f} s {v:.1f}" for q, v in top[:2])
              + f"  (다음 {top[2][0]:.2f} s {top[2][1]:.1f}, 차이 {top[1][1] - top[2][1]:.1f} dB)")

    log("\n  구간별 라우드니스 (K 가중, 게이트 없음)")
    for sid, (a, b) in tl.sections.items():
        log(f"         {sid:<6} {a:5.1f}–{b:5.1f} s   믹스 {loud(a, b - a):6.1f}   "
            f"음악 {lufs_span(mus, a, b):6.1f}   효과음 {lufs_span(sfx, a, b):6.1f}  LUFS")

    if ffmpeg:
        log("\n  ffmpeg ebur128:")
        try:
            res = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-i", str(out / "soundtrack.wav"),
                                  "-af", "ebur128=peak=true", "-f", "null", "-"],
                                 capture_output=True, text=True, encoding="utf-8", errors="replace")
            summary = res.stderr[res.stderr.rfind("Summary:"):]
            for line in summary.splitlines():
                if line.strip():
                    log("    " + line.strip())
        except OSError as e:
            log(f"    (ffmpeg 실행 실패: {e})")
    log(f"\n  결과: {'모두 통과' if ok else '확인 필요 항목 있음'}")
    return ok


def lufs_span(x: np.ndarray, a: float, b: float) -> float:
    p = (k_filter(x[:, ns(a):ns(b)]) ** 2).sum(axis=0)
    return float(-0.691 + 10 * np.log10(p.mean() + 1e-20))


# ════════════════════════════════════════════════════════════════════
# main
# ════════════════════════════════════════════════════════════════════

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="18초 홍보 영상 사운드트랙(음악+효과음) 합성")
    ap.add_argument("--timeline", type=Path, default=HERE / "timeline.json", help="timeline.json 경로")
    ap.add_argument("--out", type=Path, default=PROMO / "out" / HERE.name, help="WAV 를 쓸 폴더")
    ap.add_argument("--bits", type=int, choices=(16, 24), default=16, help="비트 깊이 (기본 16, TPDF 디더)")
    ap.add_argument("--lufs", type=float, default=-14.0, help="통합 라우드니스 목표 (기본 -14)")
    ap.add_argument("--tp", type=float, default=-1.0, help="트루피크 상한 dBTP (기본 -1.0)")
    ap.add_argument("--ffmpeg", type=str, default=None, help="있으면 ffmpeg ebur128 로도 측정")
    ap.add_argument("--no-check", action="store_true", help="자체 점검 생략")
    args = ap.parse_args(argv)

    t_start = time.time()
    tl = Timeline(args.timeline)
    n = ns(tl.duration)
    print(f"timeline: {args.timeline}  ({tl.bpm:g} BPM, 박 {tl.beat:.3f} s, {tl.duration:g} s = {n} 샘플)")

    irs = {"hall": make_ir(3.2, (2.2, 1.9, 0.9), 0.022, "hall"),
           "room": make_ir(0.9, (0.5, 0.45, 0.25), 0.006, "room", early=14)}
    mx = Mixer(n, tl["brand_hit"].t)
    gate = arrange(tl, mx, irs)
    print(f"  배치한 소리 {len(mx.events)}개, 합성 {time.time() - t_start:.1f} s")
    stems = mx.render(irs, echo_delay=0.75 * tl.beat, gate_pre=gate)   # 에코 = 점8분음표
    mix, stems, info = master(stems, tl, args.lufs, args.tp)

    args.out.mkdir(parents=True, exist_ok=True)
    write_wav(args.out / "soundtrack.wav", mix, args.bits, "d_mix")
    write_wav(args.out / "stem_music.wav", stems["music"], args.bits, "d_music")
    write_wav(args.out / "stem_sfx.wav", stems["sfx"], args.bits, "d_sfx")
    print(f"  썼음: {args.out / 'soundtrack.wav'} (+ stem_music.wav, stem_sfx.wav)  {time.time() - t_start:.1f} s")

    if args.no_check:
        return 0
    return 0 if self_check(tl, args.out, mx.events, args.ffmpeg) else 1


if __name__ == "__main__":
    sys.exit(main())
