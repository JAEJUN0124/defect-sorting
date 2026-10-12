// 카메라 영상 흉내 — 컨베이어 위 부품과 판정 상자를 그립니다 (가짜 서버를 쓸 때만).
// 장면 하나를 1280×720(키트 카메라 720p) 좌표로 움직이고, 붙인 캔버스마다 따로 그립니다.
// 위 카메라는 전체(zoom 1), 근접 카메라는 검사선 근처를 크게(zoom 2.2) 보여 줍니다.
// 실제 서버에서는 이 캔버스 대신 camera.js가 서버 영상을 띄웁니다.
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
  const W = 1280;
  const H = 720;
  const GAP = 320; // 부품 사이 거리
  const SIZE = 96; // 부품 한 변
  const SECONDS_PER_PART = 1.6; // 가짜 서버의 판정 주기와 맞춘다
  const LINE_X = W * 0.5; // 검사선

  class CameraSim {
    constructor(labels) {
      this.labels = labels; // { good: '양품', defect: '불량' }
      this.items = [];
      for (let x = W * 0.12; x < W + GAP; x += GAP) this.items.push(makePart(x));
      this.views = new Set();
      this.belt = false;
      this.offset = 0;
      this.frame = this.frame.bind(this);
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.readTheme(); this.draw(); });
    }

    attach(canvas, options) {
      const view = { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, zoom: (options && options.zoom) || 1, bg: C.bg };
      view.observer = new ResizeObserver(() => this.resize(view));
      view.observer.observe(canvas);
      this.views.add(view);
      this.readTheme();
      this.resize(view);
      if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.frame); }
      return view;
    }

    detach(view) {
      if (!view || !this.views.has(view)) return;
      view.observer.disconnect();
      this.views.delete(view);
      if (!this.views.size) { cancelAnimationFrame(this.raf); this.raf = 0; }
    }

    // 영상 바탕은 CSS 화면색(--c-screen)을 따른다. 켜기 전 빈 화면과 같은 색이라 켜고 끌 때 색이 튀지 않는다
    readTheme() {
      this.views.forEach((v) => { v.bg = getComputedStyle(v.canvas).getPropertyValue('--c-screen').trim() || C.bg; });
    }

    resize(view) {
      const r = view.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = window.devicePixelRatio || 1;
      view.canvas.width = Math.round(r.width * dpr);
      view.canvas.height = Math.round(r.height * dpr);
      view.w = r.width;
      view.h = r.height;
      view.dpr = dpr;
      this.drawView(view);
    }

    setBelt(running) { this.belt = running; }

    // 판정 결과가 오면 검사선에 가장 가까운, 아직 판정 안 된 부품에 붙인다
    mark(result) {
      let best = null;
      let bestDist = Infinity;
      this.items.forEach((it) => {
        if (it.result) return;
        const d = Math.abs(it.x - LINE_X);
        if (d < bestDist) { bestDist = d; best = it; }
      });
      if (best) best.result = result;
    }

    frame(ts) {
      if (!this.views.size) { this.raf = 0; return; }
      const dt = Math.min(0.1, (ts - this.last) / 1000);
      this.last = ts;
      if (this.belt) this.advance(dt);
      this.draw();
      this.raf = requestAnimationFrame(this.frame);
    }

    advance(dt) {
      const dx = (GAP / SECONDS_PER_PART) * dt;
      this.offset = (this.offset + dx) % 32;
      this.items.forEach((it) => {
        it.x += dx;
        // 불량품은 검사선을 지나면 로봇팔이 집어 간 것처럼 사라진다
        if (it.result === 'defect' && it.x > W * 0.68) it.alpha = Math.max(0, it.alpha - dt * 2.5);
      });
      this.items = this.items.filter((it) => it.x < W + SIZE && it.alpha > 0);
      const leftmost = this.items.reduce((min, it) => Math.min(min, it.x), Infinity);
      if (!this.items.length) this.items.push(makePart(-SIZE));
      else if (leftmost - GAP > -SIZE) this.items.push(makePart(leftmost - GAP));
    }

    draw() { this.views.forEach((v) => this.drawView(v)); }

    drawView(view) {
      const { ctx, w, h } = view;
      if (!w) return;
      const dpr = view.dpr || 1;
      // 화면을 꽉 채우도록(cover) 맞추고, 확대할 때는 검사선 가운데를 기준으로 키운다
      const s = Math.max(w / W, h / H) * view.zoom;
      const ox = w / 2 - LINE_X * s;
      const oy = h / 2 - (H / 2) * s;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = view.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);

      const top = H * 0.3;
      const bottom = H * 0.7;
      ctx.fillStyle = C.belt;
      ctx.fillRect(-W, top, W * 3, bottom - top);
      ctx.strokeStyle = C.beltLine;
      ctx.lineWidth = 2.5;
      for (let x = -W + this.offset; x < W * 2; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      ctx.fillStyle = C.beltEdge;
      ctx.fillRect(-W, top - 4, W * 3, 4);
      ctx.fillRect(-W, bottom, W * 3, 4);

      ctx.strokeStyle = C.inspect;
      ctx.lineWidth = 1.5 / s;
      ctx.setLineDash([8 / s, 8 / s]);
      ctx.beginPath();
      ctx.moveTo(LINE_X, top - 26);
      ctx.lineTo(LINE_X, bottom + 26);
      ctx.stroke();
      ctx.setLineDash([]);

      const cy = (top + bottom) / 2;
      this.items.forEach((it) => this.drawPart(ctx, it, cy));
      // 판정 상자와 글자는 화면 픽셀 기준으로 그린다 (확대해도 선·글자 크기가 같게)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.items.forEach((it) => { if (it.result) this.drawTag(ctx, it, ox + it.x * s, oy + cy * s, SIZE * s); });
    }

    drawPart(ctx, it, cy) {
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.translate(it.x, cy);
      ctx.rotate(it.tilt);
      ctx.fillStyle = C.part;
      roundRect(ctx, -SIZE / 2, -SIZE / 2, SIZE, SIZE, SIZE * 0.14);
      ctx.fill();
      ctx.fillStyle = C.hole;
      ctx.beginPath();
      ctx.arc(0, 0, SIZE * 0.18, 0, Math.PI * 2);
      ctx.fill();
      if (it.result === 'defect') {
        ctx.strokeStyle = C.scratch;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-SIZE * 0.32, -SIZE * 0.2);
        ctx.lineTo(-SIZE * 0.05, SIZE * 0.05);
        ctx.lineTo(SIZE * 0.12, SIZE * 0.32);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawTag(ctx, it, x, y, size) {
      const color = it.result === 'defect' ? C.defect : C.good;
      const box = size + 20;
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - box / 2, y - box / 2, box, box);
      const label = this.labels[it.result];
      ctx.font = '600 14px "IBM Plex Sans KR", "Malgun Gothic", sans-serif';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = color;
      ctx.fillRect(x - box / 2 - 1, y - box / 2 - 24, tw, 24);
      ctx.fillStyle = C.tagText;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x - box / 2 + 5, y - box / 2 - 12);
      ctx.restore();
    }
  }

  function makePart(x) { return { x, tilt: (Math.random() - 0.5) * 0.25, result: null, alpha: 1 }; }

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
