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

Latest library versions seen on 2026-11-09: `near-sdk` 5.30.1, `near-workspaces` 0.24.0, `near-api-js` 7.4.0, `@near-wallet-selector/core` 10.1.4, `next` 16.4.5, `tailwindcss` 4.3.5, `@hot-labs/near-connect` 0.12.0.

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

### Deploy the factory to testnet (done 2026-11-09)

These exact commands were used with near-cli-rs 0.31.1 (run from `contracts/`):

```bash
# the factory needs about 4.1 NEAR of storage (its own code plus the stored coin code)
near tokens ejecto.testnet send-near factory.ejecto.testnet '4 NEAR' \
  network-config testnet sign-with-legacy-keychain send

near contract deploy factory.ejecto.testnet \
  use-file target/near/ejecto_factory/ejecto_factory.wasm \
  with-init-call new json-args '{"owner":"ejecto.testnet","protocol_account":"fees.ejecto.testnet"}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

# upload the coin code (owner only, raw wasm as input)
near contract call-function as-transaction factory.ejecto.testnet set_coin_code \
  file-args target/near/ejecto_coin/ejecto_coin.wasm \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  sign-as ejecto.testnet network-config testnet sign-with-legacy-keychain send

# check: coin_code_hash must equal `shasum -a 256 target/near/ejecto_coin/ejecto_coin.wasm`
near contract call-function as-read-only factory.ejecto.testnet get_config \
  json-args '{}' network-config testnet now
```

### Launch a coin from the CLI

```bash
# attach at least launch_deposit (about 2.67 NEAR for the current coin code)
near contract call-function as-transaction factory.ejecto.testnet create_coin \
  json-args '{"name":"Seato","symbol":"seato","fee_preset":"standard","day_length_sec":10}' \
  prepaid-gas '200 Tgas' attached-deposit '2.68 NEAR' \
  sign-as ejecto.testnet network-config testnet sign-with-legacy-keychain send
```

Verify the coin is keyless (expected: 0 keys):

```bash
near account list-keys seato.factory.ejecto.testnet network-config testnet now
```

### Trade from the CLI

```bash
C=seato.factory.ejecto.testnet
# once per account: register (amount from storage_balance_bounds.min, about 0.00275 NEAR)
near contract call-function as-transaction $C storage_deposit json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '2750000000000000000000 yoctoNEAR' \
  sign-as ani.ejecto.testnet network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction $C buy json-args '{}' \
  prepaid-gas '50 Tgas' attached-deposit '1 NEAR' \
  sign-as ani.ejecto.testnet network-config testnet sign-with-legacy-keychain send
# after EJECT
near contract call-function as-transaction $C claim json-args '{}' \
  prepaid-gas '50 Tgas' attached-deposit '0 NEAR' \
  sign-as ani.ejecto.testnet network-config testnet sign-with-legacy-keychain send
```

### Integration tests (sandbox)

```bash
cd contracts/coin && cargo near build non-reproducible-wasm
cd ../factory && cargo near build non-reproducible-wasm
cargo test --test integration -- --nocapture --test-threads=1
```

The first run downloads the NEAR sandbox binary. Gas per call is printed.

## 4. Web app

```bash
cp .env.example .env        # once, at the repo root (the only env file)
cd web
pnpm install
pnpm dev                    # local dev server
pnpm build                  # static export in web/out
```

Hosting: GitHub Pages from `web/out` (GitHub Actions workflow or the `gh-pages` branch). `web/next.config.ts` sets `output: 'export'`, `basePath` to the repo name, `trailingSlash: true` and `images.unoptimized: true`. Add an empty `.nojekyll` file to the output so GitHub Pages serves the `_next/` folder.

`web/next.config.ts` must call `loadEnvConfig` (from `@next/env`) on the repo root so Next.js reads the root `.env`. Only variables that start with `NEXT_PUBLIC_` reach the browser. Never put anything secret in a `NEXT_PUBLIC_` variable.

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
