# Ejecto architecture

Mechanics and formulas are defined in `product-spec.md`. This file explains how the system is built.

## 1. Overview

```
              +----------------------+
  user  --->  |  Static web app      |  (Next.js static export + Tailwind, Vercel)
  wallet      |  reads via RPC       |
              +----------+-----------+
                         | view calls and signed transactions (public RPC)
          +--------------+----------------+
          v                               v
+--------------------+         +------------------------------+
|  Factory contract  | creates | Coin contract (one per coin) |
|  ejecto factory    +-------->|  <symbol>.<factory account>  |
|  - coin registry   | deploys |  - NEP-141 token             |
|  - coin wasm       |         |  - bonding curve + reserve   |
|  - protocol config |         |  - Ejecto Fund + accounting  |
|  - freeze()        |         |  - alive detector, EJECT     |
+--------------------+         |  - Mayday rescue + escrow    |
                               |  - claim, protocol fees      |
                               |  NO access keys, NO admin    |
                               +------------------------------+
```

There is no server, database, indexer, cron job or oracle. Every number the web app shows comes from contract view methods through public RPC.

## 2. Coin contract (`contracts/coin`)

Language: Rust, `near-sdk` 5.x. Built with `cargo-near`.

### State (sketch)

```rust
pub struct Coin {
    // metadata and immutable params
    name: String, symbol: String, icon: Option<String>,
    fund_buy_bps: u16, fund_sell_bps: u16,   // from fee preset
    day_length_sec: u64, launch_ts: u64,
    protocol_account: AccountId, factory: AccountId,

    // token: balances, total supply and NEP-145 storage (near-contract-standards)
    token: FungibleToken,

    // money (yoctoNEAR)
    reserve: u128, fund: u128, protocol_fees: u128,

    // accounting (accounting.rs)
    holders: LookupMap<AccountId, Holder>,
    ledger: Ledger,                         // s_pos, w_total, last_ts

    // alive detector (detector.rs): 14 x (day, yocto) buckets and peak_window
    detector: Detector,

    // terminal state
    ejected: Option<EjectSnapshot>,         // t_e, reserve_e, supply_e, fund_e, w_e

    // Mayday (spec section 10): the open round, closed rounds, cooldown, NEAR held for pledges
    mayday: Option<Mayday>,                 // round, opener, target, pledged, opened_ts, deadline_ts
    rounds: LookupMap<u32, Round>,          // rescued, ts, tokens_left, pledges_left, bonus_left; deleted once settled
    round_count: u32, rescues: u32, mayday_open_after_ts: u64, pledges_held: u128,
    open_sc: u128, open_tw: u128,           // the open round's sum scaled(amount) and sum scaled(amount) * t_pledge
}

// weight is in (yoctoNEAR / 10^12) x seconds, so u128 is enough
pub struct Holder { basis: i128, weight: u128, last_ts: u64, claimed: bool, pledge: u128, pledge_round: u32, pledge_sc: u128, pledge_tw: u128 }
```

### Methods

| Method | Kind | Who | Notes |
|---|---|---|---|
| `new(args)` | init | factory only, once | Sets immutable params. No owner field exists. |
| `storage_deposit` / `storage_balance_of` | NEP-145 | anyone | Registration before first buy or receive |
| `buy(min_tokens_out)` | payable call | anyone | Section 5 of the spec |
| `sell(amount, min_near_out)` | call | holder | Transfers NEAR out |
| `ft_transfer`, `ft_transfer_call`, `ft_total_supply`, `ft_balance_of`, `ft_metadata` | NEP-141 / NEP-148 | standard | Transfer moves basis, not weight |
| `eject()` | call | anyone | Only when the alive rule allows it |
| `claim()` | call | holder | Pull-based payout after EJECT (collects rescue tokens first) |
| `mayday(target)` | payable call | registered account | Opens a Mayday when EJECT is possible; the deposit is the opener's pledge (at least 10% of the target) |
| `pledge()` | payable call | registered account | Adds escrowed NEAR to the open round, up to the target (the rest is sent back); the pledge that reaches the target runs the rescue buy |
| `collect()` | call | pledger | Moves the pledger's rescue tokens, basis and weight out of the escrow (also runs on every buy, sell, transfer and claim) |
| `withdraw_pledge()` | call | pledger | Returns a failed round's pledge in full; on a rescued round it collects the tokens instead and returns 0 |
| `get_round(round)` | view | anyone | A closed round still being settled: rescued or failed, tokens, pledges and locked-time weight still in escrow (null once settled) |
| `withdraw_protocol_fees()` | call | anyone | Sends to the fixed protocol account |
| `status()` | view | anyone | Price, supply, reserve, fund, day, window buys, peak, threshold, ejectable flag, total weight, ejected snapshot, params, open Mayday, `can_mayday`, cooldown end, rescues, pledges held |
| `holder(account_id)` | view | anyone | Balance, basis, live weight, estimated claim if ejected now (escrow tokens included), pledge, pledge state, collectable tokens |
| `quote_buy(amount)` / `quote_sell(amount)` | view | anyone | For the UI |

There are no owner-only methods. There is no upgrade method.

### Math implementation

- Amounts are `u128` yoctoNEAR. Token amounts are `u128` raw units (10^18 per token).
- Intermediate products (for example `supply^2`) use a 512-bit integer (`uint` crate, `construct_uint!`) so no allowed input can overflow.
- Buy solves the quadratic with an integer square root (Newton, starting from `2^ceil(bits/2)`), then binary searches a window of 256 raw units around the root for the largest `d` whose exact cost fits. Gas stays small and constant.
- Module layout in `contracts/coin/src/`: `curve.rs` (curve math), `accounting.rs` (holder basis and weight, claim parts), `detector.rs` (14 buckets, peak, threshold), `events.rs`, `lib.rs` (contract and NEP wrappers), `tests.rs` (contract unit tests). Pure modules carry their own unit tests.
- Holder accounting entries live in a `near_sdk::store::LookupMap<AccountId, Holder>`. At init the contract measures one entry and adds it to the NEP-145 per-account storage, so `storage_deposit` pays for both the balance and the accounting entry.
- Every path that changes token balances goes through the accounting: `buy`, `sell`, `ft_transfer`, `ft_resolve_transfer` (books the used part of an `ft_transfer_call`), `claim`, the Mayday rescue buy and `collect`. `Ledger::shed` removes weight pro-rata when tokens leave a holder.
- Mayday escrow: the rescue mints its tokens to the coin account, which is booked as one holder (basis = uncollected pledges), so it earns weight like any holder; at the rescue it also gets the weight the pledges earned while locked (`sc * t_rescue - tw` from two running sums). `settle` moves a pledger's slice out on their next action, with no loop over pledgers. Transfers to the coin account and `storage_unregister` with an open pledge are refused.
- NEP-141 and NEP-145 come from `near-contract-standards` (`FungibleToken`), wrapped so Ejecto can add hooks (M2) and block forced unregister.
- Rounding rules from the spec: tokens out and proceeds round down, fees round up, rounding dust goes to the fund.
- Time: `env::block_timestamp()` is nanoseconds. Convert to seconds. `day = (now - launch_ts) / day_length_sec`.

### Events

Standard NEP-297 events for `ft_mint`, `ft_burn`, `ft_transfer`, plus Ejecto events (version 1.1.0: `ejecto_buy`, `ejecto_sell`, `ejecto_eject`, `ejecto_claim`, `ejecto_protocol_withdraw`, and the Mayday events `ejecto_mayday_open`, `ejecto_pledge`, `ejecto_rescue`, `ejecto_mayday_fail`, `ejecto_collect`, `ejecto_pledge_withdraw`) with JSON payloads. They help explorers and judges follow what happened.

### Gas and storage

Measured in the sandbox (2026-11-09): `create_coin` 45.8 Tgas, `storage_deposit` + `buy` 4.5 Tgas, `sell` 3.2 Tgas, `ft_transfer` 2.6 Tgas, `eject` 1.9 Tgas, `claim` 3.1 Tgas, `set_coin_code` 29.3 Tgas. Coin v3 (2026-11-11): `mayday` 2.3 Tgas, the last `pledge` with the rescue buy and a refund of the part above the target 4.2 Tgas.


- Every method is O(1). The window sum loops over 14 buckets only.
- Each holder entry is paid by NEP-145 storage deposit. The web app batches `storage_deposit` and `buy` as two function-call actions in one transaction when the user is not registered yet.

## 3. Factory contract (`contracts/factory`)

| Method | Kind | Notes |
|---|---|---|
| `new(owner, protocol_account)` | init | |
| `set_coin_code(code)` | owner only | Stores the coin wasm. Development convenience. |
| `create_coin(name, symbol, icon, fee_preset, day_length_sec)` | payable | Validates args, creates `<symbol>.<factory>`, transfers the storage deposit, deploys the coin wasm, calls `new`. Adds **no access key**, so the coin account is keyless. Registers the coin in the list after the callback succeeds, and refunds on failure. |
| `get_coins(from_index, limit)` / `get_coin(symbol)` | view | Coin registry for the web app |
| `withdraw_refund()` / `pending_refund(account_id)` | call / view | Pull-based refunds of failed launches |
| `freeze()` | owner only | One way: `set_coin_code` is refused for good, launches keep working. `get_config` shows `frozen`. |

- `set_coin_code` takes the raw wasm bytes as the call input (near-cli `file-args`), checks the `\0asm` magic, and stores the code in a `LazyOption` with its length and sha256 hash (shown by `get_config`, so anyone can compare it with a local build).
- `launch_deposit = coin_code_len x storage_byte_cost + 0.3 NEAR`. For the 265 KB coin v3 this is about 2.95 NEAR. The deposit pays the new coin's storage.
- `create_coin` refunds anything above `launch_deposit` at once, then sends one batch to the new account: `create_account`, `transfer(launch_deposit)`, `deploy_contract(code)`, `function_call(new)`. The batch is atomic, so a failed init reverts the account creation and the deposit returns to the factory. The callback `on_coin_created` registers the coin on success (and never refunds on success). On failure it books a pending refund, because the system refund of the failed batch may reach the factory only after the callback.
- The factory keeps an owner during development so we can update the coin code. The live factory (`fleet.ejecto.testnet`, coin code v3) gets `freeze()` and its full-access key deleted before submission, so the coin code is fixed for good. Two earlier factories stay live as archives: `factory.ejecto.testnet` (coin code v1, no Mayday) and `coins.ejecto.testnet` (coin code v2, Mayday with a fund co-invest that v3 replaced, D-039). Coins already launched are never affected, because each coin is keyless and has no upgrade path.
- Optimization to check later: NEAR global contracts can deploy coin code by reference and reduce the launch deposit. Use plain code deployment for the MVP.

## 4. Web app (`web/`)

- Next.js 16 (App Router) + Tailwind CSS 4 + TypeScript (D-022). `output: 'export'` builds plain static files into `web/out`, hosted on Vercel (D-031). `basePath` is still supported through `NEXT_PUBLIC_BASE_PATH` for sub-path hosting. No server code: no API routes, no server actions, no middleware, no `next/image` optimization (`images.unoptimized`).
- Every page that touches the wallet or RPC is a client component. The coin page is `/coin/?id=<coin account>` (query parameter, read with `useSearchParams` inside `Suspense`), because coins are created at runtime and static export cannot pre-render unknown dynamic routes.
- Wallet connection: NEAR Connect (`@hot-labs/near-connect`, D-027) in `web/lib/wallet.tsx`. The connector is created only in the browser. A first buy sends `storage_deposit` and `buy` as two function calls in one transaction.
- RPC reads: small `fetch` JSON-RPC helpers in `web/lib/near.ts` (view calls, account balance, access key lists) to the public testnet RPC (`https://test.rpc.fastnear.com` by default). No `near-api-js`.
- Config comes from the single root `.env`: `web/next.config.ts` calls `loadEnvConfig` from `@next/env` on the repo root. Only `NEXT_PUBLIC_` variables reach the browser: `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_FACTORY_ID`. No secrets.

Pages:

| Page | Content |
|---|---|
| Landing `/` | Done (D-023 to D-025). Preloader, hero, "The problem" typewriter, "The crash" pinned chart (model data), "How it works" pinned card stack, "The math" ledger (model), "Safeguards" spec board (live chain reads), final call to action, footer. A fixed 3D pilot layer (`components/landing/pilot-stage.tsx`) follows the scroll through all sections. Lenis smooth scroll, GSAP ScrollTrigger, Motion, custom scrollbar. |
| Coins `/coins/` | Live coin list from the factory in one table card: toolbar with Status and Clock filter dropdowns and an expand (full view) button, sortable columns (price, fund, engine, launched), phase badge (warming up, alive, dying, ejectable, Mayday, ejected), a small engine bar, stat pills (flying, total in funds). Polls every 8 s. |
| Launch `/launch/` | Form for `create_coin`: name, symbol with a live availability check, optional icon (resized in the browser to fit 2 KB), fee preset tiles, demo time or real days, live launch cost. After the launch it confirms the coin is registered and shows its access key count. |
| Coin `/coin/?id=` | DEMO TIME banner, stats, engine meter (14-day buys against the alive line and peak), price history over time (D-030: NearBlocks v3 lists the transactions, contract events give the amounts, the curve gives the price), bonding curve drawn from the contract formula, buy and sell with `quote_buy`/`quote_sell` and 1% slippage, "your seat" (balance, basis, fund weight, payout if ejected now). When ejectable: the EJECT handle and "Call a Mayday" (target 1x to 3x the alive line, opener pledge at least 10%, pledges earn loyalty while locked). While a Mayday is open the EJECT panel is replaced by the rescue panel (progress, countdown synced to chain time, pledgers, pledge box); a pledge card offers collect after a rescue and withdraw after a failure (`components/app/mayday-panel.tsx`). After EJECT: claim panel and the eject record. A Crew board ranks the holders by loyalty (fund weight share) from the `holder` view (D-035), with a "Longest seat" high score (longest streak aboard, from the token flows in the log) and Rescuer badges, and an on-chain log lists every buy, sell, EJECT, claim and Mayday step (D-032), both in scroll boxes. Share buttons open an X post intent for a seat or a parachute. Polls `status()` and `holder()` every 4 s. Only ids of the form `<symbol>.<factory>` are accepted. |
| My seats `/seats/` | The connected wallet's seats across all coins (factory list, then `status()` and `holder()` per coin): ready to claim (ejected, unclaimed, with a Claim button), flying (balance, net basis, fund weight, payout if ejected now), landed (claimed). Polls every 8 s. |
| EJECT scene | After a successful EJECT the 3D pilot fires up, opens the canopy and drifts down (`components/app/eject-moment.tsx`, lazy chunk, preloaded once the coin is ejectable). Skipped with reduced motion. |
| Simulation | Cut (D-028). The landing shows the model data. |

The app pages share a folded footer and the header with the wallet button. The web app polls `status()` every few seconds. There is no websocket and no indexer.

## 5. Simulation (`sim/ejecto-sim.mjs`)

- Agent-based model: 400 traders per coin, 500 runs, 60 days. Baseline coin (1% fee, exit race at death) against an Ejecto coin, using identical agents and random draws.
- Outputs `ejecto-results.json`, `chart-example.svg` and `chart-attack.svg`.
- It mirrors the spec. If the spec changes, update the sim and re-run it.

## 6. Security model

| Threat | Mitigation |
|---|---|
| Creator rug or parameter change | Coin account is keyless, no admin methods, no creator allocation |
| Late whale buys to farm the fund | Fund split by basis x time. Pro-rata reserve split. The buy also restarts the 14-day window. The sim shows the attacker always loses 30% to 48%. |
| Wash trading to keep the coin alive | Fees go to the fund. The sim shows 87% of the attacker's cost lands in the fund. |
| Sybil splitting | Weight is linear in basis, so splitting gives no advantage |
| Moving weight by transfer | Weight never moves on transfer |
| Exit race at death | Trading stops at EJECT. The reserve is split pro-rata. |
| Rounding drain | All rounding favors the contract. Invariant tests. |
| Reentrancy or callback issues on NEAR transfers | State is updated before every outgoing transfer. Payouts are plain transfers. |
| Mayday used to delay EJECT forever | 3 days per round, then 7 days of cooldown in which anyone can EJECT; the opener locks 10% of the target |
| Rescue and dump to farm the fund | The fund spends nothing at a rescue (v3). Pledges only earn weight for the time they were locked, paid at EJECT and shed on a sell, so a dump just pays the fees and an instant solo rescue earns nothing extra (unit tests with a 7 NEAR fund; model: attacker loses 11.4 of 20 NEAR). Code v2 paid a fund co-invest that a lone rescuer could take (D-039). |
| Overshoot the target to inflate the peak | A pledge is filled only up to the target; the rest is sent back in the same call |
| Pledgers lose money on a failed rescue | Assurance contract: every pledge of a failed round is withdrawn in full |
| Contract bug | Small code, unit and integration tests, invariants, simulation parity. An audit is needed before any mainnet use. |

## 7. Testing strategy

| Level | Tool | What |
|---|---|---|
| Unit | `cargo test` with near-sdk test utils | Curve math round trips, fees, rounding, accounting rules, alive detector, EJECT, claim sums, invariants, Mayday (open, pledge, rescue, fail, collect, withdraw, cooldown, 600 random steps that check every invariant) |
| Attack scenarios | `cargo test` | Late whale, wash trading, sybil, transfer games, buy and sell after EJECT |
| Integration | `near-workspaces` 0.24 (Rust, sandbox), `contracts/factory/tests/integration.rs` | Factory launch, keyless check, second init rejected, duplicate symbol rejected, buy, sell, transfer, EJECT after 14 demo days, claims match the view, protocol fees arrive, low deposit rejected, Mayday rescue with 10 pledgers, locked-time weight and a refund above the target, frozen factory refuses new code but still launches. Prints gas per call. |
| Parity | `cargo test` (coin) | Contract tokens, reserve and fund match the simulation formulas within 1e-9, and the fund split matches the simulation weighting |
| Manual | Testnet and the web app | Demo flow from `hackathon.md` |
