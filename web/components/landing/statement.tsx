"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, ScrollTrigger } from "@/lib/gsap";

// Words wrapped in [] are highlighted.
const TEXT =
  "[Two thirds] of new memecoins die [within a day.] When they die, the holders who stayed [the longest] lose [the most.]";

/** Flatten the text into characters, each tagged as highlighted or not. */
function chars() {
  const out: Array<{ c: string; hot: boolean }> = [];
  for (const part of TEXT.split(/(\[[^\]]+\])/)) {
    if (!part) continue;
    const hot = part.startsWith("[");
    for (const c of part.replace(/[[\]]/g, "")) out.push({ c, hot });
  }
  return out;
}

const CHARS = chars();

/**
 * Typewriter driven by scroll: typing starts as the section comes in and is complete
 * exactly when the section fills the screen. Scrolling back up erases it again.
 */
export function Statement() {
  const root = useRef<HTMLElement>(null);
  const list = CHARS;
  const [typed, setTyped] = useState(0);
  const reduced = useReducedMotion();
  const count = reduced ? list.length : typed;
  const done = count >= list.length;

  useEffect(() => {
    if (prefersReducedMotion() || !root.current) return;
    const st = ScrollTrigger.create({
      trigger: root.current,
      start: "top 65%",
      end: "top top",
      onUpdate: (self) => setTyped(Math.round(self.progress * list.length)),
    });
    return () => st.kill();
  }, [list.length]);

  return (
    <section id="statement" ref={root} className="relative flex min-h-dvh items-center">
      <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-8">
        <p className="label mb-10 text-muted">The problem</p>
        <p className="text-[8.5vw] font-extrabold leading-[1.02] tracking-tight sm:text-6xl lg:max-w-[62%] lg:text-7xl" aria-label={TEXT.replace(/[[\]]/g, "")}>
          {list.map((ch, i) => (
            <span key={i} aria-hidden className={`${ch.hot ? "text-hazard" : "text-bone"} ${i < count ? "" : "opacity-0"}`}>
              {ch.c}
              {i === count - 1 && <Caret blink={done} />}
            </span>
          ))}
          {count === 0 && <Caret blink />}
        </p>
        <p className={`label mt-12 max-w-xl leading-relaxed text-muted transition-opacity duration-700 ${done ? "opacity-100" : "opacity-0"}`}>
          Source: CoinGecko study of Pump.fun launches (2026): about two thirds stop trading within 24 hours. When a coin dies,
          the early sellers get out and the loyal holders are left with a token nobody buys.
        </p>
      </div>
    </section>
  );
}

function Caret({ blink }: { blink: boolean }) {
  return (
    <span
      aria-hidden
      className={`ml-[0.04em] inline-block h-[0.82em] w-[0.09em] translate-y-[0.1em] bg-hazard align-baseline ${blink ? "animate-blink" : ""}`}
    />
  );
}
