"use client";

import type { ReactNode } from "react";
import { PHASE_LABEL, type Phase } from "@/lib/coin";

const PHASE_STYLE: Record<Phase, { box: string; dot: string }> = {
  new: { box: "border-line text-bone", dot: "bg-bone" },
  alive: { box: "border-hud/50 text-hud", dot: "bg-hud" },
  dying: { box: "border-hazard/60 text-hazard", dot: "bg-hazard" },
  ejectable: { box: "border-eject bg-eject text-ink", dot: "bg-ink" },
  ejected: { box: "border-line text-muted", dot: "bg-muted" },
};

/** Phase pill. Ejectable pulses like the radar dot on the landing page. */
export function PhaseBadge({ phase, className = "" }: { phase: Phase; className?: string }) {
  const st = PHASE_STYLE[phase];
  return (
    <span className={`label inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-bold ${st.box} ${className}`}>
      <span className="relative flex h-2 w-2">
        {phase === "ejectable" && <span className="absolute inset-0 animate-radar rounded-full border-2 border-ink" />}
        <span className={`relative h-2 w-2 rounded-full ${st.dot}`} />
      </span>
      {PHASE_LABEL[phase]}
    </span>
  );
}

/** Coin icon: the on-chain image in a round coin frame, or a generated coin when the coin has no icon. */
export function CoinIcon({ icon, symbol, className = "h-12 w-12" }: { icon?: string | null; symbol: string; className?: string }) {
  if (icon) {
    return (
      <span className={`${className} relative block shrink-0 overflow-hidden rounded-full border-2 border-ink bg-ink shadow-[0_0_0_2px_var(--color-line)]`}>
        {/* Data URL stored on chain (max 2 KB). Plain img: next/image adds nothing for data URLs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={icon} alt="" className="h-full w-full rounded-full object-cover" />
      </span>
    );
  }
  return <CoinArt symbol={symbol} className={className} />;
}

const COIN_TONES = [
  { face: "#ffd400", rim: "#b89900" },
  { face: "#ff4d1f", rim: "#b3360f" },
  { face: "#3ddc84", rim: "#239a59" },
  { face: "#ece8df", rim: "#a8a397" },
];
const TICKS = Array.from({ length: 40 }, (_, i) => (i / 40) * Math.PI * 2);

/** A minted-looking coin: reeded rim, inner ring, a shine and the symbol. The tone is fixed per symbol. */
function CoinArt({ symbol, className }: { symbol: string; className: string }) {
  const tone = COIN_TONES[[...symbol].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COIN_TONES.length];
  const label = symbol.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return (
    <svg viewBox="0 0 64 64" className={`${className} shrink-0`} aria-hidden>
      <circle cx="32" cy="32" r="31.5" fill="#0a0a0b" />
      <circle cx="32" cy="32" r="29.5" fill={tone.rim} />
      {TICKS.map((a) => (
        <line
          key={a}
          x1={32 + Math.cos(a) * 26.6}
          y1={32 + Math.sin(a) * 26.6}
          x2={32 + Math.cos(a) * 29.3}
          y2={32 + Math.sin(a) * 29.3}
          stroke="#0a0a0b"
          strokeOpacity="0.35"
          strokeWidth="1.1"
        />
      ))}
      <circle cx="32" cy="32" r="25.5" fill={tone.face} stroke="#0a0a0b" strokeOpacity="0.25" strokeWidth="1" />
      <circle cx="32" cy="32" r="21.5" fill="none" stroke={tone.rim} strokeWidth="1.4" strokeDasharray="0.6 2.4" strokeLinecap="round" />
      <path d="M14 26 A19 19 0 0 1 30 12.5" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2.4" strokeLinecap="round" />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        className="display"
        fontSize={label.length > 1 ? 17 : 22}
        fill="#0a0a0b"
      >
        {label}
      </text>
    </svg>
  );
}

/** The NEAR logo (Simple Icons, CC0). Inherits the text color. */
export function NearIcon({ className = "h-[0.7em] w-[0.7em]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`inline-block shrink-0 fill-current ${className}`} role="img" aria-label="NEAR">
      <path d="M21.443 0c-.89 0-1.714.46-2.18 1.218l-5.017 7.448a.533.533 0 0 0 .792.7l4.938-4.282a.2.2 0 0 1 .334.151v13.41a.2.2 0 0 1-.354.128L5.03.905A2.555 2.555 0 0 0 3.078 0h-.521A2.557 2.557 0 0 0 0 2.557v18.886a2.557 2.557 0 0 0 4.736 1.338l5.017-7.448a.533.533 0 0 0-.792-.7l-4.938 4.283a.2.2 0 0 1-.333-.152V5.352a.2.2 0 0 1 .354-.128l14.924 17.87c.486.574 1.2.905 1.952.906h.521A2.558 2.558 0 0 0 24 21.445V2.557A2.558 2.558 0 0 0 21.443 0Z" />
    </svg>
  );
}

/** An amount of NEAR: the number followed by the NEAR logo. */
export function Amount({ children, icon = "text-muted", className = "" }: { children: ReactNode; icon?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.3em] whitespace-nowrap ${className}`}>
      {children}
      <NearIcon className={`h-[0.72em] w-[0.72em] ${icon}`} />
    </span>
  );
}

/** Big number with a mono label, used in stat strips. Unit "NEAR" renders the NEAR logo. */
export function Stat({ label, value, unit, sub }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label text-muted">{label}</div>
      <div className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl">
        {unit === "NEAR" ? (
          <Amount icon="text-muted ml-1">{value}</Amount>
        ) : (
          <>
            {value}
            {unit && <span className="label ml-1.5 text-muted">{unit}</span>}
          </>
        )}
      </div>
      {sub && <div className="label mt-1 text-muted">{sub}</div>}
    </div>
  );
}

/** Hazard tape across the top of a coin page that runs on demo time. */
export function DemoBanner({ dayLength }: { dayLength: number }) {
  return (
    <div className="relative overflow-hidden border-y border-ink bg-hazard text-ink">
      <div className="hazard-stripes absolute inset-y-0 left-0 w-10 sm:w-24" />
      <div className="hazard-stripes absolute inset-y-0 right-0 w-10 sm:w-24" />
      <p className="label relative py-2.5 text-center font-bold">
        Demo time: 1 day = {dayLength} s. Real coins use 24 hours.
      </p>
    </div>
  );
}

/** Mono section heading with a number, like the landing ledgers. */
export function PanelTitle({ n, children, right }: { n?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
      <h2 className="label text-bone">
        {n && <span className="mr-3 text-muted">[{n}]</span>}
        {children}
      </h2>
      {right}
    </div>
  );
}

/** The yellow and black loop handle (same drawing as the landing call to action). */
export function EjectHandle({ className = "w-36", id = "hz" }: { className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden>
      <defs>
        <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="#0a0a0b" />
          <rect width="8" height="16" fill="#ffd400" />
        </pattern>
      </defs>
      <path d="M20 110 V50 Q20 12 80 12 Q140 12 140 50 V110" fill="none" stroke="#0a0a0b" strokeWidth="30" strokeLinecap="round" />
      <path d="M20 110 V50 Q20 12 80 12 Q140 12 140 50 V110" fill="none" stroke={`url(#${id})`} strokeWidth="22" strokeLinecap="round" />
    </svg>
  );
}
