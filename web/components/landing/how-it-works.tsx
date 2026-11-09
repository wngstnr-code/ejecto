"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";

type Tone = "light" | "eject" | "outline";

const STEPS: Array<{ n: string; tone: Tone; title: string; body: string; rule: string; icon: ReactNode }> = [
  {
    n: "01",
    tone: "light",
    title: "Every trade feeds the fund",
    body: "Buy and sell on a bonding curve inside the coin's own contract. A slice of every trade drops into the Ejecto Fund.",
    rule: "Rule: 1.5% of buys and 2% of sells on the standard preset",
    icon: <TradeIcon />,
  },
  {
    n: "02",
    tone: "eject",
    title: "A dead coin arms the seat",
    body: "Once a coin is 14 days old, it is dead when its 14-day buys fall below 5% of their peak, and at least below 1 NEAR.",
    rule: "Rule: no oracle, no admin. The contract does the counting",
    icon: <PulseIcon />,
  },
  {
    n: "03",
    tone: "outline",
    title: "Everyone gets a seat",
    body: "Anyone presses EJECT and trading stops forever. Holders claim the reserve pro-rata, plus a fund share by net capital times time held.",
    rule: "Rule: late whales lose. Loyalty is what the fund pays for",
    icon: <SeatIcon />,
  },
];

const TONES: Record<Tone, string> = {
  light: "bg-bone text-ink",
  eject: "bg-eject text-ink",
  outline: "border-2 border-bone bg-ink text-bone",
};

const OFFSET_REM = 2.5; // how far each card sits below the previous one, so the stack peeks out

/**
 * Pinned section: the page stops on the title and the first card. Each further scroll
 * slides the next card up over the stack; covered cards shrink and dim while it moves in.
 */
export function HowItWorks() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion() || !track.current) return;
    const ctx = gsap.context(() => {
      const cards = gsap.utils.toArray<HTMLElement>(".how-card");
      const shades = gsap.utils.toArray<HTMLElement>(".how-shade");
      gsap.set(cards.slice(1), { y: () => window.innerHeight });
      const tl = gsap.timeline({
        scrollTrigger: { trigger: track.current, start: "top top", end: "bottom bottom", scrub: true, invalidateOnRefresh: true },
      });
      cards.forEach((card, i) => {
        if (i === 0) return;
        tl.to(card, { y: 0, ease: "power2.out", duration: 1 }, i - 1);
        for (let j = 0; j < i; j++) {
          const depth = i - j;
          // Shrink a little while the new card covers this one...
          tl.to(cards[j], { scale: 1 - depth * 0.05, ease: "none", duration: 0.5 }, i - 0.5);
          // ...and dim gradually (a black shade, no filter flicker) while the new card is on its way over it,
          // reaching full dim exactly when the new card lands.
          tl.to(shades[j], { opacity: depth * 0.35, ease: "none", duration: 0.6 }, i - 0.6);
        }
      });
      tl.to({}, { duration: 0.4 }); // short hold on the full stack before the page moves on
    }, root);
    return () => ctx.revert();
  }, []);

  const header = (
    <>
      <h2 className="display text-6xl sm:text-7xl lg:text-right lg:text-8xl">How it works</h2>
      <p className="label mt-5 max-w-xs leading-relaxed text-muted lg:ml-auto lg:text-right">
        Three rules, all inside the contract. Locked at launch, nobody can change them later.
      </p>
    </>
  );

  if (reduced) {
    return (
      <section id="how" ref={root} className="relative bg-ink text-bone">
        <div className="mx-auto max-w-7xl px-4 py-32 sm:px-8">
          <div className="lg:ml-auto lg:w-[64%]">
            {header}
            <div className="mt-12 space-y-4">
              {STEPS.map((s) => (
                <Card key={s.n} step={s} className="relative min-h-[40vh]" />
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="how" ref={root} className="relative bg-ink text-bone">
      <div ref={track} className="relative" style={{ height: `${STEPS.length * 100}vh` }}>
        <div className="sticky top-0 flex h-dvh flex-col overflow-hidden">
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-8 pt-24 sm:px-8">
            <div className="lg:ml-auto lg:w-[64%]">{header}</div>
            <div className="relative mt-10 lg:ml-auto lg:w-[64%]" style={{ height: `calc(40vh + ${(STEPS.length - 1) * OFFSET_REM}rem)` }}>
              {STEPS.map((s, i) => (
                <Card
                  key={s.n}
                  step={s}
                  className="absolute inset-x-0 h-[40vh] will-change-transform"
                  style={{ top: `${i * OFFSET_REM}rem`, zIndex: i + 1 }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* The left side is left free: the 3D pilot drifts down there under its parachute. */}
    </section>
  );
}

function Card({ step: s, className = "", style }: { step: (typeof STEPS)[number]; className?: string; style?: React.CSSProperties }) {
  return (
    <article className={`how-card flex origin-top flex-col justify-between p-7 sm:p-10 ${TONES[s.tone]} ${className}`} style={style}>
      <div className="how-shade pointer-events-none absolute -inset-[2px] z-10 bg-ink opacity-0" aria-hidden />
      <div className="flex items-start justify-between lg:flex-row-reverse">
        <span className="label">[{s.n}]</span>
        <span className="h-10 w-10 lg:-scale-x-100">{s.icon}</span>
      </div>
      <div className="lg:text-right">
        <h3 className="text-3xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">{s.title}</h3>
        <p className="label mt-4 max-w-md leading-relaxed opacity-80 lg:ml-auto">{s.body}</p>
        <div className="label mt-5 border-t border-current pt-4">{s.rule}</div>
      </div>
    </article>
  );
}

function TradeIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-full w-full" aria-hidden>
      <path d="M5 33 C17 31 25 22 35 7" />
      <circle cx="24" cy="21" r="3.2" />
      <path d="M5 36 H35" opacity="0.4" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full" aria-hidden>
      <path d="M3 18 H11 L15 8 L20 28 L24 18 H29 L32 25 H37" />
      <path d="M3 32 H37" strokeDasharray="3 3" />
    </svg>
  );
}

function SeatIcon() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full" aria-hidden>
      <circle cx="20" cy="10" r="6" />
      <path d="M15 10 H25" />
      <path d="M13 18 H27 V29 H13 Z" />
      <path d="M16 29 L14 37 M24 29 L26 37" />
    </svg>
  );
}
