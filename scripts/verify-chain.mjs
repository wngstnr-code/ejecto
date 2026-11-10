#!/usr/bin/env node
// Checks every Ejecto coin on chain with no wallet and no keys, over public RPC only.
// Usage: node scripts/verify-chain.mjs [factory-account]   (default factory.ejecto.testnet)
// Optional: NEAR_RPC=<url> to use another RPC endpoint.
//
// For the factory and each coin it checks, from outside the contract:
//   1. the coin account has 0 access keys (nobody can sign for it or replace its code)
//   2. the coin's deployed code hash equals the code hash stored in the factory config,
//      and that hash equals the reproducible build verified on NearBlocks
//   3. before EJECT: reserve == R(supply), the exact integer curve formula (spec invariant 1)
//   4. the account holds at least reserve + fund + protocol fees + storage (spec invariant 2)
//   5. after EJECT: claims never paid out more than the frozen reserve + fund (spec invariant 4)
//   6. the fee preset readable in `status` matches the spec table
// Exit code 0 when everything holds, 1 otherwise.

const FACTORY = process.argv[2] ?? "factory.ejecto.testnet";
const RPC = process.env.NEAR_RPC ?? (FACTORY.endsWith(".near") ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
// sha256 of contracts/coin built with `cargo near build reproducible-wasm` at commit 7cedbe5 (verified on NearBlocks).
const VERIFIED_COIN_HASH = "4069f17ff98bc10c1d9b8f06a56af04199eef50755efa0936c5b22d262e391ae";

// Curve constants (contracts/coin/src/curve.rs), all integers.
const ONE = 10n ** 18n;
const P0 = 20_000_000_000_000_000n;
const K = 500_000_000n;
const reserveAt = (s) => (2n * P0 * ONE * s + K * s * s) / (2n * ONE * ONE);
const STORAGE_YOCTO_PER_BYTE = 10n ** 19n;
// Fee presets in basis points (docs/product-spec.md section 5): fund on buy, fund on sell, protocol on buy.
const PRESETS = { light: [50, 100, 50], standard: [150, 200, 50], high: [300, 500, 50] };

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

async function rpc(params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method: "query", params: { finality: "final", ...params } }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) throw new Error(JSON.stringify(json.error ?? json.result.error).slice(0, 200));
  return json.result;
}

async function view(account, method, args = {}) {
  const r = await rpc({ request_type: "call_function", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58ToHex(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  return n.toString(16).padStart(64, "0");
}

const near = (y) => (Number(y) / 1e24).toFixed(4);

async function main() {
  console.log(`Ejecto chain check, factory ${FACTORY}, RPC ${RPC}\n`);
  const config = await view(FACTORY, "get_config");
  const coins = await view(FACTORY, "get_coins", { from_index: 0, limit: 100 });
  console.log(`factory ${FACTORY}`);
  ok("factory stores the verified coin code", config.coin_code_hash === VERIFIED_COIN_HASH, config.coin_code_hash.slice(0, 12));
  ok("factory lists every launched coin", coins.length === config.coins, `${coins.length} coins`);

  for (const c of coins) {
    const id = c.account_id;
    console.log(`\n${id}  ($${c.symbol.toUpperCase()})`);
    const [keys, account, status] = await Promise.all([
      rpc({ request_type: "view_access_key_list", account_id: id }),
      rpc({ request_type: "view_account", account_id: id }),
      view(id, "status"),
    ]);
    ok("0 access keys", keys.keys.length === 0, `${keys.keys.length} keys`);
    const hash = base58ToHex(account.code_hash);
    ok("deployed code is the verified code", hash === config.coin_code_hash, hash.slice(0, 12));

    const preset = PRESETS[status.fee_preset];
    ok(
      `fee preset "${status.fee_preset}" matches the spec`,
      !!preset && preset[0] === status.fund_buy_bps && preset[1] === status.fund_sell_bps && preset[2] === status.protocol_buy_bps,
    );
    ok("protocol fees go to the factory's protocol account", status.protocol_account === config.protocol_account, status.protocol_account);

    const reserve = BigInt(status.reserve);
    const fund = BigInt(status.fund);
    const protocol = BigInt(status.protocol_fees);
    const storage = BigInt(account.storage_usage) * STORAGE_YOCTO_PER_BYTE;
    ok(
      "balance covers reserve + fund + protocol fees + storage",
      BigInt(account.amount) >= reserve + fund + protocol + storage,
      `${near(account.amount)} N held`,
    );

    if (!status.ejected) {
      const s = BigInt(status.supply);
      ok("reserve equals R(supply) exactly", reserve === reserveAt(s), `${near(reserve)} N for ${(Number(s) / 1e18).toFixed(0)} tokens`);
      console.log(`  info  flying: day ${status.day}, 14-day buys ${near(status.window_buys)} N, alive line ${near(status.alive_threshold)} N, ejectable ${status.ejectable}`);
    } else {
      const e = status.ejected;
      const frozen = BigInt(e.reserve_e) + BigInt(e.fund_e);
      const left = reserve + fund;
      ok("claims paid out no more than the frozen reserve + fund", left <= frozen && reserve <= BigInt(e.reserve_e) && fund <= BigInt(e.fund_e), `${near(frozen - left)} of ${near(frozen)} N paid`);
      ok("frozen reserve equals R(supply at EJECT)", BigInt(e.reserve_e) === reserveAt(BigInt(e.supply_e)));
      ok("no longer ejectable", status.ejectable === false);
    }
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
