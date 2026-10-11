// 카메라 영상 흉내 — 컨베이어 위 부품과 판정 상자를 그립니다 (가짜 서버를 쓸 때만).
// 실제 서버에서는 이 캔버스 대신 MJPEG <img>가 보입니다.
(function () {
  const C = {
    bg: '#2A3036',
    belt: '#353C43',
    beltEdge: '#4A525A',
    beltLine: 'rgba(255,255,255,0.05)',
    inspect: 'rgba(255,255,255,0.35)',
    part: '#C3C9CF',
    hole: '#7D858D',
    scratch: '#2A3036',
    good: '#46B07A',
    defect: '#F2B705',
    tagText: '#1C2024',
  };
  const SECONDS_PER_PART = 1.6; // 가짜 서버의 판정 주기와 맞춘다

  class CameraSim {
    constructor(canvas, labels) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.labels = labels; // { good: '양품', defect: '불량' }
      this.items = [];
      this.on = false;
      this.belt = false;
      this.offset = 0;
      this.w = 0;
      this.h = 0;
      this.frame = this.frame.bind(this);
      this.readTheme();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.readTheme(); this.draw(); });
    }

    // 영상 바탕은 CSS 화면색(--c-screen)을 따른다. 켜기 전 빈 화면과 같은 색이라 켜고 끌 때 색이 튀지 않는다
    readTheme() {
      this.bg = getComputedStyle(this.canvas).getPropertyValue('--c-screen').trim() || C.bg;
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const first = !this.w;
      this.w = r.width;
      this.h = r.height;
      if (first) this.seed();
      this.draw();
    }

    gap() { return Math.max(150, this.w / 4); }
    size() { return Math.min(this.h * 0.24, 76); }

    seed() {
      this.items = [];
      for (let x = this.w * 0.12; x < this.w + this.gap(); x += this.gap()) this.items.push(this.makePart(x));
    }

    makePart(x) { return { x, tilt: (Math.random() - 0.5) * 0.25, result: null, alpha: 1 }; }

    start() {
      if (this.on) return;
      this.on = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    stop() {
      this.on = false;
      cancelAnimationFrame(this.raf);
    }

    setBelt(running) { this.belt = running; }

    // 판정 결과가 오면 검사선에 가장 가까운, 아직 판정 안 된 부품에 붙인다
    mark(result) {
      const line = this.w * 0.5;
      let best = null;
      let bestDist = Infinity;
      this.items.forEach((it) => {
        if (it.result) return;
        const d = Math.abs(it.x - line);
        if (d < bestDist) { bestDist = d; best = it; }
      });
      if (best) best.result = result;
    }

    frame(ts) {
      if (!this.on) return;
      const dt = Math.min(0.1, (ts - this.last) / 1000);
      this.last = ts;
      if (this.belt && this.w) this.advance(dt);
      this.draw();
      this.raf = requestAnimationFrame(this.frame);
    }

    advance(dt) {
      const speed = this.gap() / SECONDS_PER_PART;
      const dx = speed * dt;
      this.offset = (this.offset + dx) % 24;
      this.items.forEach((it) => {
        it.x += dx;
        // 불량품은 검사선을 지나면 로봇팔이 집어 간 것처럼 사라진다
        if (it.result === 'defect' && it.x > this.w * 0.68) it.alpha = Math.max(0, it.alpha - dt * 2.5);
      });
      this.items = this.items.filter((it) => it.x < this.w + this.size() && it.alpha > 0);
      // 왼쪽 화면 밖에서 다음 부품을 들여보낸다
      const leftmost = this.items.reduce((min, it) => Math.min(min, it.x), Infinity);
      if (!this.items.length) this.items.push(this.makePart(-this.size()));
      else if (leftmost - this.gap() > -this.size()) this.items.push(this.makePart(leftmost - this.gap()));
    }

    draw() {
      const { ctx, w, h } = this;
      if (!w) return;
      const top = h * 0.3;
      const bottom = h * 0.7;

      ctx.fillStyle = this.bg;
      ctx.fillRect(0, 0, w, h);

      // 벨트
      ctx.fillStyle = C.belt;
      ctx.fillRect(0, top, w, bottom - top);
      ctx.strokeStyle = C.beltLine;
      ctx.lineWidth = 2;
      for (let x = -24 + this.offset; x < w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      ctx.fillStyle = C.beltEdge;
      ctx.fillRect(0, top - 3, w, 3);
      ctx.fillRect(0, bottom, w, 3);

      // 검사선
      ctx.strokeStyle = C.inspect;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(w * 0.5, top - 20);
      ctx.lineTo(w * 0.5, bottom + 20);
      ctx.stroke();
      ctx.setLineDash([]);

      // 부품
      const s = this.size();
      const cy = (top + bottom) / 2;
      this.items.forEach((it) => this.drawPart(it, cy, s));
    }

    drawPart(it, cy, s) {
      const { ctx } = this;
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.translate(it.x, cy);
      ctx.rotate(it.tilt);
      ctx.fillStyle = C.part;
      roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.14);
      ctx.fill();
      ctx.fillStyle = C.hole;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      if (it.result === 'defect') {
        ctx.strokeStyle = C.scratch;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-s * 0.32, -s * 0.2);
        ctx.lineTo(-s * 0.05, s * 0.05);
        ctx.lineTo(s * 0.12, s * 0.32);
        ctx.stroke();
      }
      ctx.restore();

      if (!it.result) return;
      const color = it.result === 'defect' ? C.defect : C.good;
      const pad = 10;
      const box = s + pad * 2;
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(it.x - box / 2, cy - box / 2, box, box);
      const label = this.labels[it.result];
      ctx.font = '600 14px "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = color;
      ctx.fillRect(it.x - box / 2 - 1, cy - box / 2 - 24, tw, 24);
      ctx.fillStyle = C.tagText;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, it.x - box / 2 + 5, cy - box / 2 - 12);
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.CameraSim = CameraSim;
})();
