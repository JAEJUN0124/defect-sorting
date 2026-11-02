// v3 시간표 — 영상(scene.js)과 소리(music.py)가 함께 쓴다.
// 이 파일이 원본이다. 소리 쪽이 읽는 timeline.json은 `node promo/v3/timeline.mjs`가 만든다.
// 120 BPM: 한 박 0.5초, 30fps에서 15프레임. 큰 타격(굴러 넘어감 · 누름 · 불량 · 제목 · 태그라인 · 마크)은 박 위에 둔다.
// 장면마다 움직임이 끝나면 글이 읽히도록 한 번 멈춘다(hold).

export const FPS = 30;
export const BPM = 120;
export const DURATION = 19.5;

// 타이핑하는 문장 (포스터의 한 줄 설명)
export const SENTENCE = '카메라가 양품과 불량을 가리고, 로봇팔이 불량품만 골라 옮깁니다.';
export const TYPE_START = 6.75, TYPE_END = 8.25;

function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 글자마다 찍히는 때. 사람이 치듯 조금씩 들쭉날쭉하고, 띄어쓰기 뒤에는 조금 쉰다
export function typeTimes() {
  const chars = [...SENTENCE];
  const w = chars.map((ch, i) => (ch === ' ' ? 1.5 : 0.75 + 0.5 * hash(i, 3)));
  const total = w.reduce((a, b) => a + b, 0);
  const times = [];
  let acc = 0;
  for (let i = 0; i < chars.length; i++) {
    times.push(TYPE_START + (acc / total) * (TYPE_END - TYPE_START));
    acc += w[i];
  }
  return times;
}

// HMI 카메라 화면 속 컨베이어가 한 칸씩 내려앉는 때. 5.5 · 5.75는 양품, 6.0은 불량
export const LANDS = [4.5, 4.75, 5, 5.25, 5.5, 5.75, 6];
export const VERDICTS = [[5.5, true], [5.75, true], [6, false]];

// 빛줄기 [시작, 걸리는 시간, 방향(1 = 왼→오), 높이(0~1), 굵기, 색 번호(0 빨 · 1 초 · 2 파)]
export const STREAKS = [
  [13.25, 0.38, 1, 0.36, 9.5, 0],
  [13.3, 0.36, -1, 0.58, 5.5, 2],
  [13.36, 0.38, 1, 0.47, 15.5, 1],
  [13.42, 0.32, -1, 0.27, 4.5, 0],
  [13.48, 0.34, 1, 0.66, 7.5, 2],
  [13.54, 0.3, -1, 0.42, 11.5, 1],
  [13.6, 0.28, 1, 0.53, 5.5, 0],
  [13.66, 0.26, -1, 0.72, 8.5, 2],
];

// "불량품 선별 시스템" 글자가 하나씩 켜지는 때: 첫 글자 시작, 글자 사이 지연, 한 글자가 그려지는 시간
export const NAME_DRAW = { start: 1.3, stagger: 0.05, dur: 0.32 };
export const NAME_BLUE = 2.0; // 이 박에 모든 글자가 한 가지 파란빛으로 바뀐다

export const SECTIONS = [
  { id: 'meet', start: 0, end: 1.5, desc: '"소개합니다" — 글자가 올라와 멈추고(0.45~1.25), 1.25초부터 정육면체가 위로 구르듯 넘어가 1.5초 박에 다음 면이 앞에 선다' },
  { id: 'name', start: 1.5, end: 2.5, desc: '"불량품 선별 시스템" — 가는 관 같은 윤곽선 글자가 글자마다 한 색(빨강·파랑·초록)으로 빛이 돌며 그려지고(1.3~2.0), 2.0초 박에 모두 파랑으로 바뀐 뒤 2.35초에 앞으로 빠진다' },
  { id: 'key', start: 2.5, end: 5, desc: '3D 시작 키가 날아와 3.0초에 눌리고 잠깐 멈춤, 3.5초부터 물러나며 웹 HMI가 드러나 4.0~5.0초 멈춤' },
  { id: 'detect', start: 5, end: 6.5, desc: '카메라 화면이 커지고 5.5 양품, 5.75 양품, 6.0 불량. 불량에서 잠깐 멈춤' },
  { id: 'type', start: 6.5, end: 9, desc: '불량 상자가 입력창으로 바뀌고 한 줄 설명이 쳐진 뒤(6.75~8.25) 멈춤, 8.9 엔터' },
  { id: 'headline', start: 9, end: 11, desc: '문장이 큰 제목이 되고 색이 쓸고 지나간 뒤 멈춤' },
  { id: 'cards', start: 11, end: 13.25, desc: 'HMI 기능 카드 여덟 장이 올라와 멈췄다가(11.5~12.75) 빠르게 올라감' },
  { id: 'streak', start: 13.25, end: 14, desc: '빛줄기가 화면을 가름' },
  { id: 'tagline', start: 14, end: 16, desc: '빛나는 테두리 안에 "불량을 찾는 눈, 골라내는 손", 멈춤' },
  { id: 'end', start: 16, end: 19.5, desc: '테두리가 점으로 줄어들어 16.5초에 학교 마크로 터지고 학교·팀 이름. 19.5초 끝' },
];

export const CUES = [
  { t: 0.0, id: 'start', desc: '첫 프레임부터: 또렷한 타격과 함께 곡 시작' },
  { t: 1.25, id: 'cube', until: 1.5, desc: '글자 상자가 위로 굴러 넘어감 (휙 + 1.5초에 묵직하게 닿음, 본 비트 시작)' },
  { t: 1.3, id: 'name_draw', until: 2.0, desc: '글자가 하나씩 빛으로 그려짐 (글자마다 짧은 반짝임, name_syllables 참고)' },
  { t: 2.0, id: 'name_blue', desc: '모든 글자가 파란빛으로 바뀜 (박에 맞춘 짧은 강조)' },
  { t: 2.35, id: 'name_out', until: 2.5, desc: '글자가 앞으로 빠짐 (짧은 휙)' },
  { t: 2.5, id: 'key_in', until: 3.0, desc: '시작 키가 날아옴 (휙)' },
  { t: 3.0, id: 'press', desc: '키가 눌림: 묵직한 딸깍 + 타격' },
  { t: 3.5, id: 'zoom_out', until: 4.0, desc: '물러나며 HMI 화면이 드러남' },
  { t: 4.0, id: 'hmi_on', desc: 'HMI 화면 (멈춤 4.0~5.0)' },
  { t: 5.0, id: 'expand', until: 5.35, desc: '카메라 화면이 커짐' },
  { t: 5.5, id: 'good', desc: '양품 판정 (밝은 짧은 소리)' },
  { t: 5.75, id: 'good', desc: '양품 판정' },
  { t: 6.0, id: 'bad', desc: '불량 판정 (낮고 거친 소리)' },
  { t: 6.5, id: 'morph', until: 6.7, desc: '불량 상자가 입력창으로 바뀜' },
  { t: 8.9, id: 'enter', desc: '입력 끝 (엔터)' },
  { t: 9.0, id: 'headline', desc: '큰 제목 (화음 타격)' },
  { t: 9.35, id: 'shimmer', until: 10.1, desc: '제목 위로 색이 쓸고 지나감' },
  { t: 11.0, id: 'scroll_in', until: 11.5, desc: '기능 카드가 올라옴 (스크롤 소리)' },
  { t: 12.75, id: 'scroll_out', until: 13.25, desc: '기능 카드가 빠르게 올라감' },
  { t: 13.25, id: 'streaks', until: 14.0, desc: '빛줄기 (줄기마다 휙, streaks 목록 참고)' },
  { t: 13.5, id: 'riser', until: 14.0, desc: '차오름' },
  { t: 14.0, id: 'tagline', desc: '태그라인: 가장 큰 타격 하나, 본 비트 절정' },
  { t: 16.0, id: 'collapse', until: 16.45, desc: '테두리가 점으로 줄어듦 (빨려 들어가는 소리)' },
  { t: 16.5, id: 'logo', desc: '점이 터지며 학교 마크: 끝 소리 로고' },
  { t: 19.1, id: 'fade', until: 19.5, desc: '19.5에 무음' },
];

// node promo/v3/timeline.mjs → timeline.json (소리 쪽이 읽음). 브라우저에서는 건너뛴다
const asScript = typeof process !== 'undefined' && process.argv?.[1]
  && (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1];
if (asScript) {
  const { writeFileSync } = await import('node:fs');
  const json = {
    note: '이 파일은 timeline.mjs가 만든다. 고치려면 timeline.mjs를 고치고 node promo/v3/timeline.mjs를 다시 돌린다.',
    fps: FPS, bpm: BPM, duration: DURATION,
    sections: SECTIONS, cues: CUES,
    typing: typeTimes().map((t, i) => ({ t: +t.toFixed(4), ch: [...SENTENCE][i] })),
    name_syllables: [...'불량품선별시스템'].map((ch, i) => ({ t: +(NAME_DRAW.start + i * NAME_DRAW.stagger).toFixed(4), ch })),
    streaks: STREAKS.map(([t, dur, dir, y]) => ({ t, dur, dir, y })),
  };
  writeFileSync(new URL('./timeline.json', import.meta.url), JSON.stringify(json, null, 1) + '\n');
  console.log(`timeline.json: 글자 ${json.typing.length}개`);
}
