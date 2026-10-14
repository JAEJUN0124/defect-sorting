// XML 읽기·쓰기 — 서버와 주고받는 XML 메시지(docs/server-xml-v1.0.md)를 다루는 데 필요한 만큼만 직접 구현합니다.
// 브라우저와 Node 시험(tests/xml.test.js)에서 똑같이 동작하도록 DOMParser를 쓰지 않습니다.
// 읽은 결과는 { name, attrs: { 이름: 값 }, children: [요소], text } 모양의 요소 나무입니다.
// 서버 규약과 같이 DTD(<!DOCTYPE>)와 외부 엔티티는 받지 않습니다.
(function (root) {
  'use strict';

  const MAX_DEPTH = 32;
  const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  // XML 1.0에 쓸 수 없는 제어 문자 (탭·줄바꿈 빼고)
  const INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

  class XmlError extends Error {
    constructor(code, pos) {
      super(code + (pos === undefined ? '' : ' @' + pos));
      this.code = code;
      this.pos = pos;
    }
  }

  function decodeEntities(s, pos) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(/&([^;&\s]{1,10});|&/g, (m, name) => {
      if (!name) throw new XmlError('BAD_ENTITY', pos);
      if (name[0] === '#') {
        const hex = name[1] === 'x' || name[1] === 'X';
        const form = hex ? /^#[xX][0-9a-fA-F]+$/.test(name) : /^#[0-9]+$/.test(name);
        const code = hex ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        if (!form || !(code >= 1 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) throw new XmlError('BAD_ENTITY', pos);
        return String.fromCodePoint(code);
      }
      if (ENTITIES[name] === undefined) throw new XmlError('UNKNOWN_ENTITY', pos); // 정의하지 않은 엔티티(외부 엔티티 포함)
      return ENTITIES[name];
    });
  }

  // 글 하나를 읽어 맨 바깥 요소를 돌려준다. 형식이 틀리면 XmlError
  function parse(text) {
    if (typeof text !== 'string') throw new XmlError('NOT_TEXT');
    const s = text;
    let i = s.charCodeAt(0) === 0xfeff ? 1 : 0; // UTF-8 BOM

    const fail = (code) => { throw new XmlError(code, i); };
    const skipSpace = () => { while (i < s.length && /\s/.test(s[i])) i += 1; };
    const startsWith = (t) => s.startsWith(t, i);
    const skipUntil = (end, code) => {
      const j = s.indexOf(end, i);
      if (j === -1) fail(code);
      i = j + end.length;
    };
    const readName = () => {
      const m = /^[^\s/>=<'"!?&]+/.exec(s.slice(i, i + 256));
      if (!m || /^[-.0-9]/.test(m[0])) fail('BAD_NAME');
      i += m[0].length;
      return m[0];
    };
    // 요소 밖의 것: 공백 · 주석 · 처리 지시(<?xml ...?> 등). DTD는 받지 않는다
    const skipMisc = () => {
      for (;;) {
        skipSpace();
        if (startsWith('<!--')) skipUntil('-->', 'UNCLOSED_COMMENT');
        else if (startsWith('<?')) skipUntil('?>', 'UNCLOSED_PI');
        else if (startsWith('<!')) fail('DTD_NOT_ALLOWED');
        else return;
      }
    };

    function element(depth) {
      if (depth > MAX_DEPTH) fail('TOO_DEEP');
      if (s[i] !== '<') fail('EXPECTED_ELEMENT');
      i += 1;
      const node = { name: readName(), attrs: {}, children: [], text: '' };
      for (;;) {
        const before = i;
        skipSpace();
        if (startsWith('/>')) { i += 2; return node; }
        if (s[i] === '>') { i += 1; break; }
        if (i === before) fail('EXPECTED_SPACE');
        const name = readName();
        skipSpace();
        if (s[i] !== '=') fail('EXPECTED_EQUALS');
        i += 1;
        skipSpace();
        const quote = s[i];
        if (quote !== '"' && quote !== "'") fail('EXPECTED_QUOTE');
        const end = s.indexOf(quote, i + 1);
        if (end === -1) fail('UNCLOSED_ATTRIBUTE');
        const raw = s.slice(i + 1, end);
        if (raw.indexOf('<') !== -1) fail('BAD_ATTRIBUTE');
        if (Object.prototype.hasOwnProperty.call(node.attrs, name)) fail('DUPLICATE_ATTRIBUTE');
        node.attrs[name] = decodeEntities(raw, i);
        i = end + 1;
      }
      // 내용: 글 · 하위 요소 · 주석 · CDATA · 처리 지시
      for (;;) {
        if (i >= s.length) fail('UNCLOSED_ELEMENT');
        if (startsWith('</')) {
          i += 2;
          if (readName() !== node.name) fail('MISMATCHED_TAG');
          skipSpace();
          if (s[i] !== '>') fail('EXPECTED_CLOSE');
          i += 1;
          return node;
        }
        if (startsWith('<!--')) { skipUntil('-->', 'UNCLOSED_COMMENT'); continue; }
        if (startsWith('<![CDATA[')) {
          const end = s.indexOf(']]>', i + 9);
          if (end === -1) fail('UNCLOSED_CDATA');
          node.text += s.slice(i + 9, end);
          i = end + 3;
          continue;
        }
        if (startsWith('<?')) { skipUntil('?>', 'UNCLOSED_PI'); continue; }
        if (startsWith('<!')) fail('DTD_NOT_ALLOWED');
        if (s[i] === '<') { node.children.push(element(depth + 1)); continue; }
        const next = s.indexOf('<', i);
        const end = next === -1 ? s.length : next;
        node.text += decodeEntities(s.slice(i, end), i);
        i = end;
      }
    }

    skipMisc();
    if (i >= s.length) fail('EMPTY');
    const rootNode = element(0);
    skipMisc();
    if (i < s.length) fail('TRAILING_CONTENT');
    return rootNode;
  }

  // ---------- 쓰기 ----------
  const clean = (v) => String(v).replace(INVALID_CHARS, '');
  const escText = (v) => clean(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (v) => escText(v).replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

  // 요소 만들기: el('Command', { name: 'Home' }, [el('Motors', ...)]) 또는 el('Angle', { unit: 'deg' }, '12.3')
  function el(name, attrs, content) {
    const node = { name, attrs: {}, children: [], text: '' };
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) node.attrs[k] = String(v); });
    if (Array.isArray(content)) node.children = content.filter(Boolean);
    else if (content !== undefined && content !== null) node.text = String(content);
    return node;
  }

  // 한 줄 글로 (줄바꿈·들여쓰기 없음 — 메시지 하나가 짧게)
  function stringify(node) {
    const attrs = Object.entries(node.attrs || {}).map(([k, v]) => ' ' + k + '="' + escAttr(v) + '"').join('');
    const inner = (node.text ? escText(node.text) : '') + (node.children || []).map(stringify).join('');
    return inner ? '<' + node.name + attrs + '>' + inner + '</' + node.name + '>' : '<' + node.name + attrs + ' />';
  }

  // ---------- 찾기 ----------
  const child = (node, name) => (node && node.children.find((c) => c.name === name)) || null;
  const childrenOf = (node, name) => (node ? node.children.filter((c) => c.name === name) : []);
  const attr = (node, name) => (node && Object.prototype.hasOwnProperty.call(node.attrs, name) ? node.attrs[name] : undefined);

  root.HmiXml = { parse, stringify, el, child, children: childrenOf, attr, XmlError };
})(typeof window !== 'undefined' ? window : globalThis);
