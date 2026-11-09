"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import sim from "@/data/sim-example.json";
import { formatNear } from "@/lib/format";
import { prefersReducedMotion, ScrollTrigger } from "@/lib/gsap";
import { DRAW_END, LAUNCH_START } from "@/lib/pilot-scroll";

// Model data from sim/ejecto-sim.mjs (seed 59). Shown as a model, never as a real coin.
const DAYS = sim.days.slice(0, 46);
const EJECT_DAY = sim.ejectDay ?? 34;
const PEAK = Math.max(...DAYS.map((d) => d.windowBuys));
const THRESHOLD = DAYS[DAYS.length - 1].threshold;

const W = 1000;
const H = 330;
const PAD = { l: 8, r: 8, t: 24, b: 28 };
const x = (day: number) => PAD.l + (day / (DAYS.length - 1)) * (W - PAD.l - PAD.r);
const y = (v: number) => PAD.t + (1 - v / (PEAK * 1.08)) * (H - PAD.t - PAD.b);

// Each stage covers a range of days, so the timeline under the chart lines up with the x axis.
const LAST_DAY = DAYS.length - 1;
const STAGES = [
  { n: "01", title: "The peak", body: "Hype. Buys pour in. Every trade drops a slice into the Ejecto Fund.", from: 0, to: 13 },
  { n: "02", title: "The death", body: "Buying fades. The 14-day volume slides toward 5% of its peak.", from: 13, to: EJECT_DAY },
  { n: "03", title: "The ejection", body: "Below the line, the seat arms. Anyone pulls the handle. Everyone claims.", from: EJECT_DAY, to: LAST_DAY },
];

export function CrashChart() {
  const wrap = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(0);
  const reduced = useReducedMotion();
  const progress = reduced ? 1 : scrolled;

  useEffect(() => {
    if (prefersReducedMotion() || !wrap.current) return;
    const st = ScrollTrigger.create({
      trigger: wrap.current,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => setScrolled(self.progress),
    });
    return () => st.kill();
  }, []);

  // The first part draws the chart, the rest plays the ejection (the 3D pilot fires at LAUNCH_START).
  const drawT = Math.min(progress / DRAW_END, 1);
  const dayF = drawT * (DAYS.length - 1);
  const day = Math.floor(dayF);
  const point = DAYS[day];
  const ejected = day >= EJECT_DAY;
  const launchT = Math.max(0, (progress - LAUNCH_START) / (1 - LAUNCH_START));
  const status = ejected ? "EJECT ARMED" : point.windowBuys < point.threshold * 4 && day >= 14 ? "DYING" : "FLYING";
  const statusColor = ejected ? "text-eject" : status === "DYING" ? "text-hazard" : "text-hud";
  const stage = [...STAGES].reverse().find((s) => day >= s.from) ?? STAGES[0];

  const linePath = useMemo(() => DAYS.map((d, i) => `${i ? "L" : "M"}${x(d.day).toFixed(1)},${y(d.windowBuys).toFixed(1)}`).join(" "), []);
  const areaPath = `${linePath} L${x(DAYS.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const totalLen = 2600; // generous upper bound for the path length in viewBox units
  const dash = totalLen * (1 - drawT);

  return (
    <section id="crash" className="relative">
      <div id="crash-track" ref={wrap} className="relative h-[320vh]">
        <div className="sticky top-0 flex h-dvh flex-col justify-center overflow-hidden px-4 pt-16 sm:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <h2 className="display text-6xl sm:text-8xl">The crash</h2>
              <div className="flex gap-6 font-mono">
                <Readout label="Day" value={String(day).padStart(2, "0")} />
                <Readout label="14-day buys" value={`${formatNear(point.windowBuys, 0)} N`} />
                <Readout label="Alive line" value={`${formatNear(point.threshold, 1)} N`} />
                <div>
                  <div className="label text-muted">Status</div>
                  <div className={`text-xl font-bold ${statusColor} ${ejected ? "animate-blink" : ""}`}>{status}</div>
                </div>
              </div>
            </div>

            <div className="relative">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Simulated 14-day buy volume of a memecoin falling below the alive line, then EJECT">
                <defs>
                  <linearGradient id="crash-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ffd400" stopOpacity="0.28" />
                    <stop offset="1" stopColor="#ffd400" stopOpacity="0" />
                  </linearGradient>
                  <clipPath id="crash-reveal">
                    <rect x="0" y="0" width={x(dayF)} height={H} />
                  </clipPath>
                </defs>
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1={PAD.l} x2={W - PAD.r} y1={y(PEAK * f)} y2={y(PEAK * f)} stroke="#2a2a31" strokeDasharray="3 6" />
                ))}
                <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#2a2a31" />
                {/* stage boundaries */}
                {STAGES.slice(1).map((st) => (
                  <line key={st.n} x1={x(st.from)} x2={x(st.from)} y1={PAD.t} y2={H - PAD.b} stroke="#2a2a31" />
                ))}
                <path d={areaPath} fill="url(#crash-fill)" clipPath="url(#crash-reveal)" />
                <path d={linePath} fill="none" stroke="#ffd400" strokeWidth="3.5" strokeLinejoin="round" strokeDasharray={totalLen} strokeDashoffset={dash} />
                {/* alive line */}
                <line x1={PAD.l} x2={W - PAD.r} y1={y(THRESHOLD)} y2={y(THRESHOLD)} stroke="#ff4d1f" strokeWidth="2" strokeDasharray="10 6" />
                <text x={PAD.l + 10} y={y(THRESHOLD) + 20} textAnchor="start" fill="#ff4d1f" className="font-mono" fontSize="14">
                  ALIVE LINE: 5% OF PEAK
                </text>
                {/* eject marker */}
                {ejected && (
                  <g>
                    <line x1={x(EJECT_DAY)} x2={x(EJECT_DAY)} y1={PAD.t} y2={H - PAD.b} stroke="#ff4d1f" strokeWidth="2" />
                    <rect x={x(EJECT_DAY) - 2} y={PAD.t} width="84" height="24" fill="#ff4d1f" />
                    <text x={x(EJECT_DAY) + 40} y={PAD.t + 17} textAnchor="middle" fill="#0a0a0b" fontWeight="900" fontSize="14" className="font-mono">
                      EJECT
                    </text>
                  </g>
                )}
                {/* moving head */}
                {!ejected && <circle cx={x(dayF)} cy={y(point.windowBuys)} r="7" fill="#ffd400" stroke="#0a0a0b" strokeWidth="3" />}
              </svg>
              <p className="label mt-3 text-muted">
                Simulated coin, for illustration. Model data ({sim.summary.traders} traders, seed {sim.seed}), not a real coin.
              </p>

              {/* Result, shown inside the chart once the pilot has fired. */}
              <div
                className={`absolute left-1/2 top-[10%] w-[min(92%,22rem)] -translate-x-1/2 rounded-2xl bg-eject p-5 text-ink shadow-2xl transition-all duration-500 sm:left-[42%] sm:translate-x-0 ${
                  launchT > 0.35 ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
                }`}
              >
                <div className="label font-bold">Ejected on day {EJECT_DAY}</div>
                <p className="mt-1 text-sm font-semibold leading-relaxed">
                  {sim.holdersAtEject} holders claim {formatNear(sim.reserveAtEject + sim.fundAtEject, 0)} NEAR: the reserve
                  pro-rata plus a {formatNear(sim.fundAtEject, 0)} NEAR fund paid for loyalty.
                </p>
              </div>

              {/* Stage timeline, aligned with the days on the x axis. */}
              <div className="mt-8 flex" style={{ paddingLeft: `${(PAD.l / W) * 100}%`, paddingRight: `${(PAD.r / W) * 100}%` }}>
                {STAGES.map((st) => {
                  const span = st.to - st.from;
                  const fill = Math.min(1, Math.max(0, (dayF - st.from) / span));
                  const active = st === stage;
                  return (
                    <div key={st.n} className="min-w-0 pr-4" style={{ width: `${(span / LAST_DAY) * 100}%` }}>
                      <div className="h-[3px] w-full bg-line">
                        <div className={`h-full ${st.n === "03" ? "bg-eject" : "bg-hazard"}`} style={{ width: `${fill * 100}%` }} />
                      </div>
                      <div className={`mt-3 transition-opacity duration-300 ${active ? "opacity-100" : "opacity-40"}`}>
                        <div className="label flex gap-2">
                          <span className={st.n === "03" ? "text-eject" : "text-hazard"}>[{st.n}]</span>
                          <span className="font-bold text-bone">{st.title}</span>
                        </div>
                        <p className={`mt-1 text-sm leading-snug text-muted ${active ? "" : "hidden md:block"}`}>{st.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label text-muted">{label}</div>
      <div className="text-xl font-bold tabular-nums text-bone">{value}</div>
    </div>
  );
}
