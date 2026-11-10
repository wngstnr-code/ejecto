"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { loadSignal } from "@/lib/load-signal";
import { pilotScroll } from "@/lib/pilot-scroll";

const MIN_BAR_MS = 700; // let the bar be seen even when the model is cached
const MAX_MS = 10000; // never block the page, even if WebGL fails

const STEPS: Array<[number, string]> = [
  [0, "Strapping in"],
  [35, "Arming the seat"],
  [70, "Checking the fund"],
  [100, "Ready to fly"],
];

/**
 * Loading screen. While the 3D pilot downloads it shows the real progress. Once the model is ready the
 * pilot itself pops up in the middle (its layer sits above this screen during the intro), says hi,
 * then this screen fades out and the same pilot glides into its hero pose.
 */
export function Preloader() {
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const el = root.current;
    const html = document.documentElement;
    const handOver = () => {
      pilotScroll.appear = 1;
      pilotScroll.intro = 1;
      delete html.dataset.intro;
      html.style.overflow = "";
    };
    if (!el) return;
    if (prefersReducedMotion()) {
      handOver();
      el.style.display = "none";
      return;
    }

    // The greeting is staged for the hero: start at the top even after a reload mid page.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    pilotScroll.appear = 0;
    pilotScroll.intro = 0;
    html.dataset.intro = "on";
    html.style.overflow = "hidden";
    const start = performance.now();
    let started = false;
    let tl: gsap.core.Timeline | null = null;

    const finish = () => {
      handOver();
      setGone(true);
    };

    const playIntro = () => {
      if (started) return;
      started = true;
      tl = gsap.timeline({ onComplete: finish });
      tl.to(bar.current, { opacity: 0, y: 12, duration: 0.35, ease: "power2.in" })
        .to(pilotScroll, { appear: 1, duration: 0.9, ease: "back.out(1.8)" }, "-=0.1")
        .fromTo(bubble.current, { opacity: 0, scale: 0.4, rotate: -12 }, { opacity: 1, scale: 1, rotate: -4, duration: 0.5, ease: "back.out(2.2)" }, "-=0.45")
        .to({}, { duration: 1.3 })
        .to(bubble.current, { opacity: 0, scale: 0.8, duration: 0.25, ease: "power2.in" })
        .to(el, { opacity: 0, duration: 0.7, ease: "power2.out" }, "<")
        .to(pilotScroll, { intro: 1, duration: 1.6, ease: "power2.inOut" }, "<");
    };

    const check = () => {
      const s = loadSignal.get();
      setPct(Math.round(s.ready ? 100 : s.progress));
      if (s.ready && performance.now() - start >= MIN_BAR_MS) playIntro();
    };
    const unsubscribe = loadSignal.subscribe(check);
    const timer = window.setInterval(check, 120);
    // If the model never arrives, skip the greeting and just reveal the page.
    const fallback = window.setTimeout(() => {
      if (started) return;
      started = true;
      gsap.to(el, { opacity: 0, duration: 0.5, onComplete: finish });
    }, MAX_MS);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.clearTimeout(fallback);
      tl?.kill();
      handOver();
    };
  }, []);

  if (gone) return null;
  const status = [...STEPS].reverse().find(([at]) => pct >= at)?.[1] ?? STEPS[0][1];

  return (
    <div ref={root} className="fixed inset-0 z-[100] bg-ink" role="status" aria-label="Loading Ejecto">
      {/* Greeting bubble, next to where the 3D pilot pops up. */}
      <div ref={bubble} className="absolute left-[min(calc(50%_+_8vh),calc(100%_-_13rem))] top-[13%] origin-bottom-left opacity-0 sm:left-1/2 sm:translate-x-[14vh]">
        <div className="display whitespace-nowrap rounded-2xl bg-hazard px-5 py-3 text-lg text-ink sm:text-2xl">Hi! Strap in.</div>
        <div className="ml-6 h-0 w-0 border-x-[12px] border-t-[14px] border-x-transparent border-t-hazard" />
      </div>

      <div ref={bar} className="absolute left-1/2 top-1/2 w-[min(82vw,360px)] -translate-x-1/2 -translate-y-1/2">
        <div className="label flex items-center justify-between">
          <span className="text-muted">{status}</span>
          <span className="tabular-nums text-bone">{pct}%</span>
        </div>
        <div className="mt-3 h-3 overflow-hidden bg-line">
          <div className="hazard-stripes-thin h-full transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
