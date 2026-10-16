import { useEffect, useRef } from 'react';

// 확인 창 (모달). 답은 단추를 누른(또는 Esc) 그 순간에 정한다 — close 이벤트는 쓰지 않는다.
// 화면을 그리지 않는 동안(숨은 창 등)에는 close가 늦게 와서 확인이 사라질 수 있다 (대시보드 controls.js와 같은 방식)
// ask: { kind, resolve, opener } 또는 null
export default function ConfirmDialog({ ask, t, onDone }) {
  const dlg = useRef(null);
  const cancel = useRef(null);

  useEffect(() => {
    const el = dlg.current;
    if (!el) return;
    if (ask && !el.open) {
      el.showModal();
      cancel.current.focus(); // 실수로 Enter를 눌러도 취소되도록
    }
    if (!ask && el.open) el.close();
  }, [ask]);

  const finish = (yes) => {
    if (!ask) return;
    const { resolve, opener } = ask;
    onDone();
    resolve(yes);
    if (opener && opener.isConnected && !opener.hidden) opener.focus();
  };

  const kind = ask ? ask.kind : null;
  return (
    <dialog
      className="confirm"
      id="dlg"
      ref={dlg}
      aria-labelledby="dlg-title"
      aria-describedby="dlg-body"
      onCancel={(e) => { e.preventDefault(); finish(false); }}
    >
      <div>
        <h2 className="confirm__title" id="dlg-title">{kind ? t('dialog.' + kind + '.title') : ''}</h2>
        <p className="confirm__body" id="dlg-body">{kind ? t('dialog.' + kind + '.body') : ''}</p>
        <div className="confirm__actions">
          <button type="button" className="key key--quiet" id="dlg-cancel" ref={cancel} onClick={() => finish(false)}>
            <span>{t('dialog.cancel')}</span>
          </button>
          <button type="button" className="key key--primary" id="dlg-confirm" onClick={() => finish(true)}>
            {kind ? t('dialog.' + kind + '.confirm') : ''}
          </button>
        </div>
      </div>
    </dialog>
  );
}
