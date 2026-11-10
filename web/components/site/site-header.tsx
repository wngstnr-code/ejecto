"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./logo";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#crash", label: "The crash" },
  { href: "#safeguards", label: "Safeguards" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled ? "border-b border-line bg-ink/80 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
        <Link href="/" aria-label="Ejecto home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="label text-muted transition-colors hover:text-bone">
              {n.label}
            </a>
          ))}
        </nav>
        <Link
          href="/coins/"
          className="label rounded-full bg-hazard px-4 py-2.5 font-bold text-ink transition-transform hover:-translate-y-0.5"
        >
          Launch app
        </Link>
      </div>
    </header>
  );
}
