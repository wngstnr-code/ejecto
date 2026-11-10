"use client";

import { useEffect, useState } from "react";
import { GAS } from "@/lib/coin";
import { formatCompact, formatNear, formatPrice, formatUnitsExact, parseNear, parseTokens, unitsToTokens, yoctoToNear } from "@/lib/format";
import {
  accountBalance,
  quoteBuy,
  quoteSell,
  storageBalanceOf,
  storageBounds,
  type BuyQuote,
  type CoinStatus,
  type HolderView,
  type SellQuote,
} from "@/lib/near";
import { call, errorText, useWallet } from "@/lib/wallet";
import { TxNote, type Tx } from "./tx-note";
import { Amount, NearIcon } from "./ui";

const MIN_BUY = 10n ** 21n; // 0.001 NEAR, contract minimum
const GAS_BUFFER = 5n * 10n ** 22n; // keep 0.05 NEAR for gas when "Max" is used
const SLIPPAGE_BPS = 100n; // 1%

type Mode = "buy" | "sell";

/** Buy and sell on the curve, with live quotes from the contract's own quote methods. */
export function TradePanel({
  coinId,
  status,
  holder,
  onDone,
}: {
  coinId: string;
  status: CoinStatus;
  holder: HolderView | null;
  onDone: () => void;
}) {
  const { accountId, connect, send } = useWallet();
  const [mode, setMode] = useState<Mode>("buy");
  const [input, setInput] = useState("");
  const [nearBal, setNearBal] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<{ key: string; buy?: BuyQuote; sell?: SellQuote; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Tx | null>(null);

  const symbol = status.symbol.toUpperCase();
  const tokenBal = holder ? BigInt(holder.balance) : 0n;
  const amount = mode === "buy" ? parseNear(input) : parseTokens(input);
  const key = `${mode}:${amount ?? ""}`;

  // NEAR balance for the "Max" button and the "not enough" check.
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    accountBalance(accountId)
      .then((b) => alive && setNearBal(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accountId, tx]);

  // Debounced quote from the contract.
  useEffect(() => {
    if (!amount || amount <= 0n) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      const p =
        mode === "buy"
          ? quoteBuy(coinId, amount, ctrl.signal).then((buy) => ({ key, buy }))
          : quoteSell(coinId, amount, ctrl.signal).then((sell) => ({ key, sell }));
      p.then(setQuote).catch((e) => {
        if (!ctrl.signal.aborted) setQuote({ key, error: errorText(e) });
      });
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [coinId, mode, amount, key]);

  const q = quote?.key === key ? quote : null;
  let problem: string | null = null;
  if (input && amount === null) problem = "Enter a number.";
  else if (amount !== null && amount > 0n) {
    if (mode === "buy" && amount < MIN_BUY) problem = "Minimum buy is 0.001 NEAR.";
    if (mode === "buy" && nearBal !== null && amount > nearBal) problem = "Not enough NEAR in your wallet.";
    if (mode === "sell" && amount > tokenBal) problem = `You hold ${formatCompact(unitsToTokens(tokenBal))} ${symbol}.`;
  }
  if (!problem && q?.error) problem = q.error;
  const canSubmit = !!accountId && !!amount && amount > 0n && !problem && !!(q?.buy || q?.sell) && !busy;

  const setMax = () => {
    if (mode === "buy" && nearBal !== null) setInput(formatUnitsExact(nearBal > GAS_BUFFER ? nearBal - GAS_BUFFER : 0n, 24));
    if (mode === "sell") setInput(formatUnitsExact(tokenBal, 18));
  };

  const submit = async () => {
    if (!accountId || !amount) return;
    setBusy(true);
    setTx({ state: "pending", text: "Confirm in your wallet..." });
    try {
      let res: { hash: string | null };
      if (mode === "buy" && q?.buy) {
        const minOut = (BigInt(q.buy.tokens_out) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
        const actions = [];
        // First buy on this coin: register (NEP-145) in the same transaction.
        const registered = await storageBalanceOf(coinId, accountId);
        if (!registered) {
          const bounds = await storageBounds(coinId);
          actions.push(call("storage_deposit", { account_id: accountId, registration_only: true }, GAS.storage, bounds.min));
        }
        actions.push(call("buy", { min_tokens_out: minOut.toString() }, GAS.buy, amount));
        res = await send(coinId, actions);
      } else if (mode === "sell" && q?.sell) {
        const minOut = (BigInt(q.sell.near_out) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
        res = await send(coinId, [call("sell", { amount: amount.toString(), min_near_out: minOut.toString() }, GAS.sell)]);
      } else return;
      setTx({ state: "done", text: mode === "buy" ? "Bought. Welcome aboard." : "Sold.", hash: res.hash });
      setInput("");
      onDone();
    } catch (e) {
      setTx({ state: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-panel">
      {/* tabs */}
      <div className="grid grid-cols-2 border-b border-line">
        {(["buy", "sell"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setInput("");
              setTx(null);
            }}
            className={`display py-4 text-lg transition-colors first:rounded-tl-2xl last:rounded-tr-2xl ${
              mode === m ? (m === "buy" ? "bg-hazard text-ink" : "bg-bone text-ink") : "text-muted hover:text-bone"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <label htmlFor="amount" className="label text-muted">
            {mode === "buy" ? "You pay" : "You sell"}
          </label>
          {accountId && (
            <button type="button" onClick={setMax} className="label text-muted transition-colors hover:text-hazard">
              {mode === "buy"
                ? <Amount>Balance {nearBal === null ? "..." : formatNear(yoctoToNear(nearBal), 3)}</Amount>
                : `Balance ${formatCompact(unitsToTokens(tokenBal))}`}
              <span className="ml-2 text-hazard">Max</span>
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-ink px-4 py-3 focus-within:border-hazard">
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={input}
            onChange={(e) => {
              setInput(e.target.value.replace(",", "."));
              setTx(null);
            }}
            className="w-full min-w-0 bg-transparent text-3xl font-semibold tabular-nums outline-none placeholder:text-line"
          />
          <span className="label flex shrink-0 items-center gap-1.5 text-muted">
            {mode === "buy" ? (
              <>
                <NearIcon className="h-4 w-4 text-bone" />
                NEAR
              </>
            ) : (
              symbol
            )}
          </span>
        </div>

        {/* quote */}
        <dl className="label mt-5 space-y-2.5">
          {mode === "buy" ? (
            <>
              <Row k="You get" v={q?.buy ? `~${formatCompact(unitsToTokens(q.buy.tokens_out))} ${symbol}` : "..."} strong />
              <Row k={`Ejecto Fund (${status.fund_buy_bps / 100}%)`} v={q?.buy ? <Amount>{formatNear(yoctoToNear(q.buy.fund_fee), 4)}</Amount> : "..."} />
              <Row k={`Protocol (${status.protocol_buy_bps / 100}%)`} v={q?.buy ? <Amount>{formatNear(yoctoToNear(q.buy.protocol_fee), 4)}</Amount> : "..."} />
              <Row k="Price after" v={q?.buy ? <Amount>{formatPrice(yoctoToNear(q.buy.price_after))}</Amount> : "..."} />
            </>
          ) : (
            <>
              <Row k="You get" v={q?.sell ? <Amount>~{formatNear(yoctoToNear(q.sell.near_out), 4)}</Amount> : "..."} strong />
              <Row k={`Ejecto Fund (${status.fund_sell_bps / 100}%)`} v={q?.sell ? <Amount>{formatNear(yoctoToNear(q.sell.fund_fee), 4)}</Amount> : "..."} />
              <Row k="Price after" v={q?.sell ? <Amount>{formatPrice(yoctoToNear(q.sell.price_after))}</Amount> : "..."} />
            </>
          )}
          <Row k="Max slippage" v="1%" />
        </dl>

        {problem && <p className="label mt-4 text-eject">{problem}</p>}

        {accountId ? (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className={`display mt-6 w-full rounded-xl py-4 text-xl text-ink transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-40 ${
              mode === "buy" ? "bg-hazard" : "bg-bone"
            }`}
          >
            {busy ? "Waiting..." : mode === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => connect().catch((e) => setTx({ state: "error", text: errorText(e) }))}
            className="display mt-6 w-full rounded-xl bg-hazard py-4 text-xl text-ink transition-transform hover:-translate-y-0.5"
          >
            Connect wallet
          </button>
        )}
        <TxNote tx={tx} />
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className={`tabular-nums ${strong ? "text-base font-bold text-bone" : "text-bone"}`}>{v}</dd>
    </div>
  );
}
