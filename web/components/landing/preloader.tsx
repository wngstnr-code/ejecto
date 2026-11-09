"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";

const CHECKS: Array<[string, string]> = [
  ["SEAT", "ARMED"],
  ["EJECTO FUND", "ARMED"],
  ["PARAMETERS", "LOCKED"],
  ["ADMIN KEYS", "NONE"],
];

const SEEN_KEY = "ejecto-preflight-seen";

/** Cockpit pre-flight check. Runs once per browser session and can be skipped. */
export function Preloader() {
  const [show, setShow] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage blocked: just play it */
    }
    const el = root.current;
    if (!el) return;
    if (seen || prefersReducedMotion()) {
      el.style.display = "none";
      return;
    }
    document.documentElement.style.overflow = "hidden";

    const ctx = gsap.context(() => {
      const t = gsap.timeline({
        onComplete: () => {
          try {
            sessionStorage.setItem(SEEN_KEY, "1");
          } catch {
            /* ignore */
          }
          document.documentElement.style.overflow = "";
          setShow(false);
        },
      });
      t.from(".pf-line", { opacity: 0, x: -12, duration: 0.18, stagger: 0.16, ease: "power2.out" })
        .from(".pf-state", { opacity: 0, duration: 0.01, stagger: 0.16 }, 0.12)
        .from(".pf-title", { opacity: 0, scale: 1.08, duration: 0.25, ease: "power3.out" }, "+=0.1")
        .to(".pf-title", { opacity: 1, duration: 0.45 })
        .to(el, { yPercent: -100, duration: 0.7, ease: "power4.inOut" });
      tl.current = t;
    }, el);

    return () => {
      ctx.revert();
      document.documentElement.style.overflow = "";
    };
  }, []);

  if (!show) return null;

  return (
    <div
      ref={root}
      className="fixed inset-0 z-[100] flex flex-col justify-between bg-ink p-6 sm:p-10"
      onClick={() => tl.current?.progress(1)}
      role="status"
      aria-label="Loading Ejecto"
    >
      <div className="label flex justify-between text-muted">
        <span>Ejecto pre-flight check</span>
        <button type="button" className="text-bone underline-offset-4 hover:underline" onClick={() => tl.current?.progress(1)}>
          Skip
        </button>
      </div>

      <div className="flex flex-col items-center gap-10">
        <ul className="w-full max-w-md space-y-2 font-mono text-sm sm:text-base">
          {CHECKS.map(([name, state]) => (
            <li key={name} className="pf-line flex items-baseline gap-2">
              <span className="text-muted">{name}</span>
              <span className="flex-1 overflow-hidden whitespace-nowrap text-line">{".".repeat(60)}</span>
              <span className={`pf-state font-bold ${state === "NONE" ? "text-hazard" : "text-hud"}`}>{state}</span>
            </li>
          ))}
        </ul>
        <h1 className="pf-title glitch display text-[18vw] text-bone sm:text-[12vw]" data-text="EJECTO">
          EJECTO
        </h1>
      </div>

      <div className="hazard-stripes h-3 w-full opacity-80" />
    </div>
  );
}
