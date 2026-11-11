import { FACTORY_ID, RPC_URL } from "./config";

// Read-only contract calls over public JSON-RPC. No backend, no indexer.

type RpcError = { message?: string; data?: unknown; cause?: { name?: string } };

function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export async function viewCall<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ejecto",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      },
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: RpcError };
  if (json.error) throw new Error(json.error.cause?.name ?? json.error.message ?? "RPC error");
  if (!json.result?.result) throw new Error(json.result?.error ?? "Empty RPC result");
  const text = new TextDecoder().decode(Uint8Array.from(json.result.result));
  return JSON.parse(text) as T;
}

// Shapes returned by the contracts (see contracts/factory and contracts/coin).
export type CoinInfo = {
  account_id: string;
  symbol: string;
  name: string;
  creator: string;
  fee_preset: string;
  day_length_sec: number;
  created_at: number;
};

export type EjectSnapshot = { t_e: number; reserve_e: string; supply_e: string; fund_e: string; w_e: string };

/** An open Mayday round (spec section 10). Amounts in yoctoNEAR, times in seconds. */
export type Mayday = { round: number; opener: string; target: string; pledged: string; opened_ts: number; deadline_ts: number };

/** `status()` of a coin. All amounts are yoctoNEAR or raw token units (18 decimals) as strings. */
export type CoinStatus = {
  name: string;
  symbol: string;
  fee_preset: string;
  fund_buy_bps: number;
  fund_sell_bps: number;
  protocol_buy_bps: number;
  day_length_sec: number;
  demo_time: boolean;
  launch_ts: number;
  now_ts: number;
  protocol_account: string;
  factory: string;
  supply: string;
  /** yoctoNEAR per whole token */
  price: string;
  reserve: string;
  fund: string;
  protocol_fees: string;
  day: number;
  window_buys: string;
  peak_window: string;
  alive_threshold: string;
  ejectable: boolean;
  total_weight: string;
  ejected: null | EjectSnapshot;
  /** Open Mayday, or null. One past its deadline stays until a call closes it. */
  mayday: null | Mayday;
  can_mayday: boolean;
  /** End of the cooldown after a failed Mayday (0 when none). */
  mayday_open_after_ts: number;
  rescues: number;
  pledges_held: string;
};

/** `holder(account_id)`: the "your seat" numbers. */
export type HolderView = {
  balance: string;
  /** Net basis in yoctoNEAR, can be negative. */
  basis: string;
  weight: string;
  total_weight: string;
  claimed: boolean;
  /** Payout if EJECT happened now (before EJECT), or the claimable payout (after). */
  reserve_part: string;
  fund_part: string;
  /** NEAR pledged to a Mayday and not yet filled or withdrawn. */
  pledge: string;
  pledge_round: number;
  pledge_state: "open" | "rescued" | "failed" | "none";
  /** Rescue tokens waiting in escrow for this account. */
  collectable: string;
};

export type BuyQuote = {
  tokens_out: string;
  cost: string;
  fund_fee: string;
  protocol_fee: string;
  dust_to_fund: string;
  price_after: string;
};

export type SellQuote = { gross: string; fund_fee: string; near_out: string; price_after: string };

export type FtMetadata = { name: string; symbol: string; icon: string | null; decimals: number };

export type FactoryConfig = {
  coin_code_hash: string;
  coin_code_len: number;
  coins: number;
  launch_deposit: string;
  owner: string;
  protocol_account: string;
};

export function getConfig(signal?: AbortSignal) {
  return viewCall<FactoryConfig>(FACTORY_ID, "get_config", {}, signal);
}

export function getCoins(signal?: AbortSignal) {
  return viewCall<CoinInfo[]>(FACTORY_ID, "get_coins", { from_index: 0, limit: 100 }, signal);
}

export function getStatus(coinId: string, signal?: AbortSignal) {
  return viewCall<CoinStatus>(coinId, "status", {}, signal);
}

/** Number of access keys on an account. Ejecto coins are deployed keyless, so this should be 0. */
export async function accessKeyCount(accountId: string, signal?: AbortSignal): Promise<number> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ejecto",
      method: "query",
      params: { request_type: "view_access_key_list", finality: "final", account_id: accountId },
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: { keys?: unknown[] }; error?: RpcError };
  if (json.error || !json.result?.keys) throw new Error(json.error?.cause?.name ?? "RPC error");
  return json.result.keys.length;
}

export function getCoin(symbol: string, signal?: AbortSignal) {
  return viewCall<CoinInfo | null>(FACTORY_ID, "get_coin", { symbol }, signal);
}

export function getHolder(coinId: string, accountId: string, signal?: AbortSignal) {
  return viewCall<HolderView>(coinId, "holder", { account_id: accountId }, signal);
}

export function getMetadata(coinId: string, signal?: AbortSignal) {
  return viewCall<FtMetadata>(coinId, "ft_metadata", {}, signal);
}

export function quoteBuy(coinId: string, yocto: bigint, signal?: AbortSignal) {
  return viewCall<BuyQuote>(coinId, "quote_buy", { amount: yocto.toString() }, signal);
}

export function quoteSell(coinId: string, units: bigint, signal?: AbortSignal) {
  return viewCall<SellQuote>(coinId, "quote_sell", { amount: units.toString() }, signal);
}

export function storageBalanceOf(coinId: string, accountId: string, signal?: AbortSignal) {
  return viewCall<{ total: string; available: string } | null>(coinId, "storage_balance_of", { account_id: accountId }, signal);
}

export function storageBounds(coinId: string, signal?: AbortSignal) {
  return viewCall<{ min: string; max: string | null }>(coinId, "storage_balance_bounds", {}, signal);
}

/** Liquid NEAR balance of an account (amount minus locked), in yoctoNEAR. */
export async function accountBalance(accountId: string, signal?: AbortSignal): Promise<bigint> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ejecto",
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: accountId },
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: { amount: string; locked: string }; error?: RpcError };
  if (json.error || !json.result) throw new Error(json.error?.cause?.name ?? "RPC error");
  return BigInt(json.result.amount) - BigInt(json.result.locked);
}
