"use client";

import { useEffect, useMemo, useState } from "react";
import { explorerAccount } from "@/lib/config";
import { formatNear, formatPct, yoctoToNear } from "@/lib/format";
import type { History } from "@/lib/history";
import { getHolder, type CoinStatus, type HolderView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { Amount, PanelTitle } from "./ui";

type Member = {
  account: string;
  /** Start of the current streak aboard (ms). */
  since: number;
  /** Pledged to a Mayday that rescued this coin. */
  rescuer: boolean;
  /** Share of the fund weight: net NEAR at risk times time held. */
  share: number;
  basis: number;
  /** Before EJECT: what the seat would pay now. After: what was claimed, or is waiting to be claimed. */
  payout: number;
  fund: number;
  state: "aboard" | "claimed" | "waiting";
};

const signed = (s: string) => {
  const b = BigInt(s);
  return b < 0n ? -yoctoToNear(-b) : yoctoToNear(b);
};

/**
 * The crew: everyone who holds a seat, ranked by loyalty (their share of the fund weight, which grows with
 * net NEAR at risk and with time held). No indexer: the accounts come from the on-chain log, and every
 * number is read from the contract's `holder` view. After EJECT the claims come from the claim events.
 */
export function CrewBoard({ n, coinId, status, history }: { n: string; coinId: string; status: CoinStatus; history: History | null }) {
  const { accountId } = useWallet();
  const [views, setViews] = useState<Record<string, HolderView> | null>(null);
  const ejected = status.ejected;

  // Streaks aboard, from the token flows in the log (oldest first): a streak starts when a holder's
  // tokens go from zero to positive and ends when they go back to zero (full sell or claim). A rescue
  // gives every pledger of that round their tokens at the rescue, even before they collect them.
  const { firstBuy, streakStart, rescuers, record } = useMemo(() => {
    const bal = new Map<string, number>();
    const start = new Map<string, number>();
    const first = new Map<string, number>();
    const rescued = new Set<string>();
    const pledgers = new Map<number, Set<string>>(); // round -> accounts that pledged in it
    const waiting = new Set<string>(); // rescued, tokens still in escrow
    let best: { account: string; ms: number; open: boolean } | null = null;
    const end = status.ejected ? status.ejected.t_e * 1000 : status.now_ts * 1000;
    const aboard = (acc: string) => (bal.get(acc) ?? 0) > 1e-6 || waiting.has(acc);
    const begin = (acc: string, t: number) => {
      if (!first.has(acc)) first.set(acc, t);
      if (!start.has(acc)) start.set(acc, t);
    };
    for (const e of history?.log ?? []) {
      const round = e.round ?? 0;
      if (e.kind === "pledge") {
        if (!pledgers.has(round)) pledgers.set(round, new Set());
        pledgers.get(round)!.add(e.account);
        continue;
      }
      if (e.kind === "rescue") {
        for (const acc of pledgers.get(round) ?? []) {
          rescued.add(acc);
          waiting.add(acc);
          begin(acc, e.t);
        }
        continue;
      }
      if (e.kind === "collect") {
        waiting.delete(e.account);
        bal.set(e.account, (bal.get(e.account) ?? 0) + e.tokens);
        continue;
      }
      if (e.kind === "buy") {
        if (!aboard(e.account)) start.delete(e.account);
        begin(e.account, e.t);
        bal.set(e.account, (bal.get(e.account) ?? 0) + e.tokens);
        continue;
      }
      if (e.kind === "sell" || e.kind === "claim") {
        bal.set(e.account, Math.max(0, (bal.get(e.account) ?? 0) - e.tokens));
        const s0 = start.get(e.account);
        if (!aboard(e.account) && s0 !== undefined) {
          if (!best || e.t - s0 > best.ms) best = { account: e.account, ms: e.t - s0, open: false };
          start.delete(e.account);
        }
      }
    }
    for (const [acc, s0] of start) if (!best || end - s0 > best.ms) best = { account: acc, ms: end - s0, open: true };
    return { firstBuy: first, streakStart: start, rescuers: rescued, record: best as { account: string; ms: number; open: boolean } | null };
  }, [history, status.ejected, status.now_ts]);
  // `history` is in the key so the board loads once the log arrives, even when nobody has bought yet.
  const key = `${!!history}|${status.supply}|${status.reserve}|${status.fund}|${status.pledges_held}|${[...firstBuy.keys()].join(",")}`;

  useEffect(() => {
    if (!history) return;
    const ctrl = new AbortController();
    const accounts = [...firstBuy.keys()];
    (async () => {
      const out: Record<string, HolderView> = {};
      // A few at a time, to stay friendly with the public RPC.
      for (let i = 0; i < accounts.length; i += 4) {
        const part = await Promise.all(accounts.slice(i, i + 4).map((a) => getHolder(coinId, a, ctrl.signal).catch(() => null)));
        part.forEach((v, k) => v && (out[accounts[i + k]] = v));
      }
      if (!ctrl.signal.aborted) setViews(out);
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId, key]);

  const { members, left } = useMemo(() => {
    const list: Member[] = [];
    let gone = 0;
    if (!views) return { members: list, left: 0 };
    const claims = new Map((history?.log ?? []).filter((e) => e.kind === "claim").map((e) => [e.account, e]));
    const fundE = ejected ? yoctoToNear(ejected.fund_e) : 0;
    for (const [account, since] of firstBuy) {
      const v = views[account];
      const claim = claims.get(account);
      const rescuer = rescuers.has(account);
      if (claim) {
        list.push({ account, since, rescuer, share: fundE > 0 ? claim.fund / fundE : 0, basis: v ? signed(v.basis) : 0, payout: claim.near, fund: claim.fund, state: "claimed" });
        continue;
      }
      if (!v || BigInt(v.balance) + BigInt(v.collectable ?? "0") === 0n) {
        gone++;
        continue;
      }
      const total = BigInt(v.total_weight);
      const share = total > 0n ? Number((BigInt(v.weight) * 1_000_000n) / total) / 1_000_000 : 0;
      const reserve = yoctoToNear(v.reserve_part);
      const fund = yoctoToNear(v.fund_part);
      list.push({ account, since: streakStart.get(account) ?? since, rescuer, share, basis: signed(v.basis), payout: reserve + fund, fund, state: ejected ? "waiting" : "aboard" });
    }
    list.sort((a, b) => b.share - a.share || b.payout - a.payout || a.since - b.since);
    return { members: list, left: gone };
  }, [views, history, firstBuy, streakStart, rescuers, ejected]);

  const summary = ejected
    ? `${members.filter((m) => m.state === "claimed").length} claimed, ${members.filter((m) => m.state === "waiting").length} still to claim`
    : `${members.length} aboard, ${left} left the ship`;

  return (
    <section>
      <PanelTitle n={n} right={<span className="label text-muted">Ranked by loyalty</span>}>
        Crew
      </PanelTitle>
      <p className="label mt-4 leading-relaxed text-muted">
        Loyalty is each holder&apos;s share of the fund weight: net NEAR at risk times time held. Big late buys and quick flips earn almost none.
      </p>
      {record && <HighScore record={record} dayLength={status.day_length_sec} />}

      {!views ? (
        <div className="mt-4 space-y-3" aria-label="Loading the crew">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-panel" />
          ))}
        </div>
      ) : members.length === 0 ? (
        <p className="label mt-6 text-muted">{left ? "Everyone has left the ship." : "No crew yet. The first buy takes seat 1."}</p>
      ) : (
        <>
          <p className="label mt-3 text-bone">{summary}</p>
          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-panel">
            <ol className="max-h-[26rem] divide-y divide-line overflow-y-auto overscroll-contain" data-lenis-prevent>
              {members.map((m, i) => (
                <Row key={m.account} m={m} rank={i + 1} you={m.account === accountId} ejected={!!ejected} />
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

function Row({ m, rank, you, ejected }: { m: Member; rank: number; you: boolean; ejected: boolean }) {
  const since = new Date(m.since).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <li className={`px-4 py-3.5 sm:px-5 ${you ? "bg-hazard/10" : ""}`}>
      <div className="flex items-center gap-3">
        <span className={`display w-8 shrink-0 text-center text-xl tabular-nums ${rank === 1 ? "text-hazard" : "text-muted"}`}>{rank}</span>
        <a href={explorerAccount(m.account)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold tracking-tight hover:text-hazard">
          {m.account}
        </a>
        {m.rescuer && (
          <span className="label shrink-0 rounded-full border border-hud/60 px-2 py-0.5 text-hud" title="Pledged to a Mayday that rescued this coin">
            Rescuer
          </span>
        )}
        {you && <span className="label shrink-0 rounded-full bg-hazard px-2 py-0.5 font-bold text-ink">You</span>}
        <span className="shrink-0 text-right tabular-nums">
          <Amount icon="text-muted">{formatNear(m.payout, 4)}</Amount>
        </span>
      </div>
      <div className="mt-1.5 flex items-start justify-between gap-3 pl-11">
        <span className="label min-w-0 text-muted">
          <span className="text-hazard">{formatPct(m.share * 100, 1)} loyalty</span>
          {!ejected && <> &middot; net in {formatNear(m.basis, 3)}</>} &middot; aboard since {since}
        </span>
        <span className={`label shrink-0 ${m.state === "waiting" ? "text-eject" : "text-muted"}`}>
          {m.state === "aboard" ? "if ejected now" : m.state === "claimed" ? "claimed" : "to claim"}
        </span>
      </div>
    </li>
  );
}

/** The longest streak aboard, printed like a high score (the Memecoins track's own example). */
function HighScore({ record, dayLength }: { record: { account: string; ms: number; open: boolean }; dayLength: number }) {
  const days = record.ms / 1000 / dayLength;
  return (
    <div className="mt-5 flex items-center gap-4 overflow-hidden rounded-2xl border border-hazard/50 bg-hazard/10 px-5 py-4">
      <span className="display shrink-0 text-xs leading-tight text-hazard">
        Longest
        <br />
        seat
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold tracking-tight">{record.account}</span>
        <span className="label mt-0.5 block text-muted">{record.open ? "still aboard" : "record, now off the ship"}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="display block text-3xl leading-none tabular-nums text-hazard">{days >= 10 ? days.toFixed(0) : days.toFixed(1)}</span>
        <span className="label block text-muted">{dayLength < 86400 ? "coin days" : "days"}</span>
      </span>
    </div>
  );
}
