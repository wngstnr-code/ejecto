import { useId } from "react";

/** Helmet mark (final logo, same geometry as public/brand/ejecto-mark.svg). */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  const clip = useId();
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <defs>
        <clipPath id={clip}>
          <circle cx="256" cy="262" r="190" />
        </clipPath>
      </defs>
      <rect x="34" y="224" width="44" height="88" rx="20" fill="#2A2A31" stroke="#0A0A0B" strokeWidth="10" />
      <rect x="434" y="224" width="44" height="88" rx="20" fill="#2A2A31" stroke="#0A0A0B" strokeWidth="10" />
      <circle cx="256" cy="262" r="196" fill="#0A0A0B" />
      <circle cx="256" cy="262" r="184" fill="#ECE8DF" />
      <rect x="222" y="40" width="68" height="150" fill="#FF4D1F" clipPath={`url(#${clip})`} />
      <path
        d="M100 286 C100 214 170 190 256 190 C342 190 412 214 412 286 C412 364 342 394 256 394 C170 394 100 364 100 286 Z"
        fill="#D9A521"
        stroke="#0A0A0B"
        strokeWidth="14"
      />
      <path d="M146 262 C158 230 196 218 236 218" fill="none" stroke="#FFF1A8" strokeWidth="20" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-3">
      <LogoMark className="h-10 w-10" />
      <span className="display text-xl tracking-tight">Ejecto</span>
    </span>
  );
}
