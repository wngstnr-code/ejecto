# Ejecto product spec

This file is the source of truth for what Ejecto does. If code or other docs disagree with it, fix them or update this file on purpose (and log the reason in `decisions.md`).

## 1. Summary

Ejecto is a memecoin launchpad where every coin has an ejection seat.

- Each coin is its own NEP-141 token contract with a bonding curve inside it.
- A small fee from every trade goes into the **Ejecto Fund**.
- When the coin dies, anyone can press **EJECT**. Trading stops forever.
- Holders then claim two things:
  1. **Reserve share**: the curve reserve split pro-rata by token balance. Nobody races to the exit.
  2. **Fund share**: the Ejecto Fund split by **net capital at risk multiplied by time held**.
- Coin contracts have **no access keys** and **no admin methods**. All parameters are locked at launch.

Tagline: "Every memecoin needs an ejecto seato."

## 2. Problem and users

- About two thirds of Pump.fun tokens stop trading within 24 hours. Only 4.55% still trade after 90 days (CoinGecko, June 2026).
- When a coin dies, holders race to sell into a falling curve. Fast sellers get something, the last ones get almost nothing. Loyal, non-bot holders are punished the most.
- Trading fees go to the platform and never come back to the community.

Users:

| User | Need |
|---|---|
| Retail holders | A safety net when a coin dies. Loyalty should be rewarded, not punished. |
| Coin creators and communities | Trust. "Ejecto-protected" tells buyers they will not be wiped out. |
| Launchpads (later) | A differentiating "Ejecto mode" they can integrate. |

## 3. Glossary

| Term | Meaning |
|---|---|
| Supply `s` | Tokens in circulation, in whole tokens (raw units / 10^18) |
| Reserve `R` | NEAR held by the curve. Always equals `R(s)` before EJECT. |
| Ejecto Fund `F` | NEAR collected from fees for holders |
| Protocol fees | NEAR collected for the protocol account |
| Net basis `b_i` | NEAR a holder put in minus NEAR they took out. Can be negative. |
| Weight `w_i` | Integral over time of `max(0, b_i)`. Units: NEAR x seconds. |
| Day | `day_length_sec` seconds. 86400 for real coins, shorter for demo coins. |
| Window | The last 14 days of buy volume |

## 4. Launch

`create_coin` on the factory creates `<symbol>.<factory-account>` and deploys the coin contract. The new account has no access keys.

Launch arguments (all immutable afterwards):

| Argument | Rule |
|---|---|
| `name` | 1 to 32 characters |
| `symbol` | 2 to 10 characters, lowercase a-z and 0-9. Also used as the sub-account name. |
| `icon` | Optional small data URL (max 2 KB) |
| `fee_preset` | `light`, `standard` (default) or `high` |
| `day_length_sec` | 86400 for normal coins. 10 to 86399 for demo coins. The web app shows a "DEMO TIME" banner when it is below 86400. |

Fixed at the factory level (same for every coin of this factory version):

| Constant | Value |
|---|---|
| Token decimals | 18 |
| Initial supply | 0 (no creator allocation, no premine) |
| `P0` (start price) | 2e-8 NEAR per token (2e16 yoctoNEAR) |
| `K` (slope) | 5e-16 NEAR per token per token (5e8 yoctoNEAR) |
| Protocol fee | 0.5% of every buy |
| Protocol account | Set in the factory config, copied into each coin at launch |
| Supply cap | 10 billion tokens (reserve at the cap is about 25,000 NEAR) |
| Minimum buy | 0.001 NEAR |

Initialization: `new` may only be called by the parent account (the factory) or by the coin account itself (fallback deploy without a factory).

## 5. Bonding curve

- Price per token: `p(s) = P0 + K * s`
- Reserve for supply `s`: `R(s) = P0 * s + K * s^2 / 2`
- Example: buying from 0 to 1 billion tokens costs 270 NEAR in total.

### Buy (amount `x` NEAR attached)

1. `fund_fee = x * fund_buy_rate`, `protocol_fee = x * 0.005`, `net = x - fund_fee - protocol_fee`
2. Solve `R(s + d) - R(s) = net` for `d` (tokens out). Round `d` down.
3. `cost = R(s + d) - R(s)`. The rounding dust `net - cost` goes to the Ejecto Fund.
4. Mint `d` tokens to the buyer. `reserve += cost`. `fund += fund_fee + dust`. `protocol_fees += protocol_fee`.
5. Optional `min_tokens_out` argument for slippage protection. Panic if `d < min_tokens_out`.
   Also panic if `d == 0`, if `x` is below the minimum buy, if the buyer is not registered (NEP-145), or if the buy would hit the supply cap with leftover NEAR (the leftover would not be dust).
6. Record `x` in today's buy bucket (section 7).
7. Update the buyer's accounting: `b_i += x` (section 6).

### Sell (amount `d` tokens)

1. `gross = R(s) - R(s - d)`, rounded down.
2. `fund_fee = gross * fund_sell_rate`, rounded up. `proceeds = gross - fund_fee`.
3. Burn `d`. `reserve -= gross`. `fund += fund_fee`. Transfer `proceeds` NEAR to the seller.
4. Optional `min_near_out` for slippage protection.
5. Update the seller's accounting: `b_i -= proceeds`. If the seller's balance becomes 0, they leave the ship (section 6).

### Fee presets

| Preset | Fund fee on buy | Protocol fee on buy | Total buy fee | Fund fee on sell |
|---|---|---|---|---|
| light | 0.5% | 0.5% | 1.0% | 1.0% |
| **standard** (default) | 1.5% | 0.5% | 2.0% | 2.0% |
| high | 3.0% | 0.5% | 3.5% | 5.0% |

Rounding always favors the contract (tokens out and proceeds round down, fees round up). Normal rounding dust is a few yoctoNEAR.

### Storage and unregistering

- Holders register with NEP-145 `storage_deposit` before their first buy or receive.
- `storage_unregister(force = true)` is rejected. A forced unregister would burn tokens without releasing the matching reserve and break invariant 1. Unregistering with a zero balance is allowed.
- If an `ft_transfer_call` refund would burn tokens (sender gone), the resolve callback panics instead, so the receiver keeps the tokens and the supply stays consistent.

## 6. Holder accounting (net basis x time)

State per holder: `balance`, `basis` (signed), `weight`, `last_ts`.
Global state: `S_pos` (sum of `max(0, basis)` over all holders), `W` (sum of all weights), `last_global_ts`.

`touch(i, now)` runs before any change to holder `i`:

```
W        += S_pos * (now - last_global_ts);  last_global_ts = now
w_i      += max(0, b_i) * (now - last_ts_i); last_ts_i      = now
```

`set_basis(i, new_b)`:

```
S_pos += max(0, new_b) - max(0, b_i);  b_i = new_b
```

Rules:

| Event | Effect |
|---|---|
| Buy `x` NEAR | `b_i += x` |
| Sell for `proceeds` NEAR | `b_i -= proceeds` |
| Balance becomes 0 (full exit) | Leave the ship: `W -= w_i`, `w_i = 0`, `set_basis(i, 0)`. Loyalty weight is forfeited. |
| Transfer `a` tokens from `i` to `j` | Move basis pro-rata: `moved = max(0, b_i) * a / balance_i`. `b_i -= moved`, `b_j += moved`. Weight does **not** move. `j` starts accruing from now. If `i` ends with balance 0, `i` leaves the ship. |

All updates are O(1). There is never a loop over holders.

Implementation note: weights use the basis scaled down by 10^12 yoctoNEAR (`WEIGHT_UNIT`), so weight units are (yoctoNEAR / 10^12) x seconds. The same scaled value feeds `S_pos`, holder weights and `W`, so the sum of holder weights equals `W` exactly. Basis below 10^-12 NEAR earns no weight (the minimum buy is 0.001 NEAR).

## 7. Alive detector

- Buy volume is stored in 14 daily buckets (ring buffer, indexed by `day % 14`, each bucket tagged with its day number so stale buckets count as 0).
- `window_buys` = sum of buy volume over the last 14 days, including today.
- `peak_window` = the highest `window_buys` ever observed (updated on every buy).
- `alive_threshold = max(1 NEAR, 5% of peak_window)`

**EJECT is allowed when all of these are true:**

1. Coin age is at least 14 days.
2. `window_buys < alive_threshold`
3. The coin is not already ejected.
4. (Stretch, only if SOS is built) No SOS round is open.

Any buy raises `window_buys` and can bring the coin back to life before EJECT.

## 8. EJECT and claim

`eject()` can be called by anyone when section 7 allows it:

1. Final global touch at `t_e`: `W += S_pos * (t_e - last_global_ts)`.
2. Freeze: `reserve_e = reserve`, `supply_e = supply`, `fund_e = fund`, `W_e = W`, `t_e = now`.
3. Trading stops forever: `buy`, `sell` and `ft_transfer` panic from now on.

`claim()` (pull-based, once per holder, holder must have balance > 0):

```
w_i_final    = w_i + max(0, b_i) * (t_e - last_ts_i)
reserve_part = reserve_e * balance_i / supply_e
fund_part    = fund_e * w_i_final / W_e          (0 if W_e == 0)
payout       = reserve_part + fund_part
```

The holder's tokens are burned and `payout` is transferred. Claims are rounded down, so the sum of all claims never exceeds `reserve_e + fund_e`. Leftover dust stays in the contract.

Edge cases:

| Case | Rule |
|---|---|
| EJECT with supply 0 (nobody on board) | The fund moves to protocol fees, since nobody can claim it. `fund_e = 0`. |
| `W_e == 0` but supply > 0 (no holder has positive weight) | The fund is split pro-rata by tokens, like the reserve. |
| An `ft_transfer_call` refund resolves after EJECT | Only tokens move back. Accounting is frozen, so weights still sum to `W_e`. |
| A holder already claimed | `claim` panics. The `holder` view shows zero parts. |

## 9. Protocol fees

`withdraw_protocol_fees()` can be called by anyone. It sends the accrued protocol fees to the protocol account fixed at launch. There is no other way to move them.

## 10. SOS rescue (stretch goal, supports the Social track)

- When EJECT becomes possible, anyone can open an SOS round instead: a 72-hour (3 days) crowd pledge with a NEAR target set by the opener (at least `alive_threshold`).
- Pledges are escrowed NEAR. If the target is reached before the deadline, all pledges execute as buys in one step (same price order, recorded as buys), and the coin is alive again.
- If not reached, every pledger can withdraw their pledge, and EJECT becomes available again.
- This is an assurance contract: nobody loses money by being the only one who tries to save the coin.

## 11. Invariants (must hold, test them)

1. Before EJECT: `reserve == R(supply)` (exactly, given integer rounding rules).
2. Contract NEAR balance >= `reserve + fund + protocol_fees + storage` at all times.
3. `S_pos` equals the sum of `max(0, b_i)` over all holders.
4. After EJECT: the sum of all claims is at most `reserve_e + fund_e`.
5. No method can change parameters after launch. The coin account has no access keys.
6. After EJECT, no buy, sell or transfer succeeds.

## 12. Out of scope for the hackathon MVP

- Mainnet deployment, audits, legal review.
- Graduation to an external DEX (Rhea). The curve is the only market.
- Buying from other chains through NEAR Intents (stretch, after MVP).
- Price history charts that need an indexer.
