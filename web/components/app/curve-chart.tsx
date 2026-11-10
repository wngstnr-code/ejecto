"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { formatCompact, formatNear, formatPct, unitsToTokens, yoctoToNear } from "@/lib/format";
import type { CoinStatus } from "@/lib/near";
import { Amount, LiveIcon, PanelTitle, PriceText } from "./ui";

// Curve constants fixed by the factory (spec section 4): price(s) = P0 + K * s, in NEAR per token.
const P0 = 2e-8;
const K = 5e-16;
const price = (s: number) => P0 + K * s;
/** NEAR held by the curve at supply s: the area under the price line. */
const reserveAt = (s: number) => P0 * s + (K * s * s) / 2;

const W = 640;
const H = 260;
const PAD = { l: 8, r: 8, t: 16, b: 8 };

/**
 * The bonding curve drawn from the contract's own formula, with the coin's current position on it.
 * The shaded area under the curve up to the current supply is exactly the reserve.
 * Hover (or drag on touch) to read any point: price, reserve, and what it costs to get there from now.
 */
export function CurveChart({ status }: { status: CoinStatus }) {
  const ejected = !!status.ejected;
  const liveSupply = unitsToTokens(status.ejected ? status.ejected.supply_e : status.supply);
  // The page polls the chain every few seconds; glide to each new supply instead of jumping.
  const supply = useTween(liveSupply);
  const reserve = yoctoToNear(status.ejected ? status.ejected.reserve_e : status.reserve);
  const fundFee = status.fund_buy_bps / 100;
  const protoFee = status.protocol_buy_bps / 100;
  const maxS = Math.max(supply * 1.7, 2e7);
  const maxP = price(maxS);
  const x = (s: number) => PAD.l + (s / maxS) * (W - PAD.l - PAD.r);
  const y = (p: number) => H - PAD.b - (p / maxP) * (H - PAD.t - PAD.b);

  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null); // supply under the pointer

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const s = ((vx - PAD.l) / (W - PAD.l - PAD.r)) * maxS;
    setHover(Math.min(maxS, Math.max(0, s)));
  };

  const line = `M${x(0)},${y(price(0))} L${x(maxS)},${y(price(maxS))}`;
  const area = `M${x(0)},${y(0)} L${x(0)},${y(price(0))} L${x(supply)},${y(price(supply))} L${x(supply)},${y(0)} Z`;

  // Tooltip numbers for the hovered point.
  const h = hover;
  const hx = h === null ? 0 : x(h);
  const tipLeft = h === null ? 0 : (hx / W) * 100;
  const delta = h === null ? 0 : reserveAt(h) - reserveAt(supply); // > 0: buy cost, < 0: sell proceeds (before fees)
  // A buy pays fees on top: tokens come from the net amount, so gross = net / (1 - fees).
  const grossBuy = delta / (1 - (fundFee + protoFee) / 100);
  const netSell = -delta * (1 - status.fund_sell_bps / 10_000);
  const priceMove = h === null || supply === 0 ? null : (price(h) / price(supply) - 1) * 100;
  const near = h !== null && Math.abs(x(h) - x(supply)) < 6;

  return (
    <section>
      <PanelTitle
        n="03"
        right={
          ejected ? (
            <span className="label text-muted">Frozen at eject</span>
          ) : (
            <span className="label flex items-center gap-2 text-hazard">
              <LiveIcon />
              Live, every 4 s
            </span>
          )
        }
      >
        Bonding curve
      </PanelTitle>
      <div className="relative mt-8">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full cursor-crosshair touch-none select-none"
          role="img"
          aria-label="Bonding curve with the current supply. Hover to read any point."
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(maxP * f)} y2={y(maxP * f)} className="stroke-line" strokeDasharray="2 6" />
          ))}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="stroke-line" />
          <path d={area} className="fill-hazard/15" />
          <path d={line} fill="none" className="stroke-bone" strokeWidth="2" />

          {/* hovered span between "now" and the pointer */}
          {h !== null && !near && (
            <path
              d={`M${x(Math.min(h, supply))},${y(0)} L${x(Math.min(h, supply))},${y(price(Math.min(h, supply)))} L${x(Math.max(h, supply))},${y(price(Math.max(h, supply)))} L${x(Math.max(h, supply))},${y(0)} Z`}
              className={h > supply ? "fill-hud/15" : "fill-eject/20"}
            />
          )}

          {supply > 0 && (
            <>
              <line x1={x(supply)} x2={x(supply)} y1={y(0)} y2={y(price(supply))} className="stroke-hazard" strokeDasharray="3 4" />
              <circle cx={x(supply)} cy={y(price(supply))} r="12" className="fill-hazard/20" />
              {/* A ring goes out each time the supply changes on chain. */}
              {!ejected && (
                <circle
                  key={liveSupply}
                  cx={x(supply)}
                  cy={y(price(supply))}
                  r="10"
                  fill="none"
                  strokeWidth="2"
                  className="origin-center stroke-hazard opacity-0 animate-[ring-out_1.2s_ease-out] [transform-box:fill-box]"
                />
              )}
              <circle cx={x(supply)} cy={y(price(supply))} r="6" className="fill-hazard" />
              <text
                x={x(supply)}
                y={y(price(supply)) - 20}
                // Keep the label inside the chart when the point sits near an edge.
                textAnchor={x(supply) < 70 ? "start" : x(supply) > W - 70 ? "end" : "middle"}
                dx={x(supply) < 70 ? -6 : x(supply) > W - 70 ? 6 : 0}
                className="label fill-hazard"
                fontSize="11"
              >
                {ejected ? "AT EJECT" : "NOW"}
              </text>
            </>
          )}

          {h !== null && (
            <>
              <line x1={hx} x2={hx} y1={PAD.t} y2={y(0)} className="stroke-bone/40" strokeWidth="1" />
              <line x1={PAD.l} x2={W - PAD.r} y1={y(price(h))} y2={y(price(h))} className="stroke-bone/15" strokeWidth="1" />
              <circle cx={hx} cy={y(price(h))} r="5" className="fill-ink stroke-bone" strokeWidth="2" />
            </>
          )}
        </svg>

        {/* tooltip */}
        {h !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-60 rounded-xl border border-line bg-panel-2/95 p-4 shadow-2xl backdrop-blur"
            style={{ left: `${tipLeft}%`, transform: `translateX(${tipLeft > 60 ? "calc(-100% - 16px)" : "16px"})` }}
          >
            <div className="label text-muted">{near ? (ejected ? "Supply at eject" : "You are here") : "At supply"}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{formatCompact(h)}</div>
            <dl className="label mt-3 space-y-1.5">
              <Tip k="Price" v={<Amount><PriceText value={price(h)} /></Amount>} />
              <Tip k="Market cap" v={<Amount>{formatNear(price(h) * h, 3)}</Amount>} />
              <Tip k="Reserve" v={<Amount>{formatNear(reserveAt(h), 3)}</Amount>} />
              {priceMove !== null && !near && <Tip k={ejected ? "Price vs eject" : "Price vs now"} v={`${priceMove > 0 ? "+" : ""}${formatPct(priceMove, 1)}`} tone={priceMove > 0 ? "text-hud" : "text-eject"} />}
            </dl>
            {!near && !ejected && (
              <p className="label mt-3 border-t border-line pt-3 leading-relaxed text-muted">
                {delta > 0 ? (
                  <>
                    Buyers must put in <Amount className="text-bone">~{formatNear(grossBuy, 3)}</Amount> (fees included) to push the price here.
                  </>
                ) : (
                  <>
                    Sellers would take out <Amount className="text-bone">~{formatNear(netSell, 3)}</Amount> (after the {status.fund_sell_bps / 100}% fund fee) to pull it here.
                  </>
                )}
              </p>
            )}
            {ejected && !near && <p className="label mt-3 border-t border-line pt-3 text-muted">Trading is closed. The curve is frozen.</p>}
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-4">
          <Readout label={ejected ? "Supply at eject" : "Supply"} value={formatCompact(supply)} />
          <Readout label={ejected ? "Price at eject" : "Price now"} value={<Amount><PriceText value={price(supply)} /></Amount>} />
          <Readout label="Reserve (shaded)" value={<Amount>{formatNear(reserve, 3)}</Amount>} />
        </div>
        <p className="label mt-4 text-muted">Price = P0 + K x supply. Hover the curve to read any point.</p>
      </div>
    </section>
  );
}

function Tip({ k, v, tone = "text-bone" }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={`tabular-nums ${tone}`}>{v}</dd>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="label text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Eases a number toward its latest value over about 0.8 s (ease out cubic). */
function useTween(target: number, ms = 800): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      current.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}
