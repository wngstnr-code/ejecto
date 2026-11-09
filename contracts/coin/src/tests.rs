//! Unit tests for the coin contract (M1: token, curve, fees, fund, protocol fees).

use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const START_NS: u64 = 1_700_000_000_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn coin_id() -> AccountId {
    acc("seato.factory.ejecto.testnet")
}
fn factory_id() -> AccountId {
    acc("factory.ejecto.testnet")
}
fn protocol() -> AccountId {
    acc("fees.ejecto.testnet")
}
fn user(n: &str) -> AccountId {
    acc(&format!("{n}.ejecto.testnet"))
}

fn ctx(predecessor: &AccountId, deposit: u128, ts_ns: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(coin_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts_ns);
    testing_env!(b.build());
}

fn setup(preset: FeePreset) -> Coin {
    ctx(&factory_id(), 0, START_NS);
    Coin::new("Seato".into(), "seato".into(), None, preset, REAL_DAY, protocol())
}

fn register(c: &mut Coin, a: &AccountId) {
    let min = c.storage_balance_bounds().min.as_yoctonear();
    ctx(a, min, START_NS);
    c.storage_deposit(None, None);
}

fn buy(c: &mut Coin, a: &AccountId, amount: u128) -> u128 {
    ctx(a, amount, START_NS);
    c.buy(None).0
}

fn sell(c: &mut Coin, a: &AccountId, d: u128) -> u128 {
    ctx(a, 0, START_NS);
    c.sell(U128(d), None).0
}

fn balance(c: &Coin, a: &AccountId) -> u128 {
    c.ft_balance_of(a.clone()).0
}

fn assert_curve_invariant(c: &Coin) {
    assert_eq!(c.reserve, reserve_at(c.token.total_supply), "reserve must equal R(supply)");
}

// ---------- init ----------

#[test]
fn init_by_parent_sets_params() {
    let c = setup(FeePreset::Standard);
    let s = c.status();
    assert_eq!(s.fund_buy_bps, 150);
    assert_eq!(s.fund_sell_bps, 200);
    assert_eq!(s.protocol_buy_bps, 50);
    assert_eq!(s.factory, factory_id());
    assert!(!s.demo_time);
    assert_eq!(s.supply.0, 0);
    assert_eq!(s.price.0, curve::P0);
}

#[test]
fn init_by_self_is_allowed() {
    ctx(&coin_id(), 0, START_NS);
    let c = Coin::new("Seato".into(), "seato".into(), None, FeePreset::Light, 10, protocol());
    assert!(c.status().demo_time);
}

#[test]
#[should_panic(expected = "Only the factory")]
fn init_by_stranger_panics() {
    ctx(&user("mallory"), 0, START_NS);
    Coin::new("Seato".into(), "seato".into(), None, FeePreset::Standard, REAL_DAY, protocol());
}

#[test]
#[should_panic(expected = "symbol must be")]
fn init_bad_symbol_panics() {
    ctx(&factory_id(), 0, START_NS);
    Coin::new("Seato".into(), "SEATO".into(), None, FeePreset::Standard, REAL_DAY, protocol());
}

#[test]
#[should_panic(expected = "day_length_sec")]
fn init_bad_day_length_panics() {
    ctx(&factory_id(), 0, START_NS);
    Coin::new("Seato".into(), "seato".into(), None, FeePreset::Standard, 5, protocol());
}

// ---------- buy ----------

#[test]
fn buy_splits_fees_standard() {
    let mut c = setup(FeePreset::Standard);
    let ani = user("ani");
    register(&mut c, &ani);
    let tokens = buy(&mut c, &ani, 10 * NEAR);
    assert!(tokens > 0);
    assert_eq!(balance(&c, &ani), tokens);
    // fund fee 1.5%, protocol 0.5%
    assert_eq!(c.protocol_fees, NEAR / 20);
    let net = 10 * NEAR - 15 * NEAR / 100 - NEAR / 20;
    assert_eq!(c.reserve + (c.fund - 15 * NEAR / 100), net, "reserve plus dust equals net");
    assert!(c.fund >= 15 * NEAR / 100);
    assert_curve_invariant(&c);
}

#[test]
fn fee_presets_match_spec() {
    for (preset, buy_bps, sell_bps) in [
        (FeePreset::Light, 50u128, 100u128),
        (FeePreset::Standard, 150, 200),
        (FeePreset::High, 300, 500),
    ] {
        let mut c = setup(preset);
        let a = user("ani");
        register(&mut c, &a);
        let d = buy(&mut c, &a, 4 * NEAR);
        let fund_after_buy = c.fund;
        assert!(fund_after_buy >= 4 * NEAR * buy_bps / BPS);
        let q = c.quote_sell(U128(d));
        assert_eq!(q.fund_fee.0, (q.gross.0 * sell_bps).div_ceil(BPS));
        sell(&mut c, &a, d);
        assert_eq!(c.fund, fund_after_buy + q.fund_fee.0);
    }
}

#[test]
fn fees_round_up() {
    assert_eq!(fee_up(1, 150), 1);
    assert_eq!(fee_up(10_000, 150), 150);
    assert_eq!(fee_up(10_001, 150), 151);
    assert_eq!(fee_up(0, 150), 0);
}

#[test]
#[should_panic(expected = "Register first")]
fn buy_unregistered_panics() {
    let mut c = setup(FeePreset::Standard);
    buy(&mut c, &user("ani"), NEAR);
}

#[test]
#[should_panic(expected = "Minimum buy")]
fn buy_below_minimum_panics() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy(&mut c, &a, MIN_BUY - 1);
}

#[test]
#[should_panic(expected = "Slippage")]
fn buy_slippage_panics() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let q = c.quote_buy(U128(NEAR));
    ctx(&a, NEAR, START_NS);
    c.buy(Some(U128(q.tokens_out.0 + 1)));
}

#[test]
#[should_panic(expected = "Buy would exceed the supply cap")]
fn buy_past_supply_cap_panics() {
    let mut c = setup(FeePreset::Standard);
    let a = user("whale");
    register(&mut c, &a);
    buy(&mut c, &a, 30_000 * NEAR); // the reserve at the cap is about 25,000 NEAR
}

#[test]
fn dust_is_tiny_for_normal_buys() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    for amount in [MIN_BUY, NEAR, 7 * NEAR + 3, 123 * NEAR] {
        let q = c.quote_buy(U128(amount));
        assert!(q.dust_to_fund.0 <= 10, "dust should be a few yocto, got {}", q.dust_to_fund.0);
        buy(&mut c, &a, amount);
    }
}

#[test]
fn quote_buy_matches_buy() {
    let mut c = setup(FeePreset::High);
    let a = user("ani");
    register(&mut c, &a);
    buy(&mut c, &a, 3 * NEAR);
    let q = c.quote_buy(U128(7 * NEAR));
    let reserve0 = c.reserve;
    let got = buy(&mut c, &a, 7 * NEAR);
    assert_eq!(got, q.tokens_out.0);
    assert_eq!(c.reserve - reserve0, q.cost.0);
    assert_eq!(c.status().price, q.price_after);
}

// ---------- sell ----------

#[test]
fn buy_then_sell_everything_empties_the_curve() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let d = buy(&mut c, &a, 5 * NEAR);
    let q = c.quote_sell(U128(d));
    let out = sell(&mut c, &a, d);
    assert_eq!(out, q.near_out.0);
    assert_eq!(c.token.total_supply, 0);
    assert_eq!(c.reserve, 0);
    assert!(out < 5 * NEAR, "round trip must cost fees");
    assert_eq!(5 * NEAR - out, c.fund + c.protocol_fees, "everything not paid out stays as fund or fees");
}

#[test]
#[should_panic(expected = "Not enough tokens")]
fn sell_more_than_balance_panics() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let d = buy(&mut c, &a, NEAR);
    sell(&mut c, &a, d + 1);
}

#[test]
#[should_panic(expected = "Amount must be positive")]
fn sell_zero_panics() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy(&mut c, &a, NEAR);
    sell(&mut c, &a, 0);
}

#[test]
#[should_panic(expected = "Slippage")]
fn sell_slippage_panics() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let d = buy(&mut c, &a, NEAR);
    let q = c.quote_sell(U128(d));
    ctx(&a, 0, START_NS);
    c.sell(U128(d), Some(U128(q.near_out.0 + 1)));
}

// ---------- conservation under many trades ----------

#[test]
fn random_trades_conserve_every_yocto() {
    let mut c = setup(FeePreset::Standard);
    let users: Vec<AccountId> = ["ani", "budi", "cici", "whale"].iter().map(|n| user(n)).collect();
    for u in &users {
        register(&mut c, u);
    }
    let mut seed: u64 = 7;
    let mut rnd = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        seed >> 33
    };
    let (mut total_in, mut total_out, mut withdrawn) = (0u128, 0u128, 0u128);
    for step in 0..300 {
        let u = &users[(rnd() % 4) as usize];
        let bal = balance(&c, u);
        if bal == 0 || rnd() % 3 != 0 {
            let amount = MIN_BUY + (rnd() as u128 % 20) * NEAR / 3 + rnd() as u128;
            buy(&mut c, u, amount);
            total_in += amount;
        } else {
            let d = 1 + (rnd() as u128 * 997) % bal;
            if c.quote_sell(U128(d)).near_out.0 == 0 {
                continue;
            }
            total_out += sell(&mut c, u, d);
        }
        if step % 50 == 49 && c.protocol_fees > 0 {
            ctx(&user("anyone"), 0, START_NS);
            withdrawn += c.withdraw_protocol_fees().0;
        }
        assert_curve_invariant(&c);
        assert_eq!(
            total_in - total_out - withdrawn,
            c.reserve + c.fund + c.protocol_fees,
            "NEAR must be conserved exactly"
        );
    }
    let supply: u128 = users.iter().map(|u| balance(&c, u)).sum();
    assert_eq!(supply, c.token.total_supply);
}

// ---------- protocol fees ----------

#[test]
fn protocol_fees_withdraw_resets() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy(&mut c, &a, 2 * NEAR);
    ctx(&user("anyone"), 0, START_NS);
    assert_eq!(c.withdraw_protocol_fees().0, 2 * NEAR / 200);
    assert_eq!(c.protocol_fees, 0);
}

#[test]
#[should_panic(expected = "No protocol fees")]
fn protocol_fees_withdraw_empty_panics() {
    let mut c = setup(FeePreset::Standard);
    ctx(&user("anyone"), 0, START_NS);
    c.withdraw_protocol_fees();
}

// ---------- token standards ----------

#[test]
fn ft_transfer_moves_tokens() {
    let mut c = setup(FeePreset::Standard);
    let (a, b) = (user("ani"), user("budi"));
    register(&mut c, &a);
    register(&mut c, &b);
    let d = buy(&mut c, &a, NEAR);
    ctx(&a, 1, START_NS);
    c.ft_transfer(b.clone(), U128(d / 2), None);
    assert_eq!(balance(&c, &b), d / 2);
    assert_eq!(balance(&c, &a), d - d / 2);
    assert_curve_invariant(&c);
}

#[test]
#[should_panic(expected = "Forced unregister is disabled")]
fn force_unregister_panics() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy(&mut c, &a, NEAR);
    ctx(&a, 1, START_NS);
    c.storage_unregister(Some(true));
}

#[test]
fn unregister_with_zero_balance_works() {
    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    ctx(&a, 1, START_NS);
    assert!(c.storage_unregister(None));
}

#[test]
fn metadata_is_nep148() {
    let c = setup(FeePreset::Standard);
    let m = c.ft_metadata();
    assert_eq!(m.spec, FT_METADATA_SPEC);
    assert_eq!(m.symbol, "SEATO");
    assert_eq!(m.decimals, 18);
}

// ---------- status ----------

#[test]
fn status_age_counts_days() {
    let c = setup(FeePreset::Standard);
    ctx(&user("anyone"), 0, START_NS + 3 * REAL_DAY * 1_000_000_000 + 5);
    assert_eq!(c.status().age_days, 3);
}
