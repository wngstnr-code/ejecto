// README charts from the simulation output (model data, labeled as such on every chart).
// Usage: node sim/ejecto-sim.mjs sim/out && node sim/readme-charts.mjs sim/out docs/img
import fs from "node:fs";

const IN = process.argv[2] || "sim/out";
const OUT = process.argv[3] || "docs/img";
fs.mkdirSync(OUT, { recursive: true });
const res = JSON.parse(fs.readFileSync(`${IN}/ejecto-results.json`, "utf8"));
const series = JSON.parse(fs.readFileSync(`${IN}/example-series.json`, "utf8"));

const C = { bg: "#0b0b0c", panel: "#141417", grid: "#26262b", text: "#a3a3a8", bone: "#ece8df", hazard: "#ffd400", eject: "#ff4d1f", hud: "#3ddc84", muted: "#5b5b63" };
const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "SFMono-Regular, Menlo, Consolas, monospace";
const W = 760;
const H = 360;

const frame = (title, sub, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
  `<rect width="${W}" height="${H}" rx="18" fill="${C.bg}"/>` +
  `<text x="32" y="44" font-family="${SANS}" font-size="21" font-weight="700" fill="${C.bone}">${title}</text>` +
  `<text x="32" y="68" font-family="${MONO}" font-size="11.5" letter-spacing="0.6" fill="${C.text}">${sub}</text>` +
  body +
  `<text x="${W - 32}" y="42" text-anchor="end" font-family="${MONO}" font-size="10" letter-spacing="0.6" fill="${C.muted}">MODEL DATA</text>` +
  `</svg>`;
const t = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-family="${o.mono === false ? SANS : MONO}" font-size="${o.size ?? 11}" fill="${o.fill ?? C.text}"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.weight ? ` font-weight="${o.weight}"` : ""}>${s}</text>`;

// 1. Exit race against Ejecto: the two headline numbers as paired bars.
function outcomes() {
  const s = res.summary;
  const rows = [
    { label: "Traders wiped out (lose 90% or more)", a: s.baseline.wipedPct, b: s.ejecto.wipedPct, fmt: (v) => `${v.toFixed(2)}%` },
    { label: "NEAR lost by losing traders, per coin", a: s.baseline.lossSum, b: s.ejecto.lossSum, fmt: (v) => `${v.toFixed(0)} N` },
  ];
  let body = "";
  const x0 = 32, barX = 300, barW = 330;
  rows.forEach((r, i) => {
    const y = 120 + i * 112;
    const max = Math.max(r.a, r.b, 1e-9);
    body += t(x0, y + 4, r.label, { mono: false, size: 15, fill: C.bone, weight: 600 });
    [["Exit race", r.a, C.muted], ["Ejecto", r.b, C.hazard]].forEach(([name, v, col], k) => {
      const yy = y + 22 + k * 32;
      body += t(x0, yy + 15, name.toUpperCase(), { size: 11, fill: k ? C.hazard : C.text });
      body += `<rect x="${barX}" y="${yy}" width="${barW}" height="20" rx="4" fill="${C.panel}"/>`;
      body += `<rect x="${barX}" y="${yy}" width="${Math.max(3, (v / max) * barW)}" height="20" rx="4" fill="${col}"/>`;
      body += t(barX + barW + 12, yy + 15, r.fmt(v), { size: 13, fill: k ? C.hazard : C.bone, weight: 700 });
    });
  });
  return frame(
    "Same traders, same luck, a different ending",
    `${s.runs} COINS x ${s.traders} TRADERS x 60 DAYS. LOSSES DOWN ${s.lossReductionPct.toFixed(1)}%, NOBODY WIPED OUT.`,
    body,
  );
}

// 2. The alive detector on the example coin: 14-day buys against the alive line, log scale, EJECT marked.
function engine() {
  const d = series.days;
  const L = 70, R = W - 40, T = 96, B = H - 60;
  const yMin = Math.log10(1), yMax = Math.log10(Math.max(...d.map((p) => p.windowBuys)) * 1.4);
  const x = (day) => L + (day / 60) * (R - L);
  const y = (v) => B - ((Math.log10(Math.max(v, 1)) - yMin) / (yMax - yMin)) * (B - T);
  let body = "";
  for (const v of [1, 10, 100, 1000]) {
    if (Math.log10(v) > yMax) continue;
    body += `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>` + t(L - 10, y(v) + 4, `${v} N`, { anchor: "end", size: 10 });
  }
  for (const day of [0, 14, 30, 45, 60]) body += t(x(day), B + 20, `day ${day}`, { anchor: "middle", size: 10 });
  // Trading stops at EJECT, so both lines end there.
  const alive = d.filter((p) => p.day <= series.ejectDay);
  const line = (key) => alive.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  body += `<path d="${alive.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.threshold).toFixed(1)}`).join(" ")}" fill="none" stroke="${C.eject}" stroke-width="2" stroke-dasharray="6 5"/>`;
  body += `<path d="${line("windowBuys")}" fill="none" stroke="${C.bone}" stroke-width="2.6"/>`;
  const ex = x(series.ejectDay);
  body += `<line x1="${ex}" x2="${ex}" y1="${T - 6}" y2="${B}" stroke="${C.hazard}" stroke-width="2"/>`;
  body += `<rect x="${ex + 8}" y="${T - 4}" width="70" height="22" rx="4" fill="${C.hazard}"/>` + t(ex + 43, T + 11, "EJECT", { anchor: "middle", size: 12, fill: "#0b0b0c", weight: 700 });
  body += t(ex + 8, T + 38, `day ${series.ejectDay}: ${series.holdersAtEject} holders claim`, { size: 11, fill: C.bone });
  body += t(ex + 8, T + 54, `${series.reserveAtEject.toFixed(0)} N reserve + ${series.fundAtEject.toFixed(0)} N fund`, { size: 11, fill: C.hazard });
  body += `<line x1="${L}" x2="${L + 22}" y1="${H - 26}" y2="${H - 26}" stroke="${C.bone}" stroke-width="2.6"/>` + t(L + 30, H - 22, "NEAR spent on buys, last 14 days", { size: 10.5 });
  body += `<line x1="${L + 270}" x2="${L + 292}" y1="${H - 26}" y2="${H - 26}" stroke="${C.eject}" stroke-width="2" stroke-dasharray="6 5"/>` + t(L + 300, H - 22, "alive line (5% of the best window)", { size: 10.5 });
  return frame("How a coin is declared dead", "EXAMPLE COIN (SEED 59). BUYS FALL UNDER THE ALIVE LINE, ANYONE PULLS THE HANDLE.", body);
}

// 3. The late whale: buying right before EJECT always loses, most of all under Ejecto's weighting.
function whale() {
  const a = res.attacks;
  const sets = [
    ["Split by tokens", a.tokens, C.muted, 2],
    ["Split by net NEAR in", a.basis, C.text, 2],
    ["Ejecto: net NEAR in x time held", a.time, C.hazard, 3.2],
  ];
  const sizes = a.time.map((p) => p.W);
  const L = 70, R = W - 40, T = 118, B = H - 70;
  const lx = (w) => L + (Math.log10(w) / Math.log10(sizes[sizes.length - 1])) * (R - L);
  const y = (pct) => T + ((0 - pct) / 60) * (B - T); // 0% at top, -60% at bottom
  let body = "";
  for (const p of [0, -20, -40, -60]) body += `<line x1="${L}" x2="${R}" y1="${y(p)}" y2="${y(p)}" stroke="${p === 0 ? C.muted : C.grid}"/>` + t(L - 10, y(p) + 4, `${p}%`, { anchor: "end", size: 10 });
  for (const w of sizes) body += t(lx(w), B + 18, `${w}`, { anchor: "middle", size: 10 });
  body += t((L + R) / 2, B + 34, "NEAR the whale buys right before EJECT (log scale)", { anchor: "middle", size: 10 });
  sets.forEach(([name, pts, col, sw], i) => {
    body += `<path d="${pts.map((p, k) => `${k ? "L" : "M"}${lx(p.W).toFixed(1)},${y(p.profitPct).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="${sw}"/>`;
    body += `<line x1="${L + i * 200}" x2="${L + 20 + i * 200}" y1="94" y2="94" stroke="${col}" stroke-width="${sw}"/>` + t(L + 26 + i * 200, 98, name, { size: 10.5, fill: i === 2 ? C.hazard : C.text });
  });
  const lo = Math.min(...a.time.map((p) => -p.profitPct)), hi = Math.max(...a.time.map((p) => -p.profitPct));
  return frame("Farming the fund with a late buy loses money", `UNDER EJECTO THE WHALE LOSES ${lo.toFixed(1)}% TO ${hi.toFixed(1)}%, AT EVERY SIZE.`, body);
}

fs.writeFileSync(`${OUT}/sim-outcomes.svg`, outcomes());
fs.writeFileSync(`${OUT}/sim-engine.svg`, engine());
fs.writeFileSync(`${OUT}/sim-whale.svg`, whale());
console.log(`wrote ${OUT}/sim-outcomes.svg, sim-engine.svg, sim-whale.svg`);
