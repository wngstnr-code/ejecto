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

export type History = { trades: Trade[]; ejectAt: number | null };

type TxRow = {
  transaction_hash: string;
  signer_account_id: string;
  block_timestamp: string;
  actions: Array<{ action: string; method?: string }>;
  outcomes: { status: boolean | null };
};

type TradeEvent = { kind: "buy" | "sell"; account: string; near: number; tokens: number };

const MAX_PAGES = 5;
// Parsed trades per transaction never change, so they are cached for the whole session.
const eventCache = new Map<string, TradeEvent[]>();

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

/** The ejecto_buy / ejecto_sell events a transaction emitted (from its receipt logs). */
async function tradeEvents(row: TxRow, signal?: AbortSignal): Promise<TradeEvent[]> {
  const cached = eventCache.get(row.transaction_hash);
  if (cached) return cached;
  let result;
  try {
    result = await rpcTx(RPC_URL, row.transaction_hash, row.signer_account_id, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    result = await rpcTx(ARCHIVAL_RPC_URL, row.transaction_hash, row.signer_account_id, signal);
  }
  const events: TradeEvent[] = [];
  for (const r of result.receipts_outcome) {
    for (const log of r.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      try {
        const ev = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard: string; event: string; data: Array<Record<string, string>> };
        if (ev.standard !== "ejecto") continue;
        for (const d of ev.data) {
          if (ev.event === "ejecto_buy") {
            events.push({ kind: "buy", account: d.account_id, near: yoctoToNear(d.near_in), tokens: unitsToTokens(d.tokens_out) });
          } else if (ev.event === "ejecto_sell") {
            events.push({ kind: "sell", account: d.account_id, near: yoctoToNear(d.near_out), tokens: unitsToTokens(d.tokens_in) });
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
  const tradeRows = rows.filter((r) => r.actions.some((a) => a.method === "buy" || a.method === "sell"));
  const ejectRow = rows.find((r) => r.actions.some((a) => a.method === "eject"));

  const perTx = await mapLimit(tradeRows, 4, (row) => tradeEvents(row, signal).catch(() => [] as TradeEvent[]));
  const trades: Trade[] = [];
  let supply = 0;
  tradeRows.forEach((row, idx) => {
    const t = Number(BigInt(row.block_timestamp) / 1_000_000n);
    for (const ev of perTx[idx]) {
      supply = Math.max(0, supply + (ev.kind === "buy" ? ev.tokens : -ev.tokens));
      trades.push({ t, ...ev, supply, price: priceAtSupply(supply), hash: row.transaction_hash });
    }
  });
  return { trades, ejectAt: ejectRow ? Number(BigInt(ejectRow.block_timestamp) / 1_000_000n) : null };
}
