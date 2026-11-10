// Experiment: should the alive line use a "net buys" peak instead of the contract's gross-buys peak?
// Usage: node sim/peak-rule-experiment.mjs [sim/out]   (writes <out>/peak-rule.json, about 30 s)
// This is a MODEL, using the same agents and seeds as sim/ejecto-sim.mjs. Decision and reasoning: D-034.
//
// The worry (known issue, medium): a griefer buys a lot and sells it again, which raises the peak 14-day
// window, so 14 days later an active coin can fall under 5% of that fake peak and be ejected early.
// The candidate fix: measure the peak on buys minus sells, so a buy that is sold again adds almost nothing.
import fs from 'node:fs';
import { DAYS, run, setPeakRule, stats } from './ejecto-sim.mjs';

const OUT = process.argv[2] || 'sim/out';
const RUNS = 500;
const GRIEF_RUNS = 200;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => {
  const b = a.filter((x) => x !== null).sort((x, y) => x - y);
  return b.length ? b[Math.floor(b.length / 2)] : null;
};
const r2 = (x) => Math.round(x * 100) / 100;

const result = { model: true, rules: {}, grief: {} };

// 1. The honest case: no attacker. Does the rule change the headline results?
for (const rule of ['gross', 'net']) {
  setPeakRule(rule);
  const base = [], ej = [], days = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    base.push(stats(run(seed, 'baseline').pnl));
    const e = run(seed, 'ejecto');
    ej.push(stats(e.pnl));
    days.push(e.m.ejectDay);
  }
  const total = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const lossB = mean(base.map((x) => x.lossSum)), lossE = mean(ej.map((x) => x.lossSum));
  result.rules[rule] = {
    wipedEjectoPct: r2((total(ej, 'wiped') / total(ej, 'traders')) * 100),
    lossReductionPct: r2((1 - lossE / lossB) * 100),
    ejectDayMedian: median(days),
    ejectedWithin60Pct: r2((days.filter((d) => d !== null && d < DAYS).length / RUNS) * 100),
  };
}

// 2. The attack: buy X NEAR on day 2, sell it the same day (flash) or 14 days later (patient).
for (const rule of ['gross', 'net']) {
  setPeakRule(rule);
  result.grief[rule] = {};
  for (const hold of [0, 14]) {
    for (const x of [500, 2000, 10000]) {
      let earlier = 0, lossClean = 0, lossGrief = 0;
      const daysEarlier = [], cost = [];
      for (let seed = 1; seed <= GRIEF_RUNS; seed++) {
        const clean = run(seed, 'ejecto');
        const att = run(seed, 'ejecto', { grief: { day: 2, x, hold } });
        const d0 = clean.m.ejectDay ?? DAYS, d1 = att.m.ejectDay ?? DAYS;
        if (d1 < d0) {
          earlier++;
          daysEarlier.push(d0 - d1);
        }
        const h = att.m.h.get(777777);
        cost.push(h ? -h.cash : 0);
        // What the other holders lose, with and without the griefer (the griefer itself left out).
        lossClean += stats(clean.pnl).lossSum;
        lossGrief += stats(att.pnl.filter((p) => p.id !== 777777)).lossSum;
      }
      result.grief[rule][`${hold ? 'patient' : 'flash'}_${x}`] = {
        ejectedEarlierPct: r2((earlier / GRIEF_RUNS) * 100),
        medianDaysEarlier: median(daysEarlier),
        attackerCostPctOfX: r2((mean(cost) / x) * 100),
        holdersLossChangePct: r2(((lossGrief - lossClean) / lossClean) * 100),
      };
    }
  }
}
setPeakRule('gross');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/peak-rule.json`, JSON.stringify(result, null, 2));

const g = result.grief;
console.log('Peak rule experiment (model, same agents and seeds as the main simulation)\n');
console.log('No attacker            gross (contract)   net buys');
for (const [k, label] of [['wipedEjectoPct', 'wiped out %'], ['lossReductionPct', 'loss reduction %'], ['ejectDayMedian', 'median EJECT day']]) {
  console.log(`  ${label.padEnd(20)} ${String(result.rules.gross[k]).padEnd(18)} ${result.rules.net[k]}`);
}
console.log('\nGriefer buys X on day 2  coins ejected earlier (median days)   attacker cost   holders lose (gross)');
for (const key of Object.keys(g.gross)) {
  const a = g.gross[key], b = g.net[key];
  console.log(`  ${key.padEnd(14)} gross ${`${a.ejectedEarlierPct}% (${a.medianDaysEarlier ?? 0}d)`.padEnd(13)} net ${`${b.ejectedEarlierPct}% (${b.medianDaysEarlier ?? 0}d)`.padEnd(13)} ${`${a.attackerCostPctOfX}% of X`.padEnd(15)} ${a.holdersLossChangePct > 0 ? '+' : ''}${a.holdersLossChangePct}%`);
}
console.log(`\nwrote ${OUT}/peak-rule.json`);
