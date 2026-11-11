// Ejecto: 60-day agent simulation of a bonding-curve memecoin, baseline vs Ejecto.
// Usage: node sim/ejecto-sim.mjs sim/out
// This is a MODEL. Results are not market data. See docs/research.md for the summary and limits.
// Imported as a module (sim/peak-rule-experiment.mjs) it only exports the model and writes nothing.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---------- RNG ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = r => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---------- Curve (price in NEAR per 1M tokens, supply s in millions) ----------
const P0 = 0.02, K = 0.0005; let FB = 0.015, FS = 0.02; // Ejecto fund rates on buy / sell (protocol always 0.5% of buys)
const reserveAt = s => P0 * s + K / 2 * s * s;
const price = s => P0 + K * s;
function tokensForNet(s, net) { // solve K/2 d^2 + (P0+K s) d - net = 0
  const b = P0 + K * s; return (-b + Math.sqrt(b * b + 2 * K * net)) / K;
}

const DAYS = 60, N = 400, WINDOW = 14, MIN_AGE = 14, ALIVE_FRAC = 0.05, ALIVE_MIN = 1; // alive if 14d buys >= 5% of peak 14d buys
// How the peak window is measured. 'gross' (the contract): the best 14-day sum of buys.
// 'net' (a tested alternative, see D-034): the best 14-day sum of buys minus sells.
let PEAK_RULE = 'gross';
export function setPeakRule(rule) { PEAK_RULE = rule; }

function makeAgents(seed) {
  const r = mulberry32(seed);
  const agents = [];
  for (let i = 0; i < N; i++) {
    const late = r() < 0.10;
    const day = late ? Math.floor(r() * 25) : Math.min(DAYS - 1, Math.floor(-Math.log(1 - r()) * 3));
    const amt = Math.min(50, Math.exp(Math.log(2) + gauss(r) * 1.0));
    const tp = 1.3 + r() * 2.7;
    const sl = r() < 0.5 ? 0.3 + r() * 0.4 : 0;
    const bored = []; for (let d = 0; d < DAYS; d++) bored.push(r());
    agents.push({ id: i, day, amt, tp, sl, bored, order: r() });
  }
  return agents;
}

// ---------- Protocol model ----------
class Market {
  constructor(mode) { // mode: 'baseline' | 'ejecto'
    this.mode = mode; this.s = 0; this.reserve = 0; this.fund = 0; this.protocol = 0;
    this.h = new Map(); // id -> {bal, basis, w, last, entryPrice}
    this.S = 0; this.W = 0; this.lastT = 0; // ejecto global accumulators
    this.buys = new Array(DAYS + WINDOW + 30).fill(0); this.sells = new Array(DAYS + WINDOW + 30).fill(0); this.curDay = 0;
    this.ejected = false; this.ejectDay = null; this.totalBuy = 0; this.totalSell = 0; this.peakWin = 0;
  }
  clone() { const m = new Market(this.mode); Object.assign(m, this); m.h = new Map([...this.h].map(([k, v]) => [k, { ...v }])); m.buys = [...this.buys]; m.sells = [...this.sells]; return m; }
  holder(id) { if (!this.h.has(id)) this.h.set(id, { bal: 0, basis: 0, w: 0, last: 0, cash: 0 }); return this.h.get(id); }
  touch(h, t) { // accrue time-weighted positive basis
    this.W += this.S * (t - this.lastT); this.lastT = t;
    h.w += Math.max(0, h.basis) * (t - h.last); h.last = t;
  }
  setBasis(h, nb) { this.S += Math.max(0, nb) - Math.max(0, h.basis); h.basis = nb; }
  buy(id, x, t, day) {
    if (this.ejected) return 0;
    const h = this.holder(id); this.touch(h, t);
    const feeRate = this.mode === 'ejecto' ? FB + 0.005 : 0.01;
    const fee = x * feeRate; const net = x - fee;
    if (this.mode === 'ejecto') { this.fund += x * FB; this.protocol += x * 0.005; } else this.protocol += fee;
    const d = tokensForNet(this.s, net); this.s += d; this.reserve += net;
    h.bal += d; h.cash -= x; this.setBasis(h, h.basis + x);
    this.buys[day] += x; this.totalBuy += x; return d;
  }
  sell(id, d, t) {
    if (this.ejected) return 0;
    const h = this.holder(id); this.touch(h, t); d = Math.min(d, h.bal); if (d <= 1e-12) return 0;
    const gross = reserveAt(this.s) - reserveAt(this.s - d);
    const feeRate = this.mode === 'ejecto' ? FS : 0.01; const fee = gross * feeRate;
    if (this.mode === 'ejecto') this.fund += fee; else this.protocol += fee;
    this.s -= d; this.reserve -= gross; const proceeds = gross - fee;
    h.bal -= d; h.cash += proceeds; this.totalSell += gross; this.sells[this.curDay] += gross;
    let nb = h.basis - proceeds; if (h.bal <= 1e-9) { h.bal = 0; nb = 0; h.w = 0; } // left the ship: forfeit
    this.setBasis(h, nb); return proceeds;
  }
  // Mayday rescue (coin code v2): all pledges fill as one buy at one batch price.
  // coinvest: the Ejecto Fund adds `coinvest` x the pledges (at most half of the fund) to the batch.
  rescueBuy(pledges, t, day, bonusDays = 0, coinvest = 0) {
    if (this.ejected) return 0;
    const T = [...pledges.values()].reduce((a, x) => a + x, 0);
    const feeRate = FB + 0.005;
    const C = Math.min(coinvest * T, this.fund / 2);
    this.fund += T * FB - C; this.protocol += T * 0.005;
    const net = T * (1 - feeRate) + C;
    const d = tokensForNet(this.s, net); this.s += d; this.reserve += net;
    for (const [id, x] of pledges) {
      const h = this.holder(id); this.touch(h, t);
      h.bal += d * x / T; h.cash -= x; this.setBasis(h, h.basis + x);
      // Optional rescuer bonus: the rescue basis earns weight as if held for `bonusDays` already.
      if (bonusDays > 0) { const bw = x * bonusDays; h.w += bw; this.W += bw; }
    }
    this.buys[day] += T; this.totalBuy += T; return d;
  }
  windowBuys(day) { let v = 0; for (let d = Math.max(0, day - WINDOW + 1); d <= day; d++) v += this.buys[d]; return v; }
  windowNet(day) { let v = 0; for (let d = Math.max(0, day - WINDOW + 1); d <= day; d++) v += this.buys[d] - this.sells[d]; return Math.max(0, v); }
  updPeak(day) { this.peakWin = Math.max(this.peakWin, PEAK_RULE === 'net' ? this.windowNet(day) : this.windowBuys(day)); }
  canEject(day) { return this.mode === 'ejecto' && !this.ejected && day >= MIN_AGE && this.windowBuys(day) < Math.max(ALIVE_MIN, ALIVE_FRAC * this.peakWin); }
  // weighting: 'time' (Ejecto), 'basis', 'tokens'
  eject(day, weighting = 'time') {
    const t = day + 1; this.ejected = true; this.ejectDay = day;
    for (const h of this.h.values()) this.touch(h, t);
    const holders = [...this.h.entries()].filter(([, h]) => h.bal > 0);
    const wOf = h => weighting === 'time' ? h.w : weighting === 'basis' ? Math.max(0, h.basis) : h.bal;
    const totW = holders.reduce((a, [, h]) => a + wOf(h), 0);
    const payout = new Map();
    for (const [id, h] of holders) {
      const fromReserve = this.reserve * h.bal / this.s;
      const fromFund = totW > 0 ? this.fund * wOf(h) / totW : 0;
      payout.set(id, { fromReserve, fromFund });
      h.cash += fromReserve + fromFund; h.bal = 0;
    }
    this.reserve = 0; this.s = 0; this.fund = 0; return payout;
  }
  // baseline death: everyone still holding dumps in a random-order race
  raceExit(agents, t) { const ids = agents.filter(a => this.h.has(a.id) && this.h.get(a.id).bal > 0).sort((a, b) => a.order - b.order); for (const a of ids) this.sell(a.id, this.h.get(a.id).bal, t); }
}

// opts.weighting: fund weighting at EJECT. opts.grief: { day, x, hold } an attacker buys x NEAR on `day`
// and sells it all `hold` days later (0 = the same day), to inflate the peak window.
// opts.mayday (coin code v2 and v3, spec section 10): { pledgeProb, pledgeFrac, targetMult, newcomers,
// bonusDays, coinvest, cap, lockDays, attacker }. v3 is { bonusDays: 7, cap: true } with no coinvest:
// the rescue spends exactly the target (pledges scaled down pro-rata, the excess goes back).
// When the coin becomes ejectable, holders still aboard pledge with probability pledgeProb a share
// pledgeFrac of what they put in; the target is targetMult x the alive line. Success executes one batch
// buy; `newcomers` new buyers then arrive over the next 7 days (0 = no new demand, the pessimistic case).
export function run(seed, mode, opts = {}) {
  const agents = makeAgents(seed); const m = new Market(mode); const series = [];
  const entry = new Map(); let snapBeforeEject = null;
  const md = opts.mayday && mode === 'ejecto' ? { ...opts.mayday, blockUntil: -1, cooldownUntil: -1, rescues: 0, fails: 0, pledgers: new Set(), lockedUntil: new Map(), r: mulberry32(seed * 7919 + 13) } : null;
  for (let day = 0; day < DAYS; day++) {
    m.curDay = day;
    const g = opts.grief, G = 777777;
    if (g && day === g.day && !m.ejected) { const d = m.buy(G, g.x, day + 0.001, day); if (g.hold === 0) m.sell(G, d, day + 0.002); }
    if (g && g.hold > 0 && day === g.day + g.hold && !m.ejected && m.h.has(G)) m.sell(G, m.h.get(G).bal, day + 0.001);
    const today = agents.map(a => ({ a, k: a.bored[day] })).sort((x, y) => x.k - y.k);
    for (const { a } of today) {
      const t = day + a.order;
      if (a.day === day && !m.ejected) { m.buy(a.id, a.amt, t, day); entry.set(a.id, price(m.s)); continue; }
      const h = m.h.get(a.id); if (!h || h.bal <= 0 || m.ejected) continue;
      const p = price(m.s), e = entry.get(a.id);
      if (md && (md.lockedUntil.get(a.id) ?? -1) > day) continue; // rescue tokens are locked
      if (p >= e * a.tp || (a.sl && p <= e * a.sl) || a.bored[day] < 0.02) m.sell(a.id, h.bal, t);
    }
    m.updPeak(day);
    if (md && !m.ejected && day > md.blockUntil && day >= md.cooldownUntil && m.canEject(day)) {
      // Mayday: decide the pledges, then either rescue (one batch buy) or fail (3 days blocked, cooldown 7).
      const threshold = Math.max(ALIVE_MIN, ALIVE_FRAC * m.peakWin), target = md.targetMult * threshold;
      const pledges = new Map();
      for (const a of agents) { if (a.id === 888888) continue; const h = m.h.get(a.id); if (h && h.bal > 0 && md.r() < md.pledgeProb) pledges.set(a.id, a.amt * md.pledgeFrac); }
      // Optional attacker: pledges `attacker` NEAR to every Mayday and sells as soon as it can (rescue and dump).
      if (md.attacker) { if (!agents.some((a) => a.id === 888888)) agents.push({ id: 888888, day: 9999, amt: md.attacker, tp: 1.0, sl: 0, bored: Array(DAYS).fill(1), order: 0 }); pledges.set(888888, md.attacker); }
      let total = [...pledges.values()].reduce((x, y) => x + y, 0);
      if (md.cap && total > target) { for (const [id, x] of pledges) pledges.set(id, (x * target) / total); total = target; }
      if (total >= target) {
        m.rescueBuy(pledges, day + 0.5, day, md.bonusDays ?? 0, md.coinvest ?? 0); m.updPeak(day); md.rescues++;
        for (const id of pledges.keys()) { md.pledgers.add(id); entry.set(id, price(m.s)); if (md.lockDays) md.lockedUntil.set(id, day + md.lockDays); }
        for (let k = 0; k < md.newcomers; k++) { const id = 1000 + md.rescues * 100 + k; agents.push({ id, day: Math.min(DAYS - 1, day + 1 + Math.floor(md.r() * 7)), amt: Math.min(50, Math.exp(Math.log(2) + gauss(md.r) * 1.0)), tp: 1.3 + md.r() * 2.7, sl: md.r() < 0.5 ? 0.3 + md.r() * 0.4 : 0, bored: Array.from({ length: DAYS }, () => md.r()), order: md.r() }); }
      } else { md.fails++; md.blockUntil = day + 2; md.cooldownUntil = day + 3 + 7; }
    }
    if (m.canEject(day) && !(md && day <= md.blockUntil)) { snapBeforeEject = m.clone(); m.eject(day, opts.weighting || 'time'); }
    series.push({ day, price: price(m.s), reserve: m.reserve, fund: m.fund, holders: [...m.h.values()].filter(h => h.bal > 0).length, windowBuys: m.windowBuys(day), threshold: Math.max(ALIVE_MIN, ALIVE_FRAC * m.peakWin) });
  }
  if (mode === 'baseline') m.raceExit(agents, DAYS + 1);
  if (mode === 'ejecto' && !m.ejected) { m.eject(DAYS, opts.weighting || 'time'); } // end of sim: settle remaining
  const pnl = agents.filter(a => m.h.has(a.id)).map(a => ({ id: a.id, pnl: m.h.get(a.id).cash, inv: a.amt }));
  return { m, pnl, series, snapBeforeEject, agents, mayday: md };
}

export function stats(pnl) {
  const losers = pnl.filter(p => p.pnl < -1e-9);
  const lossSum = -losers.reduce((a, p) => a + p.pnl, 0);
  const invested = pnl.reduce((a, p) => a + p.inv, 0);
  const wiped = pnl.filter(p => p.pnl <= -0.9 * p.inv).length;
  return { traders: pnl.length, losers: losers.length, lossSum, invested, wiped };
}

export { DAYS };

// ---------- Monte Carlo (only when run directly) ----------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
const OUT = process.argv[2] || 'sim/out';
fs.mkdirSync(OUT, { recursive: true });
const RUNS = 500; const agg = { base: [], ej: [], ejectDay: [], protocol: [], fundAtEject: [], volume: [] };
for (let seed = 1; seed <= RUNS; seed++) {
  const b = run(seed, 'baseline'), e = run(seed, 'ejecto');
  agg.base.push(stats(b.pnl)); agg.ej.push(stats(e.pnl));
  agg.ejectDay.push(e.m.ejectDay); agg.protocol.push(e.m.protocol); agg.volume.push(e.m.totalBuy + e.m.totalSell);
  const s = e.series[e.m.ejectDay ?? DAYS - 1]; agg.fundAtEject.push(e.snapBeforeEject ? e.snapBeforeEject.fund : 0);
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const summary = {
  runs: RUNS, traders: N,
  baseline: { losersPct: mean(agg.base.map(s => s.losers / s.traders)) * 100, lossSum: mean(agg.base.map(s => s.lossSum)), wipedPct: mean(agg.base.map(s => s.wiped / s.traders)) * 100, invested: mean(agg.base.map(s => s.invested)) },
  ejecto: { losersPct: mean(agg.ej.map(s => s.losers / s.traders)) * 100, lossSum: mean(agg.ej.map(s => s.lossSum)), wipedPct: mean(agg.ej.map(s => s.wiped / s.traders)) * 100 },
  ejectDayMedian: median(agg.ejectDay), ejectedWithin60Pct: mean(agg.ejectDay.map(d => d !== null && d < DAYS ? 1 : 0)) * 100,
  protocolRevenueMean: mean(agg.protocol), volumeMean: mean(agg.volume), fundAtEjectMean: mean(agg.fundAtEject),
};
summary.lossReductionPct = (1 - summary.ejecto.lossSum / summary.baseline.lossSum) * 100;

// ---------- Example run (seed 7) ----------
let EX = 1, best = -1; for (let sd = 1; sd <= 200; sd++) { const r0 = run(sd, 'ejecto'); if (r0.snapBeforeEject) { const q = r0.snapBeforeEject.fund / Math.max(1e-9, r0.snapBeforeEject.reserve); if (q > best) { best = q; EX = sd; } } } const exE = run(EX, 'ejecto'); const exB = run(EX, 'baseline');
// last-holder comparison in example: holders at eject moment
const snap = exE.snapBeforeEject;
const shipHolders = snap ? [...snap.h.entries()].filter(([, h]) => h.bal > 0).map(([id]) => id) : [];
const exHolderBase = shipHolders.map(id => exB.m.h.get(id).cash), exHolderEj = shipHolders.map(id => exE.m.h.get(id).cash);
const example = {
  seed: EX, ejectDay: exE.m.ejectDay, holdersAtEject: shipHolders.length,
  fundAtEject: snap ? snap.fund : 0, reserveAtEject: snap ? snap.reserve : 0,
  holdersLossBase: -exHolderBase.filter(x => x < 0).reduce((a, b) => a + b, 0),
  holdersLossEj: -exHolderEj.filter(x => x < 0).reduce((a, b) => a + b, 0),
  series: exE.series,
};

// ---------- Attack: whale buys right when the coin is about to eject ----------
function attack(W, weighting) {
  const m = snap.clone(); const day = example.ejectDay; const WH = 99999;
  m.buy(WH, W, day + 0.99, day); // resets the alive window
  let d = day; while (!m.canEject(d)) d++; // nobody else trades
  const before = -m.h.get(WH).cash; m.eject(d, weighting); const after = m.h.get(WH).cash; return { W, profit: after, profitPct: after / W * 100, ejectDay: d };
}
const whales = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const attacks = { tokens: whales.map(W => attack(W, 'tokens')), basis: whales.map(W => attack(W, 'basis')), time: whales.map(W => attack(W, 'time')) };

// ---------- Wash trading to keep coin alive ----------
function wash(perDay, days) {
  const m = snap.clone(); const day = example.ejectDay; const WH = 88888; let cost = 0;
  for (let k = 0; k < days; k++) { const c0 = m.holder(WH).cash; m.buy(WH, perDay, day + k + 0.5, day + k); m.sell(WH, m.h.get(WH).bal, day + k + 0.6); cost += c0 - m.h.get(WH).cash; }
  return { perDay, days, cost, fundGrowth: m.fund - snap.fund };
}
const washRes = wash(3, 30);

// ---------- Sensitivity on fee levels ----------
function mc(runs) { const b = [], e = []; for (let sd = 1; sd <= runs; sd++) { b.push(stats(run(sd, 'baseline').pnl)); e.push(stats(run(sd, 'ejecto').pnl)); }
  const lb = mean(b.map(x => x.lossSum)), le = mean(e.map(x => x.lossSum));
  return { lossReductionPct: (1 - le / lb) * 100, wipedBase: mean(b.map(x => x.wiped / x.traders)) * 100, wipedEj: mean(e.map(x => x.wiped / x.traders)) * 100, losersBase: mean(b.map(x => x.losers / x.traders)) * 100, losersEj: mean(e.map(x => x.losers / x.traders)) * 100 }; }
const sens = []; for (const [fb, fsl, name] of [[0.005, 0.01, 'light'], [0.015, 0.02, 'standard'], [0.03, 0.05, 'high']]) { FB = fb; FS = fsl; sens.push({ name, buyFee: (fb + 0.005) * 100, sellFee: fsl * 100, ...mc(200) }); } FB = 0.015; FS = 0.02;
fs.writeFileSync(`${OUT}/ejecto-results.json`, JSON.stringify({ summary, example: { ...example, series: undefined }, attacks, wash: washRes, sens }, null, 2));

// ---------- SVG charts ----------
const C = { ink: '#1a1d23', muted: '#6b7280', grid: '#e5e7eb', a: '#ea580c', b: '#0f766e', c: '#7c3aed', bad: '#dc2626' };
function lineChart({ w = 640, h = 240, series, xMax, yMax, yLabel, xLabel, marks = [], legend }) {
  const L = 48, R = 12, T = 14, B = 34; const X = x => L + x / xMax * (w - L - R), Y = y => T + (1 - y / yMax) * (h - T - B);
  let s = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial" font-size="10">`;
  for (let i = 0; i <= 4; i++) { const y = yMax * i / 4; s += `<line x1="${L}" x2="${w - R}" y1="${Y(y)}" y2="${Y(y)}" stroke="${C.grid}"/><text x="${L - 6}" y="${Y(y) + 3}" text-anchor="end" fill="${C.muted}">${+y.toFixed(y < 1 ? 3 : 0)}</text>`; }
  for (let x = 0; x <= xMax; x += 10) s += `<text x="${X(x)}" y="${h - B + 14}" text-anchor="middle" fill="${C.muted}">${x}</text>`;
  s += `<text x="${(L + w - R) / 2}" y="${h - 4}" text-anchor="middle" fill="${C.muted}">${xLabel}</text><text x="12" y="${T + (h - T - B) / 2}" transform="rotate(-90 12 ${T + (h - T - B) / 2})" text-anchor="middle" fill="${C.muted}">${yLabel}</text>`;
  for (const m of marks) s += `<line x1="${X(m.x)}" x2="${X(m.x)}" y1="${T}" y2="${h - B}" stroke="${C.bad}" stroke-dasharray="4 3"/><text x="${X(m.x) + 4}" y="${T + 10}" fill="${C.bad}" font-weight="bold">${m.label}</text>`;
  for (const se of series) s += `<polyline fill="none" stroke="${se.color}" stroke-width="2.2" points="${se.pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(Math.min(y, yMax)).toFixed(1)}`).join(' ')}"/>`;
  if (legend) legend.forEach((l, i) => { s += `<rect x="${w - R - 170}" y="${T + 4 + i * 14}" width="10" height="3" fill="${l.color}"/><text x="${w - R - 155}" y="${T + 8 + i * 14}" fill="${C.ink}">${l.label}</text>`; });
  return s + '</svg>';
}
const ser = example.series;
const chart1 = lineChart({ series: [{ color: C.b, pts: ser.map(p => [p.day, p.reserve]) }, { color: C.a, pts: ser.map(p => [p.day, p.fund]) }], xMax: 60, yMax: Math.ceil(Math.max(...ser.map(p => p.reserve)) / 50) * 50, yLabel: 'NEAR', xLabel: 'day', marks: example.ejectDay !== null ? [{ x: example.ejectDay, label: 'EJECT' }] : [], legend: [{ color: C.b, label: 'Curve reserve' }, { color: C.a, label: 'Ejecto Fund' }] });
const maxAbs = Math.max(...Object.values(attacks).flat().map(a => Math.abs(a.profitPct)));
function attackChart() {
  const w = 640, h = 240, L = 48, R = 12, T = 14, B = 34; const xs = whales.map((_, i) => i); const yMax = Math.ceil(maxAbs / 20) * 20;
  const X = i => L + i / (whales.length - 1) * (w - L - R), Y = v => T + (1 - (v + yMax) / (2 * yMax)) * (h - T - B);
  let s = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial" font-size="10">`;
  for (let v = -yMax; v <= yMax; v += yMax / 2) s += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 0 ? C.ink : C.grid}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end" fill="${C.muted}">${v}%</text>`;
  whales.forEach((W, i) => s += `<text x="${X(i)}" y="${h - B + 14}" text-anchor="middle" fill="${C.muted}">${W}</text>`);
  s += `<text x="${(L + w - R) / 2}" y="${h - 4}" text-anchor="middle" fill="${C.muted}">whale buy size (NEAR), log scale</text>`;
  const lines = [['tokens', C.bad, 'Split by tokens'], ['basis', C.c, 'Split by net basis'], ['time', C.b, 'Ejecto: net basis x time held']];
  lines.forEach(([k, col, lab], j) => { s += `<polyline fill="none" stroke="${col}" stroke-width="2.2" points="${attacks[k].map((a, i) => `${X(i).toFixed(1)},${Y(a.profitPct).toFixed(1)}`).join(' ')}"/>`; s += `<rect x="${L + 10}" y="${T + 4 + j * 14}" width="10" height="3" fill="${col}"/><text x="${L + 25}" y="${T + 8 + j * 14}" fill="${C.ink}">${lab}</text>`; });
  s += `<text x="${w - R - 4}" y="${Y(yMax * 0.85)}" text-anchor="end" fill="${C.muted}">profit ↑</text><text x="${w - R - 4}" y="${Y(-yMax * 0.85)}" text-anchor="end" fill="${C.muted}">loss ↓</text>`;
  return s + '</svg>';
}
// Compact series of the example coin for the web app landing chart (model data, labeled as such in the UI).
const r2 = x => Math.round(x * 100) / 100;
fs.writeFileSync(`${OUT}/example-series.json`, JSON.stringify({
  model: true, seed: example.seed, ejectDay: example.ejectDay, windowDays: WINDOW, minAgeDays: MIN_AGE,
  holdersAtEject: example.holdersAtEject, fundAtEject: r2(example.fundAtEject), reserveAtEject: r2(example.reserveAtEject),
  holdersLossBase: r2(example.holdersLossBase), holdersLossEj: r2(example.holdersLossEj),
  summary: { runs: summary.runs, traders: summary.traders, investedPerCoin: r2(summary.baseline.invested), lossBasePerCoin: r2(summary.baseline.lossSum), lossEjectoPerCoin: r2(summary.ejecto.lossSum), lossReductionPct: r2(summary.lossReductionPct), wipedBasePct: r2(summary.baseline.wipedPct), wipedEjectoPct: r2(summary.ejecto.wipedPct), ejectDayMedian: summary.ejectDayMedian, ejectedWithin60Pct: r2(summary.ejectedWithin60Pct) },
  days: example.series.map(p => ({ day: p.day, windowBuys: r2(p.windowBuys), threshold: r2(p.threshold), reserve: r2(p.reserve), fund: r2(p.fund), holders: p.holders })),
}, null, 1));
fs.writeFileSync(`${OUT}/chart-example.svg`, chart1); fs.writeFileSync(`${OUT}/chart-attack.svg`, attackChart());
console.log(JSON.stringify({ sens, summary, example: { ...example, series: undefined }, attacks, wash: washRes }, null, 2));
}
