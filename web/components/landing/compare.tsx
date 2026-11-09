"use client";

import { animate, motion, useInView } from "motion/react";
import { useEffect, useRef } from "react";
import sim from "@/data/sim-example.json";

const s = sim.summary;

type Row = {
  n: string;
  label: string;
  note: string;
  a: { value: number; decimals: number; suffix: string };
  b: { value: number; decimals: number; suffix: string };
};

const ROWS: Row[] = [
  {
    n: "01",
    label: "Traders wiped out",
    note: "Share of traders who lose 90% or more of what they put in.",
    a: { value: s.wipedBasePct, decimals: 1, suffix: "%" },
    b: { value: s.wipedEjectoPct, decimals: 1, suffix: "%" },
  },
  {
    n: "02",
    label: "Losses per coin",
    note: `Total NEAR lost by losing traders, average over ${s.runs} coins.`,
    a: { value: s.lossBasePerCoin, decimals: 0, suffix: " NEAR" },
    b: { value: s.lossEjectoPerCoin, decimals: 0, suffix: " NEAR" },
  },
  {
    n: "03",
    label: "Still aboard at death",
    note: `What the ${sim.holdersAtEject} holders left when the example coin died lose in total.`,
    a: { value: sim.holdersLossBase, decimals: 0, suffix: " NEAR" },
    b: { value: sim.holdersLossEj, decimals: 0, suffix: " NEAR" },
  },
];

/** Ledger of model results: exit race (A) against Ejecto (B), same traders and same luck. */
export function Compare() {
  return (
    <section id="results" className="relative bg-ink text-bone">
      <div className="mx-auto max-w-7xl px-4 py-32 sm:px-8">
        {/* Left column only: the 3D pilot floats on the right. */}
        <div className="lg:w-[64%]">
        <h2 className="display whitespace-nowrap text-6xl sm:text-8xl">The math</h2>
        <p className="label mt-5 leading-relaxed text-muted">
          {s.runs} simulated coins, {s.traders} traders each, 60 days.
          <br />
          Same traders, same luck. Only the ending changes.
        </p>

        <div className="mt-16">
          {/* column heads */}
          <div className="grid grid-cols-2 gap-x-6 border-b border-line py-4 md:grid-cols-[1.3fr_1fr_1fr]">
            <span className="label hidden text-muted md:block">Model, not market data</span>
            <span className="label text-muted">[A] Exit race</span>
            <span className="label text-hazard">[B] Ejecto</span>
          </div>

          {ROWS.map((r) => {
            const max = Math.max(r.a.value, r.b.value, 1e-9);
            return (
              <HoverRow key={r.n}>
                <div className="col-span-2 md:col-span-1">
                  <div className="label text-muted transition-colors duration-300 group-hover:text-ink/60">[{r.n}]</div>
                  <div className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{r.label}</div>
                  <p className="label mt-3 max-w-xs leading-relaxed text-muted transition-colors duration-300 group-hover:text-ink/70">{r.note}</p>
                </div>
                <Figure {...r.a} share={r.a.value / max} tone="muted" />
                <Figure {...r.b} share={r.b.value / max} tone="hot" />
              </HoverRow>
            );
          })}

          {/* the ending */}
          <HoverRow>
            <div className="col-span-2 md:col-span-1">
              <div className="label text-muted transition-colors duration-300 group-hover:text-ink/60">[04]</div>
              <div className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">How a dead coin ends</div>
            </div>
            <div>
              <div className="display text-3xl text-muted transition-colors duration-300 group-hover:text-ink/55 sm:text-4xl">Race</div>
              <p className="label mt-3 max-w-[16rem] leading-relaxed text-muted transition-colors duration-300 group-hover:text-ink/70">
                Sell into a falling curve. The last ones out get almost nothing.
              </p>
            </div>
            <div>
              <div className="display text-3xl text-hazard transition-colors duration-300 group-hover:text-ink sm:text-4xl">Eject</div>
              <p className="label mt-3 max-w-[16rem] leading-relaxed text-bone/80 transition-colors duration-300 group-hover:text-ink">
                Median day {s.ejectDayMedian}. Everyone left on board claims the reserve and the fund.
              </p>
            </div>
          </HoverRow>
        </div>

        <div className="label mt-8 max-w-3xl leading-relaxed text-muted">
          <span className="text-bone">Note:</span> Ejecto removes the exit race and the total wipeouts. It does not make everyone
          profitable: early buyers got more tokens per NEAR, so late buyers can still lose part of their money. Figures come from
          the agent-based model in sim/ejecto-sim.mjs.
        </div>
        </div>
      </div>
    </section>
  );
}

/** A ledger row. On hover a hazard-yellow block wipes in from the left and the text turns black. */
function HoverRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="group relative -mx-4 grid grid-cols-2 gap-x-6 gap-y-6 border-b border-line px-4 py-10 transition-colors duration-300 hover:text-ink md:grid-cols-[1.3fr_1fr_1fr]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 origin-left scale-x-0 bg-hazard transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
      />
      {/* Content sits above the wipe. */}
      <div className="contents [&>*]:relative">{children}</div>
    </div>
  );
}

function Figure({ value, decimals, suffix, share, tone }: Row["a"] & { share: number; tone: "muted" | "hot" }) {
  const hot = tone === "hot";
  return (
    <div>
      <div
        className={`display text-4xl tabular-nums transition-colors duration-300 sm:text-5xl ${
          hot ? "text-hazard group-hover:text-ink" : "text-muted group-hover:text-ink/55"
        }`}
      >
        <CountUp value={value} decimals={decimals} />
        <span className="text-[0.45em] align-top">{suffix}</span>
      </div>
      <div className="mt-5 h-3 w-full bg-line/60 transition-colors duration-300 group-hover:bg-ink/15">
        <motion.div
          className={`bar-stripes h-full ${hot ? "bar-hot" : "bar-muted"}`}
          initial={{ width: 0 }}
          whileInView={{ width: `${Math.max(share, 0.015) * 100}%` }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

/** Counts from 0 to the value once it scrolls into view. Writes to the DOM directly, no re-renders. */
function CountUp({ value, decimals }: { value: number; decimals: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    el.style.opacity = "1";
    const controls = animate(0, value, { duration: 1.2, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => (el.textContent = fmt(v)) });
    return () => controls.stop();
    // fmt only depends on decimals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, decimals]);

  // The real value stays in the HTML; it is only hidden until the count starts, so it never jumps back to 0.
  return (
    <span ref={ref} style={{ opacity: 0 }}>
      {fmt(value)}
    </span>
  );
}
