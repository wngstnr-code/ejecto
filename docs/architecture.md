# Ejecto architecture

Mechanics and formulas are defined in `product-spec.md`. This file explains how the system is built.

## 1. Overview

```
              +----------------------+
  user  --->  |  Static web app      |  (Vite + React + TypeScript, GitHub Pages)
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
+--------------------+         |  - alive detector, EJECT     |
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

    // token
    balances: LookupMap<AccountId, Holder>,
    supply: u128,                           // raw units, 18 decimals

    // money (yoctoNEAR)
    reserve: u128, fund: u128, protocol_fees: u128,

    // accounting
    s_pos: u128,                            // sum of max(0, basis)
    w_total: U256,                          // sum of weights (yocto x seconds)
    last_global_ts: u64,

    // alive detector
    buckets: [(u64 /*day*/, u128 /*yocto*/); 14],
    peak_window: u128,

    // terminal state
    ejected: Option<EjectSnapshot>,         // reserve_e, supply_e, fund_e, w_e, t_e
}

pub struct Holder { balance: u128, basis: i128, weight: U256, last_ts: u64, claimed: bool }
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
| `claim()` | call | holder | Pull-based payout after EJECT |
| `withdraw_protocol_fees()` | call | anyone | Sends to the fixed protocol account |
| `status()` | view | anyone | Price, supply, reserve, fund, window buys, threshold, age, ejectable flag, ejected snapshot, params |
| `holder(account_id)` | view | anyone | Balance, basis, live weight, estimated claim if ejected now |
| `quote_buy(amount)` / `quote_sell(amount)` | view | anyone | For the UI |

There are no owner-only methods. There is no upgrade method.

### Math implementation

- Amounts are `u128` yoctoNEAR. Token amounts are `u128` raw units (10^18 per token).
- Intermediate products (for example `supply^2`) use a 256-bit integer (`uint` crate, `construct_uint!`) to avoid overflow.
- Buy solves a quadratic with an integer square root on 256-bit values, then recomputes `cost = R(s+d) - R(s)` exactly.
- Rounding rules from the spec: tokens out and proceeds round down, fees round up, rounding dust goes to the fund.
- Time: `env::block_timestamp()` is nanoseconds. Convert to seconds. `day = (now - launch_ts) / day_length_sec`.

### Events

Standard NEP-297 events for `ft_mint`, `ft_burn`, `ft_transfer`, plus Ejecto events (`ejecto_buy`, `ejecto_sell`, `ejecto_eject`, `ejecto_claim`, `ejecto_protocol_withdraw`) with JSON payloads. They help explorers and judges follow what happened.

### Gas and storage

- Every method is O(1). The window sum loops over 14 buckets only.
- Each holder entry is paid by NEP-145 storage deposit. The web app batches `storage_deposit` and `buy` as two function-call actions in one transaction when the user is not registered yet.

## 3. Factory contract (`contracts/factory`)

| Method | Kind | Notes |
|---|---|---|
| `new(owner, protocol_account)` | init | |
| `set_coin_code(code)` | owner only | Stores the coin wasm. Development convenience. |
| `create_coin(name, symbol, icon, fee_preset, day_length_sec)` | payable | Validates args, creates `<symbol>.<factory>`, transfers the storage deposit, deploys the coin wasm, calls `new`. Adds **no access key**, so the coin account is keyless. Registers the coin in the list after the callback succeeds, and refunds on failure. |
| `get_coins(from_index, limit)` / `get_coin(symbol)` | view | Coin registry for the web app |

- The factory keeps an owner during development so we can update the coin code. Coins already launched are never affected, because each coin is keyless and has no upgrade path.
- Optimization to check later: NEAR global contracts can deploy coin code by reference and reduce the launch deposit. Use plain code deployment for the MVP.

## 4. Web app (`web/`)

- Vite + React + TypeScript. Built as static files, hosted on GitHub Pages.
- Wallet connection: NEAR Wallet Selector (`@near-wallet-selector/*`). Check the current recommended package in docs.near.org before starting M4. `@hot-labs/near-connect` is the alternative.
- RPC reads: `near-api-js` (v7) view calls to the public testnet RPC.
- Config through `web/.env` (no secrets): `VITE_NETWORK=testnet`, `VITE_FACTORY_ID=<factory account>`.

Pages:

| Page | Content |
|---|---|
| Home | Coin list from the factory, status badge (alive, dying, ejectable, ejected), "Launch a coin" |
| Launch | Form for the launch args, demo-time toggle, cost estimate |
| Coin | Price, supply, reserve, Ejecto Fund, engine meter (`window_buys / alive_threshold`), "your seat" (balance, basis, weight, estimated claim), buy and sell with quotes, EJECT button, claim button, DEMO TIME banner |
| Simulation | Results and charts from `sim/ejecto-sim.mjs` (static JSON and SVG, clearly labeled as a model) |

The web app polls `status()` every few seconds. There is no websocket and no indexer.

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
| Contract bug | Small code, unit and integration tests, invariants, simulation parity. An audit is needed before any mainnet use. |

## 7. Testing strategy

| Level | Tool | What |
|---|---|---|
| Unit | `cargo test` with near-sdk test utils | Curve math round trips, fees, rounding, accounting rules, alive detector, EJECT, claim sums, invariants |
| Attack scenarios | `cargo test` | Late whale, wash trading, sybil, transfer games, buy and sell after EJECT |
| Integration | `near-workspaces` (Rust, sandbox) | Factory launch, keyless check (no access keys), full lifecycle with a short day length |
| Parity | Script | Same scenario through the sim math and the contract, compare results |
| Manual | Testnet and the web app | Demo flow from `hackathon.md` |
