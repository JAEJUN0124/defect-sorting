import { useEffect, useRef } from 'react';

// 로그 창: 보기 영역 위에만 뜬다. 모달이 아니라 창이 열려 있어도 조작반(긴급정지)은 그대로 누를 수 있다.
// entries: [{ key, at, level, text }] — 새것이 위
export default function LogWindow({ open, entries, t, onClose, logButton }) {
  const win = useRef(null);
  const close = useRef(null);

  useEffect(() => {
    const el = win.current;
    if (!el) return;
    if (open && !el.open) {
      el.show();
      close.current.focus();
    } else if (!open && el.open) {
      const focusInside = el.contains(document.activeElement);
      el.close();
      if (focusInside && logButton.current) logButton.current.focus();
    }
  }, [open, logButton]);

  return (
    <dialog className="logwin" id="logwin" ref={win} aria-labelledby="logwin-title">
      <div className="logwin__head">
        <h2 className="logwin__title" id="logwin-title">{t('log.title')}</h2>
        <button type="button" className="key key--quiet" id="btn-log-close" ref={close} onClick={onClose}>
          <span>{t('log.close')}</span>
        </button>
      </div>
      <ol className="log__list" id="log-list">
        {entries.map((e) => (
          <li className="log__item" data-level={e.level} key={e.key}>
            <time className="log__time" dateTime={e.at}>{clock(e.at)}</time>
            <span className="log__msg">{e.text}</span>
          </li>
        ))}
      </ol>
      <p className="log__empty" id="log-empty" hidden={entries.length > 0}>{t('log.empty')}</p>
    </dialog>
  );
}

function clock(iso) {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
