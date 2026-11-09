# Ejecto development plan

The deadline is **2026-11-14 23:59 UTC** (2026-11-15 06:59 WIB). Every milestone has acceptance criteria. Track status in `progress.md`, not here.

## Milestones

### M0: Setup (2026-11-09)

- [x] Research and idea selection (see `research.md`, `decisions.md`)
- [x] 60-day simulation (`sim/ejecto-sim.mjs`)
- [x] Docs
- [ ] Install `cargo-near` and `near-cli-rs` (see `build-and-deploy.md`)
- [ ] User: create and fund testnet accounts (factory, protocol, 3 demo holders)
- [x] `git init` and private GitHub repo `wngstnr-code/ejecto` (make it public before the deadline)

Done when: `cargo near --version` and `near --version` work, and the accounts exist.

### M1: Coin contract core (2026-11-10)

- [ ] `contracts/coin` crate scaffold (near-sdk 5.x)
- [ ] NEP-141 + NEP-145 + NEP-148 metadata
- [ ] Curve math with 256-bit intermediates: `R(s)`, buy solve, sell
- [ ] Fees and fee presets, Ejecto Fund, protocol fees, rounding dust
- [ ] `buy`, `sell`, `quote_buy`, `quote_sell`, `status`
- [ ] Unit tests: math round trips, fee splits, rounding favors the contract, invariant 1 and 2

Done when: `cargo test` passes and buying then selling everything returns the reserve to 0 with no loss to the contract.

### M2: Accounting, detector, EJECT, claim (2026-11-11)

- [ ] Holder accounting: basis, weight, `S_pos`, `W`, `touch`, full exit forfeits weight
- [ ] Transfer rule (basis moves, weight stays)
- [ ] 14-bucket alive detector, peak window, threshold
- [ ] `eject`, `claim`, `withdraw_protocol_fees`, `holder` view
- [ ] Events (NEP-297)
- [ ] Unit tests: invariants 3 to 6, attack scenarios (late whale, wash, sybil, transfer), claim sums
- [ ] Parity check against the sim on one fixed scenario

Done when: all tests pass, and the claim payouts in the spec example (Ani, Budi, Cici in `research.md`) are reproduced in a test.

### M3: Factory and testnet (2026-11-12)

- [ ] `contracts/factory`: `set_coin_code`, `create_coin` (keyless sub-account), registry views, refunds on failure
- [ ] `near-workspaces` integration test: launch, keyless check, full lifecycle with a short day length
- [ ] Deploy the factory to testnet, upload the coin code
- [ ] Launch one real demo coin on testnet, buy from 3 accounts

Done when: a coin launched on testnet has zero access keys (visible in an explorer) and buy, sell, EJECT and claim work with real transactions.

### M4: Web app (2026-11-13)

- [ ] Vite + React + TS scaffold, wallet connection, RPC views
- [ ] Home, Launch, Coin pages (engine meter, your seat, EJECT, claim, DEMO TIME banner)
- [ ] Simulation page (static JSON and SVG from `sim/`)
- [ ] Deploy to GitHub Pages

Done when: a judge can open the hosted page, connect a testnet wallet, and run the full demo flow.

### M5: Submission (2026-11-14, before 23:59 UTC)

- [ ] `README.md` with "do X, see Y" steps for the hosted demo, local run, tests and simulation
- [ ] List libraries and AI-generated code in the README (rule Q-005)
- [ ] LICENSE (MIT)
- [ ] Demo video (about 3 minutes, follow the script in `hackathon.md`)
- [ ] X post: says it was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon, includes the video. Posted by the user.
- [ ] Submission form at nearhackathon.com/#apply (tracks: memecoins, social). Submitted by the user.
- [ ] Final check: `node scripts/check-dashes.mjs`, all tests pass, hosted demo works

## Stretch goals (only after M4 works)

| Priority | Item | Why |
|---|---|---|
| 1 | SOS rescue (spec section 10) | Strengthens the Social track fit |
| 2 | "Coin graveyard" page (ejected coins and how much was rescued) | Strong demo and social proof |
| 3 | Buy from other chains through NEAR Intents 1Click | Shows chain abstraction |
| 4 | Global contracts to cut the launch deposit | Cost optimization |

## Cut lines (if we fall behind)

Drop in this order:

1. Stretch goals
2. Simulation page in the web app (link the JSON and SVG from the README instead)
3. Factory: deploy one coin contract directly to a keyless account (delete its key after deploy) and show that in the demo
4. Launch page (pre-launch the demo coin from the CLI)

Never cut: keyless coin, EJECT and claim with real testnet transactions, README steps, demo video.
