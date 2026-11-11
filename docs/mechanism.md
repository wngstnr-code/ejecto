# Ejecto mechanism note

A short, checkable summary of the mechanic in coin code v3 (`fleet.ejecto.testnet`). The full rules, with every parameter and rounding direction, are in [`product-spec.md`](product-spec.md). Each claim below points at the test that proves it.

## 1. The life of a coin

```
            buys keep the 14-day buys over the alive line
        ┌──────────────────────────────────────────────┐
        v                                              │
  LAUNCH ──► ALIVE ──(day >= 14 and buys < line)──► DYING ──► EJECT ──► CLAIM
                                                    │   ^
                                       anyone calls │   │ fails: every pledge back,
                                         a Mayday   v   │ 7-day cooldown
                                                  MAYDAY ──(target reached)──► ALIVE again
```

| State | Who acts | What can happen |
|---|---|---|
| Alive | anyone | buy, sell, transfer. Every trade pays the fund fee. |
| Dying (ejectable) | anyone | `eject()`, or `mayday(target)` to try a rescue, or plain buys that lift the 14-day buys over the line |
| Mayday (3 coin days) | anyone registered | `pledge()`. EJECT waits. Trading goes on. |
| Ejected | each holder | `claim()` once. Trading and transfers are closed for good. |

## 2. The formulas

| Quantity | Formula | Where |
|---|---|---|
| Price | `P0 + K x supply`, `P0` = 2e-8 NEAR, `K` = 5e-16 NEAR per token | `curve.rs` |
| Reserve | the area under the curve, `R(s) = P0 s + K s^2 / 2`, exact integers | `curve.rs` |
| Alive line | `max(1 NEAR, 5% of the best 14-day buy window)` | `detector.rs` |
| Ejectable | `day >= 14` and the last 14 days of buys `< alive line` and no Mayday open | `detector.rs`, `lib.rs` |
| Weight of a holder | `sum over time of scaled(net NEAR at risk)`, shed pro-rata on every sell or transfer out | `accounting.rs` |
| Claim | `reserve_e x balance / supply_e + fund_e x weight / W_e` | `accounting.rs` (`claim_parts`) |
| Mayday target | between the alive line and 3 x the line; the opener stakes 10% | `lib.rs` (`mayday`) |
| Weight a pledge earns | `scaled(amount) x (t_rescue - t_pledge)`, booked at the rescue, nothing on a failure | `lib.rs` (`rescue`, `share_of`) |

`scaled(x) = x / 10^12` (weight units). All rounding favors the contract: tokens and payouts round down, fees round up, dust goes to the fund.

## 3. Claims and the tests behind them

Coin tests are in `contracts/coin/src/tests.rs` (100), factory tests in `contracts/factory/src/lib.rs` (18), sandbox tests with the real wasm in `contracts/factory/tests/integration.rs` (5).

| Claim | Proof |
|---|---|
| No exit race: every holder gets the same share of the reserve per token | `full_lifecycle_pays_everyone_and_conserves_near`, `after_eject_a_claim_collects_first_and_claims_stay_within_the_pot` |
| Not a yoctoNEAR is created or lost | `random_trades_conserve_every_yocto`, `random_ops_keep_all_invariants`, `random_ops_with_maydays_keep_all_invariants` (600 random steps, every invariant after every step) |
| A late whale cannot farm the fund | `late_whale_cannot_farm_the_fund`; simulation: 1 to 500 NEAR right before EJECT loses 30.8% to 48.5% |
| Splitting across accounts gives nothing | `sybil_split_gives_no_advantage` |
| Weight cannot be moved or kept with dust | `transfer_moves_basis_but_not_weight`, `sending_tokens_away_sheds_weight`, `keeping_dust_does_not_keep_the_weight`, `full_exit_forfeits_weight` |
| Wash trading mostly feeds the fund | `wash_trading_mostly_feeds_the_fund` |
| A refund cannot drain someone else's basis | `refund_cannot_drain_a_victims_basis`, `transfer_call_refund_moves_basis_back` |
| A dying coin can be revived by buying | `a_buy_revives_a_dying_coin` |
| EJECT only when dead, once, and closes trading | `eject_too_young_panics`, `eject_while_alive_panics`, `eject_twice_panics`, `buy_after_eject_panics`, `sell_after_eject_panics`, `transfer_after_eject_panics` |
| The contract matches the simulation | `contract_matches_simulation_formulas`, `fund_split_matches_simulation_weighting` |
| Coins are keyless and immutable | sandbox `launch_is_keyless_and_full_lifecycle_works`; `node scripts/verify-chain.mjs` on the live coins |
| The factory can be frozen for good | `freeze_locks_the_coin_code_forever`, `only_the_owner_can_freeze`, sandbox `frozen_factory_rejects_new_code_but_still_launches` |
| **Mayday:** only on a coin that could be ejected, one at a time, with a bounded target and a 10% opener stake | `mayday_needs_an_ejectable_coin`, `only_one_mayday_at_a_time`, `mayday_target_below_the_line_panics`, `mayday_target_above_three_lines_panics`, `mayday_opener_must_stake_ten_percent` |
| **Mayday:** EJECT waits while it is open, and a missed deadline closes it | `eject_is_blocked_while_a_mayday_is_open`, `eject_after_the_deadline_closes_the_mayday_as_failed` |
| **Mayday:** all pledges buy at one price and the fund pays nothing | `rescue_fills_all_pledges_at_one_price_and_the_fund_pays_nothing` |
| **Mayday:** a failed rescue costs nobody anything | `failed_mayday_refunds_every_pledge_in_full_and_starts_a_cooldown`, `a_failed_round_is_deleted_once_every_pledge_is_withdrawn` |
| **Mayday:** a pledge never buys more than the target | `a_pledge_above_the_target_is_filled_up_to_it_and_the_rest_returned`, `a_crossing_pledge_is_capped_at_the_target`, `a_gap_below_the_minimum_pledge_counts_as_reached` |
| **Mayday:** rescue and dump loses money, even with a large fund | `rescue_and_dump_loses_money`, `rescue_and_dump_loses_money_with_a_large_fund`; simulation: the attacker loses 11.4 of every 20 NEAR |
| **Mayday:** loyalty only for NEAR really at risk | `pledges_earn_weight_while_locked_and_lose_it_on_a_full_sell`, `an_instant_solo_rescue_earns_no_extra_weight` |
| **Mayday:** nobody has to remember to collect | `any_action_collects_first`, `collect_moves_tokens_basis_and_the_weight_earned_since_the_rescue`, `withdraw_on_a_rescued_pledge_collects_instead` |
| **Mayday:** the escrow cannot be polluted or abandoned | `tokens_cannot_be_sent_to_the_coin_account`, `storage_unregister_is_refused_with_an_open_pledge`, `an_old_failed_pledge_must_be_withdrawn_before_pledging_again` |
| **Mayday:** works with 10 pledgers on the real wasm, with a refund above the target | sandbox `mayday_rescue_with_ten_pledgers_and_locked_time_weight` (last pledge plus rescue: 4.2 Tgas) |

## 4. Invariants

The nine invariants of [`product-spec.md`](product-spec.md) section 11 are checked after every step of the random tests, and four of them from outside the contract by `scripts/verify-chain.mjs` (keyless, verified code, reserve equals `R(supply)`, balance covers reserve + fund + protocol fees + held pledges + storage, claims within the frozen pot).

## 5. Known limits

| Limit | Severity | Why it stays |
|---|---|---|
| Peak inflation griefing: a large buy and sell raises the alive line, so an active coin can be ejected a few days early | medium | Nobody can steal anything. A net-buys peak was simulated and rejected (D-034). A Mayday cannot undo it, because the fake peak raises the target too. |
| Sandwiching the rescue: whoever sends the completing pledge can buy just before | low | Gains only from the pledgers' own price impact and pays about 4% in fees, bounded by the 3x target cap |
| In the model, pledgers lose about 0.44 NEAR on average without new demand | design | A rescue is a community choice, not a profit trade. Losses per coin stay within +1.3%, wiped out stays 0%. |
| Early buyers are favored by the pro-rata reserve split | design | It is a bonding curve; there is no premine and no creator allocation |
| Testnet only, not audited | | |
