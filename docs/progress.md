# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log.

## Current status

| Item | Value |
|---|---|
| Phase | M0 done, M1 next |
| Overall | Research, simulation, docs, repo and testnet accounts are done. No contract code yet. |
| Deadline | 2026-11-14 23:59 UTC (2026-11-15 06:59 WIB) |
| Days left | 5 (as of 2026-11-09) |

## Next step (exact)

1. Start M1: scaffold `contracts/coin` (near-sdk 5.x) as described in `development-plan.md`.
2. Ask the user to top up `ejecto.testnet` at near-faucet.io before M3 (deployments need more NEAR).
4. Before the deadline, ask the user to make the repo public (it is private now).

## Blockers and open questions

| Question | Owner | Status |
|---|---|---|
| Top up `ejecto.testnet` to 20 to 30 NEAR before M3 | user | open |
| When to make the GitHub repo public (must be public before the deadline) | user | open |
| Wallet package for the web app (Wallet Selector or near-connect) | dev, check docs before M4 | open |

## Milestone checklist

| Milestone | Status |
|---|---|
| M0 Setup | done |
| M1 Coin contract core | not started |
| M2 Accounting, detector, EJECT, claim | not started |
| M3 Factory and testnet | not started |
| M4 Web app | not started |
| M5 Submission | not started |

## Testnet deployments

| What | Account | Notes |
|---|---|---|
| Master, funder, factory owner | `ejecto.testnet` | Created by the faucet service, 10 NEAR, now about 6.86 NEAR |
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

- Picked the idea **Ejecto** after dropping Segel (DAO-signed releases). The reason: track crowding and fit (see `decisions.md` D-001).
- Ran the 60-day simulation (500 runs x 400 traders). Key results are in `research.md`.
- Wrote the docs set. Moved the simulation to `sim/`, translated its labels to English, and added `scripts/check-dashes.mjs`.
- Removed obsolete files: the Indonesian research docs (replaced by English docs) and the Segel proof of concept.
- Moved all config to a single root `.env` (template `.env.example`).
- near-faucet.io rejected a fresh implicit account, so `ejecto.testnet` was created with the NEAR faucet service (10 NEAR), then the sub-accounts were created from it.
- Initialized git and created the private GitHub repo `wngstnr-code/ejecto`. Initial work pushed as split commits.
- Research PDFs in Indonesian are on the user's Desktop (`Ejecto-Riset-Mendalam.pdf`, `Segel-Riset-Mendalam.pdf`). They are outside the repo and are not part of the submission.
