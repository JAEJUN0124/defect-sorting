// 아이콘 묶음 — 버튼은 <use href="#i-…" />로 가져다 쓴다 (기존 index.html과 같은 모양)
export default function Icons() {
  return (
    <svg className="icons" aria-hidden="true">
      <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></symbol>
      <symbol id="i-stop" viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" /></symbol>
      <symbol id="i-home" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="6.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /></g></symbol>
      <symbol id="i-sethome" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="6.5" /><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" /></g><circle cx="12" cy="12" r="2.5" fill="currentColor" /></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></symbol>
      <symbol id="i-log" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" /><path d="M4.5 6.5h.5M4.5 12h.5M4.5 17.5h.5" strokeWidth="2.5" /></g></symbol>
      <symbol id="i-key" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15.5" r="4.5" /><path d="M11.2 12.3 20 3.5M15.5 8l2.5 2.5M17.8 5.7l2 2" /></g></symbol>
      <symbol id="i-power" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3.5v8" /><path d="M6.6 7.2a7.5 7.5 0 1 0 10.8 0" /></g></symbol>
    </svg>
  );
}

export function Icon({ name }) {
  return <svg className="key__icon" aria-hidden="true"><use href={'#i-' + name} /></svg>;
}
