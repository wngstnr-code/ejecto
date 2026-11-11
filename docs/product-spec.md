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

`create_coin` on the factory creates `<symbol>.<factory-account>` and deploys the coin contract. The new account has no access keys. The factory checks every launch argument before it starts the launch, so bad input fails at once and the deposit is refunded by the runtime. Exactly `launch_deposit` goes to the coin account; anything above it is refunded to the creator at once (a keyless coin could never return it). If the launch batch still fails, the deposit is booked as a pending refund that the creator withdraws with `withdraw_refund`.

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

Factory (`fleet.ejecto.testnet`, coin code v3): the owner uploads the coin code once with `set_coin_code`, then calls `freeze()`, after which `set_coin_code` fails forever and the factory account's own key is deleted. From then on nobody, the team included, can change the code that new coins get or the factory itself; `get_config` shows `frozen: true`. Two earlier factories stay on chain as archives, with immutable coins that keep working: `factory.ejecto.testnet` (coin code v1, no Mayday) and `coins.ejecto.testnet` (coin code v2, Mayday with the fund co-invest that v3 replaced).

Initialization: `new` may only be called by the direct parent account (the factory, for example `factory.x` for `seato.factory.x`) or by the coin account itself (fallback deploy without a factory). Any other ancestor is rejected.

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
| Sell `d` of `balance_i` tokens for `proceeds` NEAR | Shed weight: `w_i -= w_i * d / balance_i` (and `W` by the same amount). Then `b_i -= proceeds`. |
| Balance becomes 0 (full exit by sell or transfer) | Leave the ship: `W -= w_i`, `w_i = 0`, `set_basis(i, 0)`. Loyalty weight is forfeited. |
| `ft_transfer` of `a` tokens from `i` to `j` | Move basis pro-rata: `moved = max(0, b_i) * a / balance_i`. `b_i -= moved`, `b_j += moved`. The sender sheds the same fraction of weight. Weight never moves: `j` starts accruing from now. |
| `ft_transfer_call` | No accounting while the tokens are in flight. In `ft_resolve_transfer`, only the part the receiver kept (`used`) is booked, as an `ft_transfer` from the sender's own basis and weight, with `balance_i = sender balance after the refund + used`. A refund can never touch the receiver's basis. |

Weight is tied to the tokens still held. Keeping a little dust keeps only a dust share of the weight, and moving tokens to another account to sell there sheds the weight at home.

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
4. No Mayday is open (section 10). A Mayday past its deadline does not block: EJECT closes it as failed first.

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
| A holder already claimed | `claim` can be called again if the holder holds tokens again (for example from a late `ft_transfer_call` refund). It pays the reserve part for the current balance. The fund part is paid only once. |

## 9. Protocol fees

`withdraw_protocol_fees()` can be called by anyone. It sends the accrued protocol fees to the protocol account fixed at launch. There is no other way to move them.

## 10. Mayday: the crew can rescue a dying coin

A dying coin does not have to end. When EJECT becomes possible, anyone can call a **Mayday** instead: a short, all-or-nothing crowd rescue. It is the coin's community ritual: the crew decides together whether the coin lives on. Rescuers are rewarded with loyalty, not with cash: a pledge is capital at risk, so it earns fund weight from the moment it is locked.

Coin code v3 (factory `fleet.ejecto.testnet`). Code v2 (`coins.ejecto.testnet`, archived) had a fund co-invest instead of the locked-time weight; a review showed that a lone rescuer could pledge, collect and sell at once for a profit taken from the fund whenever the fund was large (D-039).

All durations are in coin days (`day_length_sec`), so a demo coin runs a Mayday in seconds.

| Rule | Value |
|---|---|
| Who can open | Any registered account, when section 7 allows EJECT, no Mayday is open, and the cooldown has passed |
| Target | Set by the opener, from `alive_threshold` to `3 x alive_threshold` |
| Opener's stake | The opener pledges at least 10% of the target in the opening call |
| Duration | 3 days from opening (`deadline_ts`) |
| Pledges | Escrowed NEAR, at least 0.001 NEAR each, from registered accounts. Locked until the Mayday ends. One open pledge per account: a pledge from an earlier round must be collected or withdrawn first. A pledge that would pass the target is filled up to the target and the rest is sent back in the same call, so a rescue spends exactly the target. A gap of less than 0.001 NEAR left below the target counts as reached (it could never be filled). |
| While open | EJECT is blocked. Buying and selling work as usual. |
| Cooldown | After a failed Mayday, a new one can open only 7 days after its deadline. EJECT is possible again at once. |
| Locked-time weight | On a rescue, each pledge earns the fund weight of the time it was locked: `scaled(amount) * (rescue time - pledge time)`, the same "capital at risk times time" rule as every holding. Early pledgers earn up to 3 days, an instant solo rescue earns nothing. Like all weight it pays only at EJECT and is shed pro-rata on a sell. A failed pledge earns no weight (it comes back in full). The fund spends nothing at the rescue. |

**Success.** When the pledges reach the target (the pledge that reaches it executes the rescue), the target is spent as **one buy at one price**: the normal buy fees are taken (fund fee and protocol fee, exactly as in `buy`), and the curve mints the tokens. The rescue counts as a buy of the target for the alive detector, so the coin is alive again. The locked-time weight is booked at the same moment: the escrow gets `bonus = sum over the pledges of scaled(amount) * (t_rescue - t_pledge)`, and the global weight `W` grows by the same amount. The contract keeps two running sums per holder and per round (`sc = sum scaled(amount)` and `tw = sum scaled(amount) * t_pledge`), so `bonus = sc * t_rescue - tw` needs no loop. If the coin dies later, the rescuers own a larger slice of the fund, but only if they are still aboard.

The tokens go to an **escrow** inside the coin (the coin account holds them, they count in the supply). Each pledger takes their share with `collect()`, or automatically on their next buy, sell, transfer, Mayday action or claim:

```
tokens = round.tokens_left * pledge / round.pledges_left      (the last pledger takes the rest)
basis  = pledge                                               (only the pledger's own NEAR is basis)
weight = scaled(pledge) * (min(now, t_e) - round.ts)          (the weight that pledge earned since the rescue)
       + pledge_sc * round.ts - pledge_tw                       (the weight its pledges earned while locked; the last pledger takes the rest)
```

The escrow is booked as one holder (the coin account) whose basis is the sum of the uncollected pledges, so it earns weight exactly like any holder, and `collect` moves the slice of tokens, basis and weight to the pledger. The sum of holder weights stays equal to `W`, and there is no loop over pledgers. After EJECT, `collect` still works (weights frozen at `t_e`) and `claim` collects first. `collect` succeeds even when a dust pledge rounds to 0 tokens (the pledge is cleared), and `withdraw_pledge` on a rescued round collects instead of failing. A round is deleted once every pledge in it is collected or withdrawn, so its storage is released.

**Failure.** If the deadline passes below the target, the next call that touches the Mayday closes it as failed. Every pledger withdraws their full pledge with `withdraw_pledge()`. Nobody loses money by trying to save the coin: it is an assurance contract.

**Why these limits** (all simulated in `sim/mayday-experiment.mjs`):

| Abuse | Answer |
|---|---|
| Open Maydays only to delay EJECT | At most 3 days per attempt, then 7 days in which anyone can EJECT, and the opener locks 10% of the target meanwhile |
| A target that can never be met | Capped at 3 x the alive line |
| Front-run the rescue | All pledges fill at one batch price |
| Rescue and dump (pledge, collect, sell at once) | Loses money: the rescue is an ordinary buy at the batch price, so a dump pays the buy and sell fees, and the sell sheds the locked-time weight with the rest of the weight. Unit test with a 7 NEAR fund; in the model the attacker loses 11.4 of every 20 NEAR pledged. |
| Drain the fund through rescues | Not possible: the fund spends nothing at a rescue. Pledges only earn weight for the time their NEAR was really locked, paid at EJECT to holders still aboard. A solo rescue in one call earns no extra weight. |
| Overshoot the target (one huge pledge to inflate the peak) | The pledge is filled only up to the target and the rest is returned, so the rescue and the detector record at most 3 x the alive line |
| Sandwich the rescue (buy just before sending the pledge that completes the target, sell after) | Residual risk, documented: the trigger gains only from the pledgers' own price impact and pays about 4% in round-trip fees, the same as front-running any large buy. The target cap bounds the impact. |
| Fill the coin's storage with Mayday rounds | Each round needs an opener stake of 10% of the target, a failed round can repeat only every 10 days, and rounds are deleted once settled |
| Send tokens to the coin account to mix with the escrow | `ft_transfer` and `ft_transfer_call` to the coin account itself are refused |
| Unregister storage and lose an open pledge | `storage_unregister` is refused while the account has a pledge or uncollected rescue tokens |

What it does not do: it cannot undo peak inflation griefing, because a fake peak raises the alive line and therefore the minimum target too.

Views: `status` adds `mayday` (the open round: `round`, `opener`, `target`, `pledged`, `opened_ts`, `deadline_ts`), `mayday_open_after_ts` (end of the last cooldown in seconds, 0 when there was none; for a Mayday past its deadline but not closed yet, the cooldown it will start), `rescues`, `pledges_held` (NEAR held for open or failed pledges) and `can_mayday`. `mayday(target)` returns the open round, or nothing when the opener's own stake reached the target and the rescue already ran. `holder` adds `pledge`, `pledge_round`, `pledge_state` (`open`, `rescued`, `failed` or none) and `collectable` (tokens waiting in escrow).

Events (NEP-297, standard `ejecto`, version 1.2.0): `ejecto_mayday_open`, `ejecto_pledge` (with `refunded`, the part above the target sent back), `ejecto_rescue` (`round`, `pledged`, `tokens`, `bonus_weight` = the locked-time weight, `price_after`), `ejecto_mayday_fail`, `ejecto_collect`, `ejecto_pledge_withdraw`.

## 11. Invariants (must hold, test them)

1. Before EJECT: `reserve == R(supply)` (exactly, given integer rounding rules).
2. Contract NEAR balance >= `reserve + fund + protocol_fees + storage` at all times.
3. `S_pos` equals the sum of `max(0, b_i)` over all holders.
4. After EJECT: the sum of all claims is at most `reserve_e + fund_e`.
5. No method can change parameters after launch. The coin account has no access keys.
6. After EJECT, no buy, sell or transfer succeeds.
7. Contract NEAR balance >= `reserve + fund + protocol_fees + open and unwithdrawn pledges + storage`.
8. The rescue escrow holds exactly the tokens that uncollected pledgers can still collect, and its basis equals their uncollected pledges. When every pledger of a round has collected (or, after a failure, withdrawn), the round is deleted.
9. A failed Mayday returns every pledge in full; a successful one turns every pledge into tokens. No pledge is ever both refunded and filled.

## 12. Out of scope for the hackathon MVP

- Mainnet deployment, audits, legal review.
- Graduation to an external DEX (Rhea). The curve is the only market.
- Buying from other chains through NEAR Intents (stretch, after MVP).
- Price history charts that need an indexer.
