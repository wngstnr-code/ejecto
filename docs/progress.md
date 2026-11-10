# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log.

## Current status

| Item | Value |
|---|---|
| Phase | M4 (web app) in progress: landing and app pages built, signed-transaction test next |
| Overall | Contracts reviewed (M1 to M3), fixed and live on testnet. 71 coin unit tests, 15 factory unit tests, 3 sandbox integration tests. Landing and app pages (`/coins/`, `/launch/`, `/coin/?id=`) built in `web/` (Next.js 16 static export), wallet via NEAR Connect. |
| Deadline | 2026-11-14 23:59 UTC (2026-11-15 06:59 WIB) |
| Days left | 4.5 (as of 2026-11-10) |

## Next step (exact)

1. Done for buy, EJECT and claim (see the session log). Launch from the `/launch/` form also done (`wngst`). Still to try: sell. For the demo video use a fresh coin and buy more than 1 NEAR in total within the first 140 s (10 s days), or use longer demo days, so the coin is alive before it dies.
2. Check the app pages and the landing at phone width.
3. Deploy to GitHub Pages with `NEXT_PUBLIC_BASE_PATH=/ejecto`, then repeat a quick smoke test on the hosted site.
4. M5: README with "do X, see Y" steps, MIT LICENSE, demo video, then ask the user to make the repo public.

## Blockers and open questions

| Question | Owner | Status |
|---|---|---|
| More NEAR if M3 or M4 needs it (near-faucet.io still errors, use another faucet-service helper account with the user's OK) | user | open |
| When to make the GitHub repo public (must be public before the deadline) | user | open |
| Wallet package for the web app | dev | closed: NEAR Connect (D-027) |
| Contract verification on NearBlocks | dev | closed: factory and `seat` verified (D-029) |
| Source and license of both pilot GLBs, `ejecto-pilot.glb` and `ejecto-pilot-wave.glb` (needed for the README credits) | user | open |

## Milestone checklist

| Milestone | Status |
|---|---|
| M0 Setup | done |
| M1 Coin contract core | done |
| M2 Accounting, detector, EJECT, claim | done (parity check moved to M3) |
| M3 Factory and testnet | done |
| M4 Web app | in progress (landing done) |
| M5 Submission | not started |

## Review notes

### M1 deep review (2026-11-09)

| Finding | Fix |
|---|---|
| A buy that hits the supply cap would send the leftover NEAR to the fund as "dust" | Now rejected with "Buy would exceed the supply cap". Test added. |
| `isqrt` started Newton from `n`, up to ~250 U512 divisions for large inputs | Start from `2^ceil(bits/2)`. Test for huge values added. |
| Forced `storage_unregister` would burn tokens and break `reserve == R(supply)` | Forced unregister rejected. Test added. |
| `ft_transfer_call` refund could burn tokens if the sender left | Resolve panics instead, receiver keeps the tokens. Documented in the spec. |
| A unit test (`init_twice`) only tested a helper, not real near-sdk behavior | Removed. Real check moves to the M3 integration test. |

### M2 deep review (2026-11-09)

| Finding | Fix |
|---|---|
| `moved_basis` used `saturating_mul` on basis x amount (about 10^25 x 10^26), which overflowed u128 and silently moved almost no basis on transfers | Now computed in 512 bits. Test with realistic magnitudes added. |
| Unit tests that create two coins shared mocked storage, so the second coin read the first coin's holders (also a latent issue in the M1 fee preset test) | Such scenarios now run in a fresh thread (`fresh` helper) |
| Late whale and sybil attacks | Contract tests confirm: whale loses at least 20%, sybil split changes nothing |
| Anyone can keep a coin alive by buying at least the threshold every 14 days | By design: those buys pay fees into the fund for the holders, and holders can still sell any time |

### M3 deep review (2026-11-09)

| Finding | Fix |
|---|---|
| The factory did not validate name, icon and day length, so bad input failed inside the async batch and the refund relied on the factory's free balance (about 0.9 NEAR versus a 2.67 NEAR deposit) | Validated synchronously now (D-016). Three unit tests added. Redeployed and checked live: an empty name is rejected at once. |
| Promises were dropped with `let _ =` | Replaced with near-sdk `.detach()`, which states the intent. |
| Pro-rata reserve split favors early buyers (sandbox: 5 NEAR in, 7.52 out; 8 NEAR in, 6.03 out) | Not a bug, it is how bonding curves work. Documented in `research.md` section 6 and the demo script. |

### M1 to M3 full review (2026-11-09)

Checks: `cargo fmt --check`, `cargo clippy -- -D warnings`, all tests, rebuilt wasm hash equals the deployed hash, spec read side by side with the code, a code review of `contracts/` (10 findings), and attack thinking.

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | A refunded `ft_transfer_call` moved basis pro-rata from the receiver's whole holding, so a sender could drain any registered holder's basis | high | Accounting booked in `ft_resolve_transfer`, only for the used part, from the sender's own basis (D-019). Test `refund_cannot_drain_a_victims_basis`. |
| 2 | A refund after EJECT could leave a receiver with weight but zero balance, stranding its fund share | medium | Fixed by #1: in-flight tokens never give the receiver basis. Test asserts zero receiver weight. |
| 3 | Keeping 1 raw token (or sending to a sybil and selling there) kept all accrued weight | high | Weight is tied to tokens, `Ledger::shed` on sell and transfer (D-018). Tests `keeping_dust_does_not_keep_the_weight`, `sending_tokens_away_sheds_weight`. |
| 4 | Failed-launch refund paid from the factory's free balance, and the success branch could refund a spent deposit | medium | Pull-based pending refunds, success never refunds (D-021). |
| 5 | Deposit above the minimum was locked forever in the keyless coin | high | Exactly `launch_deposit` goes to the coin, the excess is refunded at once (D-021). Unit and sandbox tests. |
| 6 | Coin init accepted any ancestor account, not only the direct parent | low | Exact parent check. Test `init_by_grandparent_panics`. |
| 7 | Tokens refunded after a claim were unclaimable | low | Repeat claims: reserve part for the current balance, fund part once (D-020). Test `claim_again_after_a_late_refund`. |
| 8 | Factory launch limits duplicated as magic numbers | low | Named constants that must match the coin, plus a boundary test (9, 10, 86400, 86401). |
| 9 | Global contracts would cut the launch deposit | info | Stays a stretch goal. |
| 10 | Duplicate age check, `age_days` equal to `day` | low | Single age check in `eject`, `age_days` removed from `status`. |
| 11 | Unit test gap: the `ft_transfer_call` refund path was never tested | medium | Tests with a mocked promise result (`resolve_with_unused`). |
| 12 | Peak inflation griefing (found while thinking like an attacker) | medium | Not fixed, see Known issues. |

## Known issues

| Severity | Issue | Plan |
|---|---|---|
| low | If the protocol account does not exist, `withdraw_protocol_fees` zeroes the counter and the failed transfer refunds the NEAR to the coin, where it is no longer tracked | The factory always sets a real account. Revisit after M3. |
| low | The factory keeps a full-access key and an owner during the hackathon (D-017) | Launched coins are unaffected. Lock or hand over before any mainnet use. |
| medium | Peak inflation griefing: a big buy followed by a sell raises `peak_window`, so 14 days later a still-active coin can fall below 5% of the fake peak and be ejected | Costly (about 4% of the fake peak, most of it paid into the fund) and nobody can steal anything, since holders get a fair pro-rata exit. Possible later fix: let the peak decay over time. |
| low | Landing and app pages not yet checked on phone widths. The 3D layer has narrow-screen poses but no real-device test | Check before recording the demo. |
| low | Sell has not run with a signed transaction from the web app yet. Launch, buy (with `storage_deposit` in the same tx), EJECT and claim did on 2026-11-10 | Try it during the demo rehearsal. |
| low | Wallets that redirect instead of using a popup reload the page, so the in-page success message is lost (the data still refreshes from chain) | Acceptable for the demo. Meteor and Intear use popups. |
| low | `web/public/mascot/ejecto-pilot.glb` and `ejecto-pilot-wave.glb` are 2.4 MB each, most of it one PNG texture | Fine for the demo. Could convert the textures to WebP to cut them about in half. |
| low | The waving model has no rig, so the wave is a vertex shader on one fused mesh. The glove touches the helmet in the source pose, so the arm keeps a small outward lean | Looks clean at the greeting size. A rigged model would allow a real wave. |
| low | If a sender's `ft_transfer_call` is still in flight at EJECT and the receiver keeps the tokens, the sender keeps the matching weight without the tokens, so that small fund share stays unclaimed | Needs a transfer call to cross the EJECT moment. Accept for the MVP. |

## Testnet deployments

| What | Account | Notes |
|---|---|---|
| Master, funder, factory owner | `ejecto.testnet` | Created by the faucet service. About 16.8 NEAR after a top-up on 2026-11-09 |
| Factory (current, verified) | `factory.ejecto.testnet` | Rebuilt on 2026-11-10 (D-029): state cleared with a temporary cleaner contract (the protocol refuses to delete an account with large state), then the reproducible factory wasm (sha256 `da54dffeeed5510624bfe6c61f9cbc0499681eaaa2c1e84fee1b9d8b46ee7d20`, deploy tx in the account history on NearBlocks) with `new` (owner `ejecto.testnet`, protocol `fees.ejecto.testnet`) and the reproducible coin wasm (sha256 `4069f17ff98bc10c1d9b8f06a56af04199eef50755efa0936c5b22d262e391ae`, 236,737 bytes). Launch deposit 2.66737 NEAR. Both source verified on NearBlocks (SourceScan, commit `7cedbe5`). |
| Factory (history) | `factory.ejecto.testnet` | Deployed 2026-11-09 (tx `6QeDtBpSimeVCi1vv4RMcWyG2DY2jQA9mYN4Vx41GNoJ`). After the M1 to M3 review: new code plus state migration in one tx (`A6LbEoVXFSGfFXAzzX4XdVxJEVHnoVns2HR8Ho2W6zfL`), new coin code (tx `GSazAdDCWLoDkmnZVqrveSaT8KZrB3sBMmP7EDJwQ2pr`, hash `a0e2734e0cf30904b027069f8406b771b8e4bf5f0b8945dd054b960ca6f57cf7`, 237,148 bytes). Launch deposit 2.6715 NEAR. Registry kept `seato` until the rebuild on 2026-11-10. |
| Demo coin Seato ($SEAT) | `seat.factory.ejecto.testnet` | Launched 2026-11-10 by `founder.ejecto.testnet` (tx `EmfZJLE1hHL2aokCcWwhjJzqrHh65okYJ6rk21siQDtH`), icon `web/public/brand/seat-coin.svg`, demo time 10 s per day, 0 access keys, source verified on NearBlocks. Alive line floor is 1 NEAR, so with smaller buys it is ejectable right after day 14. |
| Real-days coin Wangsit ($WNGST) | `wngst.factory.ejecto.testnet` | Launched 2026-11-10 from the `/launch/` form by `founder.ejecto.testnet` (tx `FmYjG6CGwryhYPckiwfQzHXcooHzvZ2iUrNJzs6GKZWF`), 24 h days, uploaded icon (WebP), 0 access keys, source verified (same code hash as `seat`). EJECT possible from about 2026-11-24. |
| Verification coin (ejected, old code, no longer listed) | `seato.factory.ejecto.testnet` | Runs the coin code from before the review fixes. Harmless: it is ejected, so trading and transfers are closed. Launched (tx `CKQoSYdagkzE2rRt69MsqChDc3JMMP9MfPHNiB5Wnjxq`), 0 access keys, demo time 10 s per day. Ani 1, Budi 1.2, Cici 0.6 NEAR buys, Cici sold half. EJECT tx `BR59JVbnNF3zke6wc4c3aRoryFj1CQ7DxRxKxDV4f2Tu`. Claims: Ani 1.2769, Budi 1.0055, Cici 0.2080 NEAR, each equal to the holder view. 2 yocto dust left. |
| Top-up helper | `ejecto-topup1.testnet` | Created by the faucet service, sent 9.95 NEAR to the master, about 0.05 NEAR left |
| Top-up helper 2 | `ejecto-topup2.testnet` | Created by the faucet service on 2026-11-10 (user approved), sent 9.95 NEAR to `founder.ejecto.testnet` (tx `UdDj19X7LAyc4ToZYEH3rAFJocAkjbMd8k2RbTW7CJk`) |
| Factory (no code yet) | `factory.ejecto.testnet` | 1 NEAR |
| Protocol fees | `fees.ejecto.testnet` | 0.1 NEAR |
| Demo holders | `ani`, `budi`, `cici`, `whale` `.ejecto.testnet` | 0.5 NEAR each |
| Founder (the user's own wallet for the web app) | `founder.ejecto.testnet` | 3.5 NEAR from `ejecto.testnet` on 2026-11-10, full-access key in the local legacy keychain |

## Repository

| Item | Value |
|---|---|
| GitHub | https://github.com/wngstnr-code/ejecto (private for now) |
| Default branch | `main` |

## Session log

### 2026-11-10

- M4 started. Scaffolded `web/` with Next.js 16.4.5, Tailwind 4, TypeScript, static export, root `.env` via `@next/env`, `agentRules: false` (stops Next from writing an `AGENTS.md` full of em dashes).
- Built the landing page section by section with the user: preloader, hero with a marquee wordmark, typewriter problem statement, pinned crash chart with a stage timeline, pinned "How it works" card stack, "The math" ledger with hover wipes and striped bars, "Safeguards" spec board with live chain reads, centered final call to action, footer with a hover wordmark, custom scrollbar, heavy Lenis scroll.
- Added the 3D pilot layer (D-024): scroll choreography, ejection up and left, parachute rigging, zig-zag drifts with banking and a pendulum roll, drag to spin, leg swing and head shake in a vertex shader.
- `sim/ejecto-sim.mjs` now also writes `example-series.json` (14-day buys, alive line, per-coin loss totals). Results unchanged.
- Checked every section in the browser at desktop width. Typecheck, lint and the dash check pass.
- Logo: helmet mark chosen from generated concepts, used for the header, favicon, apple icon and OG image (static files in `web/public/brand`).
- Loading screen: real load progress bar in the center, then the 3D waving pilot (`ejecto-pilot-wave.glb`) pops up and says hi above the screen, turns once while gliding into the hero, and swaps to the main model at the back view. Extra front light during the intro. The hand wave stays clear of the visor.
- Fixed: the pilot spun wildly after returning to a hidden tab (frame step now capped at 1/30 s).
- App pages (D-028): wallet with NEAR Connect (D-027), app header with wallet menu, `/coins/` live list with filters, `/launch/` form with live symbol check and in-browser icon shrink to 2 KB, `/coin/?id=` with engine meter, bonding curve, buy and sell with contract quotes (first buy batches `storage_deposit` + `buy`), your seat, EJECT handle, claim panel, eject record. 3D EJECT scene after a successful EJECT. Folded app footer.
- Shared pilot parts moved to `web/components/pilot/parts.tsx`.
- Coin icons are round. Coins without an on-chain icon (like `seato`, whose metadata is locked) get a generated coin (reeded rim, tone fixed per symbol). The bonding curve is hoverable: price, market cap, reserve, change against now, and the NEAR needed to move the price there. The `/coins/` list is a table card with filter dropdowns, sorting and a full view. The header wallet pill shows the connected wallet's logo. The GitHub link left both headers (it stays in the footer).
- Repo made public with the user's approval. Contracts verified on NearBlocks: reproducible Docker builds (SourceScan image pinned by digest, D-029), factory state cleared and redeployed, Seato ($SEAT) launched with a generated coin logo. Landing safeguards use an animated broadcast icon for live reads. The landing always starts at the top for the intro.
- End-to-end on testnet with the user's NEAR CLI wallet on `seat`: buy 0.01 NEAR from the coin page (`storage_deposit` + `buy` in one tx, `Dj3Uizqn3CqQZtNgPW339vfWjmvvUrPtc3ybKTMHpAyG`), EJECT (`GqdoULbw6mWEMd7Tbh26LFzKsqdaUU6ngHHMNP5SagES`), claim 0.00995 NEAR = reserve 0.0098 + fund 0.00015 (`26zjMv26FQVG1UtVKx2cbXsLVKFQUPMdCKDmZ9JmkuZb`). NEAR CLI wallet note: when a command runs without a terminal (for example through `!`), append `send`.
- Status badges and the access key line use icons instead of dots (hourglass, heartbeat, sinking arrow, eject, parachute, padlock). Tiny prices show a readable zero count subscript with the full value on hover. Ejected coins show the price at EJECT.
- While ejectable, the coin page keeps the trade panel under the EJECT handle (buys still work and can revive the coin). The ejectable badge uses an animated eject icon.
- Created `founder.ejecto.testnet` (3.5 NEAR) as the user's own wallet; `sign-with-keychain` falls back to the legacy keychain, so NEAR CLI wallet commands work unchanged.
- Web RPC default switched to FastNEAR testnet (about 10x faster view calls).
- Checked in the browser at desktop width with real testnet data (`seato`, ejected): coin page, coins list, launch form validation, wallet modal opens. Static build passes.

### 2026-11-09

- Full review of M1 to M3: 12 findings, 3 high (refund basis drain, dust keeps weight, excess launch deposit locked). All fixed except peak inflation griefing (known issue). Factory redeployed with a state migration, new coin code uploaded.
- M3 done: factory contract (keyless launch, registry, refunds, synchronous argument checks), sandbox integration tests with gas numbers, parity and wash tests, factory deployed to testnet, real coin `$SEATO` launched, traded, ejected and claimed on testnet.
- M2 done: holder accounting, transfer and refund hooks, alive detector, EJECT, claim, `holder` view, events. 60 unit tests. Found and fixed a u128 overflow in `moved_basis` and a test isolation problem.
- M1 done: `contracts/` Cargo workspace, `ejecto-coin` crate (curve, token, fees, fund, protocol fees, quotes, status), 34 unit tests, clippy clean, wasm 211 KB via `cargo near build`.
- Rewrote git history to remove all traces of the local assistant file, force pushed while the repo is private.
- Picked the idea **Ejecto** after dropping Segel (DAO-signed releases). The reason: track crowding and fit (see `decisions.md` D-001).
- Ran the 60-day simulation (500 runs x 400 traders). Key results are in `research.md`.
- Wrote the docs set. Moved the simulation to `sim/`, translated its labels to English, and added `scripts/check-dashes.mjs`.
- Removed obsolete files: the Indonesian research docs (replaced by English docs) and the Segel proof of concept.
- Moved all config to a single root `.env` (template `.env.example`).
- near-faucet.io rejected a fresh implicit account, so `ejecto.testnet` was created with the NEAR faucet service (10 NEAR), then the sub-accounts were created from it.
- Initialized git and created the private GitHub repo `wngstnr-code/ejecto`. Initial work pushed as split commits.
- Research PDFs in Indonesian are on the user's Desktop (`Ejecto-Riset-Mendalam.pdf`, `Segel-Riset-Mendalam.pdf`). They are outside the repo and are not part of the submission.
