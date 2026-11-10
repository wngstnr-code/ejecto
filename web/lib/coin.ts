"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getHolder, getMetadata, getStatus, type CoinStatus, type FtMetadata, type HolderView } from "./near";

/** Minimum coin age in days before EJECT is possible (coin contract, detector.rs). */
export const MIN_AGE_DAYS = 14;
/** Detector window in days. */
export const WINDOW_DAYS = 14;

/** Gas per call in Tgas, with headroom over what the sandbox tests measured. */
export const GAS = { storage: 30, buy: 50, sell: 50, eject: 50, claim: 50, launch: 200 } as const;

export type Phase = "new" | "alive" | "dying" | "ejectable" | "ejected";

/**
 * UI phase of a coin. "dying" is a UI hint only (buys under twice the alive line), the contract rule is
 * just `ejectable`. "new" means the coin is younger than 14 days, so it cannot be ejected yet.
 */
export function coinPhase(s: CoinStatus): Phase {
  if (s.ejected) return "ejected";
  if (s.ejectable) return "ejectable";
  const window = BigInt(s.window_buys);
  const line = BigInt(s.alive_threshold);
  if (s.day < MIN_AGE_DAYS) return window >= line ? "alive" : "new";
  return window < 2n * line ? "dying" : "alive";
}

export const PHASE_LABEL: Record<Phase, string> = {
  new: "Warming up",
  alive: "Alive",
  dying: "Dying",
  ejectable: "Ejectable",
  ejected: "Ejected",
};

/** Seconds until the coin reaches the minimum age, or 0. */
export function secondsToEjectAge(s: CoinStatus): number {
  if (s.day >= MIN_AGE_DAYS) return 0;
  return Math.max(0, s.launch_ts + MIN_AGE_DAYS * s.day_length_sec - s.now_ts);
}

const POLL_MS = 4000;

/**
 * Live coin data: `status()` (and `holder()` when a wallet is connected) polled every few seconds while the
 * tab is visible. `refresh()` reads again at once, for example right after a transaction.
 */
export function useCoin(coinId: string | null, accountId: string | null) {
  const [status, setStatus] = useState<CoinStatus | null>(null);
  const [holder, setHolder] = useState<HolderView | null>(null);
  const [meta, setMeta] = useState<FtMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!coinId) return;
    const mine = ++seq.current;
    try {
      const [s, h] = await Promise.all([getStatus(coinId), accountId ? getHolder(coinId, accountId) : Promise.resolve(null)]);
      if (mine !== seq.current) return;
      setStatus(s);
      setHolder(h);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : "RPC error");
    }
  }, [coinId, accountId]);

  useEffect(() => {
    if (!coinId) return;
    let alive = true;
    getMetadata(coinId)
      .then((m) => alive && setMeta(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [coinId]);

  useEffect(() => {
    if (!coinId) return;
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [coinId, refresh]);

  return { status, holder, meta, error, refresh };
}
