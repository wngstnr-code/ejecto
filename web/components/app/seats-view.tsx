"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { coinPhase, GAS, type Phase } from "@/lib/coin";
import { formatCompact, formatNear, formatPct, unitsToTokens, yoctoToNear } from "@/lib/format";
import { getCoins, getHolder, getMetadata, getStatus, type CoinInfo, type CoinStatus, type HolderView } from "@/lib/near";
import { call, errorText, useWallet } from "@/lib/wallet";
import { TxNote, type Tx } from "./tx-note";
import { Amount, CoinIcon, PhaseBadge } from "./ui";

type Seat = { info: CoinInfo; status: CoinStatus; holder: HolderView; icon: string | null; phase: Phase };

const POLL_MS = 8000;
const icons = new Map<string, string | null>();

/**
 * Every coin where the connected wallet has (or had) a seat, read straight from the chain:
 * the factory's coin list, then `status()` and `holder()` per coin. No indexer.
 */
export function SeatsView() {
  const { ready, accountId, connect } = useWallet();
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const coins = await getCoins();
      const rows = await Promise.all(
        coins.map(async (info): Promise<Seat | null> => {
          const [status, holder] = await Promise.all([getStatus(info.account_id), getHolder(info.account_id, accountId)]);
          const hasSeat = BigInt(holder.balance) > 0n || holder.claimed;
          if (!hasSeat) return null;
          if (!icons.has(info.account_id)) {
            icons.set(info.account_id, await getMetadata(info.account_id).then((m) => m.icon ?? null).catch(() => null));
          }
          return { info, status, holder, icon: icons.get(info.account_id) ?? null, phase: coinPhase(status) };
        }),
      );
      setSeats(rows.filter((r): r is Seat => r !== null).sort((a, b) => b.info.created_at - a.info.created_at));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "RPC error");
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const first = window.setTimeout(load, 0);
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [accountId, load]);

  const payout = (h: HolderView) => yoctoToNear(h.reserve_part) + yoctoToNear(h.fund_part);
  const toClaim = seats?.filter((s) => s.phase === "ejected" && BigInt(s.holder.balance) > 0n) ?? [];
  const flying = seats?.filter((s) => s.phase !== "ejected" && BigInt(s.holder.balance) > 0n) ?? [];
  const landed = seats?.filter((s) => s.holder.claimed && BigInt(s.holder.balance) === 0n) ?? [];
  const claimTotal = toClaim.reduce((a, s) => a + payout(s.holder), 0);
  const ifNowTotal = flying.reduce((a, s) => a + payout(s.holder), 0);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-32 pt-20 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div>
          <h1 className="display text-6xl leading-none sm:text-8xl">My seats</h1>
          <p className="label mt-5 max-w-md leading-relaxed text-muted">
            Every coin you hold, and what the seat would pay you. When a coin dies, your parachute waits here.
          </p>
        </div>
        {accountId && seats && (
          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
            {/* phones: three equal stat boxes on one row; larger screens: pills */}
            <Pill label="Seats" value={String(flying.length + toClaim.length)} />
            <Pill label="Ready to claim" short="To claim" value={<Amount className={claimTotal > 0 ? "text-hazard" : ""}>{formatNear(claimTotal, 4)}</Amount>} />
            <Pill label="If all ejected now" short="If ejected" value={<Amount>{formatNear(ifNowTotal, 4)}</Amount>} />
          </div>
        )}
      </div>

      {!accountId ? (
        <Empty
          title="Connect to see your seats"
          text="Your seats are read from the chain for the connected wallet."
          action={
            <button
              type="button"
              disabled={!ready}
              onClick={() => connect().catch(() => {})}
              className="display rounded-full bg-hazard px-8 py-4 text-lg text-ink transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-50"
            >
              Connect wallet
            </button>
          }
        />
      ) : !seats ? (
        error ? (
          <p className="label mt-16 text-eject">Could not read your seats ({error}).</p>
        ) : (
          <div className="mt-16 space-y-3" aria-label="Loading seats">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-panel" />
            ))}
          </div>
        )
      ) : seats.length === 0 ? (
        <Empty
          title="No seats yet"
          text="Buy any amount of a coin to strap in. Your seats show up here."
          action={
            <Link href="/coins/" className="display rounded-full bg-hazard px-8 py-4 text-lg text-ink transition-transform hover:-translate-y-0.5">
              Find a coin
            </Link>
          }
        />
      ) : (
        <div className="mt-16 space-y-16">
          {toClaim.length > 0 && (
            <section>
              <SectionTitle n="01" title="Ready to claim" note="These coins were ejected. Your share is waiting." />
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {toClaim.map((s) => (
                  <ClaimCard key={s.info.account_id} seat={s} amount={payout(s.holder)} onDone={load} />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle n={toClaim.length ? "02" : "01"} title="Flying" note="Coins still trading. The payout is what you would get if the seat fired now." />
            {flying.length === 0 ? (
              <p className="label mt-6 text-muted">No open seats right now.</p>
            ) : (
              <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel">
                <div className="overflow-x-auto" data-lenis-prevent>
                  <div className="md:min-w-[760px]">
                    <div className={`label grid ${SEAT_COLS} gap-x-5 border-b border-line px-4 py-3 text-muted sm:px-5`}>
                      <span>Coin</span>
                      <span className="hidden md:block">Status</span>
                      <span className="hidden md:block">Balance</span>
                      <span className="hidden md:block">Net in</span>
                      <span className="hidden md:block">Fund weight</span>
                      <span className="text-right">If ejected now</span>
                      <span className="hidden md:block" />
                    </div>
                    {flying.map((s) => (
                      <SeatRow key={s.info.account_id} seat={s} amount={payout(s.holder)} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {landed.length > 0 && (
            <section>
              <SectionTitle n={toClaim.length ? "03" : "02"} title="Landed" note="Seats you already claimed." />
              <div className="mt-6 flex flex-wrap gap-3">
                {landed.map((s) => (
                  <Link
                    key={s.info.account_id}
                    href={`/coin/?id=${s.info.account_id}`}
                    className="label flex items-center gap-3 rounded-full border border-line py-2 pl-2 pr-4 text-muted transition-colors hover:border-hazard hover:text-bone"
                  >
                    <CoinIcon icon={s.icon} symbol={s.info.symbol} className="h-7 w-7" />
                    {s.info.name}
                    <span className="text-hud">Claimed</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// Phones: coin and payout only (status and weight under the name). From md up: the full table.
const SEAT_COLS = "grid-cols-[1fr_auto] md:grid-cols-[minmax(200px,2fr)_9.5rem_1fr_1fr_0.8fr_1fr_1.5rem]";

function SeatRow({ seat, amount }: { seat: Seat; amount: number }) {
  const { info, holder, icon, phase } = seat;
  const basisRaw = BigInt(holder.basis);
  const basis = basisRaw < 0n ? -yoctoToNear(-basisRaw) : yoctoToNear(basisRaw);
  const total = BigInt(holder.total_weight);
  const share = total > 0n ? Number((BigInt(holder.weight) * 1_000_000n) / total) / 10_000 : 0;
  return (
    <Link
      href={`/coin/?id=${info.account_id}`}
      className={`group relative grid ${SEAT_COLS} items-center gap-x-5 border-b border-line px-4 py-4 sm:px-5 transition-colors duration-300 last:border-b-0 hover:text-ink`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 origin-left scale-x-0 bg-hazard transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
      />
      <span className="relative flex min-w-0 items-center gap-3">
        <CoinIcon icon={icon} symbol={info.symbol} className="h-10 w-10" />
        <span className="min-w-0">
          <span className="block truncate font-semibold tracking-tight">{info.name}</span>
          <span className="label mt-0.5 block text-muted group-hover:text-ink/60">${info.symbol.toUpperCase()}</span>
          {/* phones only: what the hidden columns show on larger screens */}
          <span className="label mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted md:hidden">
            <PhaseBadge phase={phase} />
            <span>{formatPct(share, 2)} weight</span>
          </span>
        </span>
      </span>
      <span className="relative hidden md:block">
        <PhaseBadge phase={phase} className="group-hover:border-ink group-hover:text-ink" />
      </span>
      <span className="relative hidden tabular-nums md:block">{formatCompact(unitsToTokens(holder.balance))}</span>
      <span className="relative hidden tabular-nums md:block">
        <Amount icon="text-muted group-hover:text-ink/70">{`${basis < 0 ? "-" : ""}${formatNear(Math.abs(basis), 4)}`}</Amount>
      </span>
      <span className="relative hidden tabular-nums md:block">{formatPct(share, 2)}</span>
      <span className="relative text-right tabular-nums">
        <Amount className="text-hazard group-hover:text-ink" icon="text-muted group-hover:text-ink/70">
          {formatNear(amount, 4)}
        </Amount>
        {phase === "ejectable" && <span className="label mt-1 block text-eject group-hover:text-ink">Pull the handle</span>}
      </span>
      <span className="relative hidden text-right text-muted transition-transform group-hover:translate-x-1 md:block group-hover:text-ink" aria-hidden>
        &rarr;
      </span>
    </Link>
  );
}

function ClaimCard({ seat, amount, onDone }: { seat: Seat; amount: number; onDone: () => void }) {
  const { send } = useWallet();
  const [tx, setTx] = useState<Tx | null>(null);
  const busy = tx?.state === "pending";
  const { info, holder, icon } = seat;

  const claim = async () => {
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      const res = await send(info.account_id, [call("claim", {}, GAS.claim)]);
      setTx({ state: "done", text: "Claimed. Safe landing.", hash: res.hash });
      onDone();
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="hazard-stripes h-2" />
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <Link href={`/coin/?id=${info.account_id}`} className="flex min-w-0 items-center gap-3">
            <CoinIcon icon={icon} symbol={info.symbol} className="h-11 w-11" />
            <span className="min-w-0">
              <span className="block truncate font-semibold tracking-tight">{info.name}</span>
              <span className="label mt-0.5 block text-muted">${info.symbol.toUpperCase()}</span>
            </span>
          </Link>
          <PhaseBadge phase="ejected" />
        </div>
        <div className="mt-6 text-4xl font-semibold tabular-nums tracking-tight">
          <Amount icon="text-muted ml-1">{formatNear(amount, 4)}</Amount>
        </div>
        <div className="label mt-2 text-muted">
          {formatNear(yoctoToNear(holder.reserve_part), 4)} reserve +{" "}
          <span className="text-hazard">{formatNear(yoctoToNear(holder.fund_part), 4)} fund</span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={claim}
          className="display mt-6 w-full rounded-xl bg-hazard py-3.5 text-lg text-ink transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-50"
        >
          {busy ? "Claiming..." : "Claim"}
        </button>
        <TxNote tx={tx} />
      </div>
    </div>
  );
}

function SectionTitle({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <div className="border-b border-line pb-4">
      <h2 className="label text-bone">
        <span className="mr-3 text-muted">[{n}]</span>
        {title}
      </h2>
      <p className="label mt-2 text-muted">{note}</p>
    </div>
  );
}

function Pill({ label, short, value }: { label: string; short?: string; value: React.ReactNode }) {
  return (
    <div className="label flex min-w-0 flex-col items-start gap-1 whitespace-nowrap rounded-xl border border-line px-3 py-2.5 sm:flex-row sm:items-center sm:gap-2.5 sm:rounded-full sm:px-4 sm:py-3">
      <span className="font-bold tabular-nums text-bone">{value}</span>
      <span className="text-muted sm:hidden">{short ?? label}</span>
      <span className="hidden text-muted sm:inline">{label}</span>
    </div>
  );
}

function Empty({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-5 rounded-2xl border border-dashed border-line px-4 py-20 text-center">
      <p className="display text-3xl sm:text-4xl">{title}</p>
      <p className="label text-muted">{text}</p>
      {action}
    </div>
  );
}
