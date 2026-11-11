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
| `fleet.ejecto.testnet` | The live factory (coin code v3, D-039). Coins become `<symbol>.fleet.ejecto.testnet`. | 5.3 NEAR |
| `coins.ejecto.testnet`, `factory.ejecto.testnet` | Archived factories with coin code v2 and v1; their coins keep working | |
| `founder.ejecto.testnet` | Launches the demo coins | from helpers |
| `ejecto-topupN.testnet` | Faucet-service helpers that forward their 10 NEAR. The service rate-limits (HTTP 429), so create one at a time and never retry in a loop. The CLI saves the key before calling the service, so a failed attempt leaves a key file for an account that does not exist. | 10 NEAR each |
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

The wasm output path is printed by cargo-near (usually `target/near/<crate>.wasm`).

### Reproducible build (used for the deployed, verified contracts)

```bash
# needs Docker. On Apple silicon: Colima with Rosetta (softwareupdate --install-rosetta), the image is amd64 only.
# Colima only shares $HOME with the VM, so point TMPDIR there. The git tree must be clean and pushed.
export TMPDIR=$HOME/.cache/cargo-near-tmp
cd contracts/coin && cargo near build reproducible-wasm
cd contracts/factory && cargo near build reproducible-wasm
```

The image and digest are pinned in `[package.metadata.near.reproducible_build]` of each crate. The build embeds NEP-330 `build_info` (image, repo commit, contract path), which `contract_source_metadata` returns. With Rosetta both builds take about 5 minutes; under QEMU emulation they are very slow and can crash.

### Verify on NearBlocks

Open `https://testnet.nearblocks.io/verify-contract?account=<account>`, check the prefilled form (verifier `v2-verifier.sourcescan.testnet`) and press Verify Contract. Do it for the factory and for each coin account (all coins share the same code).

### Test

```bash
cd contracts/coin && cargo test
cd contracts/factory && cargo test        # includes near-workspaces sandbox tests
```

### Deploy the live factory `fleet.ejecto.testnet` (done 2026-11-11)

The factory code did not change since v2, so the deployed wasm is byte for byte the v2 factory (sha256 `4e735518...`, verified on NearBlocks at commit `ef0d663`; fetched from `coins.ejecto.testnet` with the RPC `view_code` call). The coin wasm is the reproducible build at commit `31bfad3` (sha256 `b562658a...`).

```bash
near account create-account fund-myself fleet.ejecto.testnet '5.3 NEAR' \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as ejecto.testnet network-config testnet sign-with-legacy-keychain send
near contract deploy fleet.ejecto.testnet use-file factory-v2.wasm \
  with-init-call new json-args '{"owner":"ejecto.testnet","protocol_account":"fees.ejecto.testnet"}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction fleet.ejecto.testnet set_coin_code file-args ejecto_coin.wasm \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as ejecto.testnet network-config testnet sign-with-legacy-keychain send
# launch deposit: 2.95276 NEAR. Register with storage_balance_bounds().min (0.00327 NEAR for v3), never a hardcoded value.

# before submission: freeze, then delete the factory account's own full-access key
near contract call-function as-transaction fleet.ejecto.testnet freeze json-args '{}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ejecto.testnet network-config testnet sign-with-legacy-keychain send
near account delete-keys fleet.ejecto.testnet public-keys <key> network-config testnet sign-with-legacy-keychain send
```

### Deploy the first factory to testnet (done 2026-11-09, now an archive)

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

Hosting: Vercel (D-031). Import the GitHub repo, set **Root Directory** to `web`, framework preset Next.js (pnpm is picked up from `packageManager`). `output: 'export'` makes Vercel serve the static files. Environment variables in the Vercel project: `NEXT_PUBLIC_SITE_URL` = the deployment URL (for example `https://ejecto.vercel.app`). Optional, with testnet defaults in `web/lib/config.ts`: `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_FACTORY_ID`. Leave `NEXT_PUBLIC_BASE_PATH` unset. The root `.env` is gitignored, so Vercel never sees it.

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

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs on every push to `main`, on pull requests, and by hand: the dash check, contract unit tests (`ejecto-coin`, `ejecto-factory --lib`), the sandbox integration tests (cargo-near 0.22.0 builds both wasm files first) and the web app (lint, `tsc`, static build). Vercel deploys the site by itself from `main`.

## 7. Public RPC

Testnet RPC: `https://rpc.testnet.near.org` for the CLI. The web app uses `https://test.rpc.fastnear.com` (`NEXT_PUBLIC_RPC_URL`), which answered view calls about 10x faster in our tests (or pick another provider from https://docs.near.org/api/rpc/providers). The MPC and other public endpoints are not needed for Ejecto.
