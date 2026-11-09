# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log.

## Current status

| Item | Value |
|---|---|
| Phase | M2 done (parity check moved to M3), M3 next |
| Overall | Coin contract feature complete for the MVP: token, curve, fees, fund, accounting, detector, EJECT, claim. 60 unit tests, wasm 237 KB. |
| Deadline | 2026-11-14 23:59 UTC (2026-11-15 06:59 WIB) |
| Days left | 5 (as of 2026-11-09) |

## Next step (exact)

1. Start M3: `contracts/factory` (keyless `create_coin`, registry views, refunds), then a `near-workspaces` integration test (launch, keyless check, init twice rejected, full lifecycle with a short day length, gas measurement).
2. M3 also: parity check sim vs contract on one fixed scenario, and a contract-level wash trading test.
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
| M3 Factory and testnet | not started |
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

## Known issues

| Severity | Issue | Plan |
|---|---|---|
| low | If the protocol account does not exist, `withdraw_protocol_fees` zeroes the counter and the failed transfer refunds the NEAR to the coin, where it is no longer tracked | The factory always sets a real account. Revisit after M3. |
| low | Gas of `buy`, `sell`, `eject` and `claim` is not measured yet | Measure in the M3 integration test. |
| low | If an `ft_transfer_call` refund lands after the sender already claimed, those refunded tokens cannot be claimed (their share stays in the contract) | Very unlikely (needs EJECT and a claim between the call and its callback). Accept for the MVP. |

## Testnet deployments

| What | Account | Notes |
|---|---|---|
| Master, funder, factory owner | `ejecto.testnet` | Created by the faucet service. About 16.8 NEAR after a top-up on 2026-11-09 |
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
