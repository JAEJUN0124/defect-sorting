#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
불량을 찾는 눈, 골라내는 손 — 16초 홍보 영상 v2 사운드트랙 생성기
==================================================================

v2 는 화면 가운데의 큰 낱장 판정판(공항 출발 안내판 같은 split-flap)이 주인공이다. 소리도 그 판에 맞춰
빈틈없고 기계적인 미니멀 인더스트리얼 테크노로 만든다. 낱장이 멈춤판에 부딪히는 '딱' 소리가 이 곡의 하이햇이다.

음악과 효과음은 numpy·scipy 합성만으로 만든다. 샘플·외부 음원·AI 음악 서비스는 쓰지 않고, 난수는 이름으로
고정한 시드를 쓴다(몇 번을 돌려도 같은 파일). v1(promo/v1/music.py)은 불러오지 않는다(쓸 DSP 는 옮겨 왔다).

모든 시각은 같은 폴더의 timeline.json 에서 읽는다: bpm, sections, cues(t/until/every), lands, flips.
flips 는 낱장 하나하나가 멈춤판에 닿는 때이고, t < 0(영상 시작 전) 인 것은 버린다.
timeline.mjs 를 고쳐 timeline.json 을 다시 만든 뒤 이 파일을 다시 돌리면 소리도 새 시간표를 따른다.
코드 안에 시각을 따로 적어 두지 않았다(음표 길이는 bpm 에서 나온다).

출력 (기본 promo/out/v2/)
  soundtrack.wav   최종 믹스 — 48 kHz 스테레오, 정확히 duration(16.0 s = 768000 샘플), 16비트(TPDF 디더) 또는 24비트
  stem_music.wav   음악 스템
  stem_sfx.wav     효과음 스템 (낱장 소리 포함)
  두 스템에는 마스터의 게인 변화(글루 컴프·소프트 클립·리미터·페이드)를 똑같이 곱했으므로
  stem_music + stem_sfx = soundtrack (반올림·디더 오차 안). 비율을 바꿔 다시 섞을 수 있다.

사용
  python promo/v2/music.py
  python promo/v2/music.py --out promo/out/v2 --bits 24 --lufs -14 --tp -1.0
  python promo/v2/music.py --ffmpeg PATH/TO/ffmpeg.exe     # ffmpeg ebur128 로도 측정 (환경 변수 FFMPEG 도 된다)
  python promo/v2/music.py --no-check                       # 자체 점검 생략

구성
  1. 시간표       timeline.json 읽기, 낱장의 칸(왼→오) 짐작
  2. DSP 기본     오실레이터(PolyBLEP + 2배 오버샘플), 필터(시변 SVF), 엔벌로프, 팬
  3. 공간         노이즈 IR 컨볼루션 잔향, 점8분 핑퐁 에코, 킥 사이드체인
  4. 악기·효과음  낱장 / 리듬 / 신호음 / 기계 / 큰 순간 / 화성 (함수 하나가 소리 하나)
  5. 믹서         스템별 버스와 센드, 타격 직전 '숨' 게이트, 점검용 낱장 버스
  6. 편곡         JSON 의 시각으로 모든 소리를 배치
  7. 마스터       DC 제거·120 Hz 아래 모노·글루 컴프·소프트 클립·트루피크 리미터·라우드니스 맞춤·페이드
  8. 자체 점검    길이, NaN, 클리핑, DC, 끝 무음, 숨, 스템 합, LUFS/TP, cue 온셋 오차, 낱장 온셋, 강세 순서

소리 설계 (중심음 A, 120 BPM, 한 박 0.5 s)
  낱장    flip 마다 합성한 '딱': 0.3 ms 노이즈 타격 + 얇은 판의 비조화 모드 + 회전축 '톡' (15–40 ms).
          낱장마다 결·세기·되튐이 조금씩 다르고, last(제 글자에 닿는 장)는 더 크고 낮고 길다. 칸마다 왼→오 자리.
  hook    첫 프레임 킥 + 계전기 '철컥'. 땅(lands)마다 단단한 킥 + 셔터, 엇박 하이햇·A1 베이스,
          양품마다 A5→C#6(오르는 장3도) 확인음. 불량: 같은 몸짓이 A5→E♭6(삼전음, 디튠 겹음)으로 어긋나고
          A·B♭·E♭ 클러스터 + 낮은 타격이 8분음표쯤 울리다 손으로 잡듯 끊긴다. 정적에는 A1·B♭1 맥놀이 드론, 공기,
          잔향만 남는다.
  see     초점 '위잉'(올라갔다 살짝 되돌아옴), 공진 스윕(왼→오), 잠금 '틱' + E6 '핍'.
          밑에서 필터가 닫힌 A1 8분 펄스와 8분 틱이 시작되고, 마디 첫 박마다 먹먹한 '둥'.
  judge   32분 데이터 블립이 A 단조 5음 음계로 지그재그로 두 옥타브 오름(왼→오), 내려오는 블립 + 강세 +
          노란 판정의 삼전음 핑. 틱이 16분으로 촘촘해진다.
  pick    신호 '비-빅', 서보 휘파람, 집게 '찰칵' + 서브, 휙, 둔탁한 '쿵'(두 번 튐).
          펄스는 필터가 열리고 커지며 B♭ 이 스며든다(긴장). 쿵 뒤 그루브까지는 낱장과 빨려 드는 스웰뿐.
  restore 드롭: 킥 매 박, 엇박 하이햇, 짧은 베이스 리프(A1·A2·G1·E2), 금속판 '쾅' + 공기,
          사이드체인으로 숨쉬는 A sus2 패드. 박마다 양품 확인음과 낱장 '드르륵'이 고른 격자에 맞물린다.
  hmi     UI 블립, 화면 속으로 줄어드는 '휘익', 16분 닫힌 하이햇 추가.
          라이저 구간에는 킥이 빠지고 라이저 + 32분 틱 롤, 타격 직전 32분음표(62.5 ms) 만큼 완전한 정적.
  end     가장 큰 타격(F1 로 내려앉는 서브 붐 + 펀치 + 20 ms 에 피어나는 넓은 공기·강판) 과 F 장조(♭VI) 화음,
          그 밑 F 패드 위로 낱장 폭포. F 의 소리는 제목 cue 에서 모두 끝나고, 제목에 A(add9) 화음(♭VI → I)
          + 끝 모티프 A5–E6–C#6 (16분 간격, 마지막 음이 길게, 점8분 핑퐁 에코).
          모티프는 양품 확인음 A5→C#6 사이에 5음을 끼운 아치다: 끝에서 '양품'이 완성된다.
          크레딧 블립(A6, 작게), 페이드, 마지막 10 ms 는 정확히 0.
  믹스    레벨은 편곡의 LV 표 한곳에 모았다. 그루브에서 킥 기준 베이스 약 −5, 하이햇·낱장 약 −11, 패드는
          −11 에서 타격 쪽으로 −7 까지 차오른다(소리별 K 가중 라우드니스, LU).
  강세    hit > groove > verdict_ng ≈ clamp > 나머지. 자체 점검이 K 가중 라우드니스(150·400 ms 창)로 잰다.
"""

from __future__ import annotations

import argparse
import json
import math
import os
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
    """[t0, t1) 를 step 간격으로 나눈 시각들 (t1 은 빠진다)."""
    k = int(math.ceil((t1 - t0) / step - 1e-9))
    return [t0 + i * step for i in range(max(k, 0))]


class Cue:
    """cue 하나. t = 시작, until = 끝(없으면 t), every = 반복 간격(있으면 t 부터 until 까지, until 포함)."""

    def __init__(self, d: dict):
        self.id = str(d["id"])
        self.t = float(d["t"])
        self.until = float(d["until"]) if d.get("until") is not None else None
        self.every = float(d["every"]) if d.get("every") else None

    @property
    def end(self) -> float:
        return self.until if self.until is not None else self.t

    @property
    def dur(self) -> float:
        return self.end - self.t

    def times(self) -> list[float]:
        if self.every is None:
            return [self.t]
        k = int(math.floor((self.end - self.t) / self.every + 1e-9))
        return [self.t + i * self.every for i in range(k + 1)]


class Flip:
    """낱장 하나가 멈춤판에 닿는 때. last = 그 칸의 마지막 장(제 글자), tone = 'ok'/'ng'/None, final = 끝 판."""

    def __init__(self, i: int, d: dict):
        self.i = i
        self.t = float(d["t"])
        self.last = bool(d.get("last"))
        self.tone = d.get("tone")
        self.final = bool(d.get("final"))
        self.cell = -1          # 무리 안에서 짐작한 칸(왼쪽부터 0). 모르면 -1
        self.pan = 0.0


class Timeline:
    def __init__(self, path: Path):
        self.path = Path(path)
        d = json.loads(self.path.read_text(encoding="utf-8"))
        self.fps = int(d.get("fps", 30))
        self.bpm = float(d["bpm"])
        self.beat = 60.0 / self.bpm
        self.duration = float(d["duration"])
        self.sections = {s["id"]: (float(s["start"]), float(s["end"])) for s in d["sections"]}
        self.cue_list = [Cue(c) for c in d["cues"]]
        self.lands = sorted(float(x) for x in d.get("lands", []))
        raw = d.get("flips", [])
        keep = sorted((f for f in raw if float(f["t"]) >= 0.0), key=lambda f: float(f["t"]))
        self.flips = [Flip(i, f) for i, f in enumerate(keep)]
        self.n_dropped = len(raw) - len(keep)                 # 영상 시작 전(t < 0) 낱장은 버린다
        self.flip_period = assign_flip_cells(self.flips)

    def cue(self, cid: str) -> Cue:
        for c in self.cue_list:
            if c.id == cid:
                return c
        raise KeyError(f"timeline.json 에 cue '{cid}' 가 없다")

    def times(self, cid: str) -> list[float]:
        """같은 id 의 cue 가 여럿이어도(verdict_ok 처럼) 모든 시각을 모은다."""
        ts = sorted(t for c in self.cue_list if c.id == cid for t in c.times())
        if not ts:
            raise KeyError(f"timeline.json 에 cue '{cid}' 가 없다")
        return ts

    def isolation(self, f: Flip) -> float:
        """이 낱장과 가장 가까운 다른 낱장 사이(초)."""
        gaps = [abs(self.flips[j].t - f.t) for j in (f.i - 1, f.i + 1) if 0 <= j < len(self.flips)]
        return min(gaps) if gaps else math.inf


def flip_bursts(flips: list[Flip], gap: float = 0.15) -> list[list[Flip]]:
    """낱장을 '글 한 번 바뀜' 무리로 묶는다(앞 낱장과 gap 초 넘게 떨어지면 새 무리)."""
    out: list[list[Flip]] = []
    for f in flips:
        if not out or f.t - out[-1][-1].t > gap:
            out.append([])
        out[-1].append(f)
    return out


def assign_flip_cells(flips: list[Flip], width: float = 0.35) -> float | None:
    """낱장마다 칸 자리(왼 -width … 오 +width)를 준다. JSON 에 칸 번호가 없어서 시각에서 짐작한다.
      · 한 무리 안에서 last 들은 칸 순서(왼→오)대로 조금씩 늦게 내려앉는다.
      · 같은 칸의 앞 낱장들은 그 칸의 last 보다 '한 장 넘어가는 시간 P' 의 정수배만큼 앞선다.
      · P 는 모든 무리에서 (last − 앞 낱장) 차이(1 ms 단위)의 최빈값으로 찾는다.
    짝을 못 찾은 낱장은 무리 안의 고정 난수 자리. 돌려주는 값은 찾은 P(초), 못 찾으면 None."""
    bursts = flip_bursts(flips)
    diffs = []
    for b in bursts:
        lasts = [f for f in b if f.last]
        for f in b:
            if not f.last:
                diffs += [int(round((L.t - f.t) * 1000.0)) for L in lasts if L.t > f.t]
    period = None
    if diffs:
        vals, cnt = np.unique(diffs, return_counts=True)
        if cnt.max() >= 3:
            period = float(vals[int(np.argmax(cnt))]) / 1000.0
    for b in bursts:
        lasts = [f for f in b if f.last]
        m = len(lasts)
        for c, f in enumerate(lasts):
            f.cell = c
            f.pan = 0.0 if m == 1 else -width + 2.0 * width * c / (m - 1)
        for f in b:
            if f.last:
                continue
            best = None
            if period:
                for L in lasts:
                    if L.t <= f.t:
                        continue
                    q = (L.t - f.t) / period
                    err = abs(q - round(q)) * period
                    if round(q) >= 1 and err < 0.0015 and (best is None or err < best[0]):
                        best = (err, L)
            if best is not None:
                f.cell, f.pan = best[1].cell, best[1].pan
            else:
                f.pan = float(RNG("flip_pan", f.i).uniform(-width, width))
    return period


# ════════════════════════════════════════════════════════════════════
# 2. DSP 기본
# ════════════════════════════════════════════════════════════════════

def ns(t: float) -> int:
    """초 → 샘플 수. 모든 배치가 이 함수 하나를 거치므로 cue 는 샘플 단위(±0.01 ms)로 정확하다."""
    return int(round(t * SR))


def dbg(db) -> float | np.ndarray:
    return 10.0 ** (np.asarray(db, dtype=float) / 20.0)


def tt(n: int) -> np.ndarray:
    return np.arange(n) / SR


def RNG(*key) -> np.random.Generator:
    """이름으로 고정한 난수 — 호출 순서가 바뀌어도 소리는 그대로."""
    return np.random.default_rng(zlib.crc32(repr(("v2",) + key).encode("utf-8")))


_PITCH = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def hz(name: str) -> float:
    """'A4' → 440.0. 'Bb1', 'C#6' 도 된다(평균율, A4 = 440 Hz)."""
    k, i = _PITCH[name[0].upper()], 1
    while i < len(name) and name[i] in "#b":
        k += 1 if name[i] == "#" else -1
        i += 1
    midi = 12 * (int(name[i:]) + 1) + k
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def norm(x: np.ndarray, peak: float = 1.0) -> np.ndarray:
    m = float(np.max(np.abs(x))) if np.size(x) else 0.0
    return x * (peak / m) if m > 0 else x


def rise(n: int) -> np.ndarray:
    """0 → 1 레이즈드 코사인 (첫 샘플이 정확히 0)."""
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / n) if n > 0 else np.zeros(0)


def fall(n: int) -> np.ndarray:
    """1 → 0 (마지막 샘플이 정확히 0)."""
    return rise(n)[::-1]


def edges(x: np.ndarray, a: float = 0.0002, r: float = 0.004) -> np.ndarray:
    """앞뒤 끝을 0 으로 이어 준다 — 믹서에 들어가는 모든 소리가 거치는 클릭 방지."""
    n = x.shape[-1]
    na, nr = min(n, max(2, ns(a))), min(n, max(2, ns(r)))
    x = np.array(x, dtype=float, copy=True)
    x[..., :na] *= rise(na)
    x[..., n - nr:] *= fall(nr)
    return x


def win_tail(n: int, frac: float = 0.3) -> np.ndarray:
    """끝 frac 구간을 코사인으로 0 까지 — 감쇠음이 버퍼 끝에서 잘리지 않게."""
    w = np.ones(n)
    m = min(n, max(2, int(n * frac)))
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


def smoothstep(u) -> np.ndarray:
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


def choke(n: int, hold: float, length: float = 0.06) -> np.ndarray:
    """hold 초 동안 1, 그 뒤 length 초에 걸쳐 코사인으로 0 — 울림을 손으로 잡아 끊듯이(이후는 정확히 0)."""
    g = np.zeros(n)
    a, m = min(n, ns(hold)), max(2, ns(length))
    b = min(n, a + m)
    g[:a] = 1.0
    g[a:b] = fall(m)[: b - a]
    return g


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
    """PolyBLEP 보정 — 불연속점 앞뒤 한 샘플씩을 매끈하게(대역 제한 근사)."""
    y = np.zeros_like(ph)
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] = x + x - x * x - 1.0
    m = ph > 1.0 - dt
    x = (ph[m] - 1.0) / dt[m]
    y[m] = x * x + x + x + 1.0
    return y


def _oversampled(gen, f, n: int, os_: int, ph0: float) -> np.ndarray:
    f = np.broadcast_to(np.asarray(f, dtype=float), (n,))
    if os_ <= 1:
        ph, dt = _phase(f, n, SR, ph0)
        return gen(ph, dt)
    ph, dt = _phase(np.repeat(f, os_), n * os_, SR * os_, ph0)
    return signal.resample_poly(gen(ph, dt), 1, os_)[:n]       # FIR 앤티앨리어싱 뒤 1/os


def osc_saw(f, n: int, ph0: float = 0.0, os: int = 2) -> np.ndarray:
    """대역 제한 톱니파: PolyBLEP + 오버샘플(기본 2배)."""
    return _oversampled(lambda ph, dt: 2.0 * ph - 1.0 - _blep(ph, dt), f, n, os, ph0)


def osc_pulse(f, n: int, width: float = 0.5, ph0: float = 0.0, os: int = 2) -> np.ndarray:
    """대역 제한 펄스파(DC 제거). width = 듀티비."""
    def gen(ph, dt):
        y = np.where(ph < width, 1.0, -1.0) + _blep(ph, dt) - _blep((ph - width) % 1.0, dt)
        return y - (2.0 * width - 1.0)
    return _oversampled(gen, f, n, os, ph0)


def sine(f, n: int, ph0: float = 0.0) -> np.ndarray:
    ph, _ = _phase(f, n, SR, ph0)
    return np.sin(TAU * ph)


def modes(n: int, freqs, decays, amps, r: np.random.Generator | None = None,
          drop: float = 0.0, drop_tau: float = 0.015) -> np.ndarray:
    """모달 합성: 감쇠하는 사인들의 합(판·금속의 울림). r 이 없으면 모두 위상 0 에서 시작(계단 없음).
    drop = 타격 순간 살짝 높았다가 내려앉는 음정."""
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
    """차단 주파수가 시간에 따라 바뀌는 TPT 상태변수 필터(Zavalishin/Simper). 'bp' 는 공진 피크가 0 dB."""
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
    """타격음의 뾰족한 첫 피크만 부드럽게 눌러(knee 아래는 그대로) 몸통은 살린다 — 리미터가 덜 일하게."""
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
    """감쇠 노이즈로 만든 스테레오 잔향 IR. rt = 저·중·고역 RT60(초) — 고역일수록 빨리 사라진다."""
    n, pre = ns(seconds), ns(predelay)
    t = tt(n)
    r = RNG("ir", key)
    ir = np.zeros((2, pre + n))
    for ch in range(2):
        w = r.standard_normal(n)
        lo, hi = lp(w, 400.0), hp(w, 3500.0)
        mid = w - lo - hi
        k = 6.9078                                       # ln(1000): RT60 = 60 dB 감쇠
        tail = lo * np.exp(-k * t / rt[0]) + mid * np.exp(-k * t / rt[1]) + hi * np.exp(-k * t / rt[2])
        tail *= 1.0 - np.exp(-t / 0.012)                 # 밀도가 차오르는 앞부분
        for _ in range(early):                           # 초기 반사
            d = r.uniform(0.003, 0.05)
            tail[ns(d)] += r.choice([-1.0, 1.0]) * r.uniform(4.0, 10.0) * (1.0 - d / 0.08)
        tail = lp(hp(tail, hp_hz), lp_hz) * win_tail(n, 0.15)
        ir[ch, pre:] = tail
    return ir / np.sqrt(np.sum(ir ** 2) / 2.0)          # 채널당 에너지 1


def reverb(x: np.ndarray, ir: np.ndarray, cross: float = 0.12) -> np.ndarray:
    n = x.shape[-1]
    a = (1.0 - cross) * x[0] + cross * x[1]
    b = (1.0 - cross) * x[1] + cross * x[0]
    return np.stack([signal.oaconvolve(a, ir[0])[:n], signal.oaconvolve(b, ir[1])[:n]])


def pingpong(x: np.ndarray, delay: float, fb: float = 0.4, repeats: int = 7,
             lp_hz: float = 5500.0, hp_hz: float = 350.0, spread: float = 0.85) -> np.ndarray:
    """템포 동기 핑퐁 에코: 왼·오른쪽을 번갈아 돌아오며 돌아올 때마다 조금씩 어두워진다."""
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
# 4-a. 악기: 낱장 판 (split-flap) — 이 곡의 하이햇
# ════════════════════════════════════════════════════════════════════

FLAP_MODES = (1150.0, 2240.0, 3560.0, 5150.0, 7300.0)    # 얇은 판의 굽힘 모드(비조화, Hz)
FLAP_DECAY = (0.0085, 0.0060, 0.0042, 0.0030, 0.0021)   # 모드별 감쇠 시정수(초)
FLAP_AMP = (0.55, 1.0, 0.75, 0.5, 0.3)


def flap_clack(last: bool, tone, key) -> np.ndarray:
    """낱장 하나가 멈춤판에 부딪히는 '딱'(들리는 길이 15–40 ms).
    0.3 ms 노이즈 타격 + 얇은 판의 비조화 굽힘 모드(위상 0 에서 시작) + 회전축·멈춤판의 낮은 '톡'.
    낱장마다 결(±5 %)·모드·세기(±1 dB)·되튐이 조금씩 다르다.
    last(제 글자에 닿는 마지막 장)는 더 크고(+3 dB), 낮고(−18 %), 길고(×1.45), 늘 한 번(2.5–6 ms 뒤) 작게 튀었다 앉는다.
    판정 글자에 닿을 때는 아주 살짝 밝거나(ok) 어둡다(ng)."""
    r = RNG("flap", key)
    n = ns(0.045)
    t = tt(n)
    j = 2.0 ** (0.05 * r.standard_normal())
    low = 0.82 if last else 1.0
    if last and tone == "ok":
        low *= 1.05
    elif last and tone == "ng":
        low *= 0.93
    longer = 1.45 if last else 1.0
    exc = hp(r.standard_normal(n), 1200.0) * np.exp(-t / 0.0003)                # 타격: 0.3 ms 노이즈
    fr = [f * j * low * (1.0 + 0.03 * r.standard_normal()) for f in FLAP_MODES]
    dec = [d * longer * (1.0 + 0.1 * r.standard_normal()) for d in FLAP_DECAY]
    amp = [a * max(0.3, 1.0 + 0.25 * r.standard_normal()) for a in FLAP_AMP]
    plate = modes(n, fr, dec, amp)                                              # 판 울림
    fb = (360.0 if last else 520.0) * j
    body = sine(fb * (1.0 + 0.3 * np.exp(-t / 0.0015)), n) * env_exp(n, 0.0002, 0.007 if last else 0.0035)
    strike = 0.85 * norm(exc) + 0.6 * norm(plate)
    x = strike + (0.7 if last else 0.32) * norm(body)
    if last or r.random() < 0.3:                                                # 되튐: 2.5–6 ms 뒤 작은 '딱'
        d = ns(r.uniform(0.0025, 0.006))
        x[d:] += (0.30 if last else 0.18) * strike[: n - d]
    g = float(dbg(1.0 * r.standard_normal())) * (1.0 if last else 0.72)
    return norm(x) * g * win_tail(n, 0.55)


# ════════════════════════════════════════════════════════════════════
# 4-b. 악기: 리듬
# ════════════════════════════════════════════════════════════════════

def kick(vel: float = 1.0, k=0, punch: float = 175.0, tail: float | None = None, decay: float = 0.10,
         click: float = 0.18) -> np.ndarray:
    """미니멀 테크노 킥: 175 Hz → A1(55 Hz) 로 떨어지는 사인 + 비터 클릭 + 짧은 노크, 살짝 새츄레이션.
    몸통이 짧아(시정수 0.1 s) 단단하고 기계적이다."""
    tail = hz("A1") if tail is None else tail
    r = RNG("kick", k)
    n = ns(0.45)
    t = tt(n)
    f = tail + (punch - tail) * np.exp(-t / 0.017)
    body = sine(f, n) * env_exp(n, 0.0003, decay, hold=0.018)
    clk = hp(r.standard_normal(n), 3500.0) * np.exp(-t / 0.0006)
    knock = sine(1250.0, n) * np.exp(-t / 0.0028)
    x = sat(1.7 * (body + click * norm(clk) + 0.07 * knock))
    return norm(x) * vel * win_tail(n, 0.3)


_HAT_F = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)      # 금속성 사각파 묶음(비조화)


def hat(vel: float = 1.0, k=0, decay: float = 0.03) -> np.ndarray:
    """하이햇: 비조화 사각파 묶음 + 고역 노이즈. decay 로 닫힘(0.012)·반쯤 열림(0.045)을 정한다."""
    r = RNG("hat", k, round(decay, 4))
    n = ns(max(0.08, 6.0 * decay))
    t = tt(n)
    metal = sum(osc_pulse(f * 1.7, n, 0.5, r.random()) for f in _HAT_F)
    metal = hp(bp(metal, 6500.0, 15000.0), 7000.0)
    nz = hp(r.standard_normal(n), 8000.0)
    x = (0.6 * norm(metal) + 0.5 * norm(nz)) * env_exp(n, 0.0003, decay)
    return norm(x) * vel * win_tail(n, 0.3)


def tick(accent: bool, k) -> np.ndarray:
    """정밀한 '틱'(엔코더·스테퍼 같은 기계 박자). accent = 박 위 — 조금 낮고 크다."""
    r = RNG("tick", k)
    n = ns(0.04)
    t = tt(n)
    f0 = (3100.0 if accent else 4300.0) * (1.0 + 0.01 * r.standard_normal())
    ring = modes(n, [f0, f0 * 1.52, f0 * 2.13], [0.006, 0.004, 0.0025], [1.0, 0.5, 0.3])
    clk = hp(r.standard_normal(n), 3000.0) * np.exp(-t / 0.0004)
    return norm(0.6 * norm(clk) + 0.5 * norm(ring)) * (1.0 if accent else 0.7) * win_tail(n, 0.4)


def soft_thump(k=0) -> np.ndarray:
    """펄스 구간 마디 첫 박의 먹먹한 '둥'(닫힌 킥) — 아직 그루브가 아니라 기계의 심장 박동."""
    n = ns(0.4)
    t = tt(n)
    x = sine(hz("A1") + 60.0 * np.exp(-t / 0.02), n) * env_exp(n, 0.002, 0.11)
    x = x + 0.04 * lp(RNG("thump", k).standard_normal(n), 600.0) * np.exp(-t / 0.01)
    return norm(lp(sat(1.4 * x), 420.0)) * win_tail(n, 0.3)


def bass_note(f: float, gate: float, key, cutoff: float = 1400.0, env_amt: float = 1.0, q: float = 1.5,
              sub: float = 0.9, drive: float = 1.6) -> np.ndarray:
    """짧은 베이스 한 음: 서브 사인 + 톱니·펄스를 공진 저역 통과(필터 엔벌로프)로, tanh 로 살짝 거칠게.
    120 Hz 아래는 마스터에서 모노가 된다."""
    r = RNG("bass", key)
    n = ns(gate + 0.03)
    t = tt(n)
    raw = osc_saw(f, n, r.random()) + 0.4 * osc_pulse(f * 1.004, n, 0.35, r.random())
    fc = 70.0 + cutoff * (0.22 + env_amt * np.exp(-t / 0.035))
    mid = norm(svf(raw, fc, q, "lp"))
    body = sub * sine(f, n, r.random()) + 0.6 * mid
    x = body * env_adsr(n, gate, 0.002, 0.06, 0.6, 0.025)
    return sat(drive * x) / drive


# ════════════════════════════════════════════════════════════════════
# 4-c. 악기: 신호음 (판정·데이터·UI)
# ════════════════════════════════════════════════════════════════════

def chime(f: float, decay: float = 0.12, dur: float = 0.6, bright: float = 1.0, key="chime",
          cents: float = 0.0) -> np.ndarray:
    """맑고 밝은 확인음 한 음: 사인 + 2·3배음 + 아주 짧은 FM '핑'(1:3.5) + 말렛 '틱'. 판정·모티프가 같이 쓴다."""
    r = RNG(key, round(f, 3), cents)
    n = ns(dur)
    t = tt(n)
    f = f * 2.0 ** (cents / 1200.0)
    base = (np.sin(TAU * f * t)
            + 0.22 * np.sin(TAU * 2.0 * f * t + 0.3) * np.exp(-t / (0.6 * decay))
            + 0.07 * np.sin(TAU * 3.0 * f * t + 1.1) * np.exp(-t / (0.35 * decay)))
    ping = np.sin(TAU * f * t + 1.3 * np.exp(-t / 0.012) * np.sin(TAU * 3.5 * f * t)) * np.exp(-t / 0.02)
    tick_ = hp(r.standard_normal(n), 5000.0) * np.exp(-t / 0.0004)
    y = (base + 0.35 * bright * ping) * env_exp(n, 0.0008, decay) + 0.10 * bright * norm(tick_)
    return norm(y) * win_tail(n, 0.3)


def felt(f: float, dur: float = 2.0, decay: float = 0.8, key="felt") -> np.ndarray:
    """부드러운 펠트 건반 같은 음: FM(1:1, 빠르게 줄어드는 인덱스) + 약한 2배음 — 화음·모티프의 아래 받침."""
    n = ns(dur)
    t = tt(n)
    idx = 1.1 * np.exp(-t / 0.12) + 0.08
    x = np.sin(TAU * f * t + idx * np.sin(TAU * f * t)) * env_exp(n, 0.002, decay)
    x = x + 0.15 * np.sin(TAU * 2.0 * f * t + 0.7) * env_exp(n, 0.002, 0.4 * decay)
    return norm(x) * win_tail(n, 0.3)


PENTA = (0, 3, 5, 7, 10, 12)           # A 단조 5음 음계(반음)


def data_pitches(count: int, base: float, span: float = 24.0) -> list[float]:
    """위로 올라가는 데이터: 전체로는 span 반음(두 옥타브)을 오르고, 한 음 건너 5도쯤 튀었다 돌아온다.
    음은 A 단조 5음 음계에 맞춘다."""
    out = []
    for i in range(count):
        u = i / max(count - 1, 1)
        s = span * u + (7.0 if i % 2 else 0.0) * (1.0 - 0.5 * u)
        o, p = divmod(s, 12.0)
        q = min(PENTA, key=lambda d: abs(d - p))
        out.append(base * 2.0 ** ((12.0 * o + q) / 12.0))
    return out


def data_blip(f: float, key, width: float = 0.5, gate: float = 0.032) -> np.ndarray:
    """데이터 한 조각: 아주 짧은 대역 제한 펄스 '삑'."""
    r = RNG("blip", key)
    n = ns(gate + 0.02)
    x = lp(osc_pulse(f, n, width, r.random()), 7000.0)
    return norm(x * env_adsr(n, gate, 0.0005, 0.012, 0.45, 0.008)) * win_tail(n, 0.2)


def data_back_sfx():
    """판정이 돌아옴: 2.6 kHz → 600 Hz 로 떨어지는 펄스 블립 + 강세(서브 '톡' + 금속 틱) /
    노란 판정의 삼전음 핑 A5 + E♭6 (따로 돌려줘 에코로 보낸다)."""
    r = RNG("back")
    n = ns(0.6)
    t = tt(n)
    m = ns(0.12)
    u = np.clip(tt(m) / 0.085, 0.0, 1.0)
    blip = np.zeros(n)
    blip[:m] = lp(osc_pulse(2600.0 * (600.0 / 2600.0) ** u, m, 0.3), 7000.0) * env_adsr(m, 0.09, 0.0005, 0.03, 0.7, 0.02)
    thump = sine(52.0 + 90.0 * np.exp(-t / 0.012), n) * env_exp(n, 0.0004, 0.075)
    clk = hp(r.standard_normal(n), 3000.0) * np.exp(-t / 0.0005)
    ring = modes(n, [2380.0, 3720.0, 5650.0], [0.012, 0.008, 0.005], [1.0, 0.6, 0.4])
    back = norm(0.6 * norm(blip) + 0.75 * norm(thump) + 0.45 * norm(clk) + 0.25 * norm(ring)) * win_tail(n, 0.3)
    ping = chime(hz("A5"), 0.22, 0.9, 0.7, key="back_a") + 0.85 * chime(hz("Eb6"), 0.22, 0.9, 0.7, key="back_e")
    return back, norm(ping)


def pick_blip(step: float) -> np.ndarray:
    """서버→로봇팔 신호: step 간격의 짧은 펄스 '비-빅'(E6 → A6)."""
    n = ns(0.3)
    y = np.zeros(n)
    m = ns(0.05)
    for j, f in enumerate((hz("E6"), hz("A6"))):
        i0 = ns(j * step)
        b = lp(osc_pulse(f, m, 0.5), 6500.0) * env_adsr(m, 0.03, 0.0005, 0.01, 0.6, 0.01)
        y[i0:i0 + m] += b * (0.85 if j == 0 else 1.0)
    return norm(y) * win_tail(n, 0.3)


def hmi_ui(step: float) -> np.ndarray:
    """웹 HMI: 부드러운 UI 블립 두 개(E6 → B6, step 간격) + 짧게 올라가는 공기 '슉'(넓게)."""
    n = ns(0.6)
    y = np.zeros(n)
    for j, f in enumerate((hz("E6"), hz("B6"))):
        i0 = ns(j * step)
        m = n - i0
        y[i0:] += (sine(f, m) + 0.25 * sine(2.0 * f, m, 0.2)) * env_exp(m, 0.0008, 0.05) * (1.0 if j == 0 else 0.8)
    m = ns(0.16)
    u = np.linspace(0.0, 1.0, m)
    sw = svf(stereo_noise(m, "hmi_sw"), 1500.0 * (7000.0 / 1500.0) ** u, 1.5, "bp") * np.sin(np.pi * u) ** 2
    st = pan(norm(y), 0.0)
    st[:, :m] += 0.35 * norm(sw)
    return norm(st) * win_tail(n, 0.3)


# ════════════════════════════════════════════════════════════════════
# 4-d. 효과음: 기계 (카메라·서버·로봇팔·컨베이어)
# ════════════════════════════════════════════════════════════════════

def relay_clunk() -> np.ndarray:
    """첫 프레임의 '철컥': 큰 계전기가 붙는 소리 — 금속 딸깍(접점이 한 번 튐) + 짧은 울림 + 몸통 '퉁'."""
    r = RNG("relay")
    n = ns(0.35)
    t = tt(n)
    snap = hp(r.standard_normal(n), 2500.0) * np.exp(-t / 0.0006)
    d = ns(0.011)
    snap[d:] += 0.4 * snap[: n - d]
    ring = modes(n, [1730.0, 2890.0, 4160.0, 6020.0], [0.030, 0.020, 0.012, 0.008], [1.0, 0.7, 0.5, 0.3])
    body = sine(140.0 * (1.0 + 0.5 * np.exp(-t / 0.004)), n) * env_exp(n, 0.0003, 0.025)
    x = 0.7 * norm(snap) + 0.4 * norm(ring) + 0.6 * norm(body)
    return norm(x) * win_tail(n, 0.4)


def shutter(k) -> np.ndarray:
    """땅(부품이 카메라 밑에 내려앉는 때)마다 카메라 셔터: 25 ms 간격의 작은 '찰-칵'."""
    r = RNG("shutter", k)
    n = ns(0.12)
    y = np.zeros(n)
    for j, (d, f) in enumerate(((0.0, 3600.0), (0.025, 3100.0))):
        i0 = ns(d)
        m = n - i0
        click = hp(r.standard_normal(m), 3000.0) * np.exp(-tt(m) / 0.0005)
        ring = modes(m, [f, f * 1.41, f * 2.07], [0.004, 0.003, 0.002], [1.0, 0.6, 0.4])
        y[i0:] += (0.8 * norm(click) + 0.5 * norm(ring)) * (1.0 if j == 0 else 0.6)
    return norm(y) * win_tail(n, 0.3)


def tension_drone(dur: float) -> np.ndarray:
    """정적의 아주 낮은 긴장음: A1·B♭1 사인(초당 3번쯤 맥놀이) + 걸러진 A2·B♭2 톱니 + 숨쉬는 공기."""
    n = ns(dur)
    t = tt(n)
    low = sine(hz("A1"), n) + 0.85 * sine(hz("Bb1"), n, 0.25)
    mid = lp(osc_saw(hz("A2"), n, 0.1) + 0.8 * osc_saw(hz("Bb2"), n, 0.6), 320.0, 2)
    breath = 0.55 + 0.45 * np.sin(TAU * 0.8 * t) ** 2
    air = bp(stereo_noise(n, "drone_air"), 2500.0, 8000.0)
    return pan(0.7 * norm(low) + 0.3 * norm(mid), 0.0) + 0.06 * norm(air) * breath


def focus_whir() -> np.ndarray:
    """카메라 초점 '위잉': 렌즈 모터가 520→1380 Hz 로 미끄러졌다가 1180 Hz 로 살짝 되돌아옴(초점 찾기)
    + 기어 버즈(음정의 1/8 로 떨림) + 움직임 처음·되돌 때의 작은 스텝 '딸깍'."""
    r = RNG("focus")
    n = ns(0.30)
    t = tt(n)
    f = 520.0 * (1380.0 / 520.0) ** smoothstep(t / 0.15) * (1180.0 / 1380.0) ** smoothstep((t - 0.17) / 0.06)
    whine = norm(bp(osc_pulse(f, n, 0.3), 300.0, 6000.0)) + 0.5 * sine(f, n)
    gear = 1.0 - 0.35 * (0.5 + 0.5 * np.cos(TAU * np.cumsum(f / 8.0) / SR))
    env = np.where(t > 0.23, np.exp(-(t - 0.23) / 0.02), 1.0)
    na = ns(0.004)
    env[:na] *= rise(na)
    clicks = np.zeros(n)
    for d, g in ((0.0, 1.0), (0.17, 0.6)):
        i0 = ns(d)
        m = n - i0
        tick_ = hp(r.standard_normal(m), 3000.0) * np.exp(-tt(m) / 0.0005)
        ring = modes(m, [3300.0, 5100.0], [0.004, 0.0025], [1.0, 0.6])
        clicks[i0:] += g * (norm(tick_) + 0.5 * norm(ring))
    return norm(0.8 * whine * gear * env + 0.8 * norm(clicks)) * win_tail(n, 0.2)


def scan_sweep(dur: float, beat: float) -> np.ndarray:
    """훑는 선: 높은 Q 공진 대역 노이즈가 350 Hz → 6.5 kHz 로 쓸어 올라가며 왼→오로 지나감
    + 같은 높이의 가는 빔 음, 64분음표 결의 미세한 떨림."""
    r = RNG("scan")
    n = ns(dur)
    t = tt(n)
    u = t / dur
    fc = 350.0 * (6500.0 / 350.0) ** u
    x = norm(svf(r.standard_normal(n), fc, 9.0, "bp"))
    beam = 0.12 * sine(fc, n)
    shimmer = 0.75 + 0.25 * np.cos(TAU * (16.0 / beat) * t)
    return pan((x + beam) * shimmer * (0.35 + 0.65 * u), -0.8 + 1.6 * u)


def lock_sfx() -> np.ndarray:
    """검출 상자 잠김: 정밀한 금속 '틱' + 짧은 E6 '핍'(사각파) + 작은 서브 '톡'."""
    r = RNG("lock")
    n = ns(0.5)
    t = tt(n)
    clk = hp(r.standard_normal(n), 3000.0) * np.exp(-t / 0.0005)
    ring = modes(n, [2870.0, 4410.0, 6630.0], [0.010, 0.006, 0.004], [1.0, 0.6, 0.4])
    m = ns(0.12)
    pip = np.zeros(n)
    pip[:m] = lp(osc_pulse(hz("E6"), m, 0.5), 5000.0) * env_adsr(m, 0.075, 0.001, 0.02, 0.6, 0.02)
    thump = sine(55.0 + 70.0 * np.exp(-t / 0.01), n) * env_exp(n, 0.0005, 0.05)
    x = 0.55 * norm(clk) + 0.35 * norm(ring) + 0.45 * norm(pip) + 0.55 * norm(thump)
    return norm(x) * win_tail(n, 0.3)


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


def sfx_clamp(key="clamp"):
    """그리퍼가 집음: 짧고 단단한 금속 '찰칵'(+ 27 ms 뒤 걸쇠) / 서브 '둥'(모노). 두 개를 돌려준다."""
    r = RNG(key)
    n = ns(1.2)
    t = tt(n)
    metal = modes(n, [1460.0, 2230.0, 3410.0, 4890.0, 6640.0, 8710.0], [0.15, 0.11, 0.077, 0.056, 0.036, 0.022],
                  [1.0, 0.8, 0.65, 0.5, 0.35, 0.25], r, drop=0.008)
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


def thud() -> np.ndarray:
    """불량함에 떨어지는 둔탁한 '쿵': 낮은 사인(97→52 Hz) + 어두운 노이즈 몸통 + 플라스틱 함의 낮은 울림.
    65·110 ms 뒤 두 번 작게 튄다."""
    n = ns(0.6)
    t = tt(n)

    def one(scale: float, key) -> np.ndarray:
        rr = RNG("thud", key)
        body = sine(52.0 + 45.0 * np.exp(-t / 0.012), n) * env_exp(n, 0.0005, 0.06 * scale)
        knock = lp(rr.standard_normal(n), 900.0, 2) * np.exp(-t / (0.010 * scale))
        box = modes(n, [190.0, 330.0, 510.0, 760.0], [0.04, 0.03, 0.02, 0.012], [1.0, 0.7, 0.5, 0.3])
        return norm(body) + 0.5 * norm(knock) + 0.25 * norm(box) * scale

    x = one(1.0, 0)
    for d, g in ((0.065, 0.28), (0.11, 0.12)):
        i0 = ns(d)
        x[i0:] += g * one(0.6, d)[: n - i0]
    return norm(shape(x)) * win_tail(n, 0.4)


def zoom_out_sfx(dur: float) -> np.ndarray:
    """장면이 HMI 화면 속으로 줄어듦: 넓고 밝은 노이즈가 좁고 어둡게 멀어지는 '휘익'(6.5 kHz → 650 Hz,
    넓음 → 가운데) + A5 에서 한 옥타브 내려가는 가는 음."""
    n = ns(dur)
    t = tt(n)
    u = t / dur
    fc = 6500.0 * (650.0 / 6500.0) ** (u ** 0.8)
    wide = norm(svf(stereo_noise(n, "zoom"), fc, 1.3, "bp"))
    mono = norm(svf(RNG("zoom_m").standard_normal(n), fc, 1.3, "bp"))
    w = (1.0 - u) ** 1.5
    st = w * wide + (1.0 - w) * 0.8 * np.stack([mono, mono])
    tone = 0.10 * sine(hz("A5") * 0.5 ** (u ** 1.2), n)
    return (st + tone) * smoothstep(u / 0.2) * (1.0 - u) ** 1.3


# ════════════════════════════════════════════════════════════════════
# 4-e. 효과음: 큰 순간 (불량·드롭·라이저·타격)
# ════════════════════════════════════════════════════════════════════

def ng_impact(hold: float) -> np.ndarray:
    """불량의 낮은 타격(모노): 112→42 Hz 사인 + 낮은 노이즈 '쿵' + 짧은 딸깍. hold 초 뒤 끊긴다(박자가 멈춤)."""
    r = RNG("ng_imp")
    n = ns(hold + 0.12)
    t = tt(n)
    sub = sat(sine(42.0 + 70.0 * np.exp(-t / 0.035), n) * env_exp(n, 0.0005, 0.20), 1.8)
    body = lp(r.standard_normal(n), 380.0, 4) * np.exp(-t / 0.035)
    snap = hp(r.standard_normal(n), 2500.0) * np.exp(-t / 0.0008)
    return norm(shape(norm(sub) + 0.45 * norm(body) + 0.25 * norm(snap))) * choke(n, hold, 0.1)


def drop_boom() -> np.ndarray:
    """그루브 드롭의 서브 '붐'(모노): 95 → 41 Hz 로 떨어지는 사인, 0.35 s 감쇠 — 타격보다 한 단 아래의 무게."""
    n = ns(1.2)
    t = tt(n)
    x = sat(sine(41.0 + 54.0 * np.exp(-t / 0.06), n) * env_exp(n, 0.001, 0.35), 1.8)
    return norm(shape(x)) * win_tail(n, 0.35)


def plate_clang(f0: float, dur: float, key, decay: float = 1.0) -> np.ndarray:
    """두꺼운 강판 '쾅': 비조화 모드(판의 굽힘 비율) + 짧은 노이즈 타격, 살짝 내려앉는 음정, 좌우 미세 차이."""
    ratios = (1.0, 1.52, 2.03, 2.74, 3.41, 4.12, 5.33, 6.71, 8.27)
    decs = (0.9, 0.7, 0.55, 0.42, 0.33, 0.25, 0.18, 0.12, 0.08)
    amps = (1.0, 0.8, 0.75, 0.6, 0.5, 0.4, 0.3, 0.22, 0.15)
    n = ns(dur)
    t = tt(n)
    st = []
    for ch in range(2):
        r = RNG("clang", key, ch)
        m = modes(n, [f0 * q * (1.0 + 0.002 * (ch - 0.5)) for q in ratios], [d * decay for d in decs], amps,
                  drop=0.008)
        strike = bp(r.standard_normal(n), 1500.0, 9000.0) * np.exp(-t / 0.004)
        st.append(norm(m) + 0.5 * norm(strike))
    return norm(np.stack(st)) * win_tail(n, 0.3)


def burst(dur: float, key, lo: float = 1500.0, hi: float = 9000.0, decay: float = 0.16,
          attack: float = 0.008) -> np.ndarray:
    """넓게 터지는 짧은 공기(대역 노이즈, L/R 무상관) — 큰 순간의 밀도를 채운다(피크는 앞 타격에 양보)."""
    n = ns(dur)
    x = bp(stereo_noise(n, ("burst", key)), lo, hi) * env_exp(n, attack, decay)
    return norm(shape(x)) * win_tail(n, 0.3)


def reverse_swell(x: np.ndarray, ir: np.ndarray, length: float) -> np.ndarray:
    """소리 x 의 잔향을 뒤집은 '빨려 드는' 스웰. 끝이 x 의 시작에 맞물린다."""
    m = ns(length)
    wet = np.stack([signal.fftconvolve(x, ir[ch])[:m] for ch in range(2)])
    return norm(wet[:, ::-1] * np.linspace(0.0, 1.0, m) ** 2)


def riser(dur: float, f0: float, f1: float, key, tone_lvl: float = 0.3) -> np.ndarray:
    """차오르는 소리: 대역 노이즈 450 Hz → 8 kHz + 5도로 쌓은 톱니 상승음, 끝으로 갈수록 커짐."""
    n = ns(dur)
    t = tt(n)
    u = t / dur
    fc = 450.0 * (8000.0 / 450.0) ** (u ** 1.4)
    nz = norm(svf(stereo_noise(n, ("riser", key)), fc, 1.4, "bp"))
    f = f0 * (f1 / f0) ** (u ** 1.5)
    tone = osc_saw(f, n) + 0.5 * osc_saw(f * 1.5, n, 0.37) + osc_saw(f * 1.005, n, 0.71)
    tone = norm(svf(tone, 700.0 + 5500.0 * u ** 2, 0.9, "lp"))
    return (nz + pan(tone_lvl * tone, 0.0)) * u ** 2.0


def big_hit(f_end: float, length: float):
    """가장 큰 타격: 서브 붐(약 105 Hz → f_end, ♭VI 화음의 뿌리 F1 로 내려앉음) + 킥 펀치 + 어두운 몸통(모노) /
    넓은 공기 + A 에 맞춘 강판(스테레오).
    서브는 포화시킨 사인이라 꼭지와 평균의 차가 작고, 넓은 층(노이즈·강판)은 8 ms 에 걸쳐 피어나 첫 피크가 펀치와
    겹치지 않는다(20 ms 에 걸쳐 피어남) — 피크는 덜 오르고 소리는 크게 남아 마스터 리미터가 타격 전체를 깎지 않는다.
    length = 다음 화음(제목)까지: 서브(F)는 그때까지 다 사라져 A 화음 밑에 남지 않는다. 넓은 층은 조금 더 울린다."""
    r = RNG("hit")
    n = ns(length)
    t = tt(n)
    sub = sat(sine(f_end + 62.0 * np.exp(-t / 0.25), n) * env_exp(n, 0.002, 0.65), 2.0)
    k = kick(1.0, k="hit", punch=200.0, tail=48.0, decay=0.22, click=0.22)
    punch = np.zeros(n)
    m = min(n, k.size)
    punch[:m] = k[:m]
    body = lp(r.standard_normal(n), 380.0, 4) * np.exp(-t / 0.15)
    low = norm(shape(norm(sub) + 0.7 * norm(punch) + 0.35 * norm(body))) * win_tail(n, 0.45)
    nw = ns(length + 0.6)
    tw = tt(nw)
    mid = bp(stereo_noise(nw, "hit_mid"), 900.0, 3500.0) * env_exp(nw, 0.02, 0.14)
    air = hp(stereo_noise(nw, "hit_air"), 6000.0) * env_exp(nw, 0.02, 0.16)
    metal = plate_clang(hz("A2"), length + 0.6, "hit", decay=1.2) * np.stack([1.0 - np.exp(-tw / 0.01)] * 2)
    wide = norm(shape(0.55 * norm(mid) + 0.5 * norm(air) + 0.35 * metal)) * win_tail(nw, 0.4)
    return low, wide


# ════════════════════════════════════════════════════════════════════
# 4-f. 악기: 화성 (패드·화음)
# ════════════════════════════════════════════════════════════════════

def supersaw(freqs, n: int, key, voices: int = 5, detune: float = 12.0, spread: float = 0.9, os: int = 1) -> np.ndarray:
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


def ng_cluster(notes, hold: float) -> np.ndarray:
    """불량 판정의 어긋난 화음(단2도 + 삼전음): 크게 디튠한 톱니, 빠르게 닫히는 필터, tanh 로 거칠게.
    hold 초 뒤 손으로 잡듯 끊겨(박자가 멈춤) 정적에는 잔향과 드론만 남는다."""
    n = ns(hold + 0.12)
    t = tt(n)
    x = supersaw([hz(s) for s in notes], n, "ng", voices=3, detune=22.0, spread=0.85, os=2)
    x = svf(x, 500.0 + 5200.0 * np.exp(-t / 0.05), 1.1, "lp")
    x = sat(1.5 * norm(x)) * env_exp(n, 0.0015, 0.42)
    return norm(x) * choke(n, hold, 0.08)


def tension_pad(dur: float, t_tense: float) -> np.ndarray:
    """펄스 구간 밑의 어두운 긴장: A2·E3·A3 열린 5도(디튠 톱니), 필터가 250 Hz → 1.8 kHz 로 열림.
    t_tense(초, 시작 기준) 부터 B♭3 가 스며들어(A 위 단9도) 긴장이 커진다."""
    n = ns(dur)
    u = tt(n) / dur
    x = supersaw([hz("A2"), hz("E3"), hz("A3")], n, "tpad", voices=4, detune=9.0, spread=0.7)
    m = n - min(n, ns(t_tense))
    if m > 0:
        x[:, n - m:] += 0.8 * supersaw([hz("Bb3")], m, "tpad_b", voices=3, detune=9.0, spread=0.5) * rise(m) ** 1.5
    x = svf(x, 250.0 * (1800.0 / 250.0) ** u, 0.9, "lp")
    return x * (0.35 + 0.65 * u ** 1.4)


def groove_pad(notes, dur: float) -> np.ndarray:
    """그루브의 펌핑 패드(A sus2): 디튠 톱니, 필터가 1.1 → 3 kHz 로 열리고 뒤로 갈수록 커진다(타격 쪽으로 차오름).
    사이드체인으로 숨쉰다."""
    n = ns(dur)
    u = tt(n) / dur
    x = supersaw([hz(s) for s in notes], n, "gpad", voices=5, detune=12.0, spread=0.9)
    return svf(x, 1100.0 * (3000.0 / 1100.0) ** (u ** 1.5), 0.8, "lp") * (0.55 + 0.45 * u ** 2)


def chord_stab(freqs, key, dur: float = 1.6, decay: float = 0.5, attack: float = 0.004, bright: float = 1.0) -> np.ndarray:
    """넓은 화음 스탭: 디튠 톱니 + 빠르게 닫히는 필터."""
    n = ns(dur)
    t = tt(n)
    x = supersaw(freqs, n, ("stab", key), voices=4, detune=14.0, spread=0.9, os=2)
    x = svf(x, 600.0 + 6500.0 * bright * np.exp(-t / 0.08), 0.9, "lp")
    return norm(x * env_exp(n, attack, decay)) * win_tail(n, 0.3)


def bridge_pad(notes, dur: float) -> np.ndarray:
    """타격 뒤 제목까지(낱장 폭포 밑): F 장조(♭VI), 어둡게 시작해 조금씩 밝아지고 커진다."""
    n = ns(dur)
    u = tt(n) / dur
    x = supersaw([hz(s) for s in notes], n, "bpad", voices=5, detune=12.0, spread=0.9)
    return svf(x, 700.0 * (2200.0 / 700.0) ** u, 0.8, "lp") * (0.5 + 0.5 * u)


def title_pad(notes, dur: float) -> np.ndarray:
    """제목 화음: 따뜻하고 넓은 A(add9) — 7성부 디튠 톱니를 넓게 벌리고, 처음엔 밝다가 따뜻하게 닫힌다."""
    n = ns(dur)
    t = tt(n)
    x = supersaw([hz(s) for s in notes], n, "title", voices=7, detune=11.0, spread=0.95)
    x = svf(x, 1500.0 + 2200.0 * np.exp(-t / 0.25), 0.75, "lp")
    env = (0.6 + 0.4 * np.exp(-t / 0.4)) * np.exp(-t / 5.0)
    na = ns(0.006)
    env[:na] *= rise(na)
    return x * env


def felt_chord(notes, dur: float = 2.5, decay: float = 1.1) -> np.ndarray:
    """화음의 윤곽을 잡는 펠트 건반 화음(음마다 좌우로 조금씩)."""
    out = np.zeros((2, ns(dur)))
    m = len(notes)
    for i, s in enumerate(notes):
        p = 0.0 if m == 1 else -0.4 + 0.8 * i / (m - 1)
        out += pan(felt(hz(s), dur, decay, key=("fc", s)), p)
    return out / np.sqrt(m)


def sub_note(f: float, dur: float, a: float = 0.008, decay: float = 1.8) -> np.ndarray:
    """긴 서브 한 음(사인 + 약한 2배음)."""
    n = ns(dur)
    x = (sine(f, n) + 0.12 * sine(2.0 * f, n)) * env_exp(n, a, decay)
    return sat(1.2 * x) * win_tail(n, 0.25)


# ════════════════════════════════════════════════════════════════════
# 5. 믹서
# ════════════════════════════════════════════════════════════════════

class Mixer:
    """스템(music / sfx)마다 드라이 버스와 센드(hall, room, echo)를 둔다.
    타격 전('pre')과 후('post')를 따로 모아 'pre' 에만 직전의 '숨'(무음) 게이트를 건다.
    점검용으로 낱장 소리만 모은 드라이 버스(flap)도 따로 둔다(같은 게이트를 거치고, 파일로는 쓰지 않음)."""

    STEMS = ("music", "sfx")
    FX = ("hall", "room", "echo")

    def __init__(self, n: int, split_t: float):
        self.n = n
        self.split = ns(split_t)
        self.duck = np.ones(n)
        self.dry = {(s, g): np.zeros((2, n)) for s in self.STEMS for g in ("pre", "post")}
        self.send = {(s, g, fx): np.zeros((2, n)) for s in self.STEMS for g in ("pre", "post") for fx in self.FX}
        self.flapbus = {g: np.zeros((2, n)) for g in ("pre", "post")}
        self.flap = np.zeros((2, n))
        self.events: list[dict] = []

    def add(self, stem: str, t: float, sig: np.ndarray, db: float = 0.0, pan_=0.0,
            hall: float = 0.0, room: float = 0.0, echo: float = 0.0, dry: float = 1.0,
            duck: bool = False, name: str = "", fin: float = 0.0002, fout: float = 0.004, tag: str = "") -> None:
        x = np.asarray(sig, dtype=float)
        x = pan(x, pan_) if x.ndim == 1 else (balance(x, pan_) if pan_ else x)
        x = edges(x, fin, fout) * float(dbg(db))        # 모든 음의 시작·끝이 0 에서 출발·도착
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
        if tag == "flap":
            self.flapbus[g][:, a:b] += dry * seg
        env = np.max(np.abs(seg), axis=0)
        live = np.flatnonzero(env > 1e-3 * max(env.max(), 1e-12))        # -60 dB 위로 들리는 구간
        self.events.append(dict(name=name, stem=stem, t=t, i0=i0, i1=i0 + x.shape[1],
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
                    hall_in += 0.3 * ret                      # 에코도 잔향 속으로
                if np.any(hall_in):
                    y += reverb(hall_in, irs["hall"])
                if np.any(self.send[s, g, "room"]):
                    y += reverb(self.send[s, g, "room"], irs["room"])
                y = cleanup(y)                                # 필터 울림까지 게이트가 자르도록 게이트 앞에서
                out += y * gate_pre if g == "pre" else y
            stems[s] = out
        self.flap = self.flapbus["pre"] * gate_pre + self.flapbus["post"]
        return stems


def place(buf: np.ndarray, t: float, sig: np.ndarray, db: float = 0.0, pan_: float = 0.0) -> None:
    """서브 버스(드럼)에 직접 더하기 — Mixer.add 와 같은 끝 처리."""
    x = np.asarray(sig, dtype=float)
    x = edges(pan(x, pan_) if x.ndim == 1 else x) * float(dbg(db))
    i0 = ns(t)
    a, b = max(i0, 0), min(i0 + x.shape[1], buf.shape[1])
    if b > a:
        buf[:, a:b] += x[:, a - i0: b - i0]


# ════════════════════════════════════════════════════════════════════
# 6. 편곡 — 모든 시각은 timeline.json 에서
# ════════════════════════════════════════════════════════════════════

OK_NOTES = ("A5", "C#6")                              # 양품 확인음: 오르는 장3도
NG_NOTES = ("A5", "Eb6")                              # 불량: 같은 몸짓이 삼전음으로 어긋남(둘째 음은 디튠 겹음)
NG_CLUSTER = ("A2", "A3", "Bb3", "Eb4", "A4")        # A 위 단2도 + 삼전음
HOOK_BASS = "A1"
RIFF = (                                              # 그루브 베이스 리프: (16분 칸, 음, 세기, 길이(16분 배수))
    (2, "A1", 1.00, 0.8), (3, "A1", 0.55, 0.4), (6, "A1", 1.00, 0.8), (7, "A2", 0.80, 0.45),
    (10, "A1", 1.00, 0.8), (11, "A1", 0.55, 0.4), (14, "G1", 0.95, 0.8), (15, "E2", 0.75, 0.45),
)
GROOVE_PAD = ("A2", "E3", "B3", "E4")                 # A sus2 (3음 없음 — 장·단을 끝까지 미룬다)
HIT_CHORD = ("F2", "C3", "F3", "A3", "C4", "F4")      # ♭VI: 타격의 화음
HIT_ROOT = "F1"                                       # 타격의 서브 붐이 내려앉는 음
BRIDGE = ("F2", "C3", "F3", "A3", "C4")
TITLE_CHORD = ("A2", "E3", "A3", "C#4", "E4", "B4")   # A(add9): 해결된, 따뜻한
TITLE_FELT = ("A3", "C#4", "E4", "B4")
MOTIF = ("A5", "E6", "C#6")                           # 끝 모티프: 확인음 A5→C#6 사이에 5음을 끼운 아치

# 믹스 레벨표 (dB). 소리는 대부분 꼭지 1 로 만들어지고 여기 값만큼 줄여 놓인다.
# 전체 라우드니스는 마스터가 맞추므로 서로의 차이만 뜻이 있다. 소리별 K 가중 라우드니스로 맞춘 기준:
# 그루브에서 킥 0 일 때 베이스 약 −5, 하이햇·낱장 약 −11, 패드 −11 → −7(타격 쪽으로 차오름) LU.
# 강세 순서(hit > groove > verdict_ng ≈ clamp > 나머지)는 자체 점검이 확인한다.
LV = dict(
    # 리듬
    kick_hook=-7.5, kick_drop=-6.0, kick=-7.0, hat_hook=-13.0, hat_off=-11.0, hat_16=-17.0,
    bass_hook=-5.5, bass=-5.0, pad=-17.0,
    # 낱장 · 땅(셔터)
    flap_last=-8.5, flap=-11.5, flap_final_last=-13.5, flap_final=-16.0, shutter=-25.0,
    # 판정
    open=-14.0, ok1=-13.5, ok2=-12.5,
    ng_cluster=-7.2, ng_impact=-5.2, ng_chime1=-14.5, ng_chime2=-13.5, drone=-24.0,
    # see · judge · pick
    see=-16.0, scan=-16.0, lock=-11.5,
    pulse_bass=-12.5, pulse_tick=-17.0, pulse_thump=-13.0, pulse_pad=-19.5,
    data_up=-18.0, data_back=-10.5, data_ping=-18.0,
    pick=-16.0, servo=-25.0, clamp=-4.2, clamp_sub=-5.2, lift=-15.0, drop=-8.0,
    # 드롭 · hmi · 라이저
    drop_clang=-7.0, drop_burst=-10.0, drop_boom=-10.0, drop_swell=-20.0,
    hmi=-17.0, zoom=-16.0, riser=-9.5, roll=-15.0,
    # 끝
    hit_low=-2.5, hit_wide=-6.0, hit_chord=-3.0, hit_pad=-20.0,
    title_pad=-21.5, title_felt=-20.5, title_sub=-19.5, motif=-17.0, motif_last=-16.0, motif_felt=-23.0,
    credits=-22.0,
)


def arrange(tl: Timeline, mx: Mixer, irs: dict) -> np.ndarray:
    """cue·lands·flips 시각에 모든 소리를 놓는다. 타격 직전 '숨' 게이트를 돌려준다."""
    B = tl.beat
    S8, S16, S32 = B / 2, B / 4, B / 8
    n = mx.n
    T = tl.duration

    t_open = tl.cue("open").t
    t_ng = tl.cue("verdict_ng").t
    sil = tl.cue("silence")
    t_see = tl.cue("see").t
    scan = tl.cue("scan")
    t_lock = tl.cue("lock").t
    t_judge = tl.cue("judge").t
    dup = tl.cue("data_up")
    t_back = tl.cue("data_back").t
    t_pick = tl.cue("pick").t
    srv = tl.cue("servo")
    t_clamp = tl.cue("clamp").t
    lift = tl.cue("lift")
    t_drop = tl.cue("drop").t
    t_groove = tl.cue("groove").t
    t_hmi = tl.cue("hmi").t
    zoom = tl.cue("zoom_out")
    rz = tl.cue("riser")
    t_hit = tl.cue("hit").t
    t_title = tl.cue("title").t
    t_cred = tl.cue("credits").t
    oks = tl.times("verdict_ok")
    gap_start = t_hit - S32                          # 타격 직전 32분음표만큼 '숨'

    # 킥(=사이드체인) 자리: 훅의 땅(불량 전까지) + 그루브(드롭부터 라이저 전까지 매 박)
    hook_kicks = [t for t in tl.lands if t_open <= t < t_ng]
    groove_kicks = grid(t_groove, rz.t, B)
    mx.duck = duck_env(n, hook_kicks + groove_kicks, depth_db=-9.0, attack=0.004, release=0.8 * B)
    drums = np.zeros((2, n))

    # ── 낱장: flips 하나하나 (영상 시작 전 것은 시간표에서 이미 버렸다) ───────────────
    for f in tl.flips:
        if f.final:                                  # 끝 판 폭포는 촘촘하므로 한 장 한 장은 조금 작게
            db = LV["flap_final_last"] if f.last else LV["flap_final"]
        else:
            db = LV["flap_last"] if f.last else LV["flap"]
        mx.add("sfx", f.t, flap_clack(f.last, f.tone, f.i), db, pan_=f.pan, room=0.12, name="flap", tag="flap")

    # ── 땅: 부품이 카메라 밑에 내려앉을 때마다 셔터 ───────────────────────────────
    for i, t in enumerate(tl.lands):
        mx.add("sfx", t, shutter(i), LV["shutter"], pan_=0.3, room=0.08, name="land.shutter")

    # ── 양품 확인음 (훅 + 복귀) ───────────────────────────────────────────────
    for i, t in enumerate(oks):
        mx.add("sfx", t, chime(hz(OK_NOTES[0]), 0.07, 0.5, key=("ok", i)), LV["ok1"], pan_=-0.12, echo=0.10,
               hall=0.06, name="verdict_ok")
        mx.add("sfx", t + S32, chime(hz(OK_NOTES[1]), 0.16, 0.8, key=("ok2", i)), LV["ok2"], pan_=0.12, echo=0.14,
               hall=0.08, name="verdict_ok.2")

    # ── HOOK: 첫 타격, 땅마다 킥, 엇박 하이햇·베이스 ──────────────────────────────
    mx.add("sfx", t_open, relay_clunk(), LV["open"], room=0.18, name="open")
    for i, tk in enumerate(hook_kicks):
        place(drums, tk, kick(1.0, k=("hook", i)), LV["kick_hook"])
    for i, th in enumerate(grid(t_open + S8, t_ng, B)):
        place(drums, th, hat(0.85, ("hook", i), decay=0.035), LV["hat_hook"], 0.18)
        mx.add("music", th, bass_note(hz(HOOK_BASS), S8 * 0.4, ("hook", i), cutoff=900.0), LV["bass_hook"],
               duck=True, name="hook.bass")

    # ── 불량: 어긋난 확인음 + 클러스터 + 낮은 타격, 그 뒤 정적의 드론 ───────────────
    ng_hold = 0.9 * S8                               # 불량 타격은 8분음표쯤 울리고 끊긴다 — 박자가 멈춘다
    mx.add("music", t_ng, ng_cluster(NG_CLUSTER, ng_hold), LV["ng_cluster"], hall=0.14, name="verdict_ng.cluster")
    mx.add("sfx", t_ng, ng_impact(ng_hold), LV["ng_impact"], name="verdict_ng.impact")
    mx.add("sfx", t_ng, chime(hz(NG_NOTES[0]), 0.07, 0.5, key="ng1"), LV["ng_chime1"], pan_=-0.12, echo=0.10,
           name="verdict_ng.chime")
    wrong = chime(hz(NG_NOTES[1]), 0.22, 0.9, key="ng2") + chime(hz(NG_NOTES[1]), 0.22, 0.9, key="ng3", cents=32.0)
    mx.add("sfx", t_ng + S32, norm(wrong), LV["ng_chime2"], pan_=0.12, echo=0.14, hall=0.10, name="verdict_ng.chime2")
    mx.add("music", sil.t, tension_drone(t_judge - sil.t), LV["drone"], fin=0.12, fout=1.0, name="silence.drone")

    # ── SEE: 초점, 훑기, 잠금 ─────────────────────────────────────────────────
    mx.add("sfx", t_see, focus_whir(), LV["see"], pan_=-0.1, room=0.15, name="see")
    mx.add("sfx", scan.t, scan_sweep(scan.dur, B), LV["scan"], hall=0.12, fin=0.04, fout=0.02, name="scan")
    mx.add("sfx", t_lock, lock_sfx(), LV["lock"], room=0.15, echo=0.08, name="lock")

    # ── see → pick 밑의 펄스: 필터가 열리는 A1 8분, 틱(8분 → judge 부터 16분), 마디 첫 박 '둥', 긴장 패드 ──
    p0, p1 = t_see, t_drop
    span = p1 - p0
    for i, tb in enumerate(grid(p0, p1, S8)):
        u = (tb - p0) / span
        f = hz("A2") if (i % 2 == 1 and tb >= t_pick) else hz("A1")
        mx.add("music", tb, bass_note(f, S8 * 0.5, ("pulse", i), cutoff=160.0 * (1500.0 / 160.0) ** u,
                                      env_amt=0.5 + 0.8 * u, q=1.1 + 1.3 * u), LV["pulse_bass"] + 4.0 * u,
               name="pulse.bass")
    for i, tk in enumerate(grid(p0, p1, S16)):
        step = int(round((tk - p0) / S16))
        if tk < t_judge and step % 2:
            continue
        u = (tk - p0) / span
        on_beat = step % 4 == 0
        mx.add("music", tk, tick(on_beat, ("pulse", i)), LV["pulse_tick"] + 6.0 * u - (0.0 if on_beat else 3.0),
               pan_=-0.3 if step % 2 else 0.3, room=0.1, name="pulse.tick")
    for i, tb in enumerate(grid(p0, p1, 4 * B)):
        mx.add("music", tb, soft_thump(i), LV["pulse_thump"] + 1.5 * i, name="pulse.thump")
    mx.add("music", p0, tension_pad(span + 0.08, t_pick - p0), LV["pulse_pad"], hall=0.15, fin=0.4, fout=0.08,
           name="pulse.pad")

    # ── JUDGE: 데이터가 올라갔다(32분 블립) 판정이 돌아온다 ─────────────────────────
    ups = grid(dup.t, dup.end, S32)
    for i, (tb, f) in enumerate(zip(ups, data_pitches(len(ups), hz("A4")))):
        u = i / max(len(ups) - 1, 1)
        mx.add("sfx", tb, data_blip(f, i, width=0.25 if i % 2 else 0.5), LV["data_up"] + 3.0 * u,
               pan_=-0.55 + 1.1 * u, echo=0.05, room=0.06, name="data_up")
    back, ping = data_back_sfx()
    mx.add("sfx", t_back, back, LV["data_back"], room=0.12, name="data_back")
    mx.add("sfx", t_back, ping, LV["data_ping"], echo=0.18, hall=0.12, name="data_back.ping")

    # ── PICK: 신호, 서보, 집게, 휙, 쿵 ─────────────────────────────────────────
    mx.add("sfx", t_pick, pick_blip(S32), LV["pick"], pan_=0.25, echo=0.10, name="pick")
    mx.add("sfx", srv.t, sfx_servo(srv.dur, 380.0, 760.0, 1), LV["servo"], pan_=0.3, room=0.2, fin=0.03, fout=0.05,
           name="servo")
    clamp_hi, clamp_sub = sfx_clamp()
    mx.add("sfx", t_clamp, clamp_hi, LV["clamp"], room=0.22, hall=0.08, name="clamp")
    mx.add("sfx", t_clamp, clamp_sub, LV["clamp_sub"], name="clamp.sub")
    mx.add("sfx", lift.t, sfx_lift(lift.dur), LV["lift"], hall=0.10, fin=0.02, fout=0.02, name="lift")
    mx.add("sfx", t_drop, thud(), LV["drop"], room=0.25, name="drop")

    # ── GROOVE: 드롭부터 고른 격자 — 킥 매 박, 엇박 하이햇, 베이스 리프, 패드 ─────────────
    for i, tk in enumerate(groove_kicks):                    # 드롭의 첫 킥만 조금 강세, 나머지는 고르게
        place(drums, tk, kick(1.0, k=("g", i)), LV["kick_drop"] if i == 0 else LV["kick"])
    for i, th in enumerate(grid(t_groove + S8, rz.t, B)):
        place(drums, th, hat(0.9, ("g", i % 4), decay=0.045), LV["hat_off"], 0.2)
    for i, th in enumerate(grid(t_hmi, rz.t, S16)):          # HMI 부터 16분 닫힌 하이햇(8분 자리는 비움)
        if int(round((th - t_hmi) / S16)) % 2 == 0:
            continue
        place(drums, th, hat(0.7, ("c", i % 4), decay=0.012), LV["hat_16"], -0.25)
    g_span = rz.t - t_groove
    for bi, b0 in enumerate(grid(t_groove, rz.t, 4 * B)):
        for step, note, vel, glen in RIFF:
            tb = b0 + step * S16
            if tb >= rz.t - 1e-9:
                continue
            u = (tb - t_groove) / g_span                     # 타격 쪽으로 갈수록 필터가 조금씩 열린다
            mx.add("music", tb, bass_note(hz(note), glen * S16, ("riff", bi, step),
                                          cutoff=1300.0 * vel * (1.0 + 0.7 * u), q=1.8),
                   LV["bass"] + 20.0 * math.log10(vel), duck=True, name="groove.bass")
    mx.add("music", t_groove, groove_pad(GROOVE_PAD, g_span + 0.25), LV["pad"], duck=True, hall=0.15,
           fin=0.01, fout=0.25, name="groove.pad")
    clang = plate_clang(hz("A2"), 2.5, "groove", decay=1.2)                  # 드롭의 강세: 강판 + 공기 + 서브
    mx.add("sfx", t_groove, clang, LV["drop_clang"], hall=0.20, name="groove.clang")
    mx.add("sfx", t_groove, burst(0.8, "groove", decay=0.25), LV["drop_burst"], hall=0.15, name="groove.burst")
    mx.add("sfx", t_groove, drop_boom(), LV["drop_boom"], name="groove.boom")
    sw = reverse_swell(clang[0] + clang[1], irs["hall"], t_groove - t_drop)  # 쿵 뒤부터 빨려 드는 스웰
    mx.add("sfx", t_groove - sw.shape[1] / SR, sw, LV["drop_swell"], fin=0.05, fout=0.003, name="groove.swell")
    mx.add("music", 0.0, sat(1.2 * drums) / 1.2, fin=0.0, fout=0.0, name="drums")

    # ── HMI: UI 블립, 화면 속으로 줄어듦 ──────────────────────────────────────
    mx.add("sfx", t_hmi, hmi_ui(S32), LV["hmi"], echo=0.15, hall=0.10, name="hmi")
    mx.add("sfx", zoom.t, zoom_out_sfx(zoom.dur), LV["zoom"], hall=0.12, fin=0.03, fout=0.04, name="zoom_out")

    # ── RISER: 킥이 빠지고 라이저 + 32분 틱 롤, 그리고 숨 ───────────────────────────
    mx.add("sfx", rz.t, riser(gap_start - rz.t, hz("A3"), hz("A5"), "r"), LV["riser"], hall=0.10, fin=0.02,
           fout=0.003, name="riser")
    roll = grid(rz.t, gap_start - 1e-6, S32)
    for i, tr in enumerate(roll):
        u = i / max(len(roll) - 1, 1)
        mx.add("music", tr, tick(True, ("roll", i)), LV["roll"] + 8.0 * u, pan_=0.25 if i % 2 else -0.25,
               name="riser.roll")

    # ── HIT: 가장 큰 타격 + ♭VI 화음, 폭포 밑의 F 패드 ────────────────────────────
    to_title = t_title - t_hit                       # ♭VI(F) 는 제목의 A 화음이 올 때까지만 — 그 밑에 남지 않게
    low, wide = big_hit(hz(HIT_ROOT), to_title)
    mx.add("sfx", t_hit, low, LV["hit_low"], name="hit.low")
    mx.add("sfx", t_hit, wide, LV["hit_wide"], hall=0.14, name="hit.wide")
    mx.add("music", t_hit, chord_stab([hz(s) for s in HIT_CHORD], "hit", dur=to_title + 0.03, decay=0.5,
                                      attack=0.025), LV["hit_chord"], hall=0.15, name="hit.chord")
    mx.add("music", t_hit, bridge_pad(BRIDGE, t_title - t_hit + 0.05), LV["hit_pad"], hall=0.20, fin=0.05,
           fout=0.06, name="hit.pad")

    # ── TITLE: A(add9) 화음 + 끝 모티프, 크레딧 블립 ─────────────────────────────
    end_len = T - t_title
    mx.add("music", t_title, title_pad(TITLE_CHORD, end_len), LV["title_pad"], hall=0.30, fin=0.006, fout=0.01,
           name="title.chord")
    mx.add("music", t_title, felt_chord(TITLE_FELT), LV["title_felt"], hall=0.22, name="title.felt")
    mx.add("music", t_title, sub_note(hz("A1"), end_len), LV["title_sub"], name="title.sub")
    for i, s in enumerate(MOTIF):
        last = i == len(MOTIF) - 1
        tn = t_title + i * S16
        mx.add("music", tn, chime(hz(s), 1.3 if last else 0.45, 3.0 if last else 1.8, bright=0.9, key=("motif", i)),
               LV["motif_last"] if last else LV["motif"], echo=0.25, hall=0.30, name=f"motif_{i + 1}")
        mx.add("music", tn, felt(hz(s) / 2.0, 2.0, 0.6, key=("motif_felt", i)), LV["motif_felt"], hall=0.20,
               name=f"motif_{i + 1}.felt")
    mx.add("sfx", t_cred, chime(hz("A6"), 0.06, 0.6, bright=0.3, key="credits"), LV["credits"], echo=0.25,
           hall=0.20, name="credits")

    # 타격 직전 '숨': 'pre' 그룹 전체를 gap_start 에서 12 ms 동안 0 으로
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
    """BS.1770-4 통합 라우드니스(400 ms 블록, 75 % 겹침, 절대 -70 / 상대 -10 LU 게이트)."""
    p = (k_filter(x) ** 2).sum(axis=0)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    nb, nh = ns(0.4), ns(0.1)
    st = np.arange(0, p.size - nb + 1, nh)
    e = (cs[st + nb] - cs[st]) / nb
    lv = -0.691 + 10.0 * np.log10(e + 1e-20)
    g = lv > -70.0
    if not g.any():
        return -math.inf
    g &= lv > -0.691 + 10.0 * np.log10(e[g].mean()) - 10.0
    return float(-0.691 + 10.0 * np.log10(e[g].mean()))


def true_peak_db(x: np.ndarray, os_: int = 4) -> float:
    up = signal.resample_poly(x, os_, 1, axis=-1)
    return float(20.0 * np.log10(np.max(np.abs(up)) + 1e-20))


def cleanup(x: np.ndarray) -> np.ndarray:
    """선형 정리: 18 Hz 아래(DC 포함) 제거, 120 Hz 아래는 모노(사이드 채널 4차 고역 통과)."""
    x = hp(x, 18.0, 2)
    m, s = 0.5 * (x[0] + x[1]), 0.5 * (x[0] - x[1])
    s = hp(s, 120.0, 4)
    return np.stack([m + s, m - s])


def glue_gain(x: np.ndarray, thr_db: float = -12.0, ratio: float = 1.4, knee_db: float = 6.0,
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
    큰 타격의 첫 몇 ms 피크만 둥글게 눌러 뒤의 리미터가 오래 게인을 내리지 않게 한다."""
    a = np.abs(x).max(axis=0)
    c = float(dbg(ceiling_db))
    k = c * float(dbg(-knee_db))
    g = np.ones_like(a)
    m = a > k
    g[m] = (k + (c - k) * np.tanh((a[m] - k) / (c - k))) / a[m]
    return g


def limiter_gain(x: np.ndarray, ceiling_db: float, lookahead: float = 0.0015, release: float = 0.05,
                 os_: int = 4) -> np.ndarray:
    """트루피크 룩어헤드 리미터의 게인 곡선.
    4배 오버샘플 피크로 필요한 게인을 구하고 → 앞을 내다보는 최솟값 → 릴리스 → 이동 평균.
    이동 평균 창 안의 값이 모두 그 샘플에 필요한 게인 이하라서 피크를 넘지 않는다."""
    n = x.shape[1]
    up = np.abs(signal.resample_poly(x, os_, 1, axis=-1)).max(axis=0)[: n * os_]
    pk = np.maximum(np.pad(up, (0, n * os_ - up.size)).reshape(n, os_).max(axis=1), np.abs(x).max(axis=0))
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
    f = tl.cue("fade")
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
    for it in range(12):
        g0 = float(dbg(G))
        x = pre * g0
        gc = glue_gain(x)
        gk = clip_gain(x * gc, ceiling_db=tp + 1.2)
        # 리미터는 믹스와 두 스템의 트루피크를 함께 본다 — 두 스템이 서로 상쇄되는 순간에도 스템 파일이 넘치지 않게
        both = np.concatenate([x, stems["music"] * g0, stems["sfx"] * g0]) * (gc * gk)
        gl = limiter_gain(both, ceiling_db=tp - 0.3)
        gain = float(dbg(G)) * gc * gk * gl * fade
        y = pre * gain
        L, TP = lufs_integrated(y), true_peak_db(y)
        log(f"  마스터 {it + 1}회: 게인 {G:+.2f} dB  글루 최대 {-20 * np.log10(gc.min()):.1f} dB"
            f"({np.argmin(gc) / SR:.2f} s)  클립 최대 {-20 * np.log10(gk.min()):.1f} dB({np.argmin(gk) / SR:.2f} s)"
            f"  리미터 최대 {-20 * np.log10(gl.min()):.1f} dB({np.argmin(gl) / SR:.2f} s)"
            f"  →  {L:.2f} LUFS, {TP:.2f} dBTP")
        if abs(L - target) < 0.03 and TP <= tp - 0.1:
            break
        G += target - L
    info = dict(lufs=L, tp=TP, gain_db=G, glue_db=-20 * np.log10(gc.min()), clip_db=-20 * np.log10(gk.min()),
                lim_db=-20 * np.log10(gl.min()))
    return y, {k: v * gain for k, v in stems.items()}, gain, info


# ── WAV 입출력(표준 라이브러리 wave) ──────────────────────────────────

def write_wav(path: Path, x: np.ndarray, bits: int = 16, key="dither") -> None:
    x = np.clip(x, -1.0, 1.0)
    if bits == 16:
        r = RNG(key)
        d = r.random(x.shape) - r.random(x.shape)            # TPDF ±1 LSB
        d[np.abs(x) < 1e-7] = 0.0                             # 디지털 무음(-140 dB 아래)은 그대로 0
        q = np.clip(np.round(x * 32767.0 + d), -32768, 32767).astype("<i2")
        data = q.T.tobytes()
    elif bits == 24:
        q = np.clip(np.round(x * 8388607.0), -8388608, 8388607).astype("<i4")
        data = q.T.reshape(-1).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    else:
        raise ValueError("bits 는 16 또는 24")
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
# 8. 자체 점검 (아무도 들어 볼 수 없으므로 숫자로 확인한다)
# ════════════════════════════════════════════════════════════════════

KEY_CUES = ("open", "verdict_ng", "lock", "data_back", "clamp", "groove", "hit", "title")   # ±2 ms 를 지켜야 함
INFO_CUES = ("see", "judge", "pick", "drop", "hmi", "credits")                              # 참고로 잰다
SFX_CUES = {"open", "verdict_ng", "see", "lock", "judge", "data_back", "pick", "clamp", "drop", "groove", "hmi",
            "hit", "credits"}
MUSIC_FIRST = {"title"}       # 제목은 낱장 폭포(4–9 ms 간격)와 겹치므로 화음·모티프가 있는 음악 스템에서 잰다
SPAN_CUES = ("scan", "servo", "lift", "zoom_out", "riser")   # 같은 이름으로 배치한 지속형 소리
ACCENT_OTHERS = ("open", "see", "lock", "judge", "data_back", "pick", "drop", "hmi", "title", "credits")


def _ratio_peak(cs: np.ndarray, lo: int, hi: int, W: int):
    """[lo, hi) 에서 (뒤 W 샘플 에너지 / 앞 W 샘플 에너지) 가 가장 큰 곳: (샘플, 비 dB)."""
    idx = np.arange(max(lo, W), min(hi, cs.size - 1 - W))
    ratio = (cs[idx + W] - cs[idx] + 1e-12) / (cs[idx] - cs[idx - W] + 1e-12)
    j = int(np.argmax(ratio))
    return int(idx[j]), float(10 * np.log10(ratio[j]))


def detect_onset(x: np.ndarray, t: float, search: float = 0.025):
    """cue ±search 안의 온셋: '바로 뒤 에너지 / 바로 앞 에너지' 비가 가장 큰 곳.
    타격의 앞머리는 고역에 있으므로 1 kHz 고역 통과 신호에서 4 ms 창으로 대략 찾고, 그 앞뒤 ±4 ms 에서
    0.5·1·1.5 ms 창으로 다시 좁혀 가운데값을 쓴다. 고역 비가 6 dB 미만으로 흐리면 광대역(8 ms 창)을 쓴다.
    t 가 0 근처면 첫 소리(1e-4 초과) 샘플. 돌려주는 값: (샘플 위치, 비 dB)."""
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


class FineOnset:
    """낱장처럼 촘촘한 짧은 소리용 온셋: 1.5 kHz 고역 에너지에서 0.5 ms 창으로 ±search 를 훑고,
    0.25·0.5·0.75 ms 창으로 다시 재어 가운데값. 같은 신호를 여러 번 재므로 필터·누적합을 한 번만 만든다."""

    def __init__(self, x: np.ndarray):
        y = hp(x, 1500.0, 4)
        self.cs = np.concatenate([[0.0], np.cumsum(y * y)])

    def __call__(self, t: float, search: float = 0.004):
        n0 = ns(t)
        k, r = _ratio_peak(self.cs, n0 - ns(search), n0 + ns(search) + 1, ns(0.0005))
        fine = sorted(_ratio_peak(self.cs, k - ns(0.001), k + ns(0.001) + 1, ns(w))[0]
                      for w in (0.00025, 0.0005, 0.00075))
        return fine[1], r


def flap_dominance(tl: Timeline, flap_hp: np.ndarray, rest_hp: np.ndarray) -> dict[int, float]:
    """낱장마다 '그 낱장 첫 3 ms 의 고역 에너지 / 앞뒤 3 ms 동안 나머지 소리의 고역 에너지'(dB).
    크면 그 신호에서 낱장 소리가 또렷이 들리고 온셋을 잴 수 있다."""
    out = {}
    for f in tl.flips:
        a, b = ns(f.t), ns(f.t + 0.003)
        c, d = max(ns(f.t - 0.003), 0), ns(f.t + 0.003)
        ef, er = float(np.mean(flap_hp[a:b] ** 2)), float(np.mean(rest_hp[c:d] ** 2))
        out[f.i] = 10.0 * math.log10((ef + 1e-20) / (er + 1e-20))
    return out


def pick_spot_flips(tl: Timeline, where: dict[int, str], count: int = 12) -> list[Flip]:
    """점검할 낱장 고르기: 이웃 낱장과 12 ms 이상 떨어져(이웃의 6 ms 되튐도 ±4 ms 찾는 창 밖) 잴 신호(where)가
    정해진 것 가운데 끝 판(폭포)에서 절반, 나머지에서 절반을 시간 순으로 고르게 뽑는다."""
    def spread(lst: list[Flip], k: int) -> list[Flip]:
        if len(lst) <= k:
            return lst
        return [lst[i] for i in np.linspace(0, len(lst) - 1, k).round().astype(int)]

    cand = [f for f in tl.flips if f.t > 0.005 and tl.isolation(f) >= 0.012 and f.i in where]
    return (spread([f for f in cand if not f.final], count // 2)
            + spread([f for f in cand if f.final], count - count // 2))


def lufs_span(x: np.ndarray, a: float, b: float) -> float:
    p = (k_filter(x[:, ns(a):ns(b)]) ** 2).sum(axis=0)
    return float(-0.691 + 10 * np.log10(p.mean() + 1e-20))


def self_check(tl: Timeline, out: Path, mx: Mixer, gain: np.ndarray, ffmpeg: str | None,
               target: float = -14.0, tp: float = -1.0, log=print) -> bool:
    mix, sr, bits = read_wav(out / "soundtrack.wav")
    mus, _, _ = read_wav(out / "stem_music.wav")
    sfx, _, _ = read_wav(out / "stem_sfx.wav")
    N = ns(tl.duration)
    B = tl.beat
    ok = True

    def check(cond: bool, label: str):
        nonlocal ok
        ok &= bool(cond)
        log(f"  [{'ok' if cond else 'FAIL'}] {label}")

    log("\n── 자체 점검 (써 낸 WAV 를 다시 읽어서) ──")
    check(mix.shape == (2, N) and mus.shape == (2, N) and sfx.shape == (2, N) and sr == SR,
          f"길이 {mix.shape[1]} 샘플 = {mix.shape[1] / sr:.4f} s (목표 {N}), {sr} Hz, {bits}-bit, 스테레오, 세 파일 같음")
    check(all(np.isfinite(a).all() for a in (mix, mus, sfx)), "NaN/Inf 없음")
    full = 32767 / 32768 if bits == 16 else 8388607 / 8388608
    clips = [int((np.abs(a) >= full).sum()) for a in (mix, mus, sfx)]
    check(sum(clips) == 0, f"클리핑 샘플 믹스·음악·효과음 {clips[0]}·{clips[1]}·{clips[2]}개, 샘플 피크 "
                           f"{20 * np.log10(np.abs(mix).max()):.2f} / {20 * np.log10(np.abs(mus).max()):.2f} / "
                           f"{20 * np.log10(np.abs(sfx).max()):.2f} dBFS")
    dc = mix.mean(axis=1)
    check(np.abs(dc).max() < 1e-4, f"DC 오프셋 L {dc[0]:+.2e}, R {dc[1]:+.2e}")
    tail = np.abs(mix[:, -ns(0.010):]).max()
    tail_s = max(np.abs(mus[:, -ns(0.010):]).max(), np.abs(sfx[:, -ns(0.010):]).max())
    check(tail == 0.0 and tail_s == 0.0, f"마지막 10 ms 디지털 무음 (믹스 최대 {tail:.1e}, 스템 최대 {tail_s:.1e})")
    first = np.abs(mix[:, :ns(0.003)]).max()
    check(first > 0.05, f"첫 소리가 0 s 에 시작 (첫 3 ms 피크 {20 * np.log10(first + 1e-12):.1f} dBFS)")
    t_hit = tl.cue("hit").t
    a, b = ns(t_hit - B / 8), ns(t_hit)
    breath = np.abs(mix[:, a:b]).max()
    check(breath == 0.0, f"타격 직전 숨 {(b - a) / SR * 1000:.1f} ms 디지털 무음 (최대 {breath:.1e})")
    err = np.abs(mus + sfx - mix).max()
    check(err < 4e-4, f"music + sfx 스템 합 = 최종 믹스 (최대 차이 {err:.1e} — 파일마다 반올림·디더가 따로라 몇 LSB)")
    L, TP = lufs_integrated(mix), true_peak_db(mix)
    check(abs(L - target) < 0.5 and TP <= tp, f"라우드니스 {L:.2f} LUFS(통합, 목표 {target:g}), 트루피크 {TP:.2f} dBTP "
                                              f"(상한 {tp:g}, 4배 오버샘플)")
    lo_m = lp(0.5 * (mix[0] + mix[1]), 100.0, 4)
    lo_s = lp(0.5 * (mix[0] - mix[1]), 100.0, 4)
    mono_db = 10 * np.log10((lo_s ** 2).sum() / ((lo_m ** 2).sum() + 1e-20) + 1e-20)
    check(mono_db < -20.0, f"100 Hz 아래 사이드/미드 에너지 {mono_db:.1f} dB (120 Hz 아래 모노)")
    edge = max(e["edge"] for e in mx.events)
    check(edge < 1e-9, f"배치한 소리 {len(mx.events)}개 모두 첫·끝 샘플이 0 (클릭 없음, 최대 {edge:.1e})")

    log("\n  cue 온셋 (오차 = 측정 − cue; 필수 cue 는 믹스에서, 고역 에너지 비가 흐리면 그 소리의 스템에서."
        "\n         참고 cue 는 그 소리만 보이도록 낱장을 뺀 효과음 스템 또는 음악 스템에서)")
    mono = mix[0] + mix[1]
    flap = mx.flap * gain                                    # 믹스와 같은 마스터 게인을 거친 낱장 소리만
    fm = flap[0] + flap[1]
    stem_mono = {"music": mus[0] + mus[1], "sfx": sfx[0] + sfx[1]}
    for cid in KEY_CUES + INFO_CUES:
        t = tl.cue(cid).t
        if cid in MUSIC_FIRST:
            k, strength = detect_onset(stem_mono["music"], t)
            where = "음악 스템"
        elif cid in INFO_CUES:
            if cid in SFX_CUES:
                k, strength = detect_onset(stem_mono["sfx"] - fm, t)
                where = "효과음 스템 − 낱장"
            else:
                k, strength = detect_onset(stem_mono["music"], t)
                where = "음악 스템"
        else:
            k, strength = detect_onset(mono, t)
            where = "믹스"
            if strength < 6.0:
                stem = "sfx" if cid in SFX_CUES else "music"
                k, strength = detect_onset(stem_mono[stem], t)
                where = f"{'효과음' if stem == 'sfx' else '음악'} 스템"
        e_ms = (k - ns(t)) / SR * 1000.0
        line = f"{cid:<11} {t:7.3f} s → {k / SR:8.4f} s  오차 {e_ms:+6.2f} ms  ({where}, 온셋 대비 {strength:4.1f} dB)"
        if cid in KEY_CUES:
            check(abs(e_ms) <= 2.0, line)
        else:
            log(f"  [참고] {line}")

    log("\n  낱장 (flips)")
    flap_ev = sorted(e["i0"] for e in mx.events if e["name"] == "flap")
    want = sorted(ns(f.t) for f in tl.flips)
    check(flap_ev == want, f"배치: JSON 의 낱장 {len(tl.flips)}개(t ≥ 0; 영상 전 {tl.n_dropped}개는 버림) "
                           f"모두 그 샘플에 놓임 (끝 판 {sum(f.final for f in tl.flips)}개, last {sum(f.last for f in tl.flips)}개)")
    P = tl.flip_period
    cells = sum(1 for f in tl.flips if f.cell >= 0)
    log(f"         칸 짐작: 한 장 넘어가는 시간 {P * 1000:.0f} ms, 칸을 찾은 낱장 {cells}/{len(tl.flips)}"
        if P else "         칸 짐작: 실패 — 난수 자리")
    flap_hp = hp(fm, 1500.0, 4)
    sigs = {"믹스": mono, "효과음 스템": stem_mono["sfx"]}
    dom = {k: flap_dominance(tl, flap_hp, hp(v - fm, 1500.0, 4)) for k, v in sigs.items()}
    clear = {k: sum(1 for f in tl.flips if d[f.i] >= 10.0) for k, d in dom.items()}
    log(f"         또렷함(낱장 고역이 나머지 소리보다 10 dB 이상): 믹스에서 {clear['믹스']}/{len(tl.flips)}개, "
        f"효과음 스템에서 {clear['효과음 스템']}/{len(tl.flips)}개")
    where = {}
    for f in tl.flips:                                       # 믹스에서 또렷하면 믹스, 아니면 효과음 스템에서 잰다
        for k in sigs:
            if dom[k][f.i] >= 10.0:
                where[f.i] = k
                break
    on_bus = FineOnset(fm)
    ons = {k: FineOnset(v) for k, v in sigs.items()}
    spots = pick_spot_flips(tl, where)
    e_sig, e_bus = [], []
    for f in spots:
        k = where[f.i]
        ks, rs = ons[k](f.t)
        kb, _ = on_bus(f.t)
        e_sig.append((ks - ns(f.t)) / SR * 1000.0)
        e_bus.append((kb - ns(f.t)) / SR * 1000.0)
        log(f"         {f.t:7.3f} s  {'last' if f.last else '    '} {'끝판' if f.final else '    '} 칸 {f.cell:>2}  "
            f"{k:<6} {e_sig[-1]:+5.2f} ms (또렷함 {dom[k][f.i]:4.1f} dB, 온셋 대비 {rs:4.1f} dB)   "
            f"낱장만 {e_bus[-1]:+5.2f} ms")
    if spots:
        n_mix = sum(1 for f in spots if where[f.i] == "믹스")
        check(max(map(abs, e_sig)) <= 2.0 and max(map(abs, e_bus)) <= 2.0,
              f"낱장 표본 {len(spots)}개(끝 판 {sum(f.final for f in spots)}개 포함; 믹스 {n_mix}개·효과음 스템 "
              f"{len(spots) - n_mix}개에서, ±4 ms 안을 찾음): 최대 오차 {max(map(abs, e_sig)):.2f} ms, "
              f"낱장만 {max(map(abs, e_bus)):.2f} ms")
    allf = [f for f in tl.flips if f.t > 0.005 and tl.isolation(f) >= 0.009]   # 이웃의 되튐(≤ 6 ms)이 창 밖
    e_all = [abs(on_bus(f.t, search=0.0025)[0] - ns(f.t)) / SR * 1000.0 for f in allf]
    if e_all:
        check(max(e_all) <= 2.0, f"이웃과 9 ms 이상 떨어진 낱장 {len(e_all)}/{len(tl.flips)}개 전부(낱장만, ±2.5 ms 안을 "
                                 f"찾음): 최대 {max(e_all):.2f} ms, 평균 {np.mean(e_all):.2f} ms")

    log("\n  지속형 cue (배치 구간 = cue 구간, 들리는 구간은 -60 dB 기준)")
    for cid in SPAN_CUES:
        ev = [e for e in mx.events if e["name"] == cid]
        if not ev:
            continue
        e, cu = ev[0], tl.cue(cid)
        check(e["i0"] == ns(cu.t) and e["i1"] <= ns(cu.end),
              f"{cid:<9} cue {cu.t:.3f}–{cu.end:.3f} s → 배치 {e['i0'] / SR:.4f}–{e['i1'] / SR:.4f} s, "
              f"들림 {e['first'] / SR:.3f}–{(e['last'] + 1) / SR:.3f} s")
    du = tl.cue("data_up")
    ev = sorted((e for e in mx.events if e["name"] == "data_up"), key=lambda e: e["i0"])
    check(bool(ev) and ev[0]["i0"] == ns(du.t) and ev[-1]["i0"] < ns(du.end) and ev[-1]["i1"] <= ns(du.end) + ns(0.06),
          f"data_up   cue {du.t:.3f}–{du.end:.3f} s → 블립 {len(ev)}개 {ev[0]['i0'] / SR:.4f}–{ev[-1]['i1'] / SR:.4f} s")

    log("\n  강세 세기 (cue 부터 400 ms / 150 ms — 다음 cue 가 먼저 오면 거기까지 — 의 K 가중 라우드니스)")
    p = (k_filter(mix) ** 2).sum(axis=0)
    cs = np.concatenate([[0.0], np.cumsum(p)])

    def loud(t, d):
        a_, b_ = ns(t), ns(t + d)
        return -0.691 + 10 * np.log10((cs[b_] - cs[a_]) / max(b_ - a_, 1) + 1e-20)

    starts = sorted({c.t for c in tl.cue_list})

    def accent(cid: str, d: float) -> float:
        """cue 부터 d 초 — 다음 cue 가 먼저 오면 거기까지(뒤 cue 의 강세가 섞이지 않게)."""
        t = tl.cue(cid).t
        nxt = min([x for x in starts if x > t + 1e-6] or [tl.duration])
        return loud(t, min(d, nxt - t))

    ids = ("hit", "groove", "verdict_ng", "clamp") + ACCENT_OTHERS
    for d in (0.4, 0.15):
        Ld = {c: accent(c, d) for c in ids}
        top = max(ACCENT_OTHERS, key=Ld.get)
        log("         " + "  ".join(f"{c} {Ld[c]:.1f}" for c in ids))
        cond = (Ld["hit"] > Ld["groove"] > max(Ld["verdict_ng"], Ld["clamp"])
                and abs(Ld["verdict_ng"] - Ld["clamp"]) <= 2.0 and min(Ld["verdict_ng"], Ld["clamp"]) > Ld[top])
        check(cond, f"순서 ({d * 1000:.0f} ms): hit {Ld['hit']:.1f} > groove {Ld['groove']:.1f} > "
                    f"verdict_ng {Ld['verdict_ng']:.1f} ≈ clamp {Ld['clamp']:.1f} > 나머지 (가장 큰 것 {top} {Ld[top]:.1f})")
    # 영상 전체에서 가장 큰 순간은 타격, 타격과 그 울림(타격 ~ 제목)을 빼면 가장 큰 순간은 그루브 드롭인지
    t_g, t_title = tl.cue("groove").t, tl.cue("title").t
    for d in (0.4, 0.15):
        nb = ns(d)
        st = np.arange(0, p.size - nb, ns(0.01))
        mom = -0.691 + 10 * np.log10((cs[st + nb] - cs[st]) / nb + 1e-20)
        ts = st / SR
        j1 = int(np.argmax(mom))
        rest = (ts < t_hit - d) | (ts >= t_title)
        j2 = int(np.flatnonzero(rest)[np.argmax(mom[rest])])
        rest3 = rest & (np.abs(ts - ts[j2]) > d)
        j3 = int(np.flatnonzero(rest3)[np.argmax(mom[rest3])])
        cond = abs(ts[j1] - t_hit) <= 0.1 and abs(ts[j2] - t_g) <= 0.1
        check(cond, f"가장 큰 순간 ({d * 1000:.0f} ms 창, 10 ms 간격): {ts[j1]:.2f} s {mom[j1]:.1f}; 타격과 그 울림"
                    f"({t_hit - d:.2f}–{t_title:.2f} s)을 빼면 {ts[j2]:.2f} s {mom[j2]:.1f}  "
                    f"(다음 {ts[j3]:.2f} s {mom[j3]:.1f}, {mom[j2] - mom[j3]:.1f} dB 차)")

    log("\n  구간별 라우드니스 (K 가중, 게이트 없음; '낱장' = 낱장 소리만)")
    for sid, (a_, b_) in tl.sections.items():
        log(f"         {sid:<8} {a_:5.1f}–{b_:5.1f} s   믹스 {loud(a_, b_ - a_):6.1f}   "
            f"음악 {lufs_span(mus, a_, b_):6.1f}   효과음 {lufs_span(sfx, a_, b_):6.1f}   "
            f"낱장 {lufs_span(flap, a_, b_):6.1f}  LUFS")
    sl = tl.cue("silence")
    h = sl.t + 0.5 * sl.dur
    log(f"         정적 뒤쪽 {h:5.2f}–{sl.end:5.2f} s   믹스 {loud(h, sl.end - h):6.1f}  LUFS (드론 + 낱장 + 불량 잔향)")

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


# ════════════════════════════════════════════════════════════════════
# main
# ════════════════════════════════════════════════════════════════════

def main(argv=None) -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="16초 홍보 영상 v2 사운드트랙(음악+효과음) 합성")
    ap.add_argument("--timeline", type=Path, default=HERE / "timeline.json", help="timeline.json 경로")
    ap.add_argument("--out", type=Path, default=PROMO / "out" / HERE.name, help="WAV 를 쓸 폴더 (기본 promo/out/v2)")
    ap.add_argument("--bits", type=int, choices=(16, 24), default=16, help="비트 깊이 (기본 16, TPDF 디더)")
    ap.add_argument("--lufs", type=float, default=-14.0, help="통합 라우드니스 목표 (기본 -14)")
    ap.add_argument("--tp", type=float, default=-1.0, help="트루피크 상한 dBTP (기본 -1.0)")
    ap.add_argument("--ffmpeg", type=str, default=os.environ.get("FFMPEG"), help="있으면 ffmpeg ebur128 로도 측정")
    ap.add_argument("--no-check", action="store_true", help="자체 점검 생략")
    args = ap.parse_args(argv)

    t_start = time.time()
    tl = Timeline(args.timeline)
    n = ns(tl.duration)
    print(f"timeline: {args.timeline}  ({tl.bpm:g} BPM, 박 {tl.beat:.3f} s, {tl.duration:g} s = {n} 샘플, "
          f"cue {len(tl.cue_list)}개, 땅 {len(tl.lands)}개, 낱장 {len(tl.flips)}개 + 영상 전 {tl.n_dropped}개 버림)")

    irs = {"hall": make_ir(2.8, (2.0, 1.7, 0.8), 0.020, "hall"),
           "room": make_ir(0.6, (0.35, 0.3, 0.18), 0.004, "room", early=14)}
    mx = Mixer(n, tl.cue("hit").t)
    gate = arrange(tl, mx, irs)
    print(f"  배치한 소리 {len(mx.events)}개, 합성 {time.time() - t_start:.1f} s")
    stems = mx.render(irs, echo_delay=0.75 * tl.beat, gate_pre=gate)         # 에코 = 점8분음표
    mix, stems, gain, info = master(stems, tl, args.lufs, args.tp)

    args.out.mkdir(parents=True, exist_ok=True)
    write_wav(args.out / "soundtrack.wav", mix, args.bits, "d_mix")
    write_wav(args.out / "stem_music.wav", stems["music"], args.bits, "d_music")
    write_wav(args.out / "stem_sfx.wav", stems["sfx"], args.bits, "d_sfx")
    print(f"  썼음: {args.out / 'soundtrack.wav'} (+ stem_music.wav, stem_sfx.wav)  {time.time() - t_start:.1f} s")

    if args.no_check:
        return 0
    return 0 if self_check(tl, args.out, mx, gain, args.ffmpeg, args.lufs, args.tp) else 1


if __name__ == "__main__":
    sys.exit(main())
