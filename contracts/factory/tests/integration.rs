//! Sandbox integration tests: factory launch, keyless coin, full lifecycle, gas.
//!
//! Build the wasm files first:
//!   cd contracts/coin && cargo near build non-reproducible-wasm
//!   cd contracts/factory && cargo near build non-reproducible-wasm
//! Then run: cd contracts/factory && cargo test --test integration -- --nocapture

use near_workspaces::network::Sandbox;
use near_workspaces::operations::Function;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const COIN_WASM: &str = "../target/near/ejecto_coin/ejecto_coin.wasm";
const FACTORY_WASM: &str = "../target/near/ejecto_factory/ejecto_factory.wasm";
const DAY_LENGTH: u64 = 10;

fn read(path: &str) -> Vec<u8> {
    std::fs::read(path).unwrap_or_else(|_| {
        panic!("Missing {path}. Build the contracts with `cargo near build non-reproducible-wasm` first.")
    })
}

fn u128_of(v: &Value) -> u128 {
    v.as_str().expect("U128 string").parse().unwrap()
}

fn tgas(o: &ExecutionFinalResult) -> f64 {
    o.total_gas_burnt.as_gas() as f64 / 1e12
}

struct Env {
    worker: Worker<Sandbox>,
    owner: Account,
    factory: Contract,
    fees: Account,
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let owner = root
        .create_subaccount("ejecto")
        .initial_balance(NearToken::from_near(200))
        .transact()
        .await?
        .into_result()?;
    let factory_acc = owner
        .create_subaccount("factory")
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?;
    let fees = owner
        .create_subaccount("fees")
        .initial_balance(NearToken::from_near(1))
        .transact()
        .await?
        .into_result()?;
    let factory = factory_acc
        .deploy(&read(FACTORY_WASM))
        .await?
        .into_result()?;
    factory
        .call("new")
        .args_json(json!({ "owner": owner.id(), "protocol_account": fees.id() }))
        .transact()
        .await?
        .into_result()?;
    let set = owner
        .call(factory.id(), "set_coin_code")
        .args(read(COIN_WASM))
        .max_gas()
        .transact()
        .await?;
    assert!(set.is_success(), "set_coin_code failed: {set:?}");
    println!("GAS set_coin_code: {:.1} Tgas", tgas(&set));
    Ok(Env {
        worker,
        owner,
        factory,
        fees,
    })
}

async fn user(env: &Env, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(env
        .owner
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(near))
        .transact()
        .await?
        .into_result()?)
}

async fn launch(
    env: &Env,
    creator: &Account,
    symbol: &str,
) -> anyhow::Result<ExecutionFinalResult> {
    let deposit = u128_of(&env.factory.view("launch_deposit").await?.json::<Value>()?);
    Ok(creator
        .call(env.factory.id(), "create_coin")
        .args_json(json!({
            "name": "Seato", "symbol": symbol, "fee_preset": "standard", "day_length_sec": DAY_LENGTH
        }))
        .deposit(NearToken::from_yoctonear(deposit))
        .max_gas()
        .transact()
        .await?)
}

/// storage_deposit + buy in one transaction, like the web app does.
async fn register_and_buy(
    a: &Account,
    coin: &AccountId,
    near: u128,
) -> anyhow::Result<ExecutionFinalResult> {
    let bounds: Value = a.view(coin, "storage_balance_bounds").await?.json()?;
    let min = u128_of(&bounds["min"]);
    Ok(a.batch(coin)
        .call(
            Function::new("storage_deposit")
                .args_json(json!({}))
                .deposit(NearToken::from_yoctonear(min))
                .gas(Gas::from_tgas(20)),
        )
        .call(
            Function::new("buy")
                .args_json(json!({}))
                .deposit(NearToken::from_near(near))
                .gas(Gas::from_tgas(100)),
        )
        .transact()
        .await?)
}

async fn status(a: &Account, coin: &AccountId) -> anyhow::Result<Value> {
    Ok(a.view(coin, "status").await?.json()?)
}

#[tokio::test]
async fn launch_is_keyless_and_full_lifecycle_works() -> anyhow::Result<()> {
    let env = setup().await?;
    let ani = user(&env, "ani", 30).await?;
    let budi = user(&env, "budi", 30).await?;
    let cici = user(&env, "cici", 30).await?;

    // ---- launch ----
    let out = launch(&env, &ani, "seato").await?;
    assert!(out.is_success(), "launch failed: {out:?}");
    println!("GAS create_coin: {:.1} Tgas", tgas(&out));
    assert!(out.json::<bool>()?, "callback must register the coin");
    let coin: AccountId = format!("seato.{}", env.factory.id()).parse()?;
    let info: Value = env
        .factory
        .view("get_coin")
        .args_json(json!({"symbol": "seato"}))
        .await?
        .json()?;
    assert_eq!(info["account_id"], coin.as_str());

    // ---- keyless ----
    let keys = env.worker.view_access_keys(&coin).await?;
    assert!(
        keys.is_empty(),
        "the coin account must have no access keys, found {}",
        keys.len()
    );

    // ---- init twice is rejected ----
    let again = ani
        .call(&coin, "new")
        .args_json(json!({
            "name": "Evil", "symbol": "seato", "fee_preset": "high", "day_length_sec": 10,
            "protocol_account": ani.id()
        }))
        .transact()
        .await?;
    assert!(again.is_failure(), "a second init must fail");

    // ---- duplicate symbol is rejected and the deposit stays with the caller ----
    let before = budi.view_account().await?.balance;
    let dup = launch(&env, &budi, "seato").await?;
    assert!(dup.is_failure(), "duplicate symbol must fail");
    let after = budi.view_account().await?.balance;
    assert!(
        before.as_yoctonear() - after.as_yoctonear() < NearToken::from_millinear(10).as_yoctonear()
    );

    // ---- trading ----
    let b1 = register_and_buy(&ani, &coin, 5).await?;
    assert!(b1.is_success(), "buy failed: {b1:?}");
    println!("GAS storage_deposit + buy: {:.1} Tgas", tgas(&b1));
    assert!(register_and_buy(&budi, &coin, 8).await?.is_success());
    assert!(register_and_buy(&cici, &coin, 3).await?.is_success());

    let cici_bal = u128_of(
        &cici
            .view(&coin, "ft_balance_of")
            .args_json(json!({"account_id": cici.id()}))
            .await?
            .json()?,
    );
    let sell = cici
        .call(&coin, "sell")
        .args_json(json!({ "amount": (cici_bal / 2).to_string() }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(sell.is_success(), "sell failed: {sell:?}");
    println!("GAS sell: {:.1} Tgas", tgas(&sell));

    let xfer = budi
        .call(&coin, "ft_transfer")
        .args_json(json!({ "receiver_id": cici.id(), "amount": "1000000000000000000" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(xfer.is_success(), "transfer failed: {xfer:?}");
    println!("GAS ft_transfer: {:.1} Tgas", tgas(&xfer));

    // ---- EJECT too early fails ----
    let early = ani
        .call(&coin, "eject")
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(early.is_failure(), "eject must fail while young");

    // ---- let the coin die: wait until it is ejectable (14+ demo days of no buys) ----
    let mut tries = 0;
    loop {
        let s = status(&ani, &coin).await?;
        if s["ejectable"].as_bool().unwrap() {
            println!("ejectable on demo day {}", s["day"]);
            break;
        }
        tries += 1;
        assert!(tries < 60, "coin never became ejectable, status: {s}");
        env.worker.fast_forward(50).await?;
    }

    let ej = budi
        .call(&coin, "eject")
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(ej.is_success(), "eject failed: {ej:?}");
    println!("GAS eject: {:.1} Tgas", tgas(&ej));
    let s = status(&ani, &coin).await?;
    let snap = &s["ejected"];
    let (reserve_e, fund_e) = (u128_of(&snap["reserve_e"]), u128_of(&snap["fund_e"]));

    // ---- trading after EJECT fails ----
    let late = ani
        .call(&coin, "buy")
        .args_json(json!({}))
        .deposit(NearToken::from_near(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(late.is_failure(), "buy after eject must fail");

    // ---- everyone claims ----
    let mut paid = 0u128;
    for who in [&ani, &budi, &cici] {
        let view: Value = who
            .view(&coin, "holder")
            .args_json(json!({"account_id": who.id()}))
            .await?
            .json()?;
        let expected = u128_of(&view["reserve_part"]) + u128_of(&view["fund_part"]);
        let before = who.view_account().await?.balance.as_yoctonear();
        let c = who
            .call(&coin, "claim")
            .gas(Gas::from_tgas(50))
            .transact()
            .await?;
        assert!(c.is_success(), "claim failed: {c:?}");
        let gas = tgas(&c);
        let got = u128_of(&c.json::<Value>()?);
        assert_eq!(got, expected, "holder view must predict the claim");
        let after = who.view_account().await?.balance.as_yoctonear();
        assert!(after > before, "balance must go up after claim");
        println!(
            "GAS claim: {:.1} Tgas, payout {:.4} NEAR",
            gas,
            got as f64 / 1e24
        );
        paid += got;
    }
    assert!(paid <= reserve_e + fund_e);
    assert!(
        reserve_e + fund_e - paid < 1_000_000,
        "only dust may remain"
    );

    // ---- protocol fees reach the fixed account ----
    let fees_before = env.fees.view_account().await?.balance.as_yoctonear();
    let w = ani
        .call(&coin, "withdraw_protocol_fees")
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(w.is_success(), "withdraw failed: {w:?}");
    let fees_after = env.fees.view_account().await?.balance.as_yoctonear();
    assert!(
        fees_after > fees_before,
        "protocol fees must arrive at the protocol account"
    );
    Ok(())
}

#[tokio::test]
async fn launch_with_low_deposit_fails() -> anyhow::Result<()> {
    let env = setup().await?;
    let ani = user(&env, "ani", 10).await?;
    let out = ani
        .call(env.factory.id(), "create_coin")
        .args_json(json!({"name": "Seato", "symbol": "seato", "fee_preset": "standard", "day_length_sec": 10}))
        .deposit(NearToken::from_millinear(100))
        .max_gas()
        .transact()
        .await?;
    assert!(out.is_failure());
    let coins: Value = env
        .factory
        .view("get_coins")
        .args_json(json!({}))
        .await?
        .json()?;
    assert_eq!(coins.as_array().unwrap().len(), 0);
    Ok(())
}
