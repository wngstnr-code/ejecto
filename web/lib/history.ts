import { ARCHIVAL_RPC_URL, NEARBLOCKS_API, RPC_URL } from "./config";
import { unitsToTokens, yoctoToNear } from "./format";

// Curve constants fixed by the factory (spec section 4), NEAR per token.
const P0 = 2e-8;
const K = 5e-16;
export const priceAtSupply = (supply: number) => P0 + K * supply;

export type Trade = {
  /** Unix time in ms (block time of the transaction). */
  t: number;
  kind: "buy" | "sell";
  account: string;
  /** NEAR paid in (buy) or received (sell). */
  near: number;
  tokens: number;
  /** Supply and price right after this trade. */
  supply: number;
  price: number;
  hash: string;
};

/** One line of the on-chain log: every buy, sell, EJECT, claim and Mayday step, from the contract's own events. */
export type LogEntry = {
  /** Unix time in ms (block time of the transaction). */
  t: number;
  kind: "buy" | "sell" | "eject" | "claim" | "mayday" | "pledge" | "rescue" | "fail" | "collect" | "refund";
  /** Mayday round, for the Mayday kinds. */
  round?: number;
  /** mayday: the target. pledge: the round's total after this pledge. */
  extra?: number;
  account: string;
  /** buy: NEAR paid in. sell: NEAR received. eject: reserve frozen. claim: total paid out. */
  near: number;
  /** buy and sell: fee paid into the Ejecto Fund. eject: fund frozen. claim: fund share paid. */
  fund: number;
  /** claim only: the reserve share paid. */
  reserve: number;
  tokens: number;
  hash: string;
};

export type History = { trades: Trade[]; log: LogEntry[]; ejectAt: number | null };

type TxRow = {
  transaction_hash: string;
  signer_account_id: string;
  block_timestamp: string;
  actions: Array<{ action: string; method?: string }>;
  outcomes: { status: boolean | null };
};

type ChainEvent = Omit<LogEntry, "t" | "hash">;

const MAX_PAGES = 5;
// Parsed trades per transaction never change, so they are cached for the whole session.
const eventCache = new Map<string, ChainEvent[]>();

/** All transactions sent to the coin account, oldest first (NearBlocks v3, cursor pagination). */
async function listTxns(coinId: string, signal?: AbortSignal): Promise<TxRow[]> {
  const rows: TxRow[] = [];
  let next: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${NEARBLOCKS_API}/v3/accounts/${coinId}/txns?limit=100${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`NearBlocks HTTP ${res.status}`);
    const json = (await res.json()) as { data: TxRow[] | null; meta?: { next_page?: string | null } };
    rows.push(...(json.data ?? []));
    next = json.meta?.next_page ?? null;
    if (!next || !json.data?.length) break;
  }
  return rows.sort((a, b) => Number(BigInt(a.block_timestamp) - BigInt(b.block_timestamp)));
}

async function rpcTx(url: string, hash: string, sender: string, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ejecto",
      method: "tx",
      params: { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" },
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: { receipts_outcome: Array<{ outcome: { logs: string[] } }> };
    error?: unknown;
  };
  if (!json.result) throw new Error("tx not found");
  return json.result;
}

/** The ejecto_* events (buy, sell, eject, claim) a transaction emitted, from its receipt logs. */
async function chainEvents(row: TxRow, signal?: AbortSignal): Promise<ChainEvent[]> {
  const cached = eventCache.get(row.transaction_hash);
  if (cached) return cached;
  let result;
  try {
    result = await rpcTx(RPC_URL, row.transaction_hash, row.signer_account_id, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    result = await rpcTx(ARCHIVAL_RPC_URL, row.transaction_hash, row.signer_account_id, signal);
  }
  const events: ChainEvent[] = [];
  const y = (v?: string) => (v ? yoctoToNear(v) : 0);
  for (const r of result.receipts_outcome) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const ev = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard: string; event: string; data: Array<Record<string, string>> };
        if (ev.standard !== "ejecto") continue;
        for (const d of ev.data) {
          if (ev.event === "ejecto_buy") {
            events.push({ kind: "buy", account: d.account_id, near: y(d.near_in), fund: y(d.fund_fee) + y(d.dust_to_fund), reserve: 0, tokens: unitsToTokens(d.tokens_out) });
          } else if (ev.event === "ejecto_sell") {
            events.push({ kind: "sell", account: d.account_id, near: y(d.near_out), fund: y(d.fund_fee), reserve: 0, tokens: unitsToTokens(d.tokens_in) });
          } else if (ev.event === "ejecto_eject") {
            events.push({ kind: "eject", account: row.signer_account_id, near: y(d.reserve_e), fund: y(d.fund_e), reserve: y(d.reserve_e), tokens: unitsToTokens(d.supply_e) });
          } else if (ev.event === "ejecto_claim") {
            const reserve = y(d.reserve_part);
            const fund = y(d.fund_part);
            events.push({ kind: "claim", account: d.account_id, near: reserve + fund, fund, reserve, tokens: unitsToTokens(d.tokens_burned) });
          } else if (ev.event === "ejecto_mayday_open") {
            events.push({ kind: "mayday", round: Number(d.round), account: d.opener, near: 0, fund: 0, reserve: 0, tokens: 0, extra: y(d.target) });
          } else if (ev.event === "ejecto_pledge") {
            events.push({ kind: "pledge", round: Number(d.round), account: d.account_id, near: y(d.amount), fund: 0, reserve: 0, tokens: 0, extra: y(d.pledged) });
          } else if (ev.event === "ejecto_rescue") {
            events.push({ kind: "rescue", round: Number(d.round), account: row.signer_account_id, near: y(d.pledged), fund: y(d.coinvest), reserve: 0, tokens: unitsToTokens(d.tokens) });
          } else if (ev.event === "ejecto_mayday_fail") {
            events.push({ kind: "fail", round: Number(d.round), account: row.signer_account_id, near: y(d.pledged), fund: 0, reserve: 0, tokens: 0, extra: y(d.target) });
          } else if (ev.event === "ejecto_collect") {
            events.push({ kind: "collect", round: Number(d.round), account: d.account_id, near: y(d.pledge), fund: 0, reserve: 0, tokens: unitsToTokens(d.tokens) });
          } else if (ev.event === "ejecto_pledge_withdraw") {
            events.push({ kind: "refund", round: Number(d.round), account: d.account_id, near: y(d.amount), fund: 0, reserve: 0, tokens: 0 });
          }
        }
      } catch {
        // not JSON we know, skip
      }
    }
  }
  eventCache.set(row.transaction_hash, events);
  return events;
}

/** Runs `fn` over `items` with at most `n` in flight. */
async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Price history of a coin without a backend: NearBlocks lists the coin's transactions, each trade's exact
 * token amount comes from the contract's own event log, and replaying the supply through the fixed curve
 * gives the price after every trade.
 */
export async function loadHistory(coinId: string, signal?: AbortSignal): Promise<History> {
  const rows = (await listTxns(coinId, signal)).filter((r) => r.outcomes.status !== false);
  // Transfers are listed too: the contract collects a rescuer's escrow on their next transfer.
  const METHODS = ["buy", "sell", "eject", "claim", "mayday", "pledge", "collect", "withdraw_pledge", "ft_transfer", "ft_transfer_call"];
  const eventRows = rows.filter((r) => r.actions.some((a) => a.method && METHODS.includes(a.method)));
  const ejectRow = rows.find((r) => r.actions.some((a) => a.method === "eject"));

  const perTx = await mapLimit(eventRows, 4, (row) => chainEvents(row, signal).catch(() => [] as ChainEvent[]));
  const trades: Trade[] = [];
  const log: LogEntry[] = [];
  let supply = 0;
  eventRows.forEach((row, idx) => {
    const t = Number(BigInt(row.block_timestamp) / 1_000_000n);
    for (const ev of perTx[idx]) {
      log.push({ t, ...ev, hash: row.transaction_hash });
      // Buys, sells and Mayday rescues move the supply, so they move the price.
      if (ev.kind !== "buy" && ev.kind !== "sell" && ev.kind !== "rescue") continue;
      supply = Math.max(0, supply + (ev.kind === "sell" ? -ev.tokens : ev.tokens));
      const kind = ev.kind === "sell" ? "sell" : "buy";
      // A rescue is booked under the account whose pledge completed it (a real account, so links work).
      trades.push({ t, kind, account: ev.account, near: ev.near + (ev.kind === "rescue" ? ev.fund : 0), tokens: ev.tokens, supply, price: priceAtSupply(supply), hash: row.transaction_hash });
    }
  });
  return { trades, log, ejectAt: ejectRow ? Number(BigInt(ejectRow.block_timestamp) / 1_000_000n) : null };
}
