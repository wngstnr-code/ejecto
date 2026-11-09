# Decision log

Add a new entry whenever a decision changes the product, the architecture, or the plan. Never edit old entries. Add a new one that supersedes them.

| ID | Date | Decision | Reason |
|---|---|---|---|
| D-001 | 2026-11-09 | Build **Ejecto** for the Memecoins and Social tracks. Dropped Segel (DAO-approved release signing). | The Memecoins track had 5 entries and did not grow from Nov 5 to Nov 9. Segel faced npm staged publishing and GitHub immutable releases, its users rarely verify signatures, and its track fit was weak. Ejecto needs no backend, fits the 5-day window, and no refund-on-death memecoin mechanism was found. |
| D-002 | 2026-11-09 | Name: **Ejecto** (from the "ejecto seato" meme). | Chosen by the user. Catchy and uncommon. No crypto project with this name was found. An unrelated token "EJECT" exists. |
| D-003 | 2026-11-09 | Contracts in Rust with `near-sdk` 5.x, built with `cargo-near`. | Most mature NEAR toolchain, good test tooling (`near-workspaces`). |
| D-004 | 2026-11-09 | Linear bonding curve inside the coin contract, no external DEX. | The mechanic needs full control of the reserve and the ability to stop trading at EJECT. |
| D-005 | 2026-11-09 | Two protection layers: pro-rata reserve split at EJECT, plus the Ejecto Fund. | The simulation shows the pro-rata split alone removes all wipeouts (4.4% to 0%, even with the light preset). The fund adds 7% to 19% loss reduction. |
| D-006 | 2026-11-09 | The fund is split by **net basis x time held**, not by tokens or basis alone. | Under the attack test it punishes late whales the most (attacker loses 30.8% to 48.5%). It rewards loyalty and blocks fund farming. |
| D-007 | 2026-11-09 | Alive rule: age at least 14 days, and 14-day buys below max(1 NEAR, 5% of peak 14-day buys). | A fixed threshold treated big and small coins unfairly in the first simulation. The relative threshold made 100% of coins eject within 60 days (median day 28), matching real memecoin lifetimes. |
| D-008 | 2026-11-09 | Fee presets light, standard (default), high. Protocol fee 0.5% of buys. | Lets creators choose the trade-off between protection and trading cost. Standard (2% / 2%) is similar to popular launchpads. |
| D-009 | 2026-11-09 | A full exit forfeits weight. Transfers move basis but not weight. | Prevents buying loyalty from others and rewards staying. Keeps the accounting O(1). |
| D-010 | 2026-11-09 | Coin accounts are keyless with no admin methods. Protocol fees can only go to a fixed account. | Required by the Memecoins track ("No admin key"). Strongest trust signal. |
| D-011 | 2026-11-09 | Demo coins use a short `day_length_sec` (10 to 86399), locked at launch, with a visible DEMO TIME banner. | The full lifecycle (14 days minimum) must fit in a live demo without fake data. |
| D-012 | 2026-11-09 | Static web app: Vite + React + TypeScript on GitHub Pages, RPC reads only. | No backend rule. Simple hosting that judges can open. |
| D-013 | 2026-11-09 | Testnet only for the hackathon. | No audit, no legal review. Also the hackathon allows testnet-only entries for all tracks (rule Q-010). |
| D-014 | 2026-11-09 | SOS rescue is a stretch goal, built only after M4. | Helps the Social track fit, but the core mechanic and a working demo matter more. |
