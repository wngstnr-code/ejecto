"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/site/logo";
import { explorerAccount, NETWORK } from "@/lib/config";
import { shortAccount } from "@/lib/format";
import { errorText, useWallet } from "@/lib/wallet";

const NAV = [
  { href: "/coins/", label: "Coins" },
  { href: "/launch/", label: "Launch" },
  { href: "/seats/", label: "My seats" },
];

export function AppHeader() {
  const path = usePathname();
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-ink/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" aria-label="Ejecto home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((n) => {
            const active = path?.startsWith(n.href.replace(/\/$/, ""));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`label transition-colors hover:text-bone ${active ? "text-hazard" : "text-muted"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <WalletButton />
      </div>
      {/* small screens: nav under the bar */}
      <nav className="flex gap-6 border-t border-line px-4 py-2 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="label text-muted">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

function WalletButton() {
  const { ready, accountId, walletInfo, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!accountId) {
    return (
      <div className="relative">
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            setError(null);
            connect().catch((e) => setError(errorText(e)));
          }}
          className="label rounded-full bg-hazard px-4 py-2.5 font-bold text-ink transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        >
          {ready ? "Connect wallet" : "Loading..."}
        </button>
        {error && <p className="label absolute right-0 top-full mt-2 w-64 text-right text-eject">{error}</p>}
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="label flex items-center gap-2.5 rounded-full border border-line bg-panel py-2 pl-2.5 pr-4 text-bone transition-colors hover:border-hazard"
      >
        {walletInfo?.icon ? (
          // Logo from the wallet manifest (usually a data URL or the wallet's own CDN).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={walletInfo.icon} alt="" title={walletInfo.name} className="h-5 w-5 rounded-md object-contain" />
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-panel-2 text-[10px] text-muted" aria-hidden>
            W
          </span>
        )}
        {shortAccount(accountId, 20)}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="label border-b border-line px-4 py-3 text-muted">
            {walletInfo ? `${walletInfo.name}, ` : ""}
            {NETWORK}
          </div>
          <a
            href={explorerAccount(accountId)}
            target="_blank"
            rel="noreferrer"
            className="label block px-4 py-3 text-bone transition-colors hover:bg-hazard hover:text-ink"
          >
            View on explorer
          </a>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              disconnect().catch(() => {});
            }}
            className="label block w-full px-4 py-3 text-left text-bone transition-colors hover:bg-eject hover:text-ink"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
