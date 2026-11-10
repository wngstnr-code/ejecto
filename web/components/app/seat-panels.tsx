"use client";

import { useState } from "react";
import { GAS } from "@/lib/coin";
import { formatCompact, formatNear, formatPct, unitsToTokens, yoctoToNear } from "@/lib/format";
import type { CoinStatus, HolderView } from "@/lib/near";
import { call, errorText, useWallet } from "@/lib/wallet";
import { TxNote, type Tx } from "./tx-note";
import { Amount, EjectHandle } from "./ui";

/** "Your seat": what the connected holder has, and what they would get if the seat fired now. */
export function SeatPanel({ status, holder }: { status: CoinStatus; holder: HolderView | null }) {
  const { accountId } = useWallet();
  const symbol = status.symbol.toUpperCase();
  const ejected = !!status.ejected;

  if (!accountId) {
    return (
      <Shell title="Your seat">
        <p className="label leading-relaxed text-muted">Connect a wallet to see your balance, your weight and what the seat would pay you.</p>
      </Shell>
    );
  }
  if (!holder) {
    return (
      <Shell title="Your seat">
        <p className="label text-muted">Reading your seat...</p>
      </Shell>
    );
  }

  const balance = unitsToTokens(holder.balance);
  const rawBasis = BigInt(holder.basis);
  const basis = rawBasis < 0n ? -yoctoToNear(-rawBasis) : yoctoToNear(rawBasis);
  const total = BigInt(holder.total_weight);
  const share = total > 0n ? Number((BigInt(holder.weight) * 1_000_000n) / total) / 10_000 : 0;
  const reservePart = yoctoToNear(holder.reserve_part);
  const fundPart = yoctoToNear(holder.fund_part);

  return (
    <Shell title="Your seat">
      <dl className="label space-y-3">
        <Line k="Balance" v={`${formatCompact(balance)} ${symbol}`} />
        <Line k="Net in (basis)" v={<Amount>{`${basis < 0 ? "-" : ""}${formatNear(Math.abs(basis), 4)}`}</Amount>} />
        <Line k="Fund weight" v={formatPct(share, 2)} />
      </dl>
      {!ejected && balance > 0 && (
        <div className="mt-5 rounded-xl border border-dashed border-line p-4">
          <div className="label text-muted">If the seat fired now</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            <Amount icon="text-muted ml-1">{formatNear(reservePart + fundPart, 4)}</Amount>
          </div>
          <div className="label mt-2 text-muted">
            {formatNear(reservePart, 4)} reserve + <span className="text-hazard">{formatNear(fundPart, 4)} fund</span>
          </div>
        </div>
      )}
      {!ejected && balance === 0 && <p className="label mt-5 leading-relaxed text-muted">No seat yet. Buy any amount to strap in.</p>}
    </Shell>
  );
}

/** Shown when the coin is ejectable: one big handle anyone can pull. */
export function EjectPanel({ coinId, onEjected }: { coinId: string; onEjected: () => void }) {
  const { accountId, connect, send } = useWallet();
  const [tx, setTx] = useState<Tx | null>(null);
  const busy = tx?.state === "pending";

  const pull = async () => {
    if (!accountId) {
      connect().catch((e) => setTx({ state: "error", text: errorText(e) }));
      return;
    }
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      const res = await send(coinId, [call("eject", {}, GAS.eject)]);
      setTx({ state: "done", text: "Ejected. Every holder can claim now.", hash: res.hash });
      onEjected();
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-eject text-ink">
      <div className="hazard-stripes h-3" />
      <div className="flex flex-col items-center p-6 text-center sm:p-8">
        <p className="label font-bold">The engine is dead</p>
        <h3 className="display mt-3 text-3xl leading-none sm:text-4xl">Pull the handle</h3>
        <p className="label mt-4 max-w-xs leading-relaxed text-ink/75">
          Anyone can EJECT. Trading stops forever and every holder claims the reserve pro-rata plus a share of the Ejecto Fund.
        </p>
        <button type="button" onClick={pull} disabled={busy} className="group mt-6 flex flex-col items-center gap-4 disabled:opacity-60">
          <EjectHandle id="eject-hz" className="w-32 group-hover:animate-shake" />
          <span className="display rounded-full bg-ink px-8 py-4 text-xl text-eject transition-transform group-hover:-translate-y-1">
            {busy ? "Ejecting..." : accountId ? "Eject" : "Connect to eject"}
          </span>
        </button>
        <div className="[&_p]:text-ink">
          <TxNote tx={tx} />
        </div>
      </div>
    </div>
  );
}

/** After EJECT: the holder's parachute and the claim button. */
export function ClaimPanel({ coinId, holder, onDone }: { coinId: string; holder: HolderView | null; onDone: () => void }) {
  const { accountId, connect, send } = useWallet();
  const [tx, setTx] = useState<Tx | null>(null);
  const busy = tx?.state === "pending";

  const claim = async () => {
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      const res = await send(coinId, [call("claim", {}, GAS.claim)]);
      setTx({ state: "done", text: "Claimed. Safe landing.", hash: res.hash });
      onDone();
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    }
  };

  const reservePart = holder ? yoctoToNear(holder.reserve_part) : 0;
  const fundPart = holder ? yoctoToNear(holder.fund_part) : 0;
  const hasSeat = !!holder && BigInt(holder.balance) > 0n;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="hazard-stripes h-3" />
      <div className="p-6 sm:p-8">
        <p className="label text-muted">The seat has fired</p>
        <h3 className="display mt-3 text-3xl leading-none sm:text-4xl">Your parachute</h3>

        {!accountId ? (
          <>
            <p className="label mt-5 leading-relaxed text-muted">Connect the wallet that held this coin to claim your share.</p>
            <button
              type="button"
              onClick={() => connect().catch((e) => setTx({ state: "error", text: errorText(e) }))}
              className="display mt-6 w-full rounded-xl bg-hazard py-4 text-xl text-ink transition-transform hover:-translate-y-0.5"
            >
              Connect wallet
            </button>
          </>
        ) : hasSeat ? (
          <>
            <div className="mt-6 text-5xl font-semibold tabular-nums tracking-tight">
              <Amount icon="text-muted ml-1">{formatNear(reservePart + fundPart, 4)}</Amount>
            </div>
            <div className="label mt-3 text-muted">
              {formatNear(reservePart, 4)} reserve share + <span className="text-hazard">{formatNear(fundPart, 4)} loyalty from the fund</span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={claim}
              className="display mt-6 w-full rounded-xl bg-hazard py-4 text-xl text-ink transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy ? "Claiming..." : "Claim"}
            </button>
          </>
        ) : holder?.claimed ? (
          <p className="label mt-5 leading-relaxed text-hud">Claimed. You landed safely.</p>
        ) : (
          <p className="label mt-5 leading-relaxed text-muted">This wallet had no seat on this coin when it was ejected.</p>
        )}
        <TxNote tx={tx} />
      </div>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <div className="label mb-5 text-bone">{title}</div>
      {children}
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="tabular-nums text-bone">{v}</dd>
    </div>
  );
}
