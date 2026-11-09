"use client";

import { useEffect, useState } from "react";
import { accessKeyCount, getCoins, getConfig, getStatus, type CoinInfo, type FactoryConfig } from "./near";
import { yoctoToNear } from "./format";

export type LiveStats = {
  coins: number;
  alive: number;
  ejected: number;
  inFunds: number; // NEAR sitting in the Ejecto Funds of live coins
  paidOut: number; // NEAR released to holders by EJECT (reserve + fund at EJECT)
  config: FactoryConfig;
  firstCoin: CoinInfo | null;
  coinKeys: number; // access keys summed over every coin account (keyless means 0)
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; stats: LiveStats };

async function loadStats(): Promise<LiveStats> {
  const [config, coins] = await Promise.all([getConfig(), getCoins()]);
  const [statuses, keys] = await Promise.all([
    Promise.all(coins.map((c) => getStatus(c.account_id))),
    Promise.all(coins.map((c) => accessKeyCount(c.account_id))),
  ]);
  const coinKeys = keys.reduce((a, k) => a + k, 0);
  let alive = 0;
  let ejected = 0;
  let inFunds = 0;
  let paidOut = 0;
  for (const s of statuses) {
    if (s.ejected) {
      ejected++;
      paidOut += yoctoToNear(s.ejected.reserve_e) + yoctoToNear(s.ejected.fund_e);
    } else {
      alive++;
      inFunds += yoctoToNear(s.fund);
    }
  }
  return { coins: coins.length, alive, ejected, inFunds, paidOut, config, firstCoin: coins[0] ?? null, coinKeys };
}

// One shared request per page load, used by every component that shows live stats.
let pending: Promise<LiveStats> | null = null;

/** Real numbers read from the factory and every coin on testnet. */
export function useLiveStats(): State {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    pending ??= loadStats();
    pending.then(
      (stats) => active && setState({ kind: "ready", stats }),
      (err: unknown) => {
        pending = null;
        if (active) setState({ kind: "error", message: err instanceof Error ? err.message : "RPC error" });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
