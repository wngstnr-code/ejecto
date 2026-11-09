import Link from "next/link";

/** Final call to action. Deliberately pilot-free: the pilot drifts out of frame just before it. */
export function FinalCta() {
  return (
    <section id="cta" className="relative overflow-hidden bg-hazard text-ink">
      <div className="hazard-stripes h-4 w-full" />
      <div className="mx-auto flex min-h-[80vh] max-w-7xl flex-col items-center justify-center gap-12 px-4 py-28 text-center sm:px-8">
        <p className="label font-bold">Every memecoin needs an ejecto seato</p>
        <h2 className="display whitespace-nowrap text-[13vw] leading-[0.85] sm:text-[9.5rem]">
          Pull the
          <br />
          handle
        </h2>
        <Link href="/launch/" className="group flex flex-col items-center gap-5" aria-label="Launch a coin">
          <EjectHandle />
          <span className="label rounded-full bg-ink px-7 py-4 font-bold text-hazard transition-transform group-hover:-translate-y-1">
            Launch a coin
          </span>
        </Link>
      </div>
      <div className="hazard-stripes h-4 w-full" />
    </section>
  );
}

/** The yellow and black loop handle between the pilot's knees. Shakes on hover. */
function EjectHandle() {
  return (
    <svg viewBox="0 0 160 120" className="w-36 transition-transform group-hover:animate-shake" aria-hidden>
      <defs>
        <pattern id="cta-hz" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="#0a0a0b" />
          <rect width="8" height="16" fill="#ffd400" />
        </pattern>
      </defs>
      <path d="M20 110 V50 Q20 12 80 12 Q140 12 140 50 V110" fill="none" stroke="#0a0a0b" strokeWidth="30" strokeLinecap="round" />
      <path d="M20 110 V50 Q20 12 80 12 Q140 12 140 50 V110" fill="none" stroke="url(#cta-hz)" strokeWidth="22" strokeLinecap="round" />
    </svg>
  );
}
