# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log.

## Current status

| Item | Value |
|---|---|
| Phase | M3 done, M4 (web app) next |
| Overall | Contracts done and live on testnet: factory plus a verified full lifecycle of a real coin. 63 coin unit tests, 12 factory unit tests, 2 sandbox integration tests. |
| Deadline | 2026-11-14 23:59 UTC (2026-11-15 06:59 WIB) |
| Days left | 5 (as of 2026-11-09) |

## Next step (exact)

1. Start M4: `web/` with Vite + React + TypeScript. First check docs.near.org for the currently recommended wallet package (Wallet Selector or near-connect).
2. Pages: Home (coin list from `factory.ejecto.testnet`), Launch, Coin (engine meter, your seat, buy, sell, EJECT, claim, DEMO TIME banner), Simulation.
3. For the demo video, launch a fresh demo coin (about 2.68 NEAR). `ejecto.testnet` has about 5.6 NEAR, so a top-up helper may be needed (see `build-and-deploy.md`).
4. Before the deadline, ask the user to make the repo public (it is private now).

## Blockers and open questions

| Question | Owner | Status |
|---|---|---|
| More NEAR if M3 or M4 needs it (near-faucet.io still errors, use another faucet-service helper account with the user's OK) | user | open |
| When to make the GitHub repo public (must be public before the deadline) | user | open |
| Wallet package for the web app (Wallet Selector or near-connect) | dev, check docs before M4 | open |

## Milestone checklist

| Milestone | Status |
|---|---|
| M0 Setup | done |
| M1 Coin contract core | done |
| M2 Accounting, detector, EJECT, claim | done (parity check moved to M3) |
| M3 Factory and testnet | done |
| M4 Web app | not started |
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

## Known issues

| Severity | Issue | Plan |
|---|---|---|
| low | If the protocol account does not exist, `withdraw_protocol_fees` zeroes the counter and the failed transfer refunds the NEAR to the coin, where it is no longer tracked | The factory always sets a real account. Revisit after M3. |
| low | If an unexpected failure happens inside the launch batch, the refund comes from the factory's free balance, which is smaller than one launch deposit | Bad input is now rejected before the batch, so this needs an unexpected runtime failure. Keep at least one launch deposit of free balance on the factory before a public launch. |
| low | The factory keeps a full-access key and an owner during the hackathon (D-017) | Launched coins are unaffected. Lock or hand over before any mainnet use. |
| low | If an `ft_transfer_call` refund lands after the sender already claimed, those refunded tokens cannot be claimed (their share stays in the contract) | Very unlikely (needs EJECT and a claim between the call and its callback). Accept for the MVP. |

## Testnet deployments

| What | Account | Notes |
|---|---|---|
| Master, funder, factory owner | `ejecto.testnet` | Created by the faucet service. About 16.8 NEAR after a top-up on 2026-11-09 |
| Factory | `factory.ejecto.testnet` | Deployed 2026-11-09 (tx `6QeDtBpSimeVCi1vv4RMcWyG2DY2jQA9mYN4Vx41GNoJ`), code updated (tx `BtpTqJNzXRABe1gMDAhfJpmdvH9ykqLP7QFoib2MZkd2`). Coin code hash `2aeac3797b6065b74acebb19014419b755e039b657857d77b013c6d519d71398`, launch deposit 2.6709 NEAR |
| Verification coin (ejected) | `seato.factory.ejecto.testnet` | Launched (tx `CKQoSYdagkzE2rRt69MsqChDc3JMMP9MfPHNiB5Wnjxq`), 0 access keys, demo time 10 s per day. Ani 1, Budi 1.2, Cici 0.6 NEAR buys, Cici sold half. EJECT tx `BR59JVbnNF3zke6wc4c3aRoryFj1CQ7DxRxKxDV4f2Tu`. Claims: Ani 1.2769, Budi 1.0055, Cici 0.2080 NEAR, each equal to the holder view. 2 yocto dust left. |
| Top-up helper | `ejecto-topup1.testnet` | Created by the faucet service, sent 9.95 NEAR to the master, about 0.05 NEAR left |
| Factory (no code yet) | `factory.ejecto.testnet` | 1 NEAR |
| Protocol fees | `fees.ejecto.testnet` | 0.1 NEAR |
| Demo holders | `ani`, `budi`, `cici`, `whale` `.ejecto.testnet` | 0.5 NEAR each |

## Repository

| Item | Value |
|---|---|
| GitHub | https://github.com/wngstnr-code/ejecto (private for now) |
| Default branch | `main` |

## Session log

### 2026-11-09

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
