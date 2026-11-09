# Build and deploy

All commands run from the repo root unless noted. Testnet only.

## 1. Toolchain

Installed on the dev machine (checked 2026-11-09):

| Tool | Version | Status |
|---|---|---|
| rustc / cargo | 1.96.0 | installed |
| wasm32-unknown-unknown target | | installed |
| Node.js | 24.1.0 | installed |
| pnpm | 10.33.0 | installed |
| git | 2.48.1 | installed |
| cargo-near | 0.23.0 | installed |
| near-cli-rs | 0.31.1 | installed |

Latest library versions seen on 2026-11-09: `near-sdk` 5.30.1, `near-workspaces` 0.24.0, `near-api-js` 7.4.0, `@near-wallet-selector/core` 10.1.4, `vite` 8.3.7.

Install the missing tools:

```bash
cargo install --locked cargo-near
cargo install --locked near-cli-rs
```

Check:

```bash
cargo near --version
near --version
```

## 2. Accounts and the single env file

Config lives in **one file**: `.env` at the repo root (gitignored). `.env.example` is the committed template. It holds account names and network settings only. Private keys live only in the local NEAR keychain (`~/.near-credentials/testnet/<account>.json`, file mode 600).

Accounts are prepared with near-cli. The only manual step is topping up with the faucet.

| Account | Purpose | Initial balance |
|---|---|---|
| `ejecto.testnet` (`FUNDER_ACCOUNT`, `MASTER_ACCOUNT`, `OWNER_ACCOUNT`) | Pays for everything, parent of all named accounts, factory owner | 10 NEAR from the faucet service |
| `factory.ejecto.testnet` | Factory contract. Coins become `<symbol>.factory.ejecto.testnet`. | 1 NEAR |
| `fees.ejecto.testnet` | Receives protocol fees | 0.1 NEAR |
| `ani`, `budi`, `cici`, `whale` `.ejecto.testnet` | Demo holders and the attack demo | 0.5 NEAR each |

All accounts were created on 2026-11-09. Keys are in `~/.near-credentials/testnet/` (legacy keychain format, mode 600).

How they were created (for reference, do not re-run):

```bash
# master account, funded by the NEAR faucet service (about 10 NEAR)
near account create-account sponsor-by-faucet-service ejecto.testnet \
  autogenerate-new-keypair save-to-legacy-keychain network-config testnet create

# each sub-account, funded by the master
near account create-account fund-myself factory.ejecto.testnet '1 NEAR' \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as ejecto.testnet network-config testnet sign-with-legacy-keychain send
```

Topping up:

- https://near-faucet.io only accepts accounts that already exist (a fresh implicit account is rejected as "Invalid account") and gives small amounts per request. It also returned errors on 2026-11-09.
- Fallback that works: create a helper account with the faucet service (about 10 NEAR), then send its NEAR to the master. Done once with `ejecto-topup1.testnet`.

```bash
near account create-account sponsor-by-faucet-service ejecto-topup2.testnet \
  autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
near tokens ejecto-topup2.testnet send-near ejecto.testnet '9.95 NEAR' \
  network-config testnet sign-with-legacy-keychain send
```
- Move NEAR from the master to a sub-account when needed:

```bash
near tokens ejecto.testnet send-near factory.ejecto.testnet '3 NEAR' \
  network-config testnet sign-with-legacy-keychain send
```

Check a balance:

```bash
near account view-account-summary ejecto.testnet network-config testnet now
```

Budget for the whole hackathon: about 20 to 30 NEAR. Factory storage for the coin code (about 3 NEAR), each coin launch (about 3 NEAR), demo buys (a few NEAR per demo account).

## 3. Contracts

### Build

```bash
cd contracts/coin && cargo near build non-reproducible-wasm
cd contracts/factory && cargo near build non-reproducible-wasm
```

The wasm output path is printed by cargo-near (usually `target/near/<crate>.wasm`). Use `reproducible-wasm` for the final submission build if time allows.

### Test

```bash
cd contracts/coin && cargo test
cd contracts/factory && cargo test        # includes near-workspaces sandbox tests
```

### Deploy the factory to testnet

cargo-near and near-cli-rs change their syntax between versions. Run `cargo near deploy --help` and `near --help` to confirm before using these templates.

```bash
# deploy and initialize
cd contracts/factory
cargo near deploy build-non-reproducible-wasm <factory>.testnet \
  with-init-call new json-args '{"owner":"<owner>.testnet","protocol_account":"<protocol>.testnet"}' \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send

# upload the coin code (owner only)
near contract call-function as-transaction <factory>.testnet set_coin_code \
  file-args ../coin/target/near/ejecto_coin.wasm \
  prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' \
  sign-as <owner>.testnet network-config testnet sign-with-keychain send
```

### Launch a demo coin from the CLI

```bash
near contract call-function as-transaction <factory>.testnet create_coin \
  json-args '{"name":"Seato","symbol":"seato","fee_preset":"standard","day_length_sec":10}' \
  prepaid-gas '300.0 Tgas' attached-deposit '<launch deposit> NEAR' \
  sign-as <creator>.testnet network-config testnet sign-with-keychain send
```

Verify the coin is keyless:

```bash
near account list-keys seato.<factory>.testnet network-config testnet now
```

The expected result is an empty key list.

## 4. Web app

```bash
cp .env.example .env        # once, at the repo root (the only env file)
cd web
pnpm install
pnpm dev                    # local dev server
pnpm build                  # static build in web/dist
```

Hosting: GitHub Pages from `web/dist` (GitHub Actions workflow or the `gh-pages` branch). Set the Vite `base` option to the repo name.

`web/vite.config.ts` must set `envDir: '..'` so Vite reads the root `.env`. Only variables that start with `VITE_` reach the browser. Never put anything secret in a `VITE_` variable.

## 5. Simulation

```bash
node sim/ejecto-sim.mjs sim/out
```

Produces `sim/out/ejecto-results.json`, `sim/out/chart-example.svg` and `sim/out/chart-attack.svg`. It takes about 10 seconds. No dependencies.

## 6. Text check

```bash
node scripts/check-dashes.mjs
```

Fails if any tracked text file contains an em dash (U+2014) or an en dash (U+2013).

## 7. Public RPC

Testnet RPC: `https://rpc.testnet.near.org` (or another provider from https://docs.near.org/api/rpc/providers). The MPC and other public endpoints are not needed for Ejecto.
