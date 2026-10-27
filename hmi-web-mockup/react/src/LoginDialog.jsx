import { useEffect, useRef, useState } from 'react';

// 로그인 창 (모달) — 밖 주소의 공용 비밀번호 하나 (js/auth.js, docs/cloudflare.md). 로그인으로 바뀌는 것은 원점 잡기뿐이다.
// ask: { reason, resolve, opener } 또는 null. 로그인하면 resolve(true), 취소·Esc면 resolve(false).
// 확인 창(ConfirmDialog)처럼 답은 단추를 누른 그 순간에 정한다
export default function LoginDialog({ ask, t, onLogin, onDone }) {
  const dlg = useRef(null);
  const input = useRef(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = dlg.current;
    if (!el) return;
    if (ask && !el.open) {
      setPassword('');
      setError(null);
      setBusy(false);
      el.showModal();
      input.current.focus();
    }
    if (!ask && el.open) el.close();
  }, [ask]);

  const finish = (ok) => {
    if (!ask) return;
    const { resolve, opener } = ask;
    setPassword(''); // 비밀번호를 화면에 남기지 않는다
    onDone();
    resolve(ok);
    // 로그인한 뒤에는 이어지는 창(원점 저장 확인)이 초점을 가져간다
    if (!ok && opener && opener.isConnected && !opener.hidden) opener.focus();
  };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setError(t('login.empty'));
      input.current.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onLogin(password);
      finish(true);
    } catch (err) {
      setBusy(false);
      setError(t('login.error.' + (err && err.code ? err.code : 'LOGIN_FAILED')));
      input.current.select();
    }
  }

  return (
    <dialog
      className="confirm"
      id="dlg-login"
      ref={dlg}
      aria-labelledby="login-title"
      aria-describedby="login-body"
      onCancel={(e) => { e.preventDefault(); if (!busy) finish(false); }}
    >
      <form onSubmit={submit} noValidate>
        <h2 className="confirm__title" id="login-title">{t('login.title')}</h2>
        <p className="confirm__body" id="login-body">{t(ask && ask.reason === 'setHome' ? 'login.body.setHome' : 'login.body')}</p>
        <label className="field__label" htmlFor="login-password">{t('login.password')}</label>
        <input
          className="field__input" id="login-password" ref={input} type="password" autoComplete="current-password"
          value={password} readOnly={busy} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'login-error' : undefined}
          onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
        />
        <p className="note field__error" id="login-error" data-kind="error" role="alert" hidden={!error}>{error}</p>
        <div className="confirm__actions">
          <button type="button" className="key key--quiet" id="login-cancel" disabled={busy} onClick={() => finish(false)}>
            <span>{t('dialog.cancel')}</span>
          </button>
          <button type="submit" className="key key--primary" id="login-submit" disabled={busy}>
            {t(busy ? 'login.busy' : 'login.submit')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
