"use client";

import { MIN_AGE_DAYS, WINDOW_DAYS, secondsToEjectAge, type Phase } from "@/lib/coin";
import { formatNear, yoctoToNear } from "@/lib/format";
import type { CoinStatus } from "@/lib/near";
import { Amount, PanelTitle } from "./ui";

const FILL: Record<Phase, string> = {
  new: "bar-muted",
  alive: "bar-hud",
  dying: "bar-hot",
  ejectable: "bar-eject",
  ejected: "bar-muted",
};

/**
 * The alive detector made visible: buys in the last 14 days against the alive line
 * (5% of the best 14 days ever, at least 1 NEAR). Under the line after day 14, anyone can EJECT.
 */
export function EngineMeter({ status, phase }: { status: CoinStatus; phase: Phase }) {
  const windowBuys = yoctoToNear(status.window_buys);
  const line = yoctoToNear(status.alive_threshold);
  const peak = yoctoToNear(status.peak_window);
  const scale = Math.max(peak, windowBuys, line * 4) * 1.08;
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  const wait = secondsToEjectAge(status);
  const ejected = phase === "ejected";

  if (status.ejected) return <EngineOff status={status} peak={peak} line={line} />;

  return (
    <section>
      <PanelTitle
        n="01"
        right={<span className="label text-muted">Day {status.day}</span>}
      >
        Engine
      </PanelTitle>

      <div className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="label text-muted">Buys, last {WINDOW_DAYS} days</div>
            <div className="mt-2 text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
              <Amount icon="text-muted ml-1">{ejected ? "0" : formatNear(windowBuys)}</Amount>
            </div>
          </div>
          <div className="text-right">
            <div className="label text-muted">Alive line</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums"><Amount>{formatNear(line)}</Amount></div>
          </div>
        </div>

        {/* gauge */}
        <div className="relative mt-8 pt-6">
          <div className="relative h-8 overflow-hidden bg-panel-2">
            <div
              className={`bar-stripes h-full transition-[width] duration-700 ease-out ${FILL[phase]} ${phase === "ejectable" ? "animate-pulse" : ""}`}
              style={{ width: pct(windowBuys), minWidth: windowBuys > 0 ? 4 : 0 }}
            />
          </div>
          <Marker at={pct(line)} label="Alive line" tone="text-eject" lineClass="bg-eject" />
          {peak > 0 && <Marker at={pct(peak)} label="Peak" tone="text-muted" lineClass="bg-muted" />}
        </div>

        <p className="label mt-6 leading-relaxed text-muted">
          {ejected
            ? "The seat has fired. Trading is closed for good."
            : phase === "ejectable"
              ? "Buys fell under the alive line. Anyone can pull the handle now."
              : wait > 0
                ? `EJECT unlocks at day ${MIN_AGE_DAYS} (in about ${formatWait(wait)}), and only if buys sit under the line.`
                : "Below the line, anyone can press EJECT. The line is 5% of the best 14 days, at least 1 NEAR."}
        </p>
      </div>
    </section>
  );
}

/** After EJECT the engine is gone for good: a flatline instead of an empty gauge. */
function EngineOff({ status, peak, line }: { status: CoinStatus; peak: number; line: number }) {
  const e = status.ejected!;
  const dayE = Math.floor((e.t_e - status.launch_ts) / status.day_length_sec);
  const when = new Date(e.t_e * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return (
    <section>
      <PanelTitle n="01" right={<span className="label text-muted">Ejected on day {dayE}</span>}>
        Engine
      </PanelTitle>

      <div className="mt-8 flex items-end justify-between gap-4">
        <div>
          <div className="label text-muted">Status</div>
          <div className="display mt-2 text-4xl text-muted sm:text-5xl">Engine off</div>
        </div>
        <div className="text-right">
          <div className="label text-muted">Best 14 days</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            <Amount>{formatNear(peak)}</Amount>
          </div>
        </div>
      </div>

      {/* flatline: a few beats, then nothing */}
      <svg viewBox="0 0 600 64" className="mt-8 h-16 w-full" preserveAspectRatio="none" aria-hidden>
        <line x1="0" x2="600" y1="32" y2="32" className="stroke-line" strokeDasharray="2 6" />
        <path
          d="M0 32 H40 L52 12 L64 52 L74 32 H120 L130 20 L140 44 L148 32 H190 L196 26 L202 38 L206 32 H600"
          fill="none"
          className="stroke-eject"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="206" cy="32" r="4" className="fill-eject" />
      </svg>

      <p className="label mt-6 leading-relaxed text-muted">
        Buys fell under the alive line ({formatNear(line)} NEAR) and someone pulled the handle on {when}. Trading is closed for good, and
        every holder claims from the frozen reserve and fund.
      </p>
    </section>
  );
}

function Marker({ at, label, tone, lineClass }: { at: string; label: string; tone: string; lineClass: string }) {
  return (
    <div className="pointer-events-none absolute inset-y-0" style={{ left: at }}>
      <div className={`absolute bottom-0 top-5 w-0.5 -translate-x-1/2 ${lineClass}`} />
      <div className={`label absolute top-0 -translate-x-1/2 whitespace-nowrap ${tone}`}>{label}</div>
    </div>
  );
}

function formatWait(sec: number): string {
  if (sec < 90) return `${sec} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  if (sec < 172800) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} days`;
}
