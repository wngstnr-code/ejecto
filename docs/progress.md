# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log.

## Current status

| Item | Value |
|---|---|
| Phase | M0: Setup |
| Overall | Research, simulation and docs are done. No contract code yet. |
| Deadline | 2026-11-14 23:59 UTC (2026-11-15 06:59 WIB) |
| Days left | 5 (as of 2026-11-09) |

## Next step (exact)

1. Done: `cargo-near` 0.23.0 and `near-cli-rs` 0.31.1 are installed.
2. Wait for the user to fund `FUNDER_ACCOUNT` (in `.env`) with the faucet, about 30 NEAR.
3. Write and run `scripts/setup-accounts` to create `ejecto.testnet` and its sub-accounts (`build-and-deploy.md` section 2).
4. Start M1: scaffold `contracts/coin`.
4. Before the deadline, ask the user to make the repo public (it is private now).

## Blockers and open questions

| Question | Owner | Status |
|---|---|---|
| Funder account funded with the faucet | user | open |
| When to make the GitHub repo public (must be public before the deadline) | user | open |
| Wallet package for the web app (Wallet Selector or near-connect) | dev, check docs before M4 | open |

## Milestone checklist

| Milestone | Status |
|---|---|
| M0 Setup | in progress |
| M1 Coin contract core | not started |
| M2 Accounting, detector, EJECT, claim | not started |
| M3 Factory and testnet | not started |
| M4 Web app | not started |
| M5 Submission | not started |

## Testnet deployments

| What | Account | Notes |
|---|---|---|
| Funder (implicit) | see `FUNDER_ACCOUNT` in `.env` | Keypair in the local keychain, waiting for faucet funds |
| Master | `ejecto.testnet` | Not created yet |

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
- Generated the funder keypair and moved all config to a single root `.env` (template `.env.example`).
- Initialized git and created the private GitHub repo `wngstnr-code/ejecto`. Initial work pushed as split commits.
- Research PDFs in Indonesian are on the user's Desktop (`Ejecto-Riset-Mendalam.pdf`, `Segel-Riset-Mendalam.pdf`). They are outside the repo and are not part of the submission.
