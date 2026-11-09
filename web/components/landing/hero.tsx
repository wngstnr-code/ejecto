"use client";

import { useEffect, useRef } from "react";
import { gsap, prefersReducedMotion } from "@/lib/gsap";

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    if (prefersReducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".hero-reveal", { yPercent: 110, duration: 1, ease: "power4.out", stagger: 0.08, delay: 0.2 });
      gsap.from(".hero-fade", { opacity: 0, y: 16, duration: 0.8, ease: "power2.out", stagger: 0.08, delay: 0.6 });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section id="hero" ref={root} className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      {/* giant background word, scrolling right to left without a seam */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-[18%] select-none overflow-hidden" aria-hidden>
        <div className="flex w-max animate-marquee-slow">
          {[0, 1].map((i) => (
            <div key={i} className="display flex shrink-0 whitespace-nowrap text-[30vw] text-panel">
              {Array.from({ length: 3 }, (_, j) => (
                <span key={j} className="pr-[6vw]">
                  EJECTO
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="relative mx-auto grid w-full max-w-7xl flex-1 items-center gap-6 px-4 pb-[16vh] pt-20 sm:px-8 lg:grid-cols-[1.05fr_1fr]">
        <div className="relative z-10">
          <h1 className="display text-[15vw] text-bone sm:text-[11vw] lg:text-[6.6rem]">
            <span className="block overflow-hidden">
              <span className="hero-reveal block">Every</span>
            </span>
            <span className="block overflow-hidden">
              <span className="hero-reveal block">memecoin</span>
            </span>
            <span className="block overflow-hidden">
              <span className="hero-reveal block text-eject">dies.</span>
            </span>
          </h1>
          <p className="hero-fade mt-8 max-w-md text-lg leading-relaxed text-muted">
            Ours come with an <span className="font-semibold text-bone">ejection seat</span>. When the coin dies, anyone pulls
            the handle and every holder claims a fair share. No exit race. No admin keys.
          </p>
        </div>

        {/* The 3D pilot (PilotStage) flies over this column. */}
        <div className="h-[46vh] lg:h-[70vh]" aria-hidden />
      </div>
    </section>
  );
}
