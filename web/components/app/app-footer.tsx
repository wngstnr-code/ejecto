"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/site/logo";
import { SiteFooter } from "@/components/site/site-footer";
import { lenisInstance } from "@/components/site/smooth-scroll";

/**
 * App pages keep the footer folded into one small bar with a button, so the tools stay in focus.
 * The button unfolds the full site footer.
 */
export function AppFooter() {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // After unfolding, bring the footer into view. Lenis needs a resize for the new page height.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      lenisInstance?.resize();
      if (panel.current) {
        if (lenisInstance) lenisInstance.scrollTo(panel.current, { offset: -64, duration: 1.2 });
        else panel.current.scrollIntoView({ behavior: "smooth" });
      }
    }, 520);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <div className="border-t border-line bg-ink">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <LogoMark className="h-6 w-6" />
          <span className="label hidden text-muted sm:inline">Keyless memecoins with an ejection seat, on NEAR</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="label group flex items-center gap-3 rounded-full border border-line px-4 py-2.5 text-bone transition-colors hover:border-hazard hover:bg-hazard hover:text-ink"
        >
          {open ? "Fold footer" : "More about Ejecto"}
          <span className={`inline-block transition-transform duration-300 ${open ? "rotate-180" : ""}`} aria-hidden>
            &uarr;
          </span>
        </button>
      </div>

      {/* grid-rows trick: animates height from 0 to auto */}
      <div
        className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        onTransitionEnd={() => lenisInstance?.resize()}
      >
        <div ref={panel} className="overflow-hidden" inert={!open}>
          <SiteFooter />
        </div>
      </div>
    </div>
  );
}
