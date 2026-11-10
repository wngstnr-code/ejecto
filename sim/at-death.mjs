// Who does Ejecto protect? The holders still aboard when the coin dies, and above all the ones who would
// lose the exit race. Same agents and seeds as sim/ejecto-sim.mjs. This is a MODEL.
// Usage: node sim/at-death.mjs [sim/out]   (writes <out>/at-death.json, about 15 s)
import fs from 'node:fs';
import { run } from './ejecto-sim.mjs';

const OUT = process.argv[2] || 'sim/out';
const RUNS = 500;
const r = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// Two groups, both measured on the same traders with and without Ejecto:
//   all: every trader still holding when the Ejecto run ejects the coin
//   last: the last quarter of them to sell in the exit race (the race order is each agent's `order`)
const groups = { all: { n: 0, inv: 0, back: [0, 0], wiped: [0, 0] }, last: { n: 0, inv: 0, back: [0, 0], wiped: [0, 0] } };
for (let seed = 1; seed <= RUNS; seed++) {
  const ej = run(seed, 'ejecto');
  const race = run(seed, 'baseline');
  if (!ej.snapBeforeEject) continue;
  const aboard = ej.agents.filter((a) => ej.snapBeforeEject.h.get(a.id)?.bal > 0).sort((x, y) => x.order - y.order);
  const pnlE = new Map(ej.pnl.map((p) => [p.id, p]));
  const pnlR = new Map(race.pnl.map((p) => [p.id, p]));
  const lastFrom = Math.floor(aboard.length * 0.75);
  aboard.forEach((a, i) => {
    const e = pnlE.get(a.id), b = pnlR.get(a.id);
    if (!e || !b) return;
    for (const g of i >= lastFrom ? [groups.all, groups.last] : [groups.all]) {
      g.n++;
      g.inv += e.inv;
      g.back[0] += e.inv + b.pnl;
      g.back[1] += e.inv + e.pnl;
      if (b.pnl <= -0.9 * b.inv) g.wiped[0]++;
      if (e.pnl <= -0.9 * e.inv) g.wiped[1]++;
    }
  });
}

const view = (g) => ({
  holdersPerCoin: r(g.n / RUNS),
  backPerNear: { exitRace: r(g.back[0] / g.inv, 3), ejecto: r(g.back[1] / g.inv, 3) },
  wipedOutPct: { exitRace: r((g.wiped[0] / g.n) * 100), ejecto: r((g.wiped[1] / g.n) * 100) },
});
const result = { model: true, runs: RUNS, aboardAtDeath: view(groups.all), lastQuarterOfTheRace: view(groups.last) };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/at-death.json`, JSON.stringify(result, null, 2));

console.log('Holders still aboard when the coin dies (model)\n');
console.log('                                   exit race   Ejecto');
for (const [label, g] of [['all of them', result.aboardAtDeath], ['the last quarter to sell', result.lastQuarterOfTheRace]]) {
  console.log(`  ${label.padEnd(26)} back per NEAR   ${String(g.backPerNear.exitRace).padEnd(10)} ${g.backPerNear.ejecto}`);
  console.log(`  ${''.padEnd(26)} wiped out %     ${String(g.wipedOutPct.exitRace).padEnd(10)} ${g.wipedOutPct.ejecto}`);
}
console.log(`\nwrote ${OUT}/at-death.json`);
