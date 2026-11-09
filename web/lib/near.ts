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

export type CoinStatus = {
  name: string;
  symbol: string;
  fee_preset: string;
  day_length_sec: number;
  demo_time: boolean;
  supply: string;
  price: string;
  reserve: string;
  fund: string;
  day: number;
  window_buys: string;
  peak_window: string;
  alive_threshold: string;
  ejectable: boolean;
  ejected: null | { t_e: number; reserve_e: string; supply_e: string; fund_e: string; w_e: string };
};

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
