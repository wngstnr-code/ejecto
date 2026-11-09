"use client";

import Link from "next/link";
import { explorerAccount, FACTORY_ID, REPO_URL } from "@/lib/config";
import { LogoMark } from "./logo";
import { lenisInstance } from "./smooth-scroll";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Product",
    links: [
      { label: "Launch a coin", href: "/launch/" },
      { label: "Explore coins", href: "/coins/" },
      { label: "How it works", href: "/#how" },
    ],
  },
  {
    title: "Verify",
    links: [
      { label: "Factory on explorer", href: explorerAccount(FACTORY_ID), external: true },
      { label: "Simulation model", href: `${REPO_URL}/blob/main/sim/ejecto-sim.mjs`, external: true },
      { label: "Docs and spec", href: `${REPO_URL}/tree/main/docs`, external: true },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source code", href: REPO_URL, external: true },
      { label: "NEAR HACKATHON 2026", href: "https://nearhackathon.com", external: true },
    ],
  },
];

export function SiteFooter() {
  const toTop = () => {
    if (lenisInstance) lenisInstance.scrollTo(0, { duration: 1.6 });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer className="relative overflow-hidden bg-ink text-bone">
      <div className="mx-auto max-w-7xl px-4 pt-24 sm:px-8">
        <div className="grid gap-12 border-b border-line pb-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <LogoMark className="h-9 w-9" />
              <span className="display text-2xl">Ejecto</span>
            </div>
            <p className="label mt-6 max-w-xs leading-relaxed text-muted">
              A memecoin with a built-in ejection seat. Keyless contracts on NEAR. No backend.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <div className="label text-hazard">{col.title}</div>
              <ul className="mt-6 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noreferrer" className="group label inline-flex items-center gap-2 text-muted transition-colors hover:text-bone">
                        {l.label}
                        <span aria-hidden className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
                          &#8599;
                        </span>
                      </a>
                    ) : (
                      <Link href={l.href} className="group label inline-flex items-center gap-2 text-muted transition-colors hover:text-bone">
                        {l.label}
                        <span aria-hidden className="transition-transform group-hover:translate-x-1">
                          &rarr;
                        </span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="label text-muted">Built for NEAR HACKATHON 2026. Testnet only. Unaudited. Not financial advice.</p>
          <button
            type="button"
            onClick={toTop}
            className="label inline-flex w-fit items-center gap-2 border border-line px-3 py-2 text-bone transition-colors hover:border-hazard hover:bg-hazard hover:text-ink"
          >
            Back to top <span aria-hidden>&uarr;</span>
          </button>
        </div>
      </div>

      {/* Giant full-bleed wordmark, slightly cut on both sides and at the bottom.
          A hovered letter lifts and turns yellow. */}
      <div className="select-none overflow-hidden" aria-hidden>
        <div className="display -mx-[3vw] flex justify-center whitespace-nowrap text-[21vw] leading-[0.8]">
          {"EJECTO".split("").map((ch, i) => (
            <span key={i} className="inline-block translate-y-[16%] text-panel-2 transition-[transform,color] duration-300 hover:translate-y-[4%] hover:text-hazard">
              {ch}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
