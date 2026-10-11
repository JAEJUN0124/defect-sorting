// 심플함 정량 측정 — Apple HIG에서 뽑은 기준과 지금 화면을 비교합니다.
// 사용법: 브라우저 개발자 도구 콘솔에 이 파일 내용을 붙여 넣고 실행하면 결과 객체가 나옵니다.
// 화면에 "지금 보이는" 요소만 셉니다. 캔버스(카메라 영상) 안의 그림은 내용으로 보고 제외합니다.
(function simplicityAudit() {
  const VW = innerWidth;
  const VH = innerHeight;
  const STEP = 8; // 면적 표본 간격(px)

  // 전환 효과가 도는 중이면 중간 색이 잡히므로, 재는 동안만 전환·애니메이션을 끈다
  const freeze = document.createElement('style');
  freeze.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
  document.head.appendChild(freeze);
  void document.body.offsetHeight;
  try {
    return measure();
  } finally {
    freeze.remove();
  }

  function measure() {
    // ---------- 색 계산 ----------
    const parseColor = (str) => {
      const m = str && str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (a, b) => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const hsl = ({ r, g, b }) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
      }
      return { h, s, l };
    };
    const isChromatic = (c) => {
      if (!c || c.a < 0.5) return false;
      const { s, l } = hsl(c);
      return s >= 0.25 && l > 0.08 && l < 0.95;
    };
    // 색상각이 계열 첫 색에서 25° 안쪽이면 같은 계열로 묶는다 (노랑과 짙은 노랑 글자는 한 계열)
    const hueFamilies = (colors) => {
      const hues = colors.map((c) => hsl(c).h).sort((a, b) => a - b);
      const starts = [];
      hues.forEach((h) => { if (!starts.length || h - starts[starts.length - 1] > 25) starts.push(h); });
      // 빨강은 0°와 360° 양쪽에 걸친다
      if (starts.length > 1 && starts[0] + 360 - hues[hues.length - 1] <= 25) starts.shift();
      return starts.length;
    };

    // ---------- 보이는 요소 ----------
    const isVisible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < VH && r.left < VW;
    };
    const all = Array.from(document.body.querySelectorAll('*')).filter((el) => !el.closest('svg') && isVisible(el));
    const ownText = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    // 글자색이 투명하면(스크린 리더용 숨은 글자) 보이는 글자가 아니다
    const inkVisible = (el) => (parseColor(getComputedStyle(el).color) || { a: 1 }).a >= 0.1;
    const textEls = all.filter((el) => ownText(el).length > 0 && inkVisible(el));
    const interactive = all.filter((el) => el.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex="-1"])'));
    const bgOf = (el) => {
      for (let node = el; node; node = node.parentElement) {
        const c = parseColor(getComputedStyle(node).backgroundColor);
        if (c && c.a >= 0.5) return c;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    // 글자 바로 아래가 사진·영상이면 배경색을 알 수 없으므로 대비 검사에서 뺀다
    const overMedia = (el) => {
      const r = el.getBoundingClientRect();
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      for (const below of stack.slice(stack.indexOf(el) + 1)) {
        if (below.matches('img, picture, video, canvas')) return true;
        const c = parseColor(getComputedStyle(below).backgroundColor);
        if (c && c.a >= 0.5) return false;
      }
      return false;
    };
    const pageBg = bgOf(document.body);

    // ---------- 1~4. 글자 ----------
    const families = new Set();
    const sizes = new Set();
    const weights = new Set();
    textEls.forEach((el) => {
      const cs = getComputedStyle(el);
      families.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      sizes.add(parseFloat(cs.fontSize));
      weights.add(cs.fontWeight);
    });
    const minSize = Math.min(...sizes);
    const lightWeights = Array.from(weights).filter((w) => Number(w) < 400);

    // ---------- 5~7. 색과 장식 ----------
    const palette = new Map();
    const addColor = (str) => {
      const c = parseColor(str);
      if (!c || c.a < 0.1) return;
      palette.set(`${c.r},${c.g},${c.b}`, c);
    };
    all.forEach((el) => {
      const cs = getComputedStyle(el);
      if (ownText(el)) addColor(cs.color);
      addColor(cs.backgroundColor);
      ['Top', 'Right', 'Bottom', 'Left'].forEach((side) => {
        if (parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none') addColor(cs['border' + side + 'Color']);
      });
    });
    const chromatic = Array.from(palette.values()).filter(isChromatic);
    const hueCount = hueFamilies(chromatic);

    const effects = new Set();
    let gradients = 0;
    all.forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.boxShadow !== 'none') cs.boxShadow.split(/,(?![^(]*\))/).forEach((s) => effects.add('shadow:' + s.trim()));
      if (cs.textShadow !== 'none') effects.add('text-shadow:' + cs.textShadow);
      if (/gradient/.test(cs.backgroundImage)) { gradients += 1; effects.add('gradient:' + cs.backgroundImage); }
      if (cs.filter !== 'none') effects.add('filter:' + cs.filter);
      if (cs.backdropFilter && cs.backdropFilter !== 'none') effects.add('backdrop:' + cs.backdropFilter);
    });

    // 면적: 8px 간격 표본으로 유채색 면적과 여백을 잰다
    const cols = Math.ceil(VW / STEP);
    const rows = Math.ceil(VH / STEP);
    const filled = new Uint8Array(cols * rows);
    const mark = (r) => {
      const x0 = Math.max(0, Math.floor(r.left / STEP));
      const x1 = Math.min(cols - 1, Math.floor((r.right - 0.01) / STEP));
      const y0 = Math.max(0, Math.floor(r.top / STEP));
      const y1 = Math.min(rows - 1, Math.floor((r.bottom - 0.01) / STEP));
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) filled[y * cols + x] = 1;
    };
    // 내용 = 글자 + 조작 요소 + 영상 + 바탕과 확연히 다른 면(대비 1.5 이상)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let words = 0;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const p = n.parentElement;
      if (!n.textContent.trim() || !p || p.closest('svg') || !isVisible(p) || !inkVisible(p)) continue;
      words += n.textContent.trim().split(/\s+/).length;
      const range = document.createRange();
      range.selectNodeContents(n);
      Array.from(range.getClientRects()).forEach(mark);
    }
    interactive.forEach((el) => mark(el.getBoundingClientRect()));
    all.forEach((el) => {
      if (el.matches('canvas, img, video')) { mark(el.getBoundingClientRect()); return; }
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.5 && contrast(c, pageBg) >= 1.5) mark(el.getBoundingClientRect());
    });
    const whitespace = 1 - filled.reduce((a, b) => a + b, 0) / filled.length;

    let chromaPoints = 0;
    let points = 0;
    for (let y = STEP / 2; y < VH; y += STEP) {
      for (let x = STEP / 2; x < VW; x += STEP) {
        points += 1;
        const el = document.elementFromPoint(x, y);
        if (!el || el.closest('canvas, img, video')) continue;
        if (isChromatic(bgOf(el))) chromaPoints += 1;
      }
    }
    const chromaArea = chromaPoints / points;

    // ---------- 8. 글자 대비 (HIG 표: 17pt 이하 4.5:1, 18pt 이상 또는 굵은 글자 3:1) ----------
    const contrastRows = textEls
      .filter((el) => !el.closest('button:disabled') && !overMedia(el))
      .map((el) => {
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const need = size >= 18 || Number(cs.fontWeight) >= 700 ? 3 : 4.5;
        // 반투명 글자색은 배경과 섞어서 실제 보이는 색으로 잰다
        const fg = parseColor(cs.color);
        const bg = bgOf(el);
        const seen = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
        const ratio = contrast(seen, bg);
        return { text: ownText(el).slice(0, 24), ratio: Math.round(ratio * 100) / 100, need, pass: ratio >= need };
      });
    const contrastPass = contrastRows.filter((r) => r.pass).length / contrastRows.length;

    // ---------- 9~11. 조작 ----------
    const targets = interactive.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height), pass: r.width >= 44 && r.height >= 44 };
    });
    const targetPass = targets.filter((t) => t.pass).length / targets.length;

    const prominent = interactive.filter((el) => {
      if (el.disabled) return false;
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (!c || c.a < 0.5) return false;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 1500) return false;
      return isChromatic(c) || contrast(c, bgOf(el.parentElement)) >= 3;
    }).map((el) => el.textContent.trim().slice(0, 16));

    // ---------- 12~13. 리듬 ----------
    // 96px보다 큰 값은 margin: auto 처럼 남는 자리를 나눈 결과라 간격 값으로 보지 않는다
    const spacing = [];
    all.forEach((el) => {
      const cs = getComputedStyle(el);
      ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap'].forEach((prop) => {
        const v = parseFloat(cs[prop]);
        if (v > 0 && v <= 96) spacing.push(v);
      });
    });
    const offGrid = spacing.filter((v) => Math.abs(v / 4 - Math.round(v / 4)) > 0.13);
    const gridPass = spacing.length ? 1 - offGrid.length / spacing.length : 1;

    const radii = new Set();
    all.forEach((el) => {
      const v = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      if (!(v > 0)) return;
      const r = el.getBoundingClientRect();
      radii.add(v >= Math.min(r.width, r.height) / 2 - 0.5 ? 'circle' : v + 'px');
    });

    // ---------- 15. 동작 줄이기 ----------
    const reducedMotion = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((rule) => rule.media && /prefers-reduced-motion/.test(rule.media.mediaText));
      } catch (e) {
        return false;
      }
    });

    // ---------- 점수 ----------
    const pct = (v) => Math.round(v * 1000) / 10;
    const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
    const step = (value, table) => { for (const [limit, score] of table) if (value <= limit) return score; return table[table.length - 1][1]; };
    // 요구사항을 하는 데 꼭 필요한 조작: 시작/정지, 긴급정지, 종료, 원점, 카메라, 자동, 수동, 로그 (+ 다크 모드 버튼이 있으면)
    // (+ 긴급정지 중에는 해제, 로그 창이 열려 있으면 닫기)
    // 이 HMI 전용 지표라 다른 화면(예: Apple 앱)을 잴 때는 점수에서 뺀다
    const isHmi = !!document.getElementById('btn-estop');
    const shown = (id) => { const node = document.getElementById(id); return !!node && isVisible(node); };
    const REQUIRED_CONTROLS = 8 + (shown('btn-theme') ? 1 : 0) + (shown('btn-release') ? 1 : 0) + (shown('btn-log-close') ? 1 : 0);

    const metrics = [
      { id: 1, group: '절제', name: '서체 수', value: families.size, target: '1개', basis: 'HIG 명시', score: step(families.size, [[1, 100], [2, 60], [99, 20]]) },
      { id: 2, group: '절제', name: '글자 크기 단계', value: sizes.size, target: '5단계 이하', basis: '관찰 추정', score: step(sizes.size, [[4, 100], [5, 90], [6, 70], [7, 50], [99, 30]]) },
      { id: 3, group: '절제', name: '굵기 종류 (가는 굵기 금지)', value: weights.size + (lightWeights.length ? ' (가는 굵기 있음)' : ''), target: '3종 이하, 400 미만 없음', basis: 'HIG 명시', score: clamp(step(weights.size, [[3, 100], [4, 70], [99, 40]]) - (lightWeights.length ? 40 : 0)) },
      { id: 4, group: '명료', name: '가장 작은 글자', value: minSize + 'px', target: '11pt 이상 (macOS 10pt)', basis: 'HIG 명시', score: minSize >= 11 ? 100 : minSize >= 10 ? 80 : 0 },
      { id: 5, group: '절제', name: '유채색 계열 수', value: hueCount, target: '3계열 이하', basis: 'HIG 원칙 + 관찰', score: step(hueCount, [[3, 100], [4, 70], [5, 40], [99, 10]]) },
      { id: 6, group: '절제', name: '유채색 면적', value: pct(chromaArea) + '%', target: '10% 이하', basis: '관찰 추정', score: clamp(chromaArea <= 0.1 ? 100 : 100 - ((chromaArea - 0.1) / 0.2) * 100) },
      { id: 7, group: '절제', name: '입체·장식 효과 종류', value: effects.size + (gradients ? ` (그라디언트 ${gradients})` : ''), target: '2종 이하, 그라디언트 0', basis: '관찰 추정', score: clamp(step(effects.size, [[2, 100], [3, 80], [4, 60], [99, 30]]) - gradients * 20) },
      { id: 8, group: '명료', name: '글자 대비 통과율', value: pct(contrastPass) + '%', target: '100%', basis: 'HIG 명시', score: clamp(contrastPass * 100) },
      { id: 9, group: '명료', name: '44pt 조작 영역 충족률', value: pct(targetPass) + '%', target: '100%', basis: 'HIG 명시', score: clamp(targetPass * 100) },
      { id: 10, group: '집중', name: '강조 버튼 수', value: prominent.length, target: '1~2개', basis: 'HIG 명시', score: step(prominent.length, [[2, 100], [3, 60], [4, 30], [99, 0]]) },
      { id: 11, group: '집중', name: '필요 조작 대비 실제 조작 수', value: isHmi ? `${REQUIRED_CONTROLS}/${interactive.length}` : `조작 ${interactive.length}개 (해당 없음)`, target: '100% (군더더기 0)', basis: 'HIG 원칙', score: isHmi ? clamp((REQUIRED_CONTROLS / Math.max(interactive.length, REQUIRED_CONTROLS)) * 100) : null },
      { id: 12, group: '일관', name: '4px 간격 격자 준수율', value: pct(gridPass) + '%', target: '100%', basis: 'HIG 원칙 + 관찰', score: clamp(gridPass * 100) },
      { id: 13, group: '일관', name: '모서리 반경 종류', value: radii.size, target: '3종 이하', basis: '관찰 추정', score: step(radii.size, [[3, 100], [4, 75], [5, 50], [99, 25]]) },
      { id: 14, group: '집중', name: '여백 비율', value: pct(whitespace) + '%', target: '40% 이상', basis: '관찰 추정', score: clamp(whitespace >= 0.4 ? 100 : ((whitespace - 0.1) / 0.3) * 100) },
      { id: 15, group: '명료', name: '동작 줄이기 대응', value: reducedMotion ? '있음' : '없음', target: '있음', basis: 'HIG 명시', score: reducedMotion ? 100 : 0 },
    ];
    const scored = metrics.filter((m) => m.score !== null);
    const total = Math.round(scored.reduce((a, m) => a + m.score, 0) / scored.length);
    // 다른 화면과 같은 잣대로 비교할 때 쓰는 점수 (HMI 전용 11번 제외)
    const common = metrics.filter((m) => m.id !== 11);
    const totalCommon = Math.round(common.reduce((a, m) => a + m.score, 0) / common.length);

    return {
      viewport: `${VW}x${VH}`,
      total,
      totalCommon,
      metrics,
      details: {
        families: Array.from(families),
        sizes: Array.from(sizes).sort((a, b) => a - b),
        weights: Array.from(weights),
        palette: palette.size,
        chromatic: chromatic.map((c) => `rgb(${c.r},${c.g},${c.b})`),
        effects: Array.from(effects),
        prominent,
        controls: targets,
        failedContrast: contrastRows.filter((r) => !r.pass),
        offGrid: Array.from(new Set(offGrid)),
        radii: Array.from(radii),
        words,
      },
    };
  }
})();
