// v2 시간표 — 영상(scene.js)과 소리(music.py)가 함께 쓴다.
// 이 파일이 원본이다. 소리 쪽이 읽는 timeline.json은 `node promo/v2/timeline.mjs`가 만든다.
// 120 BPM: 한 박 0.5초, 30fps에서 15프레임.

export const FPS = 30;
export const BPM = 120;
export const DURATION = 16;

// 가운데 판정판(낱장 4칸)에 뜨는 글. at = 첫 칸이 내려앉는 때(박). ' '는 빈칸
// tone: ok = 양품(초록 표시등), ng = 불량(노란 판), 없으면 보통 글
// label: 판 위에 붙는 주어 (누가 하는가)
export const BOARD = [
  { at: 0.0, text: ' 양품 ', tone: 'ok' },
  { at: 0.5, text: ' 양품 ', tone: 'ok' },
  { at: 1.0, text: ' 양품 ', tone: 'ok' },
  { at: 1.5, text: ' 불량 ', tone: 'ng' },
  { at: 2.0, text: ' 본다 ', label: '카메라가' },
  { at: 4.0, text: '판단한다', label: '서버가' },
  { at: 6.0, text: '골라낸다', label: '로봇팔이' },
  { at: 8.0, text: ' 양품 ', tone: 'ok' },
  { at: 8.5, text: ' 양품 ', tone: 'ok' },
  { at: 9.0, text: ' 양품 ', tone: 'ok' },
  { at: 9.5, text: ' 양품 ', tone: 'ok' },
  { at: 10.0, text: '운전한다', label: '웹 HMI로' },
];

// 끝 판: 12초 타격에 빈 칸으로 나타나 13초에 제목이 내려앉는다. 줄마다 칸 수가 다르고 가운데 맞춤
export const FINAL = {
  appear: 12.0,
  at: 13.0,
  rows: {
    wide: ['불량을 찾는 눈,', '골라내는 손'],
    tall: ['불량을', '찾는 눈,', '골라내는 손'],
  },
};

// 컨베이어가 한 칸씩 내려앉는 때. 이때마다 카메라가 찍는다
export const LANDS = [0.0, 0.5, 1.0, 1.5, 8.0, 8.5, 9.0, 9.5, 10.5, 11.0, 11.5];

// 판의 낱장이 넘어가는 규칙. 칸마다 몇 번 넘어가고(같은 글이면 한 번) 칸 사이에 조금씩 늦게 내려앉는다
const FLIP = 0.075;      // 낱장 한 번 넘어가는 시간
const STAGGER = 0.03;    // 칸 사이 지연
const FILL = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하', '검', '사', '부', '품'];

function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
// 글을 칸으로 나눈다. 빈칸은 '', 쉼표·마침표는 앞 글자와 한 칸에 둔다
export function cellsOf(text) {
  const cells = [];
  for (const ch of text) {
    if ((ch === ',' || ch === '.') && cells.length) cells[cells.length - 1] += ch;
    else cells.push(ch === ' ' ? '' : ch);
  }
  return cells;
}

// 낱장 하나하나: { t0, t1, cell, row, from, to, fromTone, toTone, last }
// 판 4칸(row 0) — 앞 글에서 다음 글로 넘어간다
export function boardFlips() {
  const flips = [];
  let prev = ['', '', '', ''], prevTone = '';
  BOARD.forEach((ev, e) => {
    const next = cellsOf(ev.text.padEnd(4).slice(0, 4));
    const tone = ev.tone || '';
    for (let i = 0; i < 4; i++) {
      const same = prev[i] === next[i] && prevTone === tone;
      const n = same ? 1 : 2 + (hash(e, i) % 2);
      // 첫 글은 영상이 시작하기 전에 다 내려앉아 첫 프레임에 "양품"이 또렷하다
      const end = e === 0 ? ev.at - 0.02 - (3 - i) * STAGGER : ev.at + i * STAGGER;
      let from = prev[i], fromTone = prevTone;
      for (let j = 0; j < n; j++) {
        const t1 = end - (n - 1 - j) * FLIP;
        const last = j === n - 1;
        const to = last ? next[i] : FILL[hash(e * 7 + j, i) % FILL.length];
        flips.push({ t0: t1 - FLIP, t1, cell: i, row: 0, from, to, fromTone, toTone: last ? tone : fromTone, last });
        from = to;
      }
    }
    prev = next;
    prevTone = tone;
  });
  return flips;
}

// 끝 판: 빈 칸에서 제목으로, 칸마다 4~6번 넘어가며 읽는 순서대로 물결처럼 내려앉는다.
// 띄어쓰기는 칸이 아니라 좁은 틈이라 넘어가지 않는다. cell은 줄 안의 자리(띄어쓰기 포함).
// 넘어가는 횟수와 때는 글자 순서(k)로만 정해서 가로판·세로판의 소리가 같다
export function finalFlips(format) {
  const flips = [];
  let k = 0;
  FINAL.rows[format].forEach((line, row) => {
    cellsOf(line).forEach((ch, cell) => {
      if (!ch) return;
      const n = 4 + (hash(99, k) % 3);
      const end = FINAL.at + k * 0.022;
      let from = '';
      for (let j = 0; j < n; j++) {
        const t1 = end - (n - 1 - j) * FLIP;
        const last = j === n - 1;
        const to = last ? ch : FILL[hash(k * 13 + j, 5) % FILL.length];
        flips.push({ t0: t1 - FLIP, t1, cell, row, from, to, fromTone: '', toTone: '', last });
        from = to;
      }
      k++;
    });
  });
  return flips;
}

export const SECTIONS = [
  { id: 'hook', start: 0, end: 2, desc: '부품이 박마다 들어오고 판이 양품·양품·양품을 띄우다가 1.5초에 노란 불량. 2초까지 정적' },
  { id: 'see', start: 2, end: 4, desc: '카메라가 / 본다. 시선이 불량에 모이고 훑는 선이 지나간 뒤 3초에 노란 검출 상자가 잠긴다' },
  { id: 'judge', start: 4, end: 6, desc: '서버가 / 판단한다. 카메라→서버로 데이터가 올라갔다가(4.0~4.8) 5초에 판정이 돌아와 금이 노랗게 그려진다' },
  { id: 'pick', start: 6, end: 8, desc: '로봇팔이 / 골라낸다. 서버→로봇팔 신호(6.0), 팔이 뻗어 7초에 집고 들어 올려 7.75초에 불량함에 놓는다' },
  { id: 'restore', start: 8, end: 10, desc: '다시 박마다 양품 네 번. 리듬이 돌아온다' },
  { id: 'hmi', start: 10, end: 12, desc: '웹 HMI로 / 운전한다. 10.4초부터 장면이 웹 HMI 카메라 화면 안으로 줄어들고 판은 위 제목이 된다' },
  { id: 'end', start: 12, end: 16, desc: '12초 타격에 끝 판이 나타나 13초에 "불량을 찾는 눈, 골라내는 손"이 내려앉는다. 13.5초 학교·팀. 16초 끝' },
];

// 소리 큐 (낱장 소리는 flips에서 따로)
export const CUES = [
  { t: 0.0, id: 'open', desc: '첫 프레임부터: 첫 판정과 함께 또렷한 타격' },
  { t: 0.0, id: 'verdict_ok', every: 0.5, until: 1.0, desc: '양품 판정 소리 (짧고 밝은 두 음)' },
  { t: 1.5, id: 'verdict_ng', desc: '불량 판정: 어긋난 음, 여기서 박자가 끊김' },
  { t: 1.5, id: 'silence', until: 2.0, desc: '정적 (아주 낮은 긴장음만)' },
  { t: 2.0, id: 'see', desc: '카메라 초점 소리' },
  { t: 2.4, id: 'scan', until: 3.0, desc: '훑는 선' },
  { t: 3.0, id: 'lock', desc: '검출 상자 잠김' },
  { t: 4.0, id: 'judge', desc: '판단 시작' },
  { t: 4.0, id: 'data_up', until: 4.8, desc: '카메라→서버 데이터 (빠른 짧은 음들)' },
  { t: 5.0, id: 'data_back', desc: '판정이 돌아옴, 금이 노랗게 그려짐' },
  { t: 6.0, id: 'pick', desc: '서버→로봇팔 신호' },
  { t: 6.0, id: 'servo', until: 6.95, desc: '팔이 뻗음 (서보)' },
  { t: 7.0, id: 'clamp', desc: '집음' },
  { t: 7.0, id: 'lift', until: 7.7, desc: '들어 올려 옮김' },
  { t: 7.75, id: 'drop', desc: '불량함에 떨어짐 (둔탁한 소리)' },
  { t: 8.0, id: 'groove', desc: '본 비트 시작: 리듬이 돌아옴' },
  { t: 8.0, id: 'verdict_ok', every: 0.5, until: 9.5, desc: '양품 판정 네 번' },
  { t: 10.0, id: 'hmi', desc: '웹 HMI' },
  { t: 10.4, id: 'zoom_out', until: 10.9, desc: '장면이 화면 안으로 줄어듦' },
  { t: 11.5, id: 'riser', until: 12.0, desc: '끝으로 차오름' },
  { t: 12.0, id: 'hit', desc: '가장 큰 타격, 끝 판이 나타남' },
  { t: 13.0, id: 'title', desc: '제목이 다 내려앉음: 마무리 화음' },
  { t: 13.5, id: 'credits', desc: '학교·팀 이름 (부드러운 소리)' },
  { t: 15.5, id: 'fade', until: 16.0, desc: '16.0에 무음' },
];

// node promo/v2/timeline.mjs → timeline.json (소리 쪽이 읽음). 브라우저에서는 건너뛴다
const asScript = typeof process !== 'undefined' && process.argv?.[1]
  && (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1];
if (asScript) {
  const { writeFileSync } = await import('node:fs');
  const flips = [...boardFlips(), ...finalFlips('wide')]
    .map(f => ({ t: +f.t1.toFixed(4), last: f.last, tone: f.toTone || null, final: f.t1 > 12.5 }))
    .sort((a, b) => a.t - b.t);
  const json = {
    note: '이 파일은 timeline.mjs가 만든다. 고치려면 timeline.mjs를 고치고 node promo/v2/timeline.mjs를 다시 돌린다.',
    fps: FPS, bpm: BPM, duration: DURATION,
    sections: SECTIONS, cues: CUES, lands: LANDS,
    flips_note: '판의 낱장이 넘어가 부딪히는 때. last = 그 칸의 마지막(제 글자에 닿음), tone = ok/ng, final = 끝 판(가로판 기준. 세로판은 칸 수가 달라 개수만 조금 다름)',
    flips,
  };
  writeFileSync(new URL('./timeline.json', import.meta.url), JSON.stringify(json, null, 1) + '\n');
  console.log(`timeline.json: 낱장 ${flips.length}번`);
}
