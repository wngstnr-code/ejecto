/** Helmet mark: off-white shell, red-orange stripe, gold visor. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <clipPath id="logo-shell">
          <circle cx="16" cy="16" r="14" />
        </clipPath>
        <linearGradient id="logo-visor" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1a8" />
          <stop offset="0.5" stopColor="#e9b52a" />
          <stop offset="1" stopColor="#7a4f08" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="#ece8df" />
      <rect x="13.5" y="0" width="5" height="10" fill="#ff4d1f" clipPath="url(#logo-shell)" />
      <path d="M5 16.5 Q5 11.5 16 11.5 Q27 11.5 27 16.5 Q27 24 16 24.5 Q5 24 5 16.5 Z" fill="url(#logo-visor)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="display text-lg tracking-tight">Ejecto</span>
    </span>
  );
}
