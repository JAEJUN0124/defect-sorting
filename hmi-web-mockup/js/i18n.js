// 문구 찾기 — t('키', { 값 })
// HTML의 data-i18n(글자), data-i18n-aria(aria-label) 속성도 여기서 채웁니다.
(function () {
  const dicts = window.HMI_I18N || {};
  let locale = window.HMI_CONFIG.locale || 'ko';

  function t(key, params) {
    let text = (dicts[locale] || {})[key];
    if (text === undefined) text = (dicts.ko || {})[key];
    if (text === undefined) return key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match));
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    document.documentElement.lang = locale;
    document.title = t((document.body && document.body.dataset.titleKey) || 'app.title'); // 화면마다 body의 data-title-key로 바꿀 수 있다
  }

  window.I18N = {
    t,
    apply,
    setLocale(next) { locale = next; apply(); },
  };
})();
