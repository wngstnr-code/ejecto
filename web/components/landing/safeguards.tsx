"use client";

import { explorerAccount, FACTORY_ID } from "@/lib/config";
import { useLiveStats } from "@/lib/use-live-stats";
import { Reveal } from "./reveal";

type Tile = {
  n: string;
  tag: string;
  value: string;
  live?: boolean; // value read live from testnet
  title: string;
  body: string;
  link?: { href: string; label: string };
};

/** Spec board of the guarantees. Right-aligned: the 3D pilot floats on the left of this section. */
export function Safeguards() {
  const live = useLiveStats();
  const ready = live.kind === "ready" ? live.stats : null;
  const coin = ready?.firstCoin ?? null;
  const hash = ready?.config.coin_code_hash ?? null;

  const tiles: Tile[] = [
    {
      n: "01",
      tag: "Keyless",
      value: ready ? String(ready.coinKeys) : "...",
      live: true,
      title: "Access keys on coin accounts",
      body: ready
        ? `Read live from all ${ready.coins} coin account${ready.coins === 1 ? "" : "s"}. Nobody can upgrade, drain or log in. Not even us.`
        : "Read live from every coin account on testnet.",
      // Opens the coin's access key list on the explorer: it is empty.
      link: coin ? { href: `${explorerAccount(coin.account_id)}/keys`, label: `See ${coin.symbol}'s keys: none` } : undefined,
    },
    {
      n: "02",
      tag: "No admin",
      value: "0",
      title: "Owner or admin methods",
      body: "No owner, no pause, no setters in the coin contract. Protocol fees can only ever go to one fixed account.",
    },
    {
      n: "03",
      tag: "Locked",
      value: "1x",
      title: "Parameters written once",
      body: "Curve, fee preset and day length are set in the init call at launch. They cannot change afterwards.",
    },
    {
      n: "04",
      tag: "Anti-farm",
      value: "-31%",
      title: "A late whale's result, at best",
      body: "The fund is split by net capital times time held. In the model, buying big right before EJECT loses 30.8% to 48.5%.",
    },
    {
      n: "05",
      tag: "Pull claims",
      value: "You",
      title: "Withdraw your own share",
      body: "After EJECT each holder claims for themselves. State is updated before any transfer, and repeat claims are safe.",
    },
    {
      n: "06",
      tag: "Verifiable",
      value: hash ? `${hash.slice(0, 4)}..${hash.slice(-4)}` : "sha256",
      live: true,
      title: "Code hash on chain",
      body: `Every coin runs the same code. Its sha256 is public in the ${FACTORY_ID} config.`,
      // The explorer's contract tab shows "Contract Source Code Verified" and the source files.
      link: { href: `${explorerAccount(FACTORY_ID)}/contract/code`, label: "See it verified" },
    },
  ];

  return (
    <section id="safeguards" className="relative bg-ink text-bone">
      <div className="mx-auto max-w-7xl px-4 py-32 sm:px-8">
        <div className="lg:ml-auto lg:w-[64%]">
          <div className="lg:text-right">
            <h2 className="display whitespace-nowrap text-[10.5vw] sm:text-7xl">Safeguards</h2>
            <p className="label mt-5 leading-relaxed text-muted">
              The track rules: the mechanic lives in the contract, no admin key.
              <br />
              Six ways we keep that promise.
            </p>
          </div>

          <div className="mt-16 grid border-l border-t border-line sm:grid-cols-2">
            {tiles.map((t, i) => (
              <Reveal key={t.n} delay={(i % 2) * 0.08} className="h-full">
                <article className="group relative flex h-full min-h-[20rem] flex-col overflow-hidden border-b border-r border-line p-7 transition-colors duration-300 hover:text-ink lg:items-end lg:text-right">
                  {/* hover wipe, from the right (mirror of The Math) */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 origin-right scale-x-0 bg-hazard transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
                  />
                  {/* Everything is top-aligned at fixed offsets, so tiles in the same row line up. */}
                  <div className="relative flex w-full items-center justify-between lg:flex-row-reverse">
                    <span className="label text-muted transition-colors duration-300 group-hover:text-ink/60">[{t.n}]</span>
                    <span className="flex items-center gap-3.5">
                      <span className="label text-hazard transition-colors duration-300 group-hover:text-ink">{t.tag}</span>
                      {t.live && <LiveBadge />}
                    </span>
                  </div>
                  <div className="relative mt-8 flex h-14 w-full items-end lg:justify-end">
                    <span
                      className={`display leading-none tabular-nums text-hazard transition-colors duration-300 group-hover:text-ink ${
                        t.value.length > 5 ? "text-3xl sm:text-4xl" : "text-5xl"
                      }`}
                    >
                      {t.value}
                    </span>
                  </div>
                  <h3 className="relative mt-5 text-xl font-semibold leading-tight tracking-tight">{t.title}</h3>
                  <p className="label relative mt-3 max-w-xs leading-relaxed text-muted transition-colors duration-300 group-hover:text-ink/70">
                    {t.body}
                  </p>
                  {t.link && (
                    <div className="relative mt-auto pt-6">
                      {/* A real button look; on hover it turns solid black with yellow text, visible on the yellow tile. */}
                      <a
                        href={t.link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="label inline-flex items-center gap-2 border border-current px-3 py-2 text-bone transition-colors duration-200 group-hover:text-ink hover:border-ink! hover:bg-ink! hover:text-hazard!"
                      >
                        {t.link.label} <span aria-hidden>&rarr;</span>
                      </a>
                    </div>
                  )}
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Glowing green dot with two radar rings, marking values read straight from the chain. Turns black on hover. */
/** Live chain read: a broadcast icon whose waves light up one after another, outward. */
function LiveBadge() {
  return (
    <span title="Read live from NEAR testnet" aria-label="Read live from NEAR testnet" className="flex items-center text-hazard transition-colors group-hover:text-ink">
      <svg viewBox="0 0 24 16" className="h-4 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="8" r="2.2" fill="currentColor" stroke="none" className="origin-center animate-[live-core_1.6s_ease-in-out_infinite] [transform-box:fill-box]" />
        <path d="M8.3 4.6a4.8 4.8 0 0 0 0 6.8M15.7 4.6a4.8 4.8 0 0 1 0 6.8" className="animate-[live-wave_1.6s_ease-in-out_infinite]" />
        <path d="M5.2 1.8a8.8 8.8 0 0 0 0 12.4M18.8 1.8a8.8 8.8 0 0 1 0 12.4" className="animate-[live-wave_1.6s_ease-in-out_0.25s_infinite]" />
      </svg>
    </span>
  );
}
