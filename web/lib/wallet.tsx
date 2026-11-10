"use client";

import type { NearConnector } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NETWORK } from "./config";

/** One function call inside a transaction (NEAR Connect action format). */
export type CallAction = {
  type: "FunctionCall";
  params: { methodName: string; args: object; gas: string; deposit: string };
};

export const TGAS = 1_000_000_000_000n;

export function call(methodName: string, args: object, gasTgas: number, deposit: bigint | string = 0n): CallAction {
  return {
    type: "FunctionCall",
    params: { methodName, args, gas: (BigInt(gasTgas) * TGAS).toString(), deposit: deposit.toString() },
  };
}

type Wallet = {
  /** False until a stored session has been checked. */
  ready: boolean;
  accountId: string | null;
  /** Name and logo of the connected wallet (from the NEAR Connect manifest). */
  walletInfo: WalletInfo | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Signs and sends one transaction to `receiverId`. Several actions run atomically in that one transaction. */
  send: (receiverId: string, actions: CallAction[]) => Promise<{ hash: string | null }>;
};

export type WalletInfo = { name: string; icon: string };

const WalletContext = createContext<Wallet | null>(null);

const infoOf = (w: { manifest?: { name?: string; icon?: string } } | null | undefined): WalletInfo | null =>
  w?.manifest ? { name: w.manifest.name ?? "Wallet", icon: w.manifest.icon ?? "" } : null;

/**
 * Wallet connection with NEAR Connect (`@hot-labs/near-connect`, the connector docs.near.org recommends).
 * The connector touches window, localStorage and IndexedDB, so it is created only in the browser.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const connector = useRef<NearConnector | null>(null);
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      if (!alive) return;
      const c = new NearConnector({
        network: NETWORK === "mainnet" ? "mainnet" : "testnet",
        features: { signAndSendTransaction: true },
      });
      connector.current = c;
      c.on("wallet:signIn", (p) => {
        setAccountId(p.accounts[0]?.accountId ?? null);
        setWalletInfo(infoOf(p.wallet));
      });
      c.on("wallet:signOut", () => {
        setAccountId(null);
        setWalletInfo(null);
      });
      try {
        const { wallet, accounts } = await c.getConnectedWallet();
        if (alive) {
          setAccountId(accounts[0]?.accountId ?? null);
          setWalletInfo(infoOf(wallet));
        }
      } catch {
        // no stored session
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
      connector.current?.removeAllListeners();
      connector.current = null;
    };
  }, []);

  const connect = useCallback(async () => {
    const c = connector.current;
    if (!c) return;
    await c.whenManifestLoaded;
    const wallet = await c.connect();
    const accounts = await wallet.getAccounts();
    setAccountId(accounts[0]?.accountId ?? null);
    setWalletInfo(infoOf(wallet));
  }, []);

  const disconnect = useCallback(async () => {
    const c = connector.current;
    if (!c) return;
    try {
      await c.disconnect();
    } finally {
      setAccountId(null);
      setWalletInfo(null);
    }
  }, []);

  const send = useCallback(
    async (receiverId: string, actions: CallAction[]) => {
      const c = connector.current;
      if (!c || !accountId) throw new Error("Connect a wallet first");
      const wallet = await c.wallet();
      const out = await wallet.signAndSendTransaction({ signerId: accountId, receiverId, actions });
      assertSuccess(out);
      return { hash: out?.transaction?.hash ?? null };
    },
    [accountId],
  );

  const value = useMemo(
    () => ({ ready, accountId, walletInfo, connect, disconnect, send }),
    [ready, accountId, walletInfo, connect, disconnect, send],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(WalletContext);
  if (!w) throw new Error("useWallet needs a WalletProvider");
  return w;
}

type Outcome = {
  transaction?: { hash?: string };
  status?: unknown;
  receipts_outcome?: Array<{ outcome?: { status?: unknown } }>;
};

/** Throws with the contract's panic message if the transaction or any of its receipts failed. */
function assertSuccess(out: Outcome | undefined) {
  if (!out) return;
  const statuses = [out.status, ...(out.receipts_outcome ?? []).map((r) => r.outcome?.status)];
  for (const s of statuses) {
    if (s && typeof s === "object" && "Failure" in s) throw new Error(failureMessage((s as { Failure: unknown }).Failure));
  }
}

function failureMessage(f: unknown): string {
  const text = JSON.stringify(f);
  const m = text.match(/"ExecutionError":"(?:Smart contract panicked: )?([^"]+)"/);
  return m ? m[1] : "Transaction failed";
}

/** Turns wallet and contract errors into one short line for the UI. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|cancel|closed|denied/i.test(msg)) return "Cancelled in the wallet.";
  return msg.replace(/^Error:\s*/, "").slice(0, 160);
}
