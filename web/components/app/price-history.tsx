"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { explorerAccount } from "@/lib/config";
import { formatCompact, formatNear, shortAccount, unitsToTokens } from "@/lib/format";
import { loadHistory, priceAtSupply, type History, type Trade } from "@/lib/history";
import type { CoinStatus } from "@/lib/near";
import { Amount, LiveIcon, PanelTitle, PriceText } from "./ui";

const W = 640;
const H = 240;
const PAD = { l: 8, r: 8, t: 18, b: 8 };

/**
 * Price over time, rebuilt from the chain: every buy and sell moves the supply, and the fixed curve turns
 * the supply into a price. Refreshes whenever the live supply changes, so new trades appear at the right edge.
 */
/**
 * Loads the coin's chain history once for the price chart and the on-chain log. Reloads when the coin's
 * state changes: supply moves on a trade, reserve and fund move on EJECT and on every claim.
 */
export function useCoinHistory(coinId: string, status: CoinStatus | null) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = status ? `${status.supply}|${status.reserve}|${status.fund}|${status.ejected?.t_e ?? ""}` : "";

  useEffect(() => {
    if (!key) return;
    const ctrl = new AbortController();
    loadHistory(coinId, ctrl.signal)
      .then((h) => {
        setHistory(h);
        setError(null);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "History error");
      });
    return () => ctrl.abort();
  }, [coinId, key]);

  return { history, error };
}

export function PriceHistory({ status, history, error }: { status: CoinStatus; history: History | null; error: string | null }) {

  const ejected = !!status.ejected;
  const startMs = status.launch_ts * 1000;
  const endMs = ejected ? status.ejected!.t_e * 1000 : Math.max(status.now_ts * 1000, startMs + 1000);
  const liveSupply = unitsToTokens(ejected ? status.ejected!.supply_e : status.supply);
  const livePrice = priceAtSupply(liveSupply);

  const trades = useMemo(() => (history?.trades ?? []).filter((t) => t.t <= endMs + 60_000), [history, endMs]);
  const maxP = Math.max(livePrice, ...trades.map((t) => t.price), priceAtSupply(0) * 1.25) * 1.08;
  const minP = priceAtSupply(0) * 0.96;
  const x = (t: number) => PAD.l + ((Math.min(Math.max(t, startMs), endMs) - startMs) / (endMs - startMs)) * (W - PAD.l - PAD.r);
  const y = (p: number) => H - PAD.b - ((p - minP) / (maxP - minP)) * (H - PAD.t - PAD.b);

  // Step line: the price holds until the next trade moves it.
  const path = useMemo(() => {
    let p = priceAtSupply(0);
    let d = `M${x(startMs)},${y(p)}`;
    for (const t of trades) {
      d += ` H${x(t.t)} V${y(t.price)}`;
      p = t.price;
    }
    // If the indexer has not caught up with the last trade yet, finish at the live price.
    if (Math.abs(p - livePrice) > 1e-15) d += ` H${x(endMs)} V${y(livePrice)}`;
    return `${d} H${x(endMs)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, startMs, endMs, livePrice, maxP]);
  const area = `${path} V${y(minP)} H${x(startMs)} Z`;

  // Hover: the trade nearest to the pointer (within a few pixels), else the price at that moment.
  const svg = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    setHoverX(Math.min(W - PAD.r, Math.max(PAD.l, ((e.clientX - r.left) / r.width) * W)));
  };
  const hover = useMemo(() => {
    if (hoverX === null) return null;
    let nearest: Trade | null = null;
    let best = 10;
    for (const t of trades) {
      const dist = Math.abs(x(t.t) - hoverX);
      if (dist < best) {
        best = dist;
        nearest = t;
      }
    }
    const tAt = startMs + ((hoverX - PAD.l) / (W - PAD.l - PAD.r)) * (endMs - startMs);
    const before = [...trades].reverse().find((t) => t.t <= tAt);
    return { nearest, tAt: nearest ? nearest.t : tAt, price: nearest ? nearest.price : before ? before.price : priceAtSupply(0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverX, trades, startMs, endMs]);

  const last = trades[trades.length - 1];
  const change = trades.length ? (livePrice / priceAtSupply(0) - 1) * 100 : 0;
  const tipLeft = hoverX === null ? 0 : (hoverX / W) * 100;

  return (
    <section>
      <PanelTitle
        n="02"
        right={
          ejected ? (
            <span className="label text-muted">Ended at eject</span>
          ) : (
            <span className="label flex items-center gap-2 text-hazard">
              <LiveIcon />
              Live
            </span>
          )
        }
      >
        Price history
      </PanelTitle>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label text-muted">{ejected ? "Price at eject" : "Price now"}</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">
            <Amount icon="text-muted ml-1">
              <PriceText value={livePrice} />
            </Amount>
          </div>
        </div>
        <div className="label flex gap-6 text-right text-muted">
          <div>
            <div>Since launch</div>
            <div className={`mt-1 text-base font-bold tabular-nums ${change > 0 ? "text-hud" : change < 0 ? "text-eject" : "text-bone"}`}>
              {change > 0 ? "+" : ""}
              {change.toLocaleString("en-US", { maximumFractionDigits: 1 })}%
            </div>
          </div>
          <div>
            <div>Trades</div>
            <div className="mt-1 text-base font-bold tabular-nums text-bone">{history ? trades.length : "..."}</div>
          </div>
        </div>
      </div>

      <div className="relative mt-6">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full cursor-crosshair touch-none select-none"
          role="img"
          aria-label="Price over time, rebuilt from on-chain trades. Hover to read a trade."
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHoverX(null)}
        >
          <defs>
            <linearGradient id="ph-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ffd400" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#ffd400" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (H - PAD.t - PAD.b) * f} y2={PAD.t + (H - PAD.t - PAD.b) * f} className="stroke-line" strokeDasharray="2 6" />
          ))}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(priceAtSupply(0))} y2={y(priceAtSupply(0))} className="stroke-line" />

          {history && (
            <>
              <path d={area} fill="url(#ph-fill)" />
              <path d={path} fill="none" className="stroke-hazard" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {trades.map((t, i) => (
                <circle key={`${t.hash}-${i}`} cx={x(t.t)} cy={y(t.price)} r="3.5" className={t.kind === "buy" ? "fill-hud" : "fill-eject"} />
              ))}
              {/* the newest point pings when it arrives */}
              {last && !ejected && (
                <circle
                  key={`ring-${trades.length}`}
                  cx={x(last.t)}
                  cy={y(last.price)}
                  r="6"
                  fill="none"
                  strokeWidth="2"
                  className="origin-center stroke-hazard opacity-0 animate-[ring-out_1.2s_ease-out] [transform-box:fill-box]"
                />
              )}
              {!ejected && <circle cx={x(endMs)} cy={y(livePrice)} r="4" className="fill-hazard" />}
              {ejected && (
                <>
                  <line x1={x(endMs)} x2={x(endMs)} y1={PAD.t} y2={y(minP)} className="stroke-eject" strokeDasharray="3 4" />
                  <text x={x(endMs) - 6} y={PAD.t + 4} textAnchor="end" className="label fill-eject" fontSize="11">
                    EJECT
                  </text>
                </>
              )}
            </>
          )}

          {hover && (
            <>
              <line x1={x(hover.tAt)} x2={x(hover.tAt)} y1={PAD.t} y2={y(minP)} className="stroke-bone/40" strokeWidth="1" />
              <circle cx={x(hover.tAt)} cy={y(hover.price)} r="5" className="fill-ink stroke-bone" strokeWidth="2" />
            </>
          )}
        </svg>

        {!history && !error && <p className="label absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-muted">Reading trades from the chain...</p>}
        {history && trades.length === 0 && (
          <p className="label absolute inset-x-0 top-1/3 text-center text-muted">No trades yet. The first buy starts the chart.</p>
        )}
        {error && !history && (
          <p className="label absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-eject">Could not read the trade history ({error}).</p>
        )}

        {hover && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-60 rounded-xl border border-line bg-panel-2/95 p-4 shadow-2xl backdrop-blur"
            style={{ left: `${tipLeft}%`, transform: `translateX(${tipLeft > 60 ? "calc(-100% - 16px)" : "16px"})` }}
          >
            <div className="label text-muted">{formatTime(hover.tAt, endMs - startMs)}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              <Amount icon="text-muted ml-1">
                <PriceText value={hover.price} />
              </Amount>
            </div>
            {hover.nearest ? (
              <dl className="label mt-3 space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Trade</dt>
                  <dd className={hover.nearest.kind === "buy" ? "text-hud" : "text-eject"}>{hover.nearest.kind === "buy" ? "Buy" : "Sell"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{hover.nearest.kind === "buy" ? "Paid" : "Received"}</dt>
                  <dd className="tabular-nums text-bone">
                    <Amount>{formatNear(hover.nearest.near, 4)}</Amount>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Tokens</dt>
                  <dd className="tabular-nums text-bone">{formatCompact(hover.nearest.tokens)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">By</dt>
                  <dd className="truncate text-bone">{shortAccount(hover.nearest.account, 18)}</dd>
                </div>
              </dl>
            ) : (
              <p className="label mt-2 text-muted">No trade at this moment.</p>
            )}
          </div>
        )}

        <div className="label mt-3 flex justify-between text-muted">
          <span>Launch, {formatTime(startMs, endMs - startMs)}</span>
          <span>{ejected ? `Eject, ${formatTime(endMs, endMs - startMs)}` : "Now"}</span>
        </div>
        <p className="label mt-4 text-muted">
          Rebuilt from on-chain trades (NearBlocks lists them, the contract&apos;s own events give the amounts).{" "}
          <span className="text-hud">Buy</span> and <span className="text-eject">sell</span> dots. Hover to read a trade. Latest trader:{" "}
          {last ? (
            <a href={explorerAccount(last.account)} target="_blank" rel="noreferrer" className="text-bone underline-offset-4 hover:underline">
              {shortAccount(last.account, 18)}
            </a>
          ) : (
            "none yet"
          )}
          .
        </p>
      </div>
    </section>
  );
}

function formatTime(ms: number, span: number): string {
  const d = new Date(ms);
  if (span < 86_400_000) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
