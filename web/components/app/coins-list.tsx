"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { coinPhase, type Phase } from "@/lib/coin";
import { NETWORK } from "@/lib/config";
import { formatNear, yoctoToNear } from "@/lib/format";
import { getCoins, getMetadata, getStatus, type CoinInfo, type CoinStatus } from "@/lib/near";
import { Amount, CoinIcon, NearIcon, PhaseBadge, PriceText } from "./ui";

type Row = { info: CoinInfo; status: CoinStatus | null; icon: string | null; phase: Phase | null };

type StatusFilter = "all" | "flying" | "ejectable" | "ejected";
type ClockFilter = "all" | "demo" | "real";
type SortKey = "launched" | "price" | "fund" | "engine";

const STATUS_OPTIONS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "flying", label: "Flying" },
  { id: "ejectable", label: "Ejectable" },
  { id: "ejected", label: "Ejected" },
];
const CLOCK_OPTIONS: Array<{ id: ClockFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "demo", label: "Demo time" },
  { id: "real", label: "Real days" },
];

const POLL_MS = 8000;
// Phones: coin and status only (price and fund under the name). From md up: the full table.
const COLS = "grid-cols-[1fr_auto] md:grid-cols-[minmax(220px,2fr)_9.5rem_1fr_1fr_1.2fr_7rem_1.5rem]";

const fundOf = (r: Row) => (r.status ? yoctoToNear(r.status.ejected ? r.status.ejected.fund_e : r.status.fund) : 0);
const engineOf = (r: Row) =>
  r.status && !r.status.ejected ? yoctoToNear(r.status.window_buys) / Math.max(1e-9, yoctoToNear(r.status.alive_threshold)) : 0;
const priceOf = (r: Row) => (r.status && !r.status.ejected ? yoctoToNear(r.status.price) : 0);

/** Every coin the factory launched, in one table card. Read straight from the chain, no indexer. */
export function CoinsList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [clock, setClock] = useState<ClockFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "launched", dir: -1 });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    const icons = new Map<string, string | null>();
    const load = async () => {
      try {
        const coins = await getCoins();
        const next = await Promise.all(
          coins.map(async (info): Promise<Row> => {
            if (!icons.has(info.account_id)) {
              icons.set(info.account_id, await getMetadata(info.account_id).then((m) => m.icon ?? null).catch(() => null));
            }
            const st = await getStatus(info.account_id).catch(() => null);
            return { info, status: st, icon: icons.get(info.account_id) ?? null, phase: st ? coinPhase(st) : null };
          }),
        );
        if (!alive) return;
        setRows(next);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "RPC error");
      }
    };
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // Esc closes the expanded table.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const totals = useMemo(() => {
    let flying = 0;
    let fund = 0;
    rows?.forEach((r) => {
      if (r.phase && r.phase !== "ejected") flying++;
      if (r.status && !r.status.ejected) fund += yoctoToNear(r.status.fund);
    });
    return { flying, fund };
  }, [rows]);

  const shown = useMemo(() => {
    if (!rows) return null;
    const list = rows.filter((r) => {
      const okStatus =
        status === "all" ||
        (status === "flying" && r.phase !== "ejected" && r.phase !== "ejectable") ||
        r.phase === status;
      const demo = r.info.day_length_sec < 86400;
      const okClock = clock === "all" || (clock === "demo" ? demo : !demo);
      return okStatus && okClock;
    });
    const val = (r: Row) =>
      sort.key === "launched" ? r.info.created_at : sort.key === "price" ? priceOf(r) : sort.key === "fund" ? fundOf(r) : engineOf(r);
    return list.sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [rows, status, clock, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));

  return (
    <div className="mx-auto max-w-7xl px-4 pb-32 pt-20 sm:px-8">
      {/* title row */}
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div>
          <h1 className="display text-6xl leading-none sm:text-8xl">Coins</h1>
          <p className="label mt-5 max-w-md leading-relaxed text-muted">
            Every coin here has an ejection seat. Each row is read live from the factory on NEAR {NETWORK}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* the two stats stay on one row, also on phones */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Pill icon={<FlyIcon />} value={rows ? String(totals.flying) : "-"} label="Flying" />
            <Pill icon={<NearIcon className="h-3.5 w-3.5 text-bone" />} value={rows ? formatNear(totals.fund, 2) : "-"} label="In Ejecto Funds" short="In funds" />
          </div>
          <Link
            href="/launch/"
            className="label rounded-full bg-hazard px-5 py-3 font-bold text-ink transition-transform hover:-translate-y-0.5"
          >
            Launch a coin
          </Link>
        </div>
      </div>

      {/* table card */}
      {expanded && <div className="fixed inset-0 z-[60] bg-ink/80 backdrop-blur-sm" onClick={() => setExpanded(false)} aria-hidden />}
      <div
        className={`overflow-hidden rounded-2xl border border-line bg-panel ${
          expanded ? "fixed inset-3 z-[61] flex flex-col sm:inset-8" : "relative mt-12"
        }`}
      >
        {/* toolbar */}
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
            <Dropdown label="Clock" value={clock} options={CLOCK_OPTIONS} onChange={setClock} />
            {(status !== "all" || clock !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setStatus("all");
                  setClock("all");
                }}
                className="label px-2 text-muted transition-colors hover:text-hazard"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="label hidden text-muted sm:inline">
              {shown ? `${shown.length} of ${rows?.length ?? 0}` : "Loading"}
            </span>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Close full view" : "Expand table"}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-hazard hover:bg-hazard hover:text-ink"
            >
              <ExpandIcon open={expanded} />
            </button>
          </div>
        </div>

        {/* table: scrolls inside the card, sideways on small screens */}
        <div className={`overflow-auto ${expanded ? "flex-1" : "max-h-[68vh] md:min-h-[420px]"}`} data-lenis-prevent>
          <div className="md:min-w-[860px]">
            <div className={`label sticky top-0 z-10 grid ${COLS} items-center gap-x-5 border-b border-line bg-panel px-4 py-3 text-muted sm:px-5`}>
              <span>Coin</span>
              <span>Status</span>
              <SortHead k="price" hide sort={sort} onClick={toggleSort}>Price</SortHead>
              <SortHead k="fund" hide sort={sort} onClick={toggleSort}>Ejecto Fund</SortHead>
              <SortHead k="engine" hide sort={sort} onClick={toggleSort}>Engine, 14 days</SortHead>
              <SortHead k="launched" hide sort={sort} onClick={toggleSort} right>Launched</SortHead>
              <span className="hidden md:block" />
            </div>

            {error && !rows && <Notice text={`Could not read the factory (${error}).`} />}
            {!rows && !error && <SkeletonRows />}
            {shown && shown.length === 0 && <Empty filtered={(rows?.length ?? 0) > 0} />}
            {shown?.map((r) => <CoinRow key={r.info.account_id} row={r} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoinRow({ row }: { row: Row }) {
  const { info, status, icon, phase } = row;
  const ratio = engineOf(row);
  // Bar is full at 4x the alive line, so the line itself sits at 25%.
  const fill = Math.min(1, ratio / 4);
  const barTone = phase === "alive" ? "bar-hud" : phase === "dying" ? "bar-hot" : phase === "ejectable" ? "bar-eject" : "bar-muted";

  return (
    <Link
      href={`/coin/?id=${info.account_id}`}
      className={`group relative grid ${COLS} items-center gap-x-5 border-b border-line px-4 py-4 transition-colors duration-300 last:border-b-0 hover:text-ink sm:px-5`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 origin-left scale-x-0 bg-hazard transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
      />
      <span className="relative flex min-w-0 items-center gap-3">
        <CoinIcon icon={icon} symbol={info.symbol} className="h-10 w-10" />
        <span className="min-w-0">
          <span className="block truncate font-semibold tracking-tight">{info.name}</span>
          <span className="label mt-0.5 block text-muted transition-colors group-hover:text-ink/60">
            ${info.symbol.toUpperCase()}
            {info.day_length_sec < 86400 && <span className="ml-2 text-hazard group-hover:text-ink">Demo</span>}
          </span>
        </span>
      </span>

      <span className="relative self-start md:self-auto">
        {phase ? <PhaseBadge phase={phase} className="group-hover:border-ink group-hover:text-ink" /> : <span className="label text-muted">...</span>}
      </span>

      {/* phones only: the numbers of the hidden columns, on their own row under the name */}
      <span className="relative col-span-2 mt-3 flex gap-8 pl-[3.25rem] md:hidden">
        <span>
          <span className="label block text-muted">Price</span>
          <span className="mt-1 block tabular-nums">
            {!status ? "..." : status.ejected ? <span className="text-muted">Closed</span> : <Amount><PriceText value={yoctoToNear(status.price)} /></Amount>}
          </span>
        </span>
        <span>
          <span className="label block text-muted">Ejecto Fund</span>
          <span className="mt-1 block tabular-nums">
            <Amount icon="text-muted"><span className="text-hazard">{formatNear(fundOf(row), 3)}</span></Amount>
          </span>
        </span>
      </span>

      <span className="relative hidden tabular-nums md:block">
        {!status ? "..." : status.ejected ? <span className="text-muted group-hover:text-ink/60">Closed</span> : <Amount><PriceText value={yoctoToNear(status.price)} /></Amount>}
      </span>

      <span className="relative hidden tabular-nums md:block">
        <Amount icon="text-muted group-hover:text-ink/70">
          <span className="text-hazard transition-colors group-hover:text-ink">{formatNear(fundOf(row), 3)}</span>
        </Amount>
      </span>

      <span className="relative hidden items-center gap-3 md:flex">
        <span className="block h-2.5 flex-1 overflow-hidden bg-panel-2 group-hover:bg-ink/15">
          <span className={`bar-stripes block h-full ${barTone}`} style={{ width: `${fill * 100}%` }} />
        </span>
        <span className="label w-10 text-right tabular-nums text-muted group-hover:text-ink/70">
          {status?.ejected ? "off" : `${ratio.toFixed(1)}x`}
        </span>
      </span>

      <span className="label relative hidden text-right tabular-nums text-muted group-hover:text-ink/70 md:block">{timeAgo(info.created_at)}</span>
      <span className="relative hidden text-right text-muted transition-transform md:block group-hover:translate-x-1 group-hover:text-ink" aria-hidden>
        &rarr;
      </span>
    </Link>
  );
}

function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const active = value !== options[0].id;
  const current = options.find((o) => o.id === value)?.label;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`label flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
          active ? "border-hazard text-hazard" : "border-transparent text-bone hover:border-line"
        }`}
      >
        <FilterIcon />
        {label}
        {active && <span className="text-bone">: {current}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-panel-2 py-1">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={`label flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-hazard hover:text-ink ${
                o.id === value ? "text-hazard" : "text-bone"
              }`}
            >
              {o.label}
              {o.id === value && <span aria-hidden>&bull;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortHead({
  k,
  sort,
  onClick,
  right,
  hide,
  children,
}: {
  hide?: boolean;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onClick: (k: SortKey) => void;
  right?: boolean;
  children: React.ReactNode;
}) {
  const on = sort.key === k;
  return (
    <button
      type="button"
      onClick={() => onClick(k)}
      className={`${hide ? "hidden md:flex" : "flex"} items-center gap-1.5 uppercase transition-colors hover:text-bone ${right ? "justify-end" : ""} ${on ? "text-bone" : ""}`}
    >
      {children}
      <span className={on ? "text-hazard" : "opacity-0"} aria-hidden>
        {sort.dir === -1 ? "↓" : "↑"}
      </span>
    </button>
  );
}

function Pill({ value, label, short, icon }: { value: string; label: string; short?: string; icon: React.ReactNode }) {
  return (
    <div className="label flex items-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-2.5 sm:gap-2.5 sm:px-4 sm:py-3">
      {icon}
      <span className="font-bold tabular-nums text-bone">{value}</span>
      {short ? (
        <>
          <span className="text-muted sm:hidden">{short}</span>
          <span className="hidden text-muted sm:inline">{label}</span>
        </>
      ) : (
        <span className="text-muted">{label}</span>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-label="Loading coins">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`grid ${COLS} items-center gap-x-5 border-b border-line px-4 py-4 sm:px-5`}>
          <span className="flex items-center gap-3">
            <span className="h-9 w-9 animate-pulse rounded-xl bg-panel-2" />
            <span className="h-3 w-28 animate-pulse bg-panel-2" />
          </span>
          <span className="h-6 w-24 animate-pulse rounded-full bg-panel-2" />
          <span className="h-3 w-16 animate-pulse bg-panel-2" />
          <span className="h-3 w-14 animate-pulse bg-panel-2" />
          <span className="h-2.5 animate-pulse bg-panel-2" />
          <span className="ml-auto h-3 w-14 animate-pulse bg-panel-2" />
          <span />
        </div>
      ))}
    </div>
  );
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-5 px-4 py-20 text-center">
      <p className="display text-3xl">{filtered ? "Nothing here" : "No coins yet"}</p>
      <p className="label text-muted">{filtered ? "No coin matches these filters right now." : "Be the first pilot."}</p>
      {!filtered && (
        <Link href="/launch/" className="label rounded-full bg-hazard px-6 py-3 font-bold text-ink transition-transform hover:-translate-y-0.5">
          Launch a coin
        </Link>
      )}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="p-5">
      <div className="label rounded-xl border border-eject/50 bg-eject/10 px-5 py-8 text-center text-eject">{text}</div>
    </div>
  );
}

/** Seat flying up with its exhaust: coins that are still trading. */
function FlyIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 text-hazard" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 1.5c2 1.6 2.8 3.8 2.6 6.6H5.4C5.2 5.3 6 3.1 8 1.5Z" />
      <path d="M5.4 8.1 3.6 9.6v1.6l2-.8M10.6 8.1l1.8 1.5v1.6l-2-.8" />
      <path d="M6.8 11.6 6.4 14M9.2 11.6l.4 2.4" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M2 4h12M4.5 8h7M7 12h2" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      {open ? <path d="M6 2v4H2M10 14v-4h4M10 2v4h4M6 14v-4H2" /> : <path d="M10 2h4v4M6 14H2v-4M14 2 9 7M2 14l5-5" />}
    </svg>
  );
}

function timeAgo(sec: number): string {
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
