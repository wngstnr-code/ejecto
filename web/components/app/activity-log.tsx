"use client";

import { explorerAccount, explorerTx } from "@/lib/config";
import { formatCompact, formatNear } from "@/lib/format";
import type { History, LogEntry } from "@/lib/history";
import { Amount, LiveIcon, PanelTitle } from "./ui";

const KIND: Record<LogEntry["kind"], { label: string; tone: string }> = {
  buy: { label: "Buy", tone: "border-hud/50 text-hud" },
  sell: { label: "Sell", tone: "border-eject/50 text-eject" },
  eject: { label: "EJECT", tone: "border-eject bg-eject text-ink" },
  claim: { label: "Claim", tone: "border-hazard/60 text-hazard" },
  mayday: { label: "Mayday", tone: "border-hazard bg-hazard text-ink" },
  pledge: { label: "Pledge", tone: "border-hazard/60 text-hazard" },
  rescue: { label: "Rescue", tone: "border-hud bg-hud text-ink" },
  fail: { label: "Failed", tone: "border-line text-muted" },
  collect: { label: "Collect", tone: "border-hud/50 text-hud" },
  refund: { label: "Refund", tone: "border-line text-bone" },
};

/**
 * Every buy, sell, EJECT and claim of this coin, newest first, read from the contract's own events
 * (NEP-297 `ejecto_*` logs). Each line links to its transaction, so anyone can check it on the explorer.
 */
export function ActivityLog({ n, history, error }: { n: string; history: History | null; error: string | null }) {
  const log = history ? [...history.log].reverse() : [];
  const toFund = log.reduce((a, e) => a + (e.kind === "buy" || e.kind === "sell" ? e.fund : 0), 0);

  return (
    <section>
      <PanelTitle
        n={n}
        right={
          <span className="label flex items-center gap-2 text-hazard">
            <LiveIcon /> <span className="hidden sm:inline">From contract events</span>
            <span className="sm:hidden">Live</span>
          </span>
        }
      >
        On-chain log
      </PanelTitle>

      {error && !history ? (
        <p className="label mt-6 text-muted">The log could not be loaded right now ({error}). The explorer has every transaction.</p>
      ) : !history ? (
        <div className="mt-6 space-y-3" aria-label="Loading the log">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-panel" />
          ))}
        </div>
      ) : log.length === 0 ? (
        <p className="label mt-6 text-muted">No trades yet. The first buy starts the log.</p>
      ) : (
        <>
          <p className="label mt-4 leading-relaxed text-muted">
            {log.length} actions. {formatNear(toFund, 4)} NEAR of trading fees went into the Ejecto Fund.
          </p>
          {/* A fixed-height box that scrolls on its own, so a busy coin does not stretch the page. */}
          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-panel">
            <ol className="max-h-[26rem] divide-y divide-line overflow-y-auto overscroll-contain" data-lenis-prevent>
              {log.map((e) => (
                <Row key={`${e.hash}-${e.kind}-${e.account}`} e={e} />
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

function Row({ e }: { e: LogEntry }) {
  const k = KIND[e.kind];
  const when = new Date(e.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <li className="px-4 py-3.5 sm:px-5">
      {/* line 1: action, account, amount */}
      <div className="flex items-center gap-3">
        <span className={`label w-[4.6rem] shrink-0 rounded-full border py-1 text-center font-bold ${k.tone}`}>{k.label}</span>
        <a href={explorerAccount(e.account)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold tracking-tight hover:text-hazard">
          {e.account}
        </a>
        <span className="shrink-0 tabular-nums">
          <Amount icon="text-muted">{formatNear(e.near, 4)}</Amount>
        </span>
      </div>
      {/* line 2: what happened, and the transaction (full width on phones, under the name on larger screens) */}
      <div className="mt-1.5 flex items-start justify-between gap-3 sm:pl-[5.35rem]">
        <span className="label min-w-0 text-muted">
          <Detail e={e} />
        </span>
        <a href={explorerTx(e.hash)} target="_blank" rel="noreferrer" className="label shrink-0 whitespace-nowrap text-muted hover:text-hazard" title="Open the transaction">
          {when} <span aria-hidden>&#8599;</span>
        </a>
      </div>
    </li>
  );
}

function Detail({ e }: { e: LogEntry }) {
  if (e.kind === "buy") return <>{`${formatCompact(e.tokens)} tokens, +${formatNear(e.fund, 4)} to the fund`}</>;
  if (e.kind === "sell") return <>{`${formatCompact(e.tokens)} tokens, +${formatNear(e.fund, 4)} to the fund`}</>;
  if (e.kind === "eject") return <>{`Trading stopped. Reserve and ${formatNear(e.fund, 4)} fund frozen`}</>;
  if (e.kind === "mayday") return <>{`Mayday ${e.round}: rescue target ${formatNear(e.extra ?? 0, 2)} NEAR, EJECT on hold`}</>;
  if (e.kind === "pledge")
    return <>{`Pledged to Mayday ${e.round}: ${formatNear(e.extra ?? 0, 3)} NEAR so far${e.back ? `, ${formatNear(e.back, 4)} above the target sent back` : ""}`}</>;
  if (e.kind === "rescue") return <>{`The crew bought ${formatCompact(e.tokens)} tokens at one price; pledges keep the loyalty they earned while locked`}</>;
  if (e.kind === "fail") return <>{`Mayday ${e.round} missed its target. Every pledge comes back in full`}</>;
  if (e.kind === "collect") return <>{`${formatCompact(e.tokens)} rescue tokens for a ${formatNear(e.near, 3)} pledge`}</>;
  if (e.kind === "refund") return <>{`Pledge returned in full from Mayday ${e.round}`}</>;
  return <>{`${formatNear(e.reserve, 4)} reserve + ${formatNear(e.fund, 4)} fund`}</>;
}
