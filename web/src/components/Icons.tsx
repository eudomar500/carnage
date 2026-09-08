type P = { className?: string };

const S = (p: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
       strokeLinecap="round" strokeLinejoin="round" className={p.className}>
    {p.children}
  </svg>
);

export const LockClosed = (p: P) => (
  <S {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
  </S>
);

export const LockOpen = (p: P) => (
  <S {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 7.5-2" />
    <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
  </S>
);

export const Speech = (p: P) => (
  <S {...p}>
    <path d="M3 6.5h12v8H8l-3.5 3v-3H3z" />
    <path d="M18 9.5h3v8h-1.5v2.5L17 17.5h-3.5" />
  </S>
);

export const Document = (p: P) => (
  <S {...p}>
    <path d="M6.5 3h7l4.5 4.5V21h-11.5z" />
    <path d="M13.5 3v5h4.5" />
    <path d="M9 12.5h6M9 16h6" />
  </S>
);

export const Jury = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="7" r="2.6" />
    <path d="M7.5 19v-1.6a4.5 4.5 0 0 1 9 0V19" />
    <circle cx="5" cy="9.5" r="2" />
    <path d="M1.6 18v-1.2A3.6 3.6 0 0 1 6 13.4" />
    <circle cx="19" cy="9.5" r="2" />
    <path d="M22.4 18v-1.2a3.6 3.6 0 0 0-4.4-3.4" />
  </S>
);

export const Scales = (p: P) => (
  <S {...p}>
    <path d="M12 4v16M7 20h10" />
    <path d="M4 8h16M12 4l-8 4M12 4l8 4" />
    <path d="M1.5 14a2.5 2.5 0 0 0 5 0L4 8z" />
    <path d="M17.5 14a2.5 2.5 0 0 0 5 0L20 8z" />
  </S>
);

export const Vault = (p: P) => (
  <S {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </S>
);

export const Bell = (p: P) => (
  <S {...p}>
    <path d="M6 17.5v-6a6 6 0 0 1 12 0v6" />
    <path d="M4.5 17.5h15" />
    <path d="M10.2 20.3a2 2 0 0 0 3.6 0" />
    <path d="M12 5.5V3.6" />
  </S>
);
