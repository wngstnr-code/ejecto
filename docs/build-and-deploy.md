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

Accounts are prepared by script. The only manual step is funding the funder with the faucet.

| Account | Purpose | Created how |
|---|---|---|
| `FUNDER_ACCOUNT` (implicit, 64 hex chars) | Pays for everything | Keypair generated locally. Exists on-chain once the user funds it. |
| `ejecto.testnet` (`MASTER_ACCOUNT`, `OWNER_ACCOUNT`) | Parent of all named accounts, factory owner | Funder calls the `testnet` registrar `create_account` |
| `factory.ejecto.testnet` | Factory contract. Coins become `<symbol>.factory.ejecto.testnet`. | Sub-account of the master |
| `fees.ejecto.testnet` | Receives protocol fees | Sub-account of the master |
| `ani`, `budi`, `cici`, `whale` `.ejecto.testnet` | Demo holders and the attack demo | Sub-accounts of the master |

Funding target: about 30 testnet NEAR on the funder (minimum 15). The faucet can be used more than once. Rough budget: factory storage for the coin code (about 3 NEAR), each coin launch (about 3 NEAR), demo buys (about 5 NEAR per demo account).

Steps:

1. Done: the funder keypair is generated and saved in the keychain. Its account id is in `.env`.
2. The user funds `FUNDER_ACCOUNT` with the testnet faucet (for example https://near-faucet.io).
3. Run `scripts/setup-accounts` (written in M0) to create the master and sub-accounts and distribute NEAR.
4. Record the result in `progress.md` (names only, never keys).

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
