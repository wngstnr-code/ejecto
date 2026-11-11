"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GAS } from "@/lib/coin";
import { formatNear, formatUnitsExact, parseNear, yoctoToNear } from "@/lib/format";
import type { History } from "@/lib/history";
import { storageBalanceOf, storageBounds, type CoinStatus, type HolderView } from "@/lib/near";
import { call, errorText, useWallet, type CallAction } from "@/lib/wallet";
import { TxNote, type Tx } from "./tx-note";
import { Amount } from "./ui";

const BPS = 10_000n;
/** Contract constants (coin lib.rs, spec section 10). */
const OPENER_BPS = 1_000n;
const COINVEST_BPS = 2_500n;
const COINVEST_FUND_MAX_BPS = 5_000n;
const MAYDAY_DAYS = 3;
const MIN_PLEDGE = 10n ** 21n; // 0.001 NEAR

/** The contract allows one open pledge per account: a failed earlier one must be withdrawn first. */
function blockedBy(holder: HolderView | null, round: number | null) {
  if (!holder || holder.pledge_state !== "failed" || BigInt(holder.pledge) === 0n) return null;
  if (round !== null && holder.pledge_round === round) return null;
  return `Withdraw your pledge from Mayday ${holder.pledge_round} first (the card below).`;
}

/**
 * What the fund adds at a rescue of `pledged`, as the contract computes it: the rescue's own fund fee
 * lands first, then the co-invest is 25% of the pledges, at most half the fund.
 */
function coinvest(pledged: bigint, s: CoinStatus) {
  const fee = (pledged * BigInt(s.fund_buy_bps) + BPS - 1n) / BPS;
  const a = (pledged * COINVEST_BPS) / BPS;
  const b = ((BigInt(s.fund) + fee) * COINVEST_FUND_MAX_BPS) / BPS;
  return a < b ? a : b;
}

/** Shown instead of the Call panel while a failed Mayday's cooldown runs. */
export function MaydayCooldown({ status }: { status: CoinStatus }) {
  const now = useChainNow(status);
  const left = status.mayday_open_after_ts - now;
  if (status.mayday || left <= 0) return null;
  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <p className="label text-hazard">Mayday cooldown</p>
      <p className="label mt-3 leading-relaxed text-muted">
        The last Mayday missed its target. A new one can be called in <span className="tabular-nums text-bone">{clock(left)}</span>. Until then,
        anyone can EJECT, and buys over the alive line still bring the coin back.
      </p>
    </div>
  );
}

/** Chain time in seconds, ticking locally between status polls. */
function useChainNow(status: CoinStatus) {
  const offset = useRef<number | null>(null);
  const [now, setNow] = useState(status.now_ts);
  useEffect(() => {
    offset.current = null; // re-sync to the chain clock on every new status
  }, [status.now_ts]);
  useEffect(() => {
    const t = setInterval(() => {
      if (offset.current === null) offset.current = status.now_ts - Date.now() / 1000;
      setNow(Date.now() / 1000 + offset.current);
    }, 250);
    return () => clearInterval(t);
  }, [status.now_ts]);
  return now;
}

function clock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Registers the account on the coin first if needed, then runs `action`, in one transaction. */
async function withRegistration(coinId: string, accountId: string, action: CallAction) {
  const actions: CallAction[] = [];
  if (!(await storageBalanceOf(coinId, accountId))) {
    const bounds = await storageBounds(coinId);
    actions.push(call("storage_deposit", { account_id: accountId, registration_only: true }, GAS.storage, bounds.min));
  }
  actions.push(action);
  return actions;
}

function Shell({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-hazard/60 bg-panel">
      <div className={`hazard-stripes h-3 ${live ? "animate-[hazard-run_1s_linear_infinite]" : ""}`} />
      <div className="p-6 sm:p-7">{children}</div>
    </div>
  );
}

/**
 * Shown when EJECT is possible: instead of ending the coin, anyone can call a Mayday, a crowd rescue
 * with a target, part-paid by the Ejecto Fund. Nobody loses money if it fails.
 */
export function MaydayCallPanel({ coinId, status, holder, onDone }: { coinId: string; status: CoinStatus; holder: HolderView | null; onDone: () => void }) {
  const { accountId, connect, send } = useWallet();
  const line = BigInt(status.alive_threshold);
  const [mult, setMultRaw] = useState<1 | 2 | 3>(2);
  const target = line * BigInt(mult);
  const minStake = (target * OPENER_BPS + BPS - 1n) / BPS;
  // null means "the minimum stake for the chosen target" (reset when the target changes).
  const [input, setInput] = useState<string | null>(null);
  const stake = input === null ? minStake : (parseNear(input) ?? 0n);
  const setMult = (m: 1 | 2 | 3) => {
    setMultRaw(m);
    setInput(null);
  };
  const [tx, setTx] = useState<Tx | null>(null);
  const busy = tx?.state === "pending";
  const days = (MAYDAY_DAYS * status.day_length_sec) / 86400;
  const duration = status.day_length_sec < 86400 ? `${MAYDAY_DAYS} coin days (${MAYDAY_DAYS * status.day_length_sec} s in demo time)` : `${days} days`;

  const problem = !accountId
    ? null
    : (blockedBy(holder, null) ?? (stake < minStake ? `The opener pledges at least ${formatNear(yoctoToNear(minStake), 3)} NEAR (10%).` : null));

  const open = async () => {
    if (!accountId) {
      connect().catch((e) => setTx({ state: "error", text: errorText(e) }));
      return;
    }
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      const actions = await withRegistration(coinId, accountId, call("mayday", { target: target.toString() }, GAS.mayday, stake));
      const res = await send(coinId, actions);
      setTx({ state: "done", text: stake >= target ? "Mayday called and the coin is rescued." : "Mayday called. The crew has until the deadline.", hash: res.hash });
      onDone();
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    }
  };

  return (
    <Shell>
      <p className="label text-hazard">Or save it</p>
      <h3 className="display mt-3 text-3xl leading-none sm:text-4xl">Call a Mayday</h3>
      <p className="label mt-4 leading-relaxed text-muted">
        Rally the crew to buy the coin back to life together. EJECT waits {duration} while the crew pledges. Reach the target and every
        pledge buys in at one price, with the Ejecto Fund adding up to 25%. Miss it and every pledge comes back in full.
      </p>

      <div className="label mt-6 text-muted">Rescue target</div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {([1, 2, 3] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMult(m)}
            className={`rounded-xl border px-2 py-3 text-center transition-colors ${mult === m ? "border-hazard bg-hazard text-ink" : "border-line text-bone hover:border-hazard"}`}
          >
            <span className="block font-semibold tabular-nums">
              <Amount icon={mult === m ? "text-ink/70" : "text-muted"}>{formatNear(yoctoToNear(line * BigInt(m)), 2)}</Amount>
            </span>
            <span className="label mt-0.5 block opacity-70">{m}x line</span>
          </button>
        ))}
      </div>

      <label className="label mt-5 block text-muted" htmlFor="mayday-stake">
        Your opening pledge (min 10%)
      </label>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-ink px-4 py-3 focus-within:border-hazard">
        <input
          id="mayday-stake"
          inputMode="decimal"
          value={input ?? formatUnitsExact(minStake, 24)}
          onChange={(e) => setInput(e.target.value.replace(",", "."))}
          className="w-full bg-transparent text-xl tabular-nums outline-none"
        />
        <Amount>{""}</Amount>
      </div>
      <dl className="label mt-4 space-y-2">
        <div className="flex justify-between">
          <dt className="text-muted">Fund adds at the rescue</dt>
          <dd className="text-hazard">
            <Amount icon="text-muted">{formatNear(yoctoToNear(coinvest(target, status)), 4)}</Amount>
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">If it fails</dt>
          <dd className="text-bone">Full refund</dd>
        </div>
      </dl>
      {problem && <p className="label mt-3 text-eject">{problem}</p>}
      <button
        type="button"
        onClick={open}
        disabled={busy || !!problem}
        className="display mt-5 w-full rounded-xl bg-hazard py-4 text-xl text-ink transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-50"
      >
        {busy ? "Calling..." : accountId ? "Call Mayday" : "Connect to call a Mayday"}
      </button>
      <TxNote tx={tx} />
    </Shell>
  );
}

/** The open Mayday: progress to the target, a live countdown, the pledgers, and a pledge box. */
export function MaydayOpenPanel({
  coinId,
  status,
  history,
  holder,
  onDone,
}: {
  coinId: string;
  status: CoinStatus;
  history: History | null;
  holder: HolderView | null;
  onDone: () => void;
}) {
  const { accountId, connect, send } = useWallet();
  const m = status.mayday!;
  const now = useChainNow(status);
  const left = m.deadline_ts - now;
  const target = BigInt(m.target);
  const pledged = BigInt(m.pledged);
  const missing = target > pledged ? target - pledged : 0n;
  const pct = Number((pledged * 1000n) / (target || 1n)) / 10;
  const [input, setInput] = useState("");
  const amount = parseNear(input) ?? 0n;
  const [tx, setTx] = useState<Tx | null>(null);
  const busy = tx?.state === "pending";
  const ended = left <= 0;
  // Reload the status once the deadline passes, so the badge and the EJECT panel follow at once.
  useEffect(() => {
    if (ended) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);
  const problem = !accountId ? null : (blockedBy(holder, m.round) ?? (input && amount < MIN_PLEDGE ? "The smallest pledge is 0.001 NEAR." : null));

  const pledgers = useMemo(() => {
    const by = new Map<string, number>();
    for (const e of history?.log ?? []) if (e.kind === "pledge" && e.round === m.round) by.set(e.account, (by.get(e.account) ?? 0) + e.near);
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [history, m.round]);

  const pledge = async () => {
    if (!accountId) {
      connect().catch((e) => setTx({ state: "error", text: errorText(e) }));
      return;
    }
    if (amount <= 0n) return;
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      const actions = await withRegistration(coinId, accountId, call("pledge", {}, GAS.pledge, amount));
      const res = await send(coinId, actions);
      setTx({ state: "done", text: amount >= missing ? "Target reached. The coin is rescued." : "Pledged. Rally the rest of the crew.", hash: res.hash });
      setInput("");
      onDone();
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    }
  };

  return (
    <Shell live>
      <div className="flex items-center justify-between gap-3">
        <p className="label font-bold text-hazard">Mayday {m.round}</p>
        <p className={`label tabular-nums ${ended ? "text-muted" : "text-bone"}`}>{ended ? "Ended" : `${clock(left)} left`}</p>
      </div>
      <h3 className="display mt-3 text-3xl leading-none sm:text-4xl">{ended ? "Time is up" : "Rescue in progress"}</h3>
      <p className="label mt-4 leading-relaxed text-muted">
        {ended
          ? "The target was not reached in time. The next call closes this Mayday: every pledge can be withdrawn in full, and EJECT is open again."
          : "EJECT waits until the deadline. When the pledges reach the target, they buy in together at one price and the coin is alive again."}
      </p>

      <div className="mt-6 flex items-end justify-between gap-3">
        <div className="text-3xl font-semibold tabular-nums tracking-tight">
          <Amount icon="text-muted ml-1">{formatNear(yoctoToNear(pledged), 3)}</Amount>
        </div>
        <div className="label text-right text-muted">
          of <span className="text-bone">{formatNear(yoctoToNear(target), 3)}</span> target
        </div>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-ink">
        <div className="bar-stripes bar-hot h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="label mt-2 flex justify-between text-muted">
        <span>{pct.toFixed(0)}%</span>
        <span>
          Fund adds <span className="text-hazard">{formatNear(yoctoToNear(coinvest(pledged > target ? pledged : target, status)), 4)}</span>
        </span>
      </div>

      {pledgers.length > 0 && (
        <ul className="mt-5 max-h-36 space-y-1.5 overflow-y-auto overscroll-contain" data-lenis-prevent>
          {pledgers.map(([acc, near]) => (
            <li key={acc} className="label flex justify-between gap-3">
              <span className={`truncate ${acc === accountId ? "text-hazard" : "text-bone"}`}>
                {acc}
                {acc === m.opener && <span className="ml-2 text-muted">opener</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted">{formatNear(near, 3)}</span>
            </li>
          ))}
        </ul>
      )}

      {!ended && (
        <>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-ink px-4 py-3 focus-within:border-hazard">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(",", "."))}
              className="w-full bg-transparent text-xl tabular-nums outline-none placeholder:text-muted"
              aria-label="Pledge in NEAR"
            />
            <Amount>{""}</Amount>
          </div>
          <div className="mt-2 flex gap-2">
            {["0.1", "0.5"].map((v) => (
              <button key={v} type="button" onClick={() => setInput(v)} className="label rounded-full border border-line px-3 py-1.5 hover:border-hazard">
                {v}
              </button>
            ))}
            {missing > 0n && (
              <button type="button" onClick={() => setInput(formatUnitsExact(missing, 24))} className="label rounded-full border border-hazard px-3 py-1.5 text-hazard">
                Fill the rest
              </button>
            )}
          </div>
          {problem && <p className="label mt-3 text-eject">{problem}</p>}
          <button
            type="button"
            onClick={pledge}
            disabled={busy || !!problem || (!!accountId && amount <= 0n)}
            className="display mt-5 w-full rounded-xl bg-hazard py-4 text-xl text-ink transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-50"
          >
            {busy ? "Pledging..." : accountId ? (amount >= missing && amount > 0n ? "Pledge and rescue" : "Pledge") : "Connect to pledge"}
          </button>
          <p className="label mt-3 leading-relaxed text-muted">Pledges are locked until the Mayday ends. If the target is missed, every pledge comes back in full.</p>
        </>
      )}
      <TxNote tx={tx} />
    </Shell>
  );
}

/** The connected holder's own Mayday business: tokens to collect after a rescue, or a pledge to withdraw. */
export function PledgeCard({ coinId, holder, onDone }: { coinId: string; holder: HolderView | null; onDone: () => void }) {
  const { send } = useWallet();
  const [tx, setTx] = useState<Tx | null>(null);
  const busy = tx?.state === "pending";
  if (!holder || holder.pledge_state === "none" || BigInt(holder.pledge) === 0n) return tx ? <TxNote tx={tx} /> : null;
  const pledge = formatNear(yoctoToNear(holder.pledge), 3);

  const act = async (method: "collect" | "withdraw_pledge") => {
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      const res = await send(coinId, [call(method, {}, method === "collect" ? GAS.collect : GAS.withdraw)]);
      setTx({ state: "done", text: method === "collect" ? "Collected. You are aboard." : "Pledge returned in full.", hash: res.hash });
      onDone();
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <p className="label text-muted">Your Mayday pledge</p>
      {holder.pledge_state === "open" && (
        <p className="mt-3 leading-relaxed">
          <span className="font-semibold">{pledge} NEAR</span> pledged to Mayday {holder.pledge_round}. Locked until it ends.
        </p>
      )}
      {holder.pledge_state === "rescued" && (
        <>
          <p className="mt-3 leading-relaxed">
            Mayday {holder.pledge_round} rescued the coin. Your rescue tokens are waiting, with the loyalty they earned since.
          </p>
          <button type="button" disabled={busy} onClick={() => act("collect")} className="display mt-4 w-full rounded-xl bg-hud py-3.5 text-lg text-ink disabled:opacity-50">
            {busy ? "Collecting..." : "Collect"}
          </button>
          <p className="label mt-2 text-muted">Any buy, sell, transfer or claim collects them for you too.</p>
        </>
      )}
      {holder.pledge_state === "failed" && (
        <>
          <p className="mt-3 leading-relaxed">
            Mayday {holder.pledge_round} missed its target. Your <span className="font-semibold">{pledge} NEAR</span> comes back in full.
          </p>
          <button type="button" disabled={busy} onClick={() => act("withdraw_pledge")} className="display mt-4 w-full rounded-xl bg-hazard py-3.5 text-lg text-ink disabled:opacity-50">
            {busy ? "Withdrawing..." : "Withdraw pledge"}
          </button>
        </>
      )}
      <TxNote tx={tx} />
    </div>
  );
}
