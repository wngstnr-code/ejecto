# Ejecto

**Every memecoin needs an ejecto seato.**

Ejecto is a memecoin launchpad on NEAR where every coin has an ejection seat. Each coin trades on a bonding curve inside its own keyless contract, and a small part of every trade goes into the **Ejecto Fund**. When the coin dies, anyone can press **EJECT**: trading stops forever and every holder claims a fair share of the reserve plus a loyalty share of the fund. No exit race, no total wipeout, no admin.

| | |
|---|---|
| Live app (NEAR testnet) | https://ejecto.vercel.app |
| Demo video | https://x.com/Dudung_gg/status/2120172645438374353 |
| Factory contract (source verified) | [`factory.ejecto.testnet`](https://testnet.nearblocks.io/address/factory.ejecto.testnet/contract/code) |
| Example coin, launched, ejected and claimed on video | [`pilot.factory.ejecto.testnet`](https://testnet.nearblocks.io/address/pilot.factory.ejecto.testnet) |
| Tracks | Memecoins With Mechanics, Social Money |

Built at NEAR HACKATHON 2026.

---

## The problem

About two thirds of memecoins stop trading within a day. When a coin dies, holders race to sell into a falling curve: the fastest sellers get something, the last ones get almost nothing. The most loyal holders lose the most, and the fees they paid never come back to them.

## The mechanic

All of it lives in the coin contract (`contracts/coin`). There is no backend.

1. **Bonding curve.** Price is `P0 + K x supply` (`P0` = 2e-8 NEAR, `K` = 5e-16 NEAR per token). Buys mint from the curve, sells burn into it. The reserve always equals the area under the curve. Supply starts at 0: no premine, no creator allocation.
2. **Ejecto Fund.** Every buy and sell pays a fund fee (preset chosen at launch: light 0.5% / 1%, standard 1.5% / 2%, high 3% / 5%). A 0.5% protocol fee is taken on buys.
3. **Alive detector.** The contract tracks buy volume per day. The *alive line* is 5% of the best 14-day window ever, at least 1 NEAR. Once the coin is 14 days old and the last 14 days of buys fall under the line, the coin is dead.
4. **EJECT.** Anyone can call `eject()` on a dead coin. Trading stops forever and the reserve, the fund and every holder's weight are frozen in a snapshot.
5. **Claim.** Each holder calls `claim()` and receives:
   - a **reserve share**, pro-rata to their token balance (nobody races to the exit), plus
   - a **fund share**, weighted by **net NEAR at risk multiplied by time held** (loyalty, not size, is rewarded; transfers move basis, not weight).
6. **Keyless and fixed.** The factory creates each coin as `<symbol>.factory.ejecto.testnet` with **no access keys** and the contract has **no owner methods**. Every parameter is locked at launch.

Late buyers can still lose some money: early buyers got more tokens per NEAR, so the pro-rata split favors them. What Ejecto removes is the exit race and total wipeouts, and it pays loyalty. The [simulation](#simulation) quantifies this.

## Why NEAR (concretely)

- **One account per coin.** The factory creates a sub-account per coin and deploys the coin wasm to it in one batch, then adds no key. The coin is an immutable, keyless contract that anyone can inspect, which is how "no rug" is enforced instead of promised.
- **Verifiable code.** Both contracts are built reproducibly (`cargo near build reproducible-wasm`, pinned SourceScan image) and verified on NearBlocks; every coin shares the verified code hash.
- **Standards.** Coins are NEP-141 tokens with NEP-145 storage; the first buy batches `storage_deposit` and `buy` in one transaction.
- **No backend.** The web app is a static site. It reads contract views over public RPC and signs with NEAR Connect. Price history is rebuilt in the browser from the contract's own events.

---

## Try it in 5 minutes (hosted app, NEAR testnet)

You need a NEAR **testnet** wallet with about 3 NEAR (launch costs 2.67 NEAR). The wallet modal (NEAR Connect) lists Meteor, Intear, Ledger, Nightly, NEAR CLI and more.

| # | Do | See |
|---|---|---|
| 1 | Open https://ejecto.vercel.app/coins/ | A live table of every coin from the factory, with status badges. `Pilot ($PILOT)` and `Seato ($SEAT)` are **Ejected**. |
| 2 | Click **Pilot** | The coin page: price, supply, reserve, Ejecto Fund, the engine meter showing **Engine off**, the price history rebuilt from chain, and the eject record. |
| 3 | Click **Connect wallet** (top right) and pick a testnet wallet | Your account in the header. |
| 4 | Go to **Launch**. Enter a name and a free symbol, keep **Demo time** (1 day = 10 s) and press **Launch** | "Coin is live" with **0 access keys** and a link to the explorer. |
| 5 | Click **Open the coin**, enter `0.2` NEAR and press **Buy** | The price history and the bonding curve move; **Your seat** shows your balance, net basis and fund weight. |
| 6 | Stop buying and wait about 2.5 minutes (day 14 in demo time) | The badge turns **Ejectable** and the **Pull the handle** panel appears. |
| 7 | Press **EJECT** | The seat fires (3D scene); the panel switches to **Your parachute**. |
| 8 | Press **Claim** (or open **My seats**) | NEAR comes back to your wallet: reserve share plus fund share, exactly as previewed. |

With buys under 1 NEAR in total, the coin is already under the alive line at day 14. To see a coin that stays alive, buy more than 1 NEAR within the first 140 s.

## Verify without a wallet

Install [near-cli-rs](https://github.com/near/near-cli-rs), then:

```bash
# the coin account has no access keys
near account list-keys pilot.factory.ejecto.testnet network-config testnet now
# see: an empty table (no public keys at all)

# the frozen eject snapshot and all parameters
near contract call-function as-read-only pilot.factory.ejecto.testnet status json-args '{}' network-config testnet now
# see: "ejected": { "t_e": ..., "reserve_e": ..., "fund_e": ... } and "ejectable": false

# the factory stores the verified coin code
near contract call-function as-read-only factory.ejecto.testnet get_config json-args '{}' network-config testnet now
# see: "coin_code_hash": "4069f17ff98bc10c1d9b8f06a56af04199eef50755efa0936c5b22d262e391ae"
```

The contract tab on NearBlocks shows **Contract Source Code Verified** for the factory and for every coin.

### The demo run, on chain

Recorded in the demo video. Coin `$PILOT`, demo time 10 s per day.

| Step | Account | Transaction | Result |
|---|---|---|---|
| Launch from the web form | founder.ejecto.testnet | `FQz2inaghVdmw7ZBzi9a1GxxdicHkh12FFg7hs4BpVt2` | keyless coin |
| Buy 0.5 NEAR | ani.ejecto.testnet | `DeCroHC5mfk8uA73euddMBmDwct3ZoQvJWtYAsrgXAxQ` | |
| Buy 0.6 NEAR | budi.ejecto.testnet | `HdssESJcYZh7nHj8ELmJC63bDLPitbG2qzemmrsRnnLJ` | |
| Buy 0.3 NEAR | cici.ejecto.testnet | `4S6Uu9cPs6UaMEKsksJBvtnCR5Qg5tFet18DadPSkuqn` | |
| Whale buys 0.4 NEAR right before EJECT | whale.ejecto.testnet | `Gcbq1ydArgCqDppzb9Jpo6v3uxQejLXSrJsebfuH5uit` | tries to farm the fund |
| EJECT from the web | founder.ejecto.testnet | `3SFynGmm1EStoLWMq937QCtab6Y3xtqePwS1vaX8Tpkq` | snapshot frozen |
| Claim | ani | `AfHFxnZ9SeyUZpWtbxh1549Awaapovopch6aYmcVrL2J` | 0.664 NEAR (**+33%**) |
| Claim | budi | `4ejTcWt1nCVkRu6zDXk2H1dxnQAxhku2HhFHsoNbNbFR` | 0.584 NEAR (-3%) |
| Claim | cici | `J5FspvufBhJNxmHU75w87Q1PE6AGgg3DLeHzUB5kus49` | 0.248 NEAR (-17%) |
| Claim | whale | `2awYR8dKe2HFPjsiMwULtcZfPvGSqef8yt6fwv6UANwV` | 0.295 NEAR (**-26%**): farming loses |

Look any hash up on https://testnet.nearblocks.io.

---

## Run it locally

Requirements: Rust (stable, `wasm32-unknown-unknown`), [cargo-near](https://github.com/near/cargo-near), Node.js 22+ and pnpm 10.

### Web app

```bash
cd web
pnpm install
pnpm dev
```

Open http://localhost:3000. It talks to the deployed testnet factory by default (settings are in `web/lib/config.ts`; optional overrides go in a root `.env`, see `.env.example`). `pnpm build` writes the static site to `web/out`.

### Contract tests

```bash
cd contracts
cargo test -p ejecto-coin          # see: test result: ok. 71 passed
cargo test -p ejecto-factory --lib # see: test result: ok. 15 passed
```

### Sandbox integration tests (real wasm in a local NEAR sandbox)

```bash
cd contracts/coin && cargo near build non-reproducible-wasm
cd ../factory && cargo near build non-reproducible-wasm
cargo test --test integration -- --test-threads=1
# see: launch_is_keyless_and_full_lifecycle_works ... ok
#      launch_with_low_deposit_fails ... ok
#      excess_launch_deposit_comes_back ... ok
```

The first run downloads the sandbox binary. The lifecycle test launches a coin through the factory, checks it has no keys, buys from several accounts, ejects and claims.

### Reproducible build (matches the deployed code)

```bash
export TMPDIR=$HOME/.cache/cargo-near-tmp   # needed with Colima on macOS
cd contracts/coin && cargo near build reproducible-wasm
# see: SHA-256 checksum hex : 4069f17ff98bc10c1d9b8f06a56af04199eef50755efa0936c5b22d262e391ae
```

Needs Docker. Details in `docs/build-and-deploy.md`.

<a id="simulation"></a>

### Simulation

```bash
node sim/ejecto-sim.mjs sim/out
```

An agent-based model (zero dependencies): 500 coins, 400 traders each, 60 days, the same traders and random draws with and without Ejecto. It writes `sim/out/ejecto-results.json` and two SVG charts. Results (standard fees):

| | Exit race | Ejecto |
|---|---|---|
| Traders wiped out (lose 90% or more) | 4.37% | **0%** |
| Losses per coin (NEAR) | 387.96 | **346.12** (-10.8%) |
| Late whale buying 1 to 500 NEAR right before EJECT | | **always loses 30.8% to 48.5%** |

The simulation is a model, not market data.

---

## Architecture

```
user + wallet ──► static web app (Next.js export, Vercel) ──► public NEAR RPC
                                                         │
                       factory.ejecto.testnet ───────────┤ create_coin: new keyless sub-account
                                                         │
                       <symbol>.factory.ejecto.testnet   │ NEP-141 coin + curve + fund + EJECT + claim
```

| Path | What |
|---|---|
| `contracts/coin` | Coin contract: NEP-141, bonding curve, Ejecto Fund, alive detector, EJECT, claim. No owner methods. |
| `contracts/factory` | Factory: stores the coin code, launches keyless coins, registry, refunds of failed launches. |
| `web` | Next.js static app: landing, Coins, Coin, Launch, My seats. NEAR Connect wallet, RPC reads, no backend. |
| `sim` | The simulation behind the economics. |
| `docs` | Product spec, architecture, decisions, progress, research. |

CI (`.github/workflows/ci.yml`) runs the unit tests, the sandbox tests and the web lint, type check and build on every push.

## Security model and known limits

- Coins are keyless and have no admin path; the only way to change one is not to have deployed it.
- The **factory** still has an owner (`ejecto.testnet`) during the hackathon, so the coin code for *future* launches can be replaced. Coins already launched are never affected. This would be locked before any mainnet use.
- **Peak inflation griefing** (medium): a large buy followed by a sell raises the peak window, so 14 days later an active coin can fall under 5% of the inflated peak and be ejected. It is costly (about 4% of the fake peak, mostly paid into the fund) and nobody can steal anything, since holders get a fair exit. A decaying peak is a possible fix.
- Late buyers can still lose part of their money (see the demo run and the simulation).
- Testnet only. Not audited.

The full review notes are in `docs/progress.md`.

## Tools used

- Rust, near-sdk 5.30, near-contract-standards, cargo-near, near-workspaces, near-cli-rs
- Next.js 16, React 19, Tailwind CSS 4, TypeScript, GSAP, Lenis, Motion, React Three Fiber, three.js, NEAR Connect (`@hot-labs/near-connect`)
- SourceScan and NearBlocks for contract verification, Vercel for hosting, GitHub Actions for CI
- AI tools: Claude Code was used as a coding assistant during development.

## License

MIT, see [LICENSE](LICENSE).
