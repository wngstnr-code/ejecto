# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log.

## Current status

| Item | Value |
|---|---|
| Phase | Done and frozen: factory keyless, final demo video posted on X (https://x.com/Dudung_gg/status/2120827304754766145), competitors rechecked. Next: the user submits the form |
| Overall | Review of stages 1 to 4 found a fund drain in the v2 Mayday (co-invest); fixed in coin code v3 (locked-time pledge weight). 100 coin unit tests, 18 factory unit tests, 5 sandbox tests. Chain check covers all three factories. |
| Deadline | 2026-11-14 23:59 UTC (2026-11-15 06:59 WIB) |
| Days left | 3.5 (as of 2026-11-11) |

## Next step (exact)

0. Done: final demo video (`video/out/ejecto-final.mp4`, local only, all new footage of `moon.fleet.ejecto.testnet`), factory frozen (tx `8ETkUY26JiNWuMGSGryVpYdmMfVDediafFxCTt8rDETo`) and its only key deleted, `verify-chain` checks both. Final video posted by the user on X: https://x.com/Dudung_gg/status/2120827304754766145 (2026-11-12; it says "Built at NEAR HACKATHON", as rule 03 asks). README demo link and demo run table point to it. Competitors rechecked on 2026-11-11. Next: the user submits by 2026-11-14 23:59 UTC with this demo post link. Vercel has no env vars: the web uses the `FACTORY_ID` default in `web/lib/config.ts`.
1. Done for buy, EJECT and claim (see the session log). Launch from the `/launch/` form (`wngst`) and sell (`2hVG73vDZ8XEkZTEYxJKqt6Y7XeAnegwGnAoBG5cykP2`, 2% fund fee on the gross) also done. Every flow has now run on testnet. For the demo video use a fresh coin and buy more than 1 NEAR in total within the first 140 s (10 s days), or use longer demo days, so the coin is alive before it dies.
2. Check the app pages and the landing at phone width.
3. Done: live at https://ejecto.vercel.app (Vercel, D-031). Check the CI run on GitHub after each push.
4. M5: README with "do X, see Y" steps, MIT LICENSE, demo video, then ask the user to make the repo public.

## Blockers and open questions

| Question | Owner | Status |
|---|---|---|
| More NEAR if M3 or M4 needs it (near-faucet.io still errors, use another faucet-service helper account with the user's OK) | user | open |
| When to make the GitHub repo public (must be public before the deadline) | user | closed: public |
| Wallet package for the web app | dev | closed: NEAR Connect (D-027) |
| Contract verification on NearBlocks | dev | closed: factory and `seat` verified (D-029) |
| Source and license of both pilot GLBs, `ejecto-pilot.glb` and `ejecto-pilot-wave.glb` | user | closed: made by the user, no credit line needed |

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

## Competitor review (2026-11-10)

- 468 public submissions (nearhackathon.com API); Memecoins With Mechanics has 28, the fewest of all tracks; Social Money has 44.
- Closest: LIFO (pays the newest buyers first in a crash, uses a server Worker for demo signing and settle), Tripwire (keyless rug-proof launchpad). No other entry ends a dead coin with a pro-rata snapshot plus a loyalty fund.
- Gaps closed: on-chain log on the coin page (D-032); README "For judges" table, track prompt answers, sybil section tied to tests, "How Ejecto differs".
- Added a keyless chain check (`node scripts/verify-chain.mjs`, all 26 checks pass on testnet) with a 6-hourly workflow, and simulation charts in the README (D-033). Peak fix: simulated a net-buys peak first (`sim/peak-rule-experiment.mjs`) and rejected it on the data (D-034); no contract change. README has the experiment and its tables.
- Judge review (neutral pass over the 28 memecoin entries): contender for the top 3 with LIFO and MIRA, weakest on prompt fit, felt impact and Social Money fit. Response: memecoins track only, three Jury Seat coins ready to EJECT, impact led by the holders at death (`sim/at-death.mjs`, chart row added), D-036. Testnet faucet down; about 5 NEAR left across our accounts after the launches.
- Mayday v2 (D-038, supersedes D-037): stage 1 done (spec section 10 rewritten as the full design with fund co-invest and no lock; `sim/mayday-experiment.mjs` passes the broad gate). Stage 2 done: coin code v2 (`mayday`, `pledge`, `collect`, `withdraw_pledge`, `get_round`, escrow held by the coin account, transfers to the coin and unregister with a pledge refused, `status` and `holder` extended, events 1.1.0) with 20 new unit tests (91 in total, including 600 random steps that check every invariant with Maydays); factory v2 with `freeze()` (18 unit tests); sandbox 5 tests (Mayday with 10 pledgers: open 2.3 Tgas, last pledge plus rescue 3.5 Tgas). Coin wasm 264 KB. A view bug found by the random test (`can_mayday` true for an expired, unclosed Mayday) was fixed. Next: stage 3, deploy `coins.ejecto.testnet`, reproducible build and verification, new coins, freeze. README edits (TL;DR, jury seats, Mayday table) are held back until stage 5.
- Crew board (holders ranked by loyalty, live from `holder`) and "Share my seat" / "Share my parachute" X intents on the coin page and My seats; README gains a Social Money section (D-035). meme.cooking: read its docs (deposit countdown, then a Ref pool locked 69 years, launchpad contract closed source); a real integration would need a new contract and pool data from outside the coin, so it stays out of scope; the README explains how the two fit together (birth and death of a memecoin) and names an Ejecto seat for AMM tokens as future work.

## Competitor recheck (2026-11-11, evening)

- 540 public submissions (API, paginated: `?page=N`, 8 per page); Memecoins With Mechanics now has 37 (was 28), still the smallest track. Ejecto is not listed yet (the user submits).
- Still no other entry ends a dead coin with a pro-rata snapshot, a loyalty fund and a crew rescue. LIFO (newest buyers paid first in a crash) stays the closest idea, the opposite answer to the same exit race.
- New entries worth watching: THE PIT (launchpad, each coin trades against its own reserve, fees fund an AI budget, keyless factory, NEAR Global Contracts bring launch cost to about 0.12 NEAR), KEYFALL (game coin, live on mainnet, ML-DSA-65 keys, NEAR Intents top-ups, 85 likes and 1,370 views), Feral (AI creature swarm, Chain Signatures), STAG (lock together: +10% minted or -5% burned), Ethics Keyless Trust (raise a launch together, keyless vaults), Meme Wars, Slay the Bear, Anyone Can Rug.
- Where they beat us: reach (our final post had 7 views at check time), launch cost (2.95 NEAR per coin against about 0.12 NEAR with Global Contracts), mainnet presence (KEYFALL). The coin code is frozen, so launch cost stays; it is already stated in the README. Testnet only by our rules.
- No change to the submission content.

## Review notes (2026-11-11, stages 1 to 4 deep review and coin v3)

| Finding | Fix |
|---|---|
| High: the v2 fund co-invest let a lone rescuer pledge, collect and sell for a profit paid by the fund (+2.44 NEAR on a 7 NEAR fund, repeatable). Confirmed by a unit test; the model missed it (small funds) | Coin code v3 (D-039): the fund spends nothing at a rescue; pledges earn weight for the time they were locked. Test `rescue_and_dump_loses_money_with_a_large_fund` |
| High: a pledge above the target was spent in full (inflated the peak and the co-invest) | Pledges are filled up to the target, the rest is sent back in the same call |
| Design (second review): a flat 7-day bonus rewarded an instant solo rescue with nothing locked | Weight from locked time only (`sc * t_rescue - tw`); an instant solo rescue earns nothing |
| A gap under 0.001 NEAR could leave a dust pledge | Such a gap counts as reached |
| `collect` reverted on a dust pledge; `withdraw_pledge` panicked on a rescued round | `collect` clears the pledge; `withdraw_pledge` collects |
| Rounds never deleted; `mayday()` returned a stale round; the cooldown view counted an open Mayday | Settled rounds deleted; `mayday()` returns `Option`; cooldown only after a failure |
| `rescue` duplicated the buy booking; the holder view could promise more weight than `settle` moves | Shared `apply_buy`; the view caps at the escrow weight like `settle` |
| Residual: whoever sends the completing pledge can sandwich it | Documented in spec section 10; bounded by the 3x target cap and 4% round-trip fees |
| v3 holder entries are 32 bytes larger, so `storage_deposit` needs more (0.00327 NEAR) | The web and scripts read `storage_balance_bounds`; nothing is hardcoded |

All else held: 100 + 18 unit tests, 5 sandbox tests, the default simulation output is byte-identical to before stage 1, every coin on all three factories is keyless with the verified code and an exact reserve.

## Review notes (2026-11-11, stage 4 web)

Deep review of the stage 4 web diff (build, spec section 10 next to the UI, code review, docs).

| Finding | Fix |
|---|---|
| UI let a pledge under 0.001 NEAR or a second open pledge (earlier failed one not withdrawn) reach the wallet, where the contract refuses it | Both checked in the panels, with a message pointing to the pledge card |
| Spec named `mayday_open_after_day` and missed `pledges_held` | Spec now matches the contract (`mayday_open_after_ts`, `pledges_held`) |
| `architecture.md` had no Mayday at all (stale since stage 2) | Updated: state, methods, escrow, events, gas, factory `freeze()`, coin page, security rows, tests |
| Opening pledge input could not be cleared | Input state is null for "the minimum", reset when the target changes |
| Collects that run inside `ft_transfer` were not read | `ft_transfer` and `ft_transfer_call` added to the history methods |
| Rescue trade used a fake account name in an explorer link | Booked under the account whose pledge completed the rescue |
| No hint during the 7-day cooldown, and the engine text offered a Mayday that could not be called | Cooldown card with a countdown; engine text checks `can_mayday` |
| Fund co-invest preview ignored the rescue's own fund fee and an overshooting last pledge | Same order as the contract: fee first, then `min(25% pledged, 50% fund)` |
| Rescuer streaks started at the pledge, and uncollected rescuers had none | Streaks start at the rescue for every pledger of that round |
| Badge stayed "Mayday" up to one poll after the deadline | The panel refreshes the status when the deadline passes |
| Dead `getRound` view helper | Removed |
| Accepted: history loads twice per change (second load 8 s later for NearBlocks lag) | At most 10 NearBlocks calls per change; kept for correctness, watch for HTTP 429 |

## Review notes (2026-11-10, pre-submission)

- Phone check at 390 px (Playwright, every page): the live landing scrolled sideways by 58 px (hero title too wide). Fixed: hero, Safeguards and The Math headings scale with the viewport, the crash readouts use a 2x2 grid, the crash stage text shows only the active stage, the 3D pilot shrinks away after the hero on phones so it never covers text, the Coins table becomes a two-column list (price and fund under the name), the demo banner is shortened. No horizontal overflow left on any page.
- Hydration warning on Launch (dev only): the default coin art had float coordinates that differed in the last digit between server and browser. Rounded to 2 decimals.
- Safeguards buttons now open the explorer pages that prove the claim: the coin's empty access key list and the factory's "Contract Source Code Verified" tab (checked in a browser).
- Full check: coin 71 and factory 15 unit tests pass, web lint, type check and static build pass, CI green, dash check clean, no secrets or AI attribution in history, repo public with MIT detected by GitHub. On chain: all 3 coins have 0 access keys and code hash `4069f17f...`, matching the factory config and the verified source; contract code unchanged since the verified commit `7cedbe5`. README claims (fees, curve, wallet list, CLI output, tx hashes) checked against the spec and the chain.

## Known issues

| Severity | Issue | Plan |
|---|---|---|
| low | If the protocol account does not exist, `withdraw_protocol_fees` zeroes the counter and the failed transfer refunds the NEAR to the coin, where it is no longer tracked | The factory always sets a real account. Revisit after M3. |
| low | The factory keeps a full-access key and an owner during the hackathon (D-017) | Launched coins are unaffected. Lock or hand over before any mainnet use. |
| medium | Peak inflation griefing: a big buy followed by a sell raises `peak_window`, so 14 days later a still-active coin can fall below 5% of the fake peak and be ejected | Nobody can steal anything, since holders get a fair pro-rata exit. A net-buys peak was simulated and rejected (D-034, `sim/peak-rule-experiment.mjs`): it stops only the flash version, which in the model lowers the other holders' losses, not the patient one, and it delays honest ejects. Stays medium because the model has no long-lived coins. |
| low | Wallets that redirect instead of using a popup reload the page, so the in-page success message is lost (the data still refreshes from chain) | Acceptable for the demo. Meteor and Intear use popups. |
| low | `web/public/mascot/ejecto-pilot.glb` and `ejecto-pilot-wave.glb` are 2.4 MB each, most of it one PNG texture | Fine for the demo. Could convert the textures to WebP to cut them about in half. |
| low | The waving model has no rig, so the wave is a vertex shader on one fused mesh. The glove touches the helmet in the source pose, so the arm keeps a small outward lean | Looks clean at the greeting size. A rigged model would allow a real wave. |
| low | If a sender's `ft_transfer_call` is still in flight at EJECT and the receiver keeps the tokens, the sender keeps the matching weight without the tokens, so that small fund share stays unclaimed | Needs a transfer call to cross the EJECT moment. Accept for the MVP. |

## Testnet deployments

Funding note (2026-11-11): the faucet service (`helper.nearprotocol.com/account`, behind `sponsor-by-faucet-service`) answered HTTP 429 to every new `ejecto-*` name all afternoon, but created `crewfuel-k7`, `seatfuel-m3` and `parachute-q9` at once (10 NEAR each, forwarded to the founder), so it most likely limits by name pattern. Unused helpers `ejecto-topup1..9` and `whale` were deleted with their balance sent to the founder (user approved).

| What | Account | Notes |
|---|---|---|
| Master, funder, factory owner | `ejecto.testnet` | Created by the faucet service. About 16.8 NEAR after a top-up on 2026-11-09 |
| Factory (current, verified) | `factory.ejecto.testnet` | Rebuilt on 2026-11-10 (D-029): state cleared with a temporary cleaner contract (the protocol refuses to delete an account with large state), then the reproducible factory wasm (sha256 `da54dffeeed5510624bfe6c61f9cbc0499681eaaa2c1e84fee1b9d8b46ee7d20`, deploy tx in the account history on NearBlocks) with `new` (owner `ejecto.testnet`, protocol `fees.ejecto.testnet`) and the reproducible coin wasm (sha256 `4069f17ff98bc10c1d9b8f06a56af04199eef50755efa0936c5b22d262e391ae`, 236,737 bytes). Launch deposit 2.66737 NEAR. Both source verified on NearBlocks (SourceScan, commit `7cedbe5`). |
| Factory (history) | `factory.ejecto.testnet` | Deployed 2026-11-09 (tx `6QeDtBpSimeVCi1vv4RMcWyG2DY2jQA9mYN4Vx41GNoJ`). After the M1 to M3 review: new code plus state migration in one tx (`A6LbEoVXFSGfFXAzzX4XdVxJEVHnoVns2HR8Ho2W6zfL`), new coin code (tx `GSazAdDCWLoDkmnZVqrveSaT8KZrB3sBMmP7EDJwQ2pr`, hash `a0e2734e0cf30904b027069f8406b771b8e4bf5f0b8945dd054b960ca6f57cf7`, 237,148 bytes). Launch deposit 2.6715 NEAR. Registry kept `seato` until the rebuild on 2026-11-10. |
| Demo coin Seato ($SEAT) | `seat.factory.ejecto.testnet` | Launched 2026-11-10 by `founder.ejecto.testnet` (tx `EmfZJLE1hHL2aokCcWwhjJzqrHh65okYJ6rk21siQDtH`), icon `web/public/brand/seat-coin.svg`, demo time 10 s per day, 0 access keys, source verified on NearBlocks. Alive line floor is 1 NEAR, so with smaller buys it is ejectable right after day 14. |
| Jury coins ($JURY1, $JURY2, $JURY3) | `jury1..3.factory.ejecto.testnet` | Launched 2026-11-10 19:05 UTC for judges (D-036), demo time 10 s, crew ani 0.3, budi 0.2, cici 0.1 NEAR, ready to EJECT. Launch txs `JTwpaR26NacWR9bJB8C3xB7kfZKLxSHrhX9XPp6oizt`, `HakWeoLKrjKdb6gqobJoHtrCUxi5Rzuz56bkYcECKFs1`, `AyxymL4cqpzJteRU84hckGn32gtAaAkqncRK4aEtX5e5`. |
| Jury coins 4 to 8 | `jury4..8.factory.ejecto.testnet` | Launched 2026-11-10 19:34 UTC, same setup as jury 1 to 3 (D-037). Eight Jury Seats in total. |
| **Factory v3 (live)** | `fleet.ejecto.testnet` | Created 2026-11-11 (tx `28gVDaRidiwQxrsskffDtQeiprXzgmQQp8FJi7QXLJCF`), factory wasm identical to v2 (sha256 `4e735518...`, verified at commit `ef0d663`), deployed with `new` (tx `GWeQLpLMSgo1c9FruSPcYXMGJ5jYzTVeJEqrUt9mGi1H`), coin code v3 (tx `2yqV8CifJi5hqjwaLA9BSfRWoiFaQqUkaXvZCbx1GNyH`, sha256 `b562658a418490b45e41eafca156ffe557d6a2fe70a4b33cd847fb05f1023d8a`, 265,276 bytes, reproducible at commit `31bfad3`, source verified on NearBlocks). Launch deposit 2.95276 NEAR. Frozen 2026-11-11 (tx `8ETkUY26JiNWuMGSGryVpYdmMfVDediafFxCTt8rDETo`), its only full-access key deleted: 0 keys. |
| v3 coins (11) | `jury1..7`, `phoenix`, `seat`, `wngst`, `crash` `.fleet.ejecto.testnet` | All launched by `founder.ejecto.testnet` with their own logos (seat and wngst keep the old ones). Jury Seats: crew ani 0.3, budi 0.2, cici 0.1. Seat and wngst: real days, founder holds 0.2. Crash Test: no crew, for hand testing. Phoenix: Mayday 1 (budi, target 2 NEAR) failed and was refunded in full, Mayday 2 (ani, target 1 NEAR) rescued it with 0.1 NEAR of cici's pledge sent back, all collected (tx list in the README). `verify-chain` passes all 11. Launch txs: jury1 `DsjXrcXX...`, jury2 `D4xUtNnU...`, jury3 `Qmud6pLs...`, jury4 `8uaVypL1...`, phoenix `6J9vavT9...`, seat `6QLBexzJ...`, wngst `8NRh699p...`, jury5 `EBxy1yp2...`, jury6 `7EanmVqw...`, jury7 `7ZBNzaat...`, crash `Ew2AguCP...`. |
| Archive coins ejected for funds (2026-11-11) | `jury1..8.factory.ejecto.testnet`, `jury1..6.coins.ejecto.testnet`, `phoenix.coins.ejecto.testnet` | The faucet service returned HTTP 429 all afternoon, so with the user's OK the crew ejected these 15 archived coins, claimed (about 9.95 NEAR back) and unregistered their storage. `seat` and `wngst` on both archives keep running. |
| Factory v2 (archive) | `coins.ejecto.testnet` | Deployed 2026-11-11 (tx `2FuRTSTqNTMDLyJSrHJo5rBVimhiGYAG6txL9TD13iG5`), owner `ejecto.testnet`, coin code `e4092754...2e55` (263,494 bytes, launch deposit 2.93494 NEAR). Factory and coin source verified on NearBlocks at commit `ef0d663`. Archive: never frozen, replaced by `fleet.ejecto.testnet` (D-039); its owner key stays, it is no longer used for launches. |
| v2 coins | `seat`, `wngst` (real days, old logos), `jury1..6`, `phoenix`, `crash` (demo time, new logos) `.coins.ejecto.testnet` | Jury Seats: crew ani 0.3, budi 0.2, cici 0.1 NEAR, ready to EJECT or Mayday. Phoenix: Mayday round 1 failed and both pledges were withdrawn in full, round 2 rescued it (ani 0.3, budi 0.4, cici 0.3, target 1 NEAR), all collected. Crash Test: no crew, left for hand testing. All keyless; `verify-chain` passes every coin check. |
| Demo coin Pilot ($PILOT) | `pilot.factory.ejecto.testnet` | Launched 2026-11-10 from the web form for the demo video (tx `FQz2inaghVdmw7ZBzi9a1GxxdicHkh12FFg7hs4BpVt2`), demo time 10 s, ejected and fully claimed. Source verified (same code). |
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

### 2026-11-11

- Stage 4 (web on factory v2): `near.ts` reads the v2 `status` and `holder` fields and `get_round`; new phase `mayday` (siren badge) that blocks the EJECT panel while open; history parses the six Mayday events (log labels Mayday, Pledge, Rescue, Failed, Collect, Refund; a rescue moves the price chart). New `mayday-panel.tsx`: Call a Mayday (target 1x to 3x the line, opener pledge at least 10%, fund co-invest shown), the open Mayday (progress, chain-synced countdown, pledgers, pledge and "fill the rest"), and a pledge card (collect after a rescue, withdraw after a failure). Engine meter says how much buying revives a dying coin. Crew board: Longest seat high score (streaks from the token flows, a rescuer's streak starts at the rescue), Rescuer badges, pledgers with tokens still in escrow count as crew. Coin header shows "Rescued Nx".
- Tested the open and ended Mayday views on `crash` (founder opened Mayday 1 with 0.1 NEAR, it failed after 30 s, pledge withdrawn in full: tx `4uQHjCLBwUtXEr611gjUCavTqL13fR6nKfYeNmp1enkg`, `CHZJNV2pUuRW7NExNjZay154Wo3rBV2FjyogoUQgfJdZ`).
- Fixes found while testing: history did not reload on Mayday steps (key now includes the Mayday fields, plus a second fetch 8 s later for NearBlocks lag); the Crew board stayed a skeleton on a coin with no buys; Phoenix overflowed the phone width by 3 px (left column now `min-w-0`); Peak and Alive line labels overlapped on small coins.
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
- README (judge facing: mechanic, why NEAR, "do X, see Y" steps for the hosted app, wallet-free verification, the demo run with real tx hashes, local run, tests, simulation, limits, tools used) and MIT LICENSE added.
- X post published by the user on 2026-11-10 (deleted later). The final video post is https://x.com/Dudung_gg/status/2120827304754766145 (2026-11-12), the link for the submission form.
- Video (folder `video/`, kept local only and excluded from git on request, Remotion): `EjectoAd` (45 s, 9:16, 3D pilot and real coin logos, captions in the style of two reference ads) and `EjectoDemo` (about 2:47, 16:9). The demo is a real run on testnet recorded with Playwright (`scripts/record-demo.mjs`): launch of $PILOT from the web form, ani 0.5, budi 0.6, cici 0.3 NEAR buys, a whale 0.4 NEAR buy right before EJECT, EJECT from the web, claims (ani in the web, the rest with near-cli). Results: ani +33%, budi -3%, cici -17%, whale -26%. Voiceover generated locally with Kokoro TTS (Apache 2.0), music by Kevin MacLeod (CC BY 4.0, credited in the video and in `video/public/music/CREDITS.txt`). UI cards for the ad captured with `scripts/capture-ui.mjs`.
- Hosted on Vercel at https://ejecto.vercel.app (D-031, deployed by the user). Smoke test: every page 200, both GLB models and brand assets served, `og:image` and `twitter:image` point to the Vercel URL. GitHub Actions CI added (`.github/workflows/ci.yml`).
- `/seats/` (My seats): every coin the wallet holds, ready-to-claim cards with a Claim button, flying table with the payout if ejected now, landed list. Linked in the app header and the footer.
- Price history chart on the coin page (D-030): step line of price over time with buy and sell dots, hover details, live reload on every supply change, eject marker.
- Sell tab: 25% / 50% / Max buttons and a NEAR estimate under the token input (a user had typed 0.05 meaning NEAR). Engine meter notes that sells do not count. The bonding curve glides to each new supply, sends a ring out on every on-chain change, and shows a live indicator (polled every 4 s).
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
