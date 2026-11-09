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
    Coin::new(
        "Seato".into(),
        "seato".into(),
        None,
        preset,
        REAL_DAY,
        protocol(),
    )
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
    assert_eq!(
        c.reserve,
        reserve_at(c.token.total_supply),
        "reserve must equal R(supply)"
    );
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
    let c = Coin::new(
        "Seato".into(),
        "seato".into(),
        None,
        FeePreset::Light,
        10,
        protocol(),
    );
    assert!(c.status().demo_time);
}

#[test]
#[should_panic(expected = "Only the factory")]
fn init_by_stranger_panics() {
    ctx(&user("mallory"), 0, START_NS);
    Coin::new(
        "Seato".into(),
        "seato".into(),
        None,
        FeePreset::Standard,
        REAL_DAY,
        protocol(),
    );
}

#[test]
#[should_panic(expected = "symbol must be")]
fn init_bad_symbol_panics() {
    ctx(&factory_id(), 0, START_NS);
    Coin::new(
        "Seato".into(),
        "SEATO".into(),
        None,
        FeePreset::Standard,
        REAL_DAY,
        protocol(),
    );
}

#[test]
#[should_panic(expected = "day_length_sec")]
fn init_bad_day_length_panics() {
    ctx(&factory_id(), 0, START_NS);
    Coin::new(
        "Seato".into(),
        "seato".into(),
        None,
        FeePreset::Standard,
        5,
        protocol(),
    );
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
    assert_eq!(
        c.reserve + (c.fund - 15 * NEAR / 100),
        net,
        "reserve plus dust equals net"
    );
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
        fresh(move || {
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
        });
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
        assert!(
            q.dust_to_fund.0 <= 10,
            "dust should be a few yocto, got {}",
            q.dust_to_fund.0
        );
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
    assert_eq!(
        5 * NEAR - out,
        c.fund + c.protocol_fees,
        "everything not paid out stays as fund or fees"
    );
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
    let users: Vec<AccountId> = ["ani", "budi", "cici", "whale"]
        .iter()
        .map(|n| user(n))
        .collect();
    for u in &users {
        register(&mut c, u);
    }
    let mut seed: u64 = 7;
    let mut rnd = || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
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
    ctx(
        &user("anyone"),
        0,
        START_NS + 3 * REAL_DAY * 1_000_000_000 + 5,
    );
    assert_eq!(c.status().age_days, 3);
}

// =====================================================================================
// M2: accounting, alive detector, EJECT, claim
// =====================================================================================

const DEMO_DAY: u64 = 10; // seconds
const SEC: u64 = 1_000_000_000; // ns

fn at_day(day: u64) -> u64 {
    START_NS + day * DEMO_DAY * SEC
}

fn setup_demo(preset: FeePreset) -> Coin {
    ctx(&factory_id(), 0, START_NS);
    Coin::new(
        "Seato".into(),
        "seato".into(),
        None,
        preset,
        DEMO_DAY,
        protocol(),
    )
}

fn buy_at(c: &mut Coin, a: &AccountId, amount: u128, day: u64) -> u128 {
    ctx(a, amount, at_day(day));
    c.buy(None).0
}

fn sell_at(c: &mut Coin, a: &AccountId, d: u128, day: u64) -> u128 {
    ctx(a, 0, at_day(day));
    c.sell(U128(d), None).0
}

fn transfer_at(c: &mut Coin, from: &AccountId, to: &AccountId, d: u128, day: u64) {
    ctx(from, 1, at_day(day));
    c.ft_transfer(to.clone(), U128(d), None);
}

fn eject_at(c: &mut Coin, day: u64) -> EjectSnapshot {
    ctx(&user("anyone"), 0, at_day(day));
    c.eject()
}

fn claim_at(c: &mut Coin, a: &AccountId, day: u64) -> u128 {
    ctx(a, 0, at_day(day));
    c.claim().0
}

fn h(c: &Coin, a: &AccountId) -> Holder {
    c.holders.get(a).cloned().unwrap_or_default()
}

/// Invariant 3: s_pos equals the sum of scaled positive basis over all holders.
fn assert_s_pos(c: &Coin, users: &[AccountId]) {
    let sum: u128 = users
        .iter()
        .map(|u| accounting::scaled(h(c, u).basis))
        .sum();
    assert_eq!(
        c.ledger.s_pos, sum,
        "s_pos must equal the sum of positive basis"
    );
}

/// Holder weights accrued to `now` must sum to the live total exactly.
fn assert_weights(c: &Coin, users: &[AccountId], now_sec: u64) {
    let sum: u128 = users
        .iter()
        .map(|u| Ledger::live_weight(&h(c, u), now_sec))
        .sum();
    assert_eq!(
        sum,
        c.ledger.live_total(now_sec),
        "weights must sum to the total"
    );
}

/// Runs `f` in a fresh thread, so it gets a fresh mocked blockchain (empty storage).
/// Needed when one test creates more than one coin: the mock keeps storage between coins.
fn fresh<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::spawn(f)
        .join()
        .expect("scenario thread panicked")
}

fn crew() -> Vec<AccountId> {
    ["ani", "budi", "cici", "whale"]
        .iter()
        .map(|n| user(n))
        .collect()
}

#[test]
fn full_lifecycle_pays_everyone_and_conserves_near() {
    let mut c = setup_demo(FeePreset::Standard);
    let users = crew();
    for u in &users {
        register(&mut c, u);
    }
    let (ani, budi, cici) = (&users[0], &users[1], &users[2]);
    let mut total_in = 0u128;
    let mut total_out = 0u128;
    buy_at(&mut c, ani, 10 * NEAR, 0);
    total_in += 10 * NEAR;
    let d_c = buy_at(&mut c, cici, 20 * NEAR, 2);
    total_in += 20 * NEAR;
    total_out += sell_at(&mut c, cici, d_c / 2, 5);
    buy_at(&mut c, budi, 10 * NEAR, 6);
    total_in += 10 * NEAR;
    assert_s_pos(&c, &users);
    assert_weights(&c, &users, at_day(6) / SEC);

    // day 19: day 6 left the window, nothing bought since, so the coin is ejectable
    ctx(&user("anyone"), 0, at_day(19));
    assert!(
        !c.status().ejectable,
        "day 6 buy is still in the window on day 19"
    );
    ctx(&user("anyone"), 0, at_day(20));
    assert!(c.status().ejectable);
    let snap = eject_at(&mut c, 20);
    assert_eq!(snap.reserve_e.0, c.reserve);

    let mut claimed = 0u128;
    for u in [ani, budi, cici] {
        let view = c.holder(u.clone());
        let got = claim_at(&mut c, u, 21);
        assert_eq!(
            got,
            view.reserve_part.0 + view.fund_part.0,
            "view must predict the claim"
        );
        assert!(got > 0);
        claimed += got;
    }
    assert!(claimed <= snap.reserve_e.0 + snap.fund_e.0);
    // leftovers are rounding dust only
    assert!(
        c.reserve + c.fund < 1_000_000,
        "dust left: {}",
        c.reserve + c.fund
    );
    assert_eq!(c.token.total_supply, 0);
    assert_eq!(
        total_in - total_out - claimed,
        c.reserve + c.fund + c.protocol_fees
    );
    // the loyal early holder gets a larger fund share than the late one per NEAR at risk
    assert!(h(&c, ani).weight > h(&c, budi).weight);
}

#[test]
#[should_panic(expected = "Too young to eject")]
fn eject_too_young_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    eject_at(&mut c, 13);
}

#[test]
#[should_panic(expected = "still alive")]
fn eject_while_alive_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy_at(&mut c, &a, 10 * NEAR, 0);
    buy_at(&mut c, &a, 2 * NEAR, 14); // 2 NEAR >= max(1 NEAR, 5% of 12 NEAR peak)
    eject_at(&mut c, 15);
}

#[test]
#[should_panic(expected = "Already ejected")]
fn eject_twice_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    eject_at(&mut c, 14);
    eject_at(&mut c, 15);
}

#[test]
fn a_buy_revives_a_dying_coin() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy_at(&mut c, &a, 10 * NEAR, 0);
    ctx(&a, 0, at_day(14));
    assert!(c.status().ejectable);
    buy_at(&mut c, &a, NEAR, 14);
    ctx(&a, 0, at_day(14));
    assert!(
        !c.status().ejectable,
        "1 NEAR >= threshold max(1 NEAR, 0.55 NEAR)"
    );
}

#[test]
#[should_panic(expected = "ejected")]
fn buy_after_eject_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    eject_at(&mut c, 14);
    buy_at(&mut c, &a, NEAR, 15);
}

#[test]
#[should_panic(expected = "ejected")]
fn sell_after_eject_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let d = buy_at(&mut c, &a, NEAR, 0);
    eject_at(&mut c, 14);
    sell_at(&mut c, &a, d, 15);
}

#[test]
#[should_panic(expected = "ejected")]
fn transfer_after_eject_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    let (a, b) = (user("ani"), user("budi"));
    register(&mut c, &a);
    register(&mut c, &b);
    let d = buy_at(&mut c, &a, NEAR, 0);
    eject_at(&mut c, 14);
    transfer_at(&mut c, &a, &b, d, 15);
}

#[test]
#[should_panic(expected = "Not ejected yet")]
fn claim_before_eject_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy_at(&mut c, &a, NEAR, 0);
    claim_at(&mut c, &a, 1);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn claim_twice_panics() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    buy_at(&mut c, &a, NEAR, 0);
    eject_at(&mut c, 14);
    claim_at(&mut c, &a, 15);
    claim_at(&mut c, &a, 16);
}

#[test]
fn full_exit_forfeits_weight() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let d = buy_at(&mut c, &a, 5 * NEAR, 0);
    sell_at(&mut c, &a, d, 3);
    let ha = h(&c, &a);
    assert_eq!((ha.basis, ha.weight), (0, 0));
    assert_eq!(c.ledger.w_total, 0);
    assert_eq!(c.ledger.s_pos, 0);
}

#[test]
fn transfer_moves_basis_but_not_weight() {
    let mut c = setup_demo(FeePreset::Standard);
    let (a, b) = (user("ani"), user("budi"));
    register(&mut c, &a);
    register(&mut c, &b);
    let d = buy_at(&mut c, &a, 10 * NEAR, 0);
    // half on day 5: Ani keeps her weight, half her basis moves to Budi
    transfer_at(&mut c, &a, &b, d / 2, 5);
    let (ha, hb) = (h(&c, &a), h(&c, &b));
    assert_eq!(hb.weight, 0, "receiver starts from zero weight");
    assert!(ha.weight > 0);
    assert_eq!(ha.basis + hb.basis, 10 * NEAR as i128);
    assert!((hb.basis - 5 * NEAR as i128).abs() <= 1);
    // the rest on day 6: Ani leaves the ship
    transfer_at(&mut c, &a, &b, d - d / 2, 6);
    let (ha, hb) = (h(&c, &a), h(&c, &b));
    assert_eq!((ha.basis, ha.weight), (0, 0));
    assert_eq!(hb.basis, 10 * NEAR as i128);
    let users = [a, b];
    assert_s_pos(&c, &users);
    assert_weights(&c, &users, at_day(6) / SEC);
}

#[test]
fn eject_with_no_holders_routes_fund_to_protocol() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let d = buy_at(&mut c, &a, 5 * NEAR, 0);
    sell_at(&mut c, &a, d, 1);
    let fund = c.fund;
    let fees = c.protocol_fees;
    assert!(fund > 0);
    let snap = eject_at(&mut c, 15);
    assert_eq!(snap.supply_e.0, 0);
    assert_eq!(snap.fund_e.0, 0);
    assert_eq!(c.protocol_fees, fees + fund);
}

#[test]
fn late_whale_cannot_farm_the_fund() {
    let mut c = setup_demo(FeePreset::Standard);
    let users = crew();
    for u in &users {
        register(&mut c, u);
    }
    // early hype, then some exits
    buy_at(&mut c, &users[0], 20 * NEAR, 0);
    let d_b = buy_at(&mut c, &users[1], 30 * NEAR, 1);
    buy_at(&mut c, &users[2], 15 * NEAR, 2);
    sell_at(&mut c, &users[1], d_b, 4);
    // day 16: the coin is about to be ejected, the whale buys big
    ctx(&users[3], 0, at_day(16));
    assert!(c.status().ejectable);
    let whale_in = 50 * NEAR;
    buy_at(&mut c, &users[3], whale_in, 16);
    ctx(&users[3], 0, at_day(16));
    assert!(
        !c.status().ejectable,
        "the whale's own buy keeps the coin alive"
    );
    // nobody else trades; ejectable again once the whale buy leaves the window
    ctx(&users[3], 0, at_day(29));
    assert!(!c.status().ejectable);
    eject_at(&mut c, 30);
    let whale_out = claim_at(&mut c, &users[3], 31);
    let loss_pct = (whale_in - whale_out) * 100 / whale_in;
    assert!(
        loss_pct >= 20,
        "whale should lose a lot, lost only {loss_pct}%"
    );
}

#[test]
fn sybil_split_gives_no_advantage() {
    // Scenario A: one account buys 2 x 5 NEAR. Scenario B: two accounts buy 5 NEAR each.
    // Same times, same everything else. Fund shares must match.
    let run = |split: bool| -> u128 {
        fresh(move || {
            let mut c = setup_demo(FeePreset::Standard);
            let users = crew();
            for u in &users {
                register(&mut c, u);
            }
            buy_at(&mut c, &users[0], 10 * NEAR, 0);
            if split {
                buy_at(&mut c, &users[1], 5 * NEAR, 1);
                buy_at(&mut c, &users[2], 5 * NEAR, 1);
            } else {
                buy_at(&mut c, &users[1], 5 * NEAR, 1);
                buy_at(&mut c, &users[1], 5 * NEAR, 1);
            }
            eject_at(&mut c, 15);
            let mut fund_parts = 0;
            for u in if split {
                vec![&users[1], &users[2]]
            } else {
                vec![&users[1]]
            } {
                fund_parts += c.holder(u.clone()).fund_part.0;
            }
            fund_parts
        })
    };
    let (one, two) = (run(false), run(true));
    let diff = one.abs_diff(two);
    assert!(
        diff <= one / 1_000_000_000,
        "sybil split changed the fund share: {one} vs {two}"
    );
}

#[test]
fn random_ops_keep_all_invariants() {
    let mut c = setup_demo(FeePreset::High);
    let users = crew();
    for u in &users {
        register(&mut c, u);
    }
    let mut seed: u64 = 99;
    let mut rnd = || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        seed >> 33
    };
    let (mut total_in, mut total_out) = (0u128, 0u128);
    let mut day = 0;
    for _ in 0..200 {
        day += rnd() % 2; // time moves forward sometimes
        if day > 12 {
            break;
        }
        let i = (rnd() % 4) as usize;
        let u = &users[i];
        let bal = balance(&c, u);
        match rnd() % 4 {
            0 | 1 => {
                let amount = MIN_BUY + (rnd() as u128 % 10) * NEAR + rnd() as u128;
                buy_at(&mut c, u, amount, day);
                total_in += amount;
            }
            2 if bal > 0 => {
                let d = 1 + (rnd() as u128 * 31) % bal;
                ctx(u, 0, at_day(day));
                if c.quote_sell(U128(d)).near_out.0 > 0 {
                    total_out += sell_at(&mut c, u, d, day);
                }
            }
            3 if bal > 0 => {
                let to = &users[(i + 1 + (rnd() % 3) as usize) % 4];
                let d = 1 + (rnd() as u128 * 17) % bal;
                transfer_at(&mut c, u, to, d, day);
            }
            _ => {}
        }
        assert_curve_invariant(&c);
        assert_s_pos(&c, &users);
        assert_weights(&c, &users, at_day(day) / SEC);
        assert_eq!(total_in - total_out, c.reserve + c.fund + c.protocol_fees);
    }
    // let it die and settle
    let eject_day = day + 15;
    let snap = eject_at(&mut c, eject_day);
    let mut claimed = 0u128;
    for u in &users {
        if balance(&c, u) > 0 {
            claimed += claim_at(&mut c, u, eject_day + 1);
        }
    }
    assert!(claimed <= snap.reserve_e.0 + snap.fund_e.0);
    assert_eq!(
        total_in - total_out - claimed,
        c.reserve + c.fund + c.protocol_fees
    );
    assert!(
        c.reserve + c.fund < 1_000_000,
        "only rounding dust may stay"
    );
}

#[test]
fn storage_includes_holder_entry_and_unregister_cleans_it() {
    let mut c = setup_demo(FeePreset::Standard);
    let probe_ft = FungibleToken::new(b"probe".to_vec());
    assert!(
        c.token.account_storage_usage > probe_ft.account_storage_usage,
        "storage per account must include the accounting entry"
    );
    let a = user("ani");
    register(&mut c, &a);
    let d = buy_at(&mut c, &a, NEAR, 0);
    sell_at(&mut c, &a, d, 1);
    ctx(&a, 1, at_day(1));
    assert!(c.storage_unregister(None));
    assert!(c.holders.get(&a).is_none());
}

// =====================================================================================
// Parity with the simulation formulas (sim/ejecto-sim.mjs) and wash trading
// =====================================================================================

/// The simulation works in NEAR (f64) and millions of tokens:
/// price(s) = 0.02 + 0.0005 * s, reserveAt(s) = 0.02 * s + 0.0005 / 2 * s^2,
/// fund += 1.5% of buys (standard) and 2% of sells. The contract must match these
/// formulas up to floating point and integer rounding.
#[test]
fn contract_matches_simulation_formulas() {
    const P0_SIM: f64 = 0.02;
    const K_SIM: f64 = 0.0005;
    let reserve_sim = |s: f64| P0_SIM * s + K_SIM / 2.0 * s * s;
    let tokens_sim = |s: f64, net: f64| {
        let b = P0_SIM + K_SIM * s;
        (-b + (b * b + 2.0 * K_SIM * net).sqrt()) / K_SIM
    };
    let to_millions = |raw: u128| raw as f64 / 1e24; // 1e18 raw per token, 1e6 tokens
    let to_near = |y: u128| y as f64 / 1e24;
    let close = |a: f64, b: f64| (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1e-12);

    let mut c = setup(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let (mut s_sim, mut fund_sim, mut reserve_sim_acc) = (0.0f64, 0.0f64, 0.0f64);
    for amount_near in [0.5f64, 2.0, 7.25, 13.0, 0.75, 40.0] {
        let amount = (amount_near * 1e24) as u128;
        let d = buy(&mut c, &a, amount);
        let net = amount_near * (1.0 - 0.015 - 0.005);
        let d_sim = tokens_sim(s_sim, net);
        assert!(
            close(to_millions(d), d_sim),
            "tokens {} vs sim {}",
            to_millions(d),
            d_sim
        );
        s_sim += d_sim;
        fund_sim += amount_near * 0.015;
        reserve_sim_acc += net;
        assert!(close(to_near(c.reserve), reserve_sim(s_sim)));
        assert!(close(to_near(c.reserve), reserve_sim_acc));
        assert!(
            close(to_near(c.fund), fund_sim),
            "fund {} vs sim {}",
            to_near(c.fund),
            fund_sim
        );
    }
    // a sell: gross = R(s) - R(s - d), fund += 2% of gross
    let bal = balance(&c, &a);
    let d = bal / 3;
    let out = sell(&mut c, &a, d);
    let d_m = to_millions(d);
    let gross_sim = reserve_sim(s_sim) - reserve_sim(s_sim - d_m);
    assert!(
        close(to_near(out), gross_sim * 0.98),
        "sell {} vs sim {}",
        to_near(out),
        gross_sim * 0.98
    );
    fund_sim += gross_sim * 0.02;
    assert!(close(to_near(c.fund), fund_sim));
}

/// Fund split by net basis x time must match the simulation's weighting.
#[test]
fn fund_split_matches_simulation_weighting() {
    let mut c = setup_demo(FeePreset::Standard);
    let users = crew();
    for u in &users {
        register(&mut c, u);
    }
    // (who, day, NEAR in)
    let plan: [(usize, u64, f64); 4] = [(0, 0, 10.0), (1, 2, 4.0), (2, 5, 6.0), (0, 6, 2.0)];
    for (i, day, near) in plan {
        buy_at(&mut c, &users[i], (near * 1e24) as u128, day);
    }
    let eject_day = 20;
    eject_at(&mut c, eject_day);
    // simulation weighting: basis_i * (t_e - t_buy), summed per holder, in NEAR x days
    let mut w = [0.0f64; 4];
    for (i, day, near) in plan {
        w[i] += near * (eject_day - day) as f64;
    }
    let total: f64 = w.iter().sum();
    let fund_e = u128_of_snap(&c);
    for (i, u) in users.iter().enumerate().take(3) {
        let got = c.holder(u.clone()).fund_part.0 as f64;
        let want = fund_e * w[i] / total;
        assert!(
            (got - want).abs() <= want * 1e-9 + 2.0,
            "holder {i}: {got} vs {want}"
        );
    }
}

fn u128_of_snap(c: &Coin) -> f64 {
    c.ejected.as_ref().unwrap().fund_e.0 as f64
}

#[test]
fn wash_trading_mostly_feeds_the_fund() {
    let mut c = setup_demo(FeePreset::Standard);
    let (ani, washer) = (user("ani"), user("whale"));
    register(&mut c, &ani);
    register(&mut c, &washer);
    buy_at(&mut c, &ani, 10 * NEAR, 0);
    let fund0 = c.fund;
    let (mut spent, mut got) = (0u128, 0u128);
    for day in 1..30 {
        let d = buy_at(&mut c, &washer, 3 * NEAR, day);
        spent += 3 * NEAR;
        got += sell_at(&mut c, &washer, d, day);
    }
    let cost = spent - got;
    let fund_growth = c.fund - fund0;
    let share = fund_growth * 100 / cost;
    // standard preset: 1.5% + 2% of ~4% round-trip cost goes to the fund, 0.5% to protocol
    assert!(
        share >= 85,
        "only {share}% of the wash cost reached the fund"
    );
    assert_eq!(
        h(&c, &washer).weight,
        0,
        "the washer never stays, so never earns weight"
    );
}
