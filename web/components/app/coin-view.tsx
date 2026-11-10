"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { coinPhase, useCoin } from "@/lib/coin";
import { explorerAccount, FACTORY_ID } from "@/lib/config";
import { formatCompact, formatNear, unitsToTokens, yoctoToNear } from "@/lib/format";
import { accessKeyCount, type CoinStatus } from "@/lib/near";
import { prefersReducedMotion } from "@/lib/gsap";
import { useWallet } from "@/lib/wallet";
import { CurveChart } from "./curve-chart";
import { ActivityLog } from "./activity-log";
import { PriceHistory, useCoinHistory } from "./price-history";
import { EngineMeter } from "./engine-meter";
import { ClaimPanel, EjectPanel, SeatPanel } from "./seat-panels";
import { TradePanel } from "./trade-panel";
import { CoinIcon, DemoBanner, LockIcon, PhaseBadge, PriceText, Stat } from "./ui";

// The 3D EJECT scene is a separate chunk, loaded only for coins that can be ejected.
const EjectMoment = dynamic(() => import("./eject-moment"), { ssr: false });

/** Coin accounts are always <symbol>.<factory>. Anything else is refused before any RPC call. */
function validCoinId(id: string | null): id is string {
  return !!id && id.endsWith(`.${FACTORY_ID}`) && /^[a-z0-9]{2,10}$/.test(id.slice(0, -FACTORY_ID.length - 1));
}

export function CoinView({ id }: { id: string | null }) {
  const valid = validCoinId(id);
  const { accountId } = useWallet();
  const { status, holder, meta, error, refresh } = useCoin(valid ? id : null, accountId);
  // One chain history load feeds both the price chart and the on-chain log (hooks run before any early return).
  const chain = useCoinHistory(valid && id ? id : "", status ?? null);
  const [keys, setKeys] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const endCelebrate = useCallback(() => setCelebrate(false), []);
  const onEjected = useCallback(() => {
    if (!prefersReducedMotion()) setCelebrate(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    accessKeyCount(id)
      .then((n) => alive && setKeys(n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, valid]);

  if (!valid) return <Missing text="That is not an Ejecto coin address." />;
  if (!status) return error ? <Missing text={`Could not read this coin (${error}).`} /> : <Loading />;

  const phase = coinPhase(status);
  const symbol = status.symbol.toUpperCase();
  const ej = status.ejected;
  const supply = unitsToTokens(ej ? ej.supply_e : status.supply);
  // After EJECT, claims burn the supply and the live price falls back to P0, so show the price at EJECT.
  const price = ej ? 2e-8 + 5e-16 * supply : yoctoToNear(status.price);

  return (
    <>
      {status.demo_time && <DemoBanner dayLength={status.day_length_sec} />}
      {(phase === "ejectable" || celebrate) && <EjectMoment play={celebrate} onDone={endCelebrate} />}

      <div className="mx-auto max-w-7xl px-4 pb-32 pt-12 sm:px-8">
        <Link href="/coins/" className="label text-muted transition-colors hover:text-hazard">
          &larr; All coins
        </Link>

        {/* identity */}
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <CoinIcon icon={meta?.icon} symbol={status.symbol} className="h-16 w-16" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="display text-4xl leading-none sm:text-6xl">{status.name}</h1>
              <PhaseBadge phase={phase} />
            </div>
            <div className="label mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-muted">
              <span className="text-bone">${symbol}</span>
              <a href={explorerAccount(id)} target="_blank" rel="noreferrer" className="transition-colors hover:text-hazard">
                {id}
              </a>
              <span className="flex items-center gap-2" title="Access keys on the coin account, read live">
                <LockIcon className={`h-3.5 w-3.5 ${keys === 0 ? "text-hud" : "text-muted"}`} />
                {keys === null ? "Checking keys" : `${keys} access keys`}
              </span>
              <span>Fee {status.fee_preset}</span>
            </div>
          </div>
        </div>

        {/* stat strip */}
        <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-y border-line py-8 md:grid-cols-4">
          <Stat label={ej ? "Last price" : "Price"} value={<PriceText value={price} />} unit="NEAR" />
          <Stat label={ej ? "Supply at eject" : "Supply"} value={formatCompact(supply)} unit={symbol} />
          <Stat label={ej ? "Reserve left" : "Reserve"} value={formatNear(yoctoToNear(status.reserve), 3)} unit="NEAR" />
          <Stat
            label={ej ? "Fund left" : "Ejecto Fund"}
            value={<span className="text-hazard">{formatNear(yoctoToNear(status.fund), 3)}</span>}
            unit="NEAR"
          />
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_400px]">
          <div className="space-y-16">
            <EngineMeter status={status} phase={phase} />
            <PriceHistory status={status} history={chain.history} error={chain.error} />
            <CurveChart status={status} />
            {ej && <EjectRecord status={status} />}
            <ActivityLog n={ej ? "05" : "04"} history={chain.history} error={chain.error} />
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {phase === "ejected" ? (
              <ClaimPanel coinId={id} holder={holder} onDone={refresh} />
            ) : phase === "ejectable" ? (
              <>
                <EjectPanel coinId={id} onEjected={onEjected} />
                {/* Until someone pulls the handle the curve is still open, and buys can restart the engine. */}
                <TradePanel coinId={id} status={status} holder={holder} onDone={refresh} revive />
              </>
            ) : (
              <TradePanel coinId={id} status={status} holder={holder} onDone={refresh} />
            )}
            {phase !== "ejected" && <SeatPanel status={status} holder={holder} />}
          </aside>
        </div>
      </div>
    </>
  );
}

/** The frozen numbers from the moment of EJECT. */
function EjectRecord({ status }: { status: CoinStatus }) {
  const e = status.ejected!;
  const when = new Date(e.t_e * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return (
    <section>
      <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
        <h2 className="label text-bone">
          <span className="mr-3 text-muted">[04]</span>Eject record
        </h2>
        <span className="label text-muted">{when}</span>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-3">
        <Stat label="Reserve at eject" value={formatNear(yoctoToNear(e.reserve_e), 3)} unit="NEAR" />
        <Stat label="Fund at eject" value={<span className="text-hazard">{formatNear(yoctoToNear(e.fund_e), 3)}</span>} unit="NEAR" />
        <Stat
          label="Paid out so far"
          value={formatNear(
            yoctoToNear(BigInt(e.reserve_e) + BigInt(e.fund_e) - BigInt(status.reserve) - BigInt(status.fund)),
            3,
          )}
          unit="NEAR"
        />
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-7xl items-center justify-center px-4">
      <div className="w-[min(82vw,320px)]">
        <div className="label text-muted">Reading the coin from NEAR</div>
        <div className="mt-3 h-3 overflow-hidden bg-line">
          <div className="hazard-stripes-thin bar-stripes h-full w-1/2 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-7xl flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="display text-4xl sm:text-6xl">No seat here</p>
      <p className="label text-muted">{text}</p>
      <Link href="/coins/" className="label rounded-full bg-hazard px-6 py-3 font-bold text-ink transition-transform hover:-translate-y-0.5">
        See all coins
      </Link>
    </div>
  );
}
