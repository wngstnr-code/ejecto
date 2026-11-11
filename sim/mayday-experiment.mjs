// Experiment: what does a Mayday (crew rescue, spec section 10, coin code v3) do to the crew?
// Usage: node sim/mayday-experiment.mjs [sim/out]   (writes <out>/mayday.json, about 40 s)
// This is a MODEL, using the same agents and seeds as sim/ejecto-sim.mjs. Pledging behavior is an
// assumption, so the scenarios bracket it: no new demand after a rescue (pessimistic) and some (optimistic).
import fs from 'node:fs';
import { DAYS, run } from './ejecto-sim.mjs';

const OUT = process.argv[2] || 'sim/out';
const RUNS = 300;
const r = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const median = (a) => { const b = a.filter((x) => x !== null).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };

// Outcome of the original 400 traders, counting what they pledged as money put in.
function outcome(res) {
  const out = new Map();
  for (const a of res.agents) {
    if (a.id >= 400) continue;
    const h = res.m.h.get(a.id);
    if (!h) continue;
    out.set(a.id, { cash: h.cash, put: -Math.min(0, Math.min(h.cash, 0)) });
  }
  return out;
}

function scenario(name, mayday, grief) {
  let attacker = 0, attackerRuns = 0;
  const base = { rescued: 0, rescues: 0, fails: 0, ejectDays: [], lossNo: 0, lossMd: 0, wipedNo: 0, wipedMd: 0, traders: 0, pledgers: 0, pledgersBetter: 0, pledgerDelta: 0, otherDelta: 0, others: 0 };
  for (let seed = 1; seed <= RUNS; seed++) {
    const no = run(seed, 'ejecto', grief ? { grief } : {});
    const md = run(seed, 'ejecto', { mayday, ...(grief ? { grief } : {}) });
    base.ejectDays.push(md.m.ejectDay);
    const ah = md.m.h.get(888888);
    if (ah && md.mayday.rescues) { attacker += ah.cash; attackerRuns++; }
    if (md.mayday.rescues > 0) base.rescued++;
    base.rescues += md.mayday.rescues;
    base.fails += md.mayday.fails;
    const a = new Map(no.pnl.filter((p) => p.id < 400).map((p) => [p.id, p]));
    const b = new Map(md.pnl.filter((p) => p.id < 400).map((p) => [p.id, p]));
    for (const [id, p] of a) {
      const q = b.get(id);
      if (!q) continue;
      // Money put in: the first buy, plus any pledge (in the Mayday run).
      const pledged = md.mayday.pledgers.has(id);
      const putMd = p.inv + (pledged ? p.inv * mayday.pledgeFrac : 0);
      base.traders++;
      base.lossNo += Math.max(0, -p.pnl);
      base.lossMd += Math.max(0, -q.pnl);
      if (p.pnl <= -0.9 * p.inv) base.wipedNo++;
      if (q.pnl <= -0.9 * putMd) base.wipedMd++;
      if (pledged) {
        base.pledgers++;
        base.pledgerDelta += q.pnl - p.pnl;
        if (q.pnl > p.pnl) base.pledgersBetter++;
      } else {
        base.others++;
        base.otherDelta += q.pnl - p.pnl;
      }
    }
  }
  return {
    name,
    coinsRescuedPct: r((base.rescued / RUNS) * 100),
    failedMaydaysPerCoin: r(base.fails / RUNS, 2),
    medianEjectDay: median(base.ejectDays),
    lossPerCoin: { noMayday: r(base.lossNo / RUNS), mayday: r(base.lossMd / RUNS) },
    wipedOutPct: { noMayday: r((base.wipedNo / base.traders) * 100, 2), mayday: r((base.wipedMd / base.traders) * 100, 2) },
    pledgers: { perCoin: r(base.pledgers / RUNS), betterOffPct: r((base.pledgersBetter / Math.max(1, base.pledgers)) * 100), meanChangeNear: r(base.pledgerDelta / Math.max(1, base.pledgers), 3) },
    everyoneElse: { meanChangeNear: r(base.otherDelta / Math.max(1, base.others), 3) },
    ...(mayday.attacker ? { attacker: { pledgedPerMayday: mayday.attacker, meanNetNear: r(attacker / Math.max(1, attackerRuns), 2), coinsWithARescue: attackerRuns } } : {}),
  };
}

// v3 (spec section 10): the rescue spends exactly the target (pledges above it are scaled down), the
// fund spends nothing, and each pledge earns weight for the time it was locked before the rescue. The
// model pledges at one moment, so the locked time is bracketed: 0 days (lower bound) and 3 days, the
// whole Mayday (upper bound; `bonusDays` adds pledge x days of weight).
const crew = { pledgeProb: 0.3, pledgeFrac: 0.5, targetMult: 2, cap: true };
const result = {
  model: true,
  assumptions: 'When the coin becomes ejectable, each holder aboard pledges half of what they first put in, with probability 0.3; target 2 x the alive line; pledges above the target are scaled down to it. Locked-time weight is bracketed: pledges locked 0 days or the full 3 days before the rescue.',
  scenarios: [
    scenario('v3, pledges locked 0 days, no new demand', { ...crew, newcomers: 0 }),
    scenario('v3, pledges locked 3 days, no new demand', { ...crew, bonusDays: 3, newcomers: 0 }),
    scenario('v3, pledges locked 0 days, 40 newcomers after a rescue', { ...crew, newcomers: 40 }),
    scenario('v3, pledges locked 3 days, 40 newcomers after a rescue', { ...crew, bonusDays: 3, newcomers: 40 }),
    scenario('v3 rescue and dump: an attacker pledges 20 NEAR to every Mayday and sells at once', { ...crew, newcomers: 0, attacker: 20 }),
    scenario('v2 for reference: fund co-invest 25%, no new demand (dropped: it pays a rescue and dump)', { ...crew, cap: false, newcomers: 0, coinvest: 0.25 }),
    scenario('v3 on a griefed coin (flash 2,000 NEAR on day 2), no new demand', { ...crew, bonusDays: 3, newcomers: 0 }, { day: 2, x: 2000, hold: 0 }),
  ],
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/mayday.json`, JSON.stringify(result, null, 2));
console.log('Mayday experiment (model, 300 coins)\n');
for (const x of result.scenarios) {
  console.log(`${x.name}\n  rescued ${x.coinsRescuedPct}%, median EJECT day ${x.medianEjectDay}, loss per coin ${x.lossPerCoin.noMayday} -> ${x.lossPerCoin.mayday}, wiped ${x.wipedOutPct.mayday}%\n  pledgers: ${x.pledgers.meanChangeNear} NEAR each against not pledging (${x.pledgers.betterOffPct}% better off); everyone else ${x.everyoneElse.meanChangeNear}` + (x.attacker ? `\n  attacker: ${x.attacker.meanNetNear} NEAR net per coin rescued` : ''));
}
console.log(`\nwrote ${OUT}/mayday.json`);
