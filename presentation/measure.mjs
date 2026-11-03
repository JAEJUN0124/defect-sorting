// 발표 목업 세 안을 같은 방법으로 잰다: 화면 글자 수, 글자 크기·색 종류, 그림 요소, 글자 대비(가장 낮은 값).
// 사용: node measure.mjs <presentation 폴더> v1 v2 v3
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [root, ...versions] = process.argv.slice(2);
const VOID = new Set(['img', 'br', 'hr']);
const TEXT = new Set(['h1', 'h2', 'h3', 'p', 'li']);

function lum(hex) {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v.slice(0, 6);
  const ch = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const styleOf = (attrs) => { const m = attrs.match(/style="([^"]*)"/); return m ? m[1] : ''; };
const prop = (style, name) => {
  const m = style.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)'));
  return m ? m[1].trim() : null;
};
// 그라데이션 바탕은 가운데 정지점 색으로 본다
function bgColor(style) {
  const b = prop(style, 'background');
  if (!b) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(b)) return b;
  const stops = b.match(/#[0-9a-f]{6}/gi);
  return stops ? stops[Math.floor(stops.length / 2)] : null;
}

function measureSlide(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<aside>[\s\S]*?<\/aside>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '<svg></svg>');
  const stack = [];
  const out = { chars: 0, sizes: new Set(), colors: new Set(), elems: 0, imgs: 0, svgs: 0, shapes: 0, icons: 0, connectors: 0, minLarge: Infinity, minSmall: Infinity, words: [] };
  const re = /<(\/?)([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(body))) {
    if (m[4] !== undefined) {
      const text = m[4].replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, '');
      if (!text) continue;
      out.chars += text.length;
      // 글자가 놓인 요소: 가장 가까운 글 요소의 크기, 물려받은 색과 바탕
      const host = [...stack].reverse().find((s) => TEXT.has(s.tag)) || stack[stack.length - 1];
      const color = [...stack].reverse().map((s) => s.color).find(Boolean);
      const bg = [...stack].reverse().map((s) => s.bg).find(Boolean);
      const size = host && host.size ? host.size : 32;
      if (host && host.gradientText) continue; // 그라데이션 글자는 가운데 색으로 따로 잰다
      if (color && bg && /^#/.test(color)) {
        const c = contrast(color, bg);
        if (size >= 44) out.minLarge = Math.min(out.minLarge, c); else out.minSmall = Math.min(out.minSmall, c);
      }
      continue;
    }
    const [, close, tagRaw, attrs] = m;
    const tag = tagRaw.toLowerCase();
    if (close) { const i = stack.map((s) => s.tag).lastIndexOf(tag); if (i >= 0) stack.length = i; continue; }
    out.elems++;
    const style = styleOf(attrs);
    (style.match(/#[0-9a-f]{6}\b/gi) || []).forEach((c) => out.colors.add(c.toUpperCase()));
    const fs = prop(style, 'font-size');
    if (fs) out.sizes.add(parseInt(fs, 10));
    if (tag === 'img') out.imgs++;
    if (tag === 'svg') out.svgs++;
    if (tag === 'x-shape') out.shapes++;
    if (tag === 'x-icon') out.icons++;
    if (tag === 'x-connector') out.connectors++;
    const gradientText = /background-clip:\s*text/.test(style);
    const entry = { tag, size: fs ? parseInt(fs, 10) : null, color: prop(style, 'color'), bg: gradientText ? null : bgColor(style), gradientText };
    if (gradientText) {
      const stops = (prop(style, 'background') || '').match(/#[0-9a-f]{6}/gi) || [];
      const bg = [...stack].reverse().map((s) => s.bg).find(Boolean);
      if (bg && stops.length) {
        const worst = Math.min(...stops.map((s) => contrast(s, bg)));
        const size = entry.size || 32;
        if (size >= 44) out.minLarge = Math.min(out.minLarge, worst); else out.minSmall = Math.min(out.minSmall, worst);
      }
    }
    if (!VOID.has(tag) && !/\/$/.test(attrs.trim())) stack.push(entry);
  }
  return out;
}

const rows = [];
for (const v of versions) {
  const dir = join(root, v, 'project');
  if (!existsSync(join(dir, 'deck.json'))) { rows.push({ v, missing: true }); continue; }
  const deck = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8'));
  const files = deck.order.filter((id) => existsSync(join(dir, 'slides', id + '.html')));
  const agg = { slides: files.length, chars: 0, maxChars: 0, maxCharsId: '', sizes: new Set(), colors: new Set(), elems: 0, maxElems: 0, imgs: 0, svgs: 0, shapes: 0, icons: 0, connectors: 0, minLarge: Infinity, minSmall: Infinity, faces: Object.values(deck.faces || {}).map((f) => f.family) };
  for (const id of files) {
    const s = measureSlide(readFileSync(join(dir, 'slides', id + '.html'), 'utf8'));
    agg.chars += s.chars;
    if (s.chars > agg.maxChars) { agg.maxChars = s.chars; agg.maxCharsId = id; }
    s.sizes.forEach((x) => agg.sizes.add(x));
    s.colors.forEach((x) => agg.colors.add(x));
    agg.elems += s.elems; agg.maxElems = Math.max(agg.maxElems, s.elems);
    for (const k of ['imgs', 'svgs', 'shapes', 'icons', 'connectors']) agg[k] += s[k];
    agg.minLarge = Math.min(agg.minLarge, s.minLarge);
    agg.minSmall = Math.min(agg.minSmall, s.minSmall);
  }
  rows.push({ v, ...agg, sizes: [...agg.sizes].sort((a, b) => b - a), colors: agg.colors.size, missingSlides: deck.order.filter((id) => !files.includes(id)) });
}
console.log(JSON.stringify(rows, null, 1));
