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
    assert_eq!(c.status().day, 3);
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
    let w_before = Ledger::live_weight(&h(&c, &a), at_day(5) / SEC);
    // half on day 5: half of Ani's basis moves to Budi, Ani sheds half of her weight
    transfer_at(&mut c, &a, &b, d / 2, 5);
    let (ha, hb) = (h(&c, &a), h(&c, &b));
    assert_eq!(
        hb.weight, 0,
        "receiver starts from zero weight, weight never moves"
    );
    assert!(
        ha.weight.abs_diff(w_before / 2) <= 1,
        "sender keeps only half: {} vs {}",
        ha.weight,
        w_before / 2
    );
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

// =====================================================================================
// ft_transfer_call refunds (ft_resolve_transfer) with a mocked promise result
// =====================================================================================

/// Calls `ft_resolve_transfer` as the contract itself, with the receiver reporting
/// `unused` tokens (the part that must be refunded to the sender).
fn resolve_with_unused(
    c: &mut Coin,
    sender: &AccountId,
    receiver: &AccountId,
    amount: u128,
    unused: u128,
    day: u64,
) -> u128 {
    let mut b = VMContextBuilder::new();
    b.current_account_id(coin_id())
        .predecessor_account_id(coin_id())
        .block_timestamp(at_day(day));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Successful(
            format!("\"{unused}\"").into_bytes()
        )],
    );
    c.ft_resolve_transfer(sender.clone(), receiver.clone(), U128(amount))
        .0
}

fn transfer_call_at(c: &mut Coin, from: &AccountId, to: &AccountId, d: u128, day: u64) {
    ctx(from, 1, at_day(day));
    let _ = c.ft_transfer_call(to.clone(), U128(d), None, String::new());
}

#[test]
fn transfer_call_refund_moves_basis_back() {
    let mut c = setup_demo(FeePreset::Standard);
    let (a, b) = (user("ani"), user("budi"));
    register(&mut c, &a);
    register(&mut c, &b);
    let d = buy_at(&mut c, &a, 10 * NEAR, 0);
    let half = d / 2;
    transfer_call_at(&mut c, &a, &b, half, 1);
    assert_eq!(
        h(&c, &b).basis,
        0,
        "no accounting while the tokens are in flight"
    );
    // the receiver uses only half of what it got, the other half comes back
    let unused = half / 2;
    let used = resolve_with_unused(&mut c, &a, &b, half, unused, 2);
    assert_eq!(used, half - unused);
    assert_eq!(balance(&c, &b), half - unused);
    assert_eq!(balance(&c, &a), d - half + unused);
    // only the used quarter is booked: about 2.5 NEAR of Ani's basis moves to Budi
    let (ha, hb) = (h(&c, &a), h(&c, &b));
    assert!(
        (hb.basis - 25 * NEAR as i128 / 10).abs() <= 2,
        "budi basis {}",
        hb.basis
    );
    assert_eq!(ha.basis + hb.basis, 10 * NEAR as i128);
    let users = [a, b];
    assert_s_pos(&c, &users);
    assert_weights(&c, &users, at_day(2) / SEC);
}

#[test]
fn transfer_call_full_refund_after_eject_moves_tokens_only() {
    let mut c = setup_demo(FeePreset::Standard);
    let (a, b) = (user("ani"), user("budi"));
    register(&mut c, &a);
    register(&mut c, &b);
    let d = buy_at(&mut c, &a, 10 * NEAR, 0);
    transfer_call_at(&mut c, &a, &b, d / 2, 1);
    let snap = eject_at(&mut c, 15);
    let (ha0, hb0) = (h(&c, &a), h(&c, &b));
    let receiver_weight = hb0.weight;
    // the callback lands after EJECT and refunds everything
    let used = resolve_with_unused(&mut c, &a, &b, d / 2, d / 2, 16);
    assert_eq!(used, 0);
    assert_eq!(balance(&c, &a), d);
    assert_eq!(balance(&c, &b), 0);
    assert_eq!(
        (h(&c, &a), h(&c, &b)),
        (ha0, hb0),
        "accounting is frozen after EJECT"
    );
    assert_eq!(
        receiver_weight, 0,
        "the receiver never got basis for in-flight tokens, so no stranded weight"
    );
    // weights at t_e still sum to w_e, so claims stay within the snapshot
    let users = [a.clone(), b.clone()];
    let wsum: u128 = users
        .iter()
        .map(|u| Ledger::live_weight(&h(&c, u), snap.t_e))
        .sum();
    assert_eq!(wsum, snap.w_e.0);
    let got = claim_at(&mut c, &a, 17);
    assert!(got <= snap.reserve_e.0 + snap.fund_e.0);
}

// =====================================================================================
// Regression tests for the M1 to M3 review findings
// =====================================================================================

/// Finding: a refunded ft_transfer_call pulled basis out of the receiver.
#[test]
fn refund_cannot_drain_a_victims_basis() {
    let mut c = setup_demo(FeePreset::Standard);
    let (attacker, victim) = (user("whale"), user("ani"));
    register(&mut c, &attacker);
    register(&mut c, &victim);
    buy_at(&mut c, &victim, 20 * NEAR, 0);
    let x = buy_at(&mut c, &attacker, NEAR, 0);
    let victim_basis = h(&c, &victim).basis;
    let attacker_basis = h(&c, &attacker).basis;
    for day in 1..5 {
        // the victim has no contract, so ft_on_transfer fails and everything is refunded
        transfer_call_at(&mut c, &attacker, &victim, x, day);
        let used = resolve_with_unused(&mut c, &attacker, &victim, x, x, day);
        assert_eq!(used, 0);
    }
    assert_eq!(
        h(&c, &victim).basis,
        victim_basis,
        "victim basis must not move"
    );
    assert_eq!(
        h(&c, &attacker).basis,
        attacker_basis,
        "attacker gains nothing"
    );
    assert_eq!(balance(&c, &attacker), x);
}

/// Finding: keeping 1 raw token kept all accrued weight.
#[test]
fn keeping_dust_does_not_keep_the_weight() {
    let mut c = setup_demo(FeePreset::Standard);
    let a = user("ani");
    register(&mut c, &a);
    let d = buy_at(&mut c, &a, 10 * NEAR, 0);
    let w = Ledger::live_weight(&h(&c, &a), at_day(10) / SEC);
    sell_at(&mut c, &a, d - 1, 10);
    let kept = h(&c, &a).weight;
    assert!(kept <= w / d + 1, "dust kept {kept} of {w}");
}

/// Finding: moving tokens to a sybil and selling there kept the old weight at home.
#[test]
fn sending_tokens_away_sheds_weight() {
    let mut c = setup_demo(FeePreset::Standard);
    let (a, sybil) = (user("ani"), user("budi"));
    register(&mut c, &a);
    register(&mut c, &sybil);
    let d = buy_at(&mut c, &a, 10 * NEAR, 0);
    let w = Ledger::live_weight(&h(&c, &a), at_day(10) / SEC);
    let keep = d / 100;
    transfer_at(&mut c, &a, &sybil, d - keep, 10);
    let left = h(&c, &a).weight;
    assert!(
        left.abs_diff(w / 100) <= 2,
        "ani should keep about 1% of her weight, kept {left} of {w}"
    );
    sell_at(&mut c, &sybil, d - keep, 11);
    assert_eq!(h(&c, &sybil).weight, 0);
}

/// Finding: tokens refunded after a claim could not be claimed.
#[test]
fn claim_again_after_a_late_refund() {
    let mut c = setup_demo(FeePreset::Standard);
    let (a, b) = (user("ani"), user("budi"));
    register(&mut c, &a);
    register(&mut c, &b);
    let d = buy_at(&mut c, &a, 10 * NEAR, 0);
    buy_at(&mut c, &b, 5 * NEAR, 0);
    transfer_call_at(&mut c, &a, &b, d / 2, 1);
    let snap = eject_at(&mut c, 15);
    let first = claim_at(&mut c, &a, 16);
    // the callback lands after Ani's claim and refunds all in-flight tokens
    resolve_with_unused(&mut c, &a, &b, d / 2, d / 2, 17);
    assert_eq!(balance(&c, &a), d / 2);
    let view = c.holder(a.clone());
    assert_eq!(view.fund_part.0, 0, "the fund part is paid only once");
    let second = claim_at(&mut c, &a, 18);
    assert!(second > 0 && second == view.reserve_part.0);
    let third = claim_at(&mut c, &b, 18);
    assert!(first + second + third <= snap.reserve_e.0 + snap.fund_e.0);
    assert!(c.reserve + c.fund < 1_000_000);
}

/// Finding: any ancestor account could initialize the coin.
#[test]
#[should_panic(expected = "Only the factory")]
fn init_by_grandparent_panics() {
    ctx(&acc("ejecto.testnet"), 0, START_NS);
    Coin::new(
        "Seato".into(),
        "seato".into(),
        None,
        FeePreset::Standard,
        REAL_DAY,
        protocol(),
    );
}

// =====================================================================================
// Mayday (spec section 10, coin code v3): crowd rescue with a weight bonus, escrow, refunds
// =====================================================================================

fn mayday_at(c: &mut Coin, a: &AccountId, target: u128, deposit: u128, day: u64) -> Option<Mayday> {
    ctx(a, deposit, at_day(day));
    c.mayday(U128(target))
}

fn pledge_at(c: &mut Coin, a: &AccountId, amount: u128, day: u64) -> u128 {
    ctx(a, amount, at_day(day));
    c.pledge().0
}

fn collect_at(c: &mut Coin, a: &AccountId, day: u64) -> u128 {
    ctx(a, 0, at_day(day));
    c.collect().0
}

fn withdraw_at(c: &mut Coin, a: &AccountId, day: u64) -> u128 {
    ctx(a, 0, at_day(day));
    c.withdraw_pledge().0
}

fn status_at(c: &Coin, day: u64) -> Status {
    ctx(&user("anyone"), 0, at_day(day));
    c.status()
}

/// Holders plus the escrow (the coin account), for the weight and basis invariants.
fn with_escrow(users: &[AccountId]) -> Vec<AccountId> {
    let mut v = users.to_vec();
    v.push(coin_id());
    v
}

/// A coin bought only on day 0 (0.6 NEAR, under the 1 NEAR alive line), so it is ejectable from day 14.
fn dying_coin() -> (Coin, Vec<AccountId>) {
    let mut c = setup_demo(FeePreset::Standard);
    let users = crew();
    for u in &users {
        register(&mut c, u);
    }
    buy_at(&mut c, &users[0], NEAR * 3 / 10, 0);
    buy_at(&mut c, &users[1], NEAR * 2 / 10, 0);
    buy_at(&mut c, &users[2], NEAR / 10, 0);
    (c, users)
}

#[test]
#[should_panic(expected = "only be called when the coin could be ejected")]
fn mayday_needs_an_ejectable_coin() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], NEAR, NEAR, 10); // too young
}

#[test]
#[should_panic(expected = "Target must be between the alive line and 3 times it")]
fn mayday_target_below_the_line_panics() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], NEAR / 2, NEAR / 2, 15);
}

#[test]
#[should_panic(expected = "Target must be between the alive line and 3 times it")]
fn mayday_target_above_three_lines_panics() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 4 * NEAR, NEAR, 15);
}

#[test]
#[should_panic(expected = "The opener pledges at least 10% of the target")]
fn mayday_opener_must_stake_ten_percent() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 10, 15);
}

#[test]
#[should_panic(expected = "A Mayday is already open")]
fn only_one_mayday_at_a_time() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 5, 15);
    mayday_at(&mut c, &users[1], 2 * NEAR, NEAR / 5, 15);
}

#[test]
#[should_panic(expected = "A Mayday is open: EJECT waits until it ends")]
fn eject_is_blocked_while_a_mayday_is_open() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 5, 15);
    assert!(!status_at(&c, 16).ejectable, "EJECT is blocked during the Mayday");
    eject_at(&mut c, 16);
}

#[test]
fn eject_after_the_deadline_closes_the_mayday_as_failed() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 5, 15);
    // deadline is day 18; on day 18 EJECT closes the failed Mayday and ends the coin
    assert!(status_at(&c, 18).ejectable);
    eject_at(&mut c, 18);
    let r = c.get_round(1).unwrap();
    assert!(!r.rescued);
    assert_eq!(r.pledges_left.0, NEAR / 5);
    // the pledge still comes back after EJECT
    assert_eq!(withdraw_at(&mut c, &users[0], 19), NEAR / 5);
}

#[test]
fn rescue_fills_all_pledges_at_one_price_and_the_fund_pays_nothing() {
    let (mut c, users) = dying_coin();
    let fund_before = c.fund;
    let supply_before = c.token.total_supply;
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 2, 15);
    pledge_at(&mut c, &users[3], NEAR, 16);
    let s_before_last = c.token.total_supply;
    assert_eq!(s_before_last, supply_before, "pledges are not buys");
    pledge_at(&mut c, &users[1], NEAR / 2, 16); // reaches 2 NEAR: the rescue executes now
    let st = status_at(&c, 16);
    assert!(st.mayday.is_none());
    assert_eq!(st.rescues, 1);
    assert!(!st.ejectable, "the rescue counts as a buy, the coin is alive again");
    assert_eq!(st.pledges_held.0, 0);
    let r = c.get_round(1).unwrap();
    assert!(r.rescued);
    assert_eq!(r.pledges_left.0, 2 * NEAR);
    assert_eq!(balance(&c, &coin_id()), r.tokens_left.0, "the escrow holds the rescue tokens");
    assert_curve_invariant(&c);
    // the rescue is an ordinary buy: the fund only gains the buy fee and the dust, it pays nothing
    let fee = fee_up(2 * NEAR, 150);
    assert!(c.fund >= fund_before + fee, "the fund never pays for a rescue");
    assert!(c.fund <= fund_before + fee + 1_000_000, "only dust is added on top of the fee");
    // locked-time weight: only the opener's 0.5 NEAR was locked (one day); the others pledged on
    // the rescue day itself and earned nothing yet
    let locked = scaled((NEAR / 2) as i128) * DEMO_DAY as u128;
    assert_eq!(r.bonus_left.0, locked);
    // one price: each pledger's tokens are proportional to the pledge
    let t3 = collect_at(&mut c, &users[3], 17);
    let t0 = collect_at(&mut c, &users[0], 17);
    let t1 = collect_at(&mut c, &users[1], 17);
    assert!(t3.abs_diff(t0 * 2) <= 2 && t0.abs_diff(t1) <= 2, "same price for everyone");
    assert_eq!(balance(&c, &coin_id()), 0, "the escrow is empty after everyone collected");
    assert!(c.get_round(1).is_none(), "a settled round is deleted");
}

#[test]
fn collect_moves_tokens_basis_and_the_weight_earned_since_the_rescue() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[3], NEAR, NEAR, 15); // solo rescue in the opening call
    assert_eq!(status_at(&c, 15).rescues, 1);
    let all = with_escrow(&users);
    assert_s_pos(&c, &all);
    assert_weights(&c, &all, at_day(15) / SEC);
    let before = h(&c, &users[3]);
    assert_eq!(before.pledge, NEAR);
    // five days later the pledger collects: basis = pledge, weight = pledge x 5 days (an instant
    // solo rescue was never locked, so it earned no locked-time weight)
    let tokens = collect_at(&mut c, &users[3], 20);
    let after = h(&c, &users[3]);
    assert!(tokens > 0 && balance(&c, &users[3]) == tokens);
    assert_eq!(after.basis, before.basis + NEAR as i128);
    let expected = accounting::scaled(NEAR as i128) * (5 * DEMO_DAY) as u128;
    assert!(after.weight.abs_diff(expected) <= 1, "weight {} vs {expected}", after.weight);
    assert_eq!(after.pledge, 0);
    assert_s_pos(&c, &all);
    assert_weights(&c, &all, at_day(20) / SEC);
}

#[test]
fn any_action_collects_first() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[3], NEAR, NEAR, 15);
    let view = {
        ctx(&users[3], 0, at_day(16));
        c.holder(users[3].clone())
    };
    assert_eq!(view.pledge_state, "rescued");
    assert!(view.collectable.0 > 0);
    // a sell of the collectable tokens works without calling collect first
    let got = sell_at(&mut c, &users[3], view.collectable.0 / 2, 16);
    assert!(got > 0);
    assert_eq!(h(&c, &users[3]).pledge, 0, "the sell collected first");
}

#[test]
fn failed_mayday_refunds_every_pledge_in_full_and_starts_a_cooldown() {
    let (mut c, users) = dying_coin();
    let mut total_in = c.reserve + c.fund + c.protocol_fees;
    mayday_at(&mut c, &users[0], 3 * NEAR, NEAR / 2, 15);
    pledge_at(&mut c, &users[1], NEAR / 3, 16);
    total_in += NEAR / 2 + NEAR / 3;
    assert_eq!(
        total_in,
        c.reserve + c.fund + c.protocol_fees + c.pledges_held,
        "pledges are held, not spent"
    );
    // deadline day 18 passes below the target
    let st = status_at(&c, 19);
    assert!(st.ejectable, "a Mayday past its deadline does not block EJECT");
    assert_eq!(withdraw_at(&mut c, &users[0], 19), NEAR / 2);
    assert_eq!(withdraw_at(&mut c, &users[1], 19), NEAR / 3);
    assert_eq!(c.pledges_held, 0);
    // cooldown: 7 days after the deadline (day 18 + 7 = day 25)
    let st = status_at(&c, 24);
    assert!(!st.can_mayday, "no new Mayday during the cooldown");
    assert!(st.ejectable, "EJECT stays possible during the cooldown");
    assert!(status_at(&c, 25).can_mayday);
    mayday_at(&mut c, &users[2], NEAR, NEAR / 10, 25);
}

#[test]
#[should_panic(expected = "Cooldown: a failed Mayday ended less than 7 days ago")]
fn no_new_mayday_during_the_cooldown() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 3 * NEAR, NEAR / 2, 15);
    mayday_at(&mut c, &users[2], NEAR, NEAR, 24);
}

#[test]
#[should_panic(expected = "Pledges are locked until the Mayday ends")]
fn pledges_are_locked_while_the_mayday_is_open() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 3 * NEAR, NEAR / 2, 15);
    withdraw_at(&mut c, &users[0], 16);
}

#[test]
fn withdraw_on_a_rescued_pledge_collects_instead() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[3], NEAR, NEAR, 15);
    assert_eq!(withdraw_at(&mut c, &users[3], 16), 0, "no NEAR comes back from a rescue");
    assert!(balance(&c, &users[3]) > 0, "the rescue tokens were collected");
    assert_eq!(c.holders.get(&users[3]).unwrap().pledge, 0);
}

#[test]
fn a_pledge_above_the_target_is_filled_up_to_it_and_the_rest_returned() {
    let (mut c, users) = dying_coin();
    let line = status_at(&c, 15).alive_threshold.0;
    // the opener sends 10 times the target: only the target is spent
    assert!(mayday_at(&mut c, &users[3], line, 10 * line, 15).is_none(), "rescued in the opening call");
    let r = c.get_round(1).unwrap();
    assert_eq!(r.pledges_left.0, line, "the rescue spent exactly the target");
    assert_eq!(c.holders.get(&users[3]).unwrap().pledge, line);
    assert_eq!(c.detector.window_buys(15), line, "the detector records the target, not the deposit");
    assert_eq!(c.pledges_held, 0);
}

#[test]
fn a_crossing_pledge_is_capped_at_the_target() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 5, 15);
    pledge_at(&mut c, &users[3], 5 * NEAR, 16); // needs only 1.8 NEAR
    let r = c.get_round(1).unwrap();
    assert_eq!(r.pledges_left.0, 2 * NEAR);
    assert_eq!(c.holders.get(&users[3]).unwrap().pledge, 2 * NEAR - NEAR / 5);
}

#[test]
fn mayday_returns_the_open_round_or_none_after_an_instant_rescue() {
    let (mut c, users) = dying_coin();
    let m = mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 5, 15).expect("open");
    assert_eq!((m.round, m.pledged.0), (1, NEAR / 5));
}

#[test]
fn the_cooldown_view_starts_only_when_a_mayday_has_failed() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 5, 15);
    assert_eq!(status_at(&c, 16).mayday_open_after_ts, 0, "an open Mayday may still succeed");
    let expired = status_at(&c, 18);
    assert!(expired.mayday.is_some(), "past the deadline, not closed yet");
    assert_eq!(expired.mayday_open_after_ts, c.mayday.as_ref().unwrap().deadline_ts + 7 * c.day_length_sec);
}

#[test]
fn a_failed_round_is_deleted_once_every_pledge_is_withdrawn() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 5, 15);
    pledge_at(&mut c, &users[1], NEAR / 5, 16);
    withdraw_at(&mut c, &users[0], 19);
    assert!(c.get_round(1).is_some(), "one pledge is still out");
    withdraw_at(&mut c, &users[1], 19);
    assert!(c.get_round(1).is_none());
}

#[test]
fn pledges_earn_weight_while_locked_and_lose_it_on_a_full_sell() {
    let (mut c, users) = dying_coin();
    let opener = &users[3];
    let w0 = h(&c, opener).weight;
    mayday_at(&mut c, opener, NEAR, NEAR / 2, 15); // 0.5 NEAR locked from day 15
    pledge_at(&mut c, &users[0], NEAR / 2, 17); // completes the target on day 17: rescue
    let locked = scaled((NEAR / 2) as i128) * (2 * DEMO_DAY) as u128;
    assert_eq!(c.get_round(1).unwrap().bonus_left.0, locked, "two days of 0.5 NEAR at risk");
    ctx(&user("anyone"), 0, at_day(17));
    assert_eq!(c.holder(opener.clone()).weight.0, w0 + locked, "the view shows it at once");
    collect_at(&mut c, opener, 17);
    assert_eq!(h(&c, opener).weight, w0 + locked, "collect moves exactly the locked-time weight");
    assert_weights(&c, &with_escrow(&users), at_day(17) / SEC);
    let t = balance(&c, opener);
    sell_at(&mut c, opener, t, 17);
    assert_eq!(h(&c, opener).weight, 0, "a full sell forfeits it, like any weight");
    assert_weights(&c, &with_escrow(&users), at_day(17) / SEC);
}

#[test]
fn an_instant_solo_rescue_earns_no_extra_weight() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[3], NEAR, NEAR, 15);
    assert_eq!(c.get_round(1).unwrap().bonus_left.0, 0, "nothing was ever locked");
    ctx(&user("anyone"), 0, at_day(15));
    assert_eq!(c.holder(users[3].clone()).weight.0, 0);
}

#[test]
fn a_gap_below_the_minimum_pledge_counts_as_reached() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], NEAR, NEAR / 10, 15);
    pledge_at(&mut c, &users[1], NEAR - NEAR / 10 - 1, 16); // leaves 1 yocto
    let st = status_at(&c, 16);
    assert_eq!(st.rescues, 1, "a 1 yocto gap could never be filled, so the rescue ran");
    assert_eq!(c.get_round(1).unwrap().pledges_left.0, NEAR - 1);
}

#[test]
#[should_panic(expected = "Withdraw your pledge from the earlier Mayday first")]
fn an_old_failed_pledge_must_be_withdrawn_before_pledging_again() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 3 * NEAR, NEAR / 2, 15);
    // fails on day 18, cooldown until day 25
    mayday_at(&mut c, &users[1], NEAR, NEAR / 10, 25);
    pledge_at(&mut c, &users[0], NEAR / 10, 25);
}

#[test]
#[should_panic(expected = "Collect or withdraw your Mayday pledge first")]
fn storage_unregister_is_refused_with_an_open_pledge() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[3], 3 * NEAR, NEAR / 2, 15);
    ctx(&users[3], 1, at_day(16));
    c.storage_unregister(None);
}

#[test]
#[should_panic(expected = "cannot receive tokens")]
fn tokens_cannot_be_sent_to_the_coin_account() {
    let (mut c, users) = dying_coin();
    let b = balance(&c, &users[0]);
    transfer_at(&mut c, &users[0], &coin_id(), b / 2, 1);
}

#[test]
fn after_eject_a_claim_collects_first_and_claims_stay_within_the_pot() {
    let (mut c, users) = dying_coin();
    mayday_at(&mut c, &users[0], 2 * NEAR, NEAR / 2, 15);
    pledge_at(&mut c, &users[3], 3 * NEAR / 2, 15); // rescue on day 15
    // nobody buys again: the rescue leaves the window after 14 days and the coin is ejectable
    assert!(!status_at(&c, 28).ejectable);
    assert!(status_at(&c, 29).ejectable);
    let snap = eject_at(&mut c, 29);
    let mut claimed = 0;
    for u in &users {
        ctx(u, 0, at_day(30));
        let v = c.holder(u.clone());
        if v.balance.0 + v.collectable.0 > 0 {
            let got = claim_at(&mut c, u, 30);
            assert_eq!(got, v.reserve_part.0 + v.fund_part.0, "the view predicts the claim");
            claimed += got;
        }
    }
    assert!(claimed <= snap.reserve_e.0 + snap.fund_e.0);
    assert_eq!(balance(&c, &coin_id()), 0, "every rescue token was collected and burned");
    assert!(c.reserve + c.fund < 1_000_000, "only dust stays: {}", c.reserve + c.fund);
}

#[test]
fn rescue_and_dump_loses_money() {
    let (mut c, users) = dying_coin();
    let attacker = &users[3];
    mayday_at(&mut c, attacker, 3 * NEAR, 3 * NEAR, 15); // solo rescue
    let tokens = collect_at(&mut c, attacker, 15);
    let back = sell_at(&mut c, attacker, tokens, 15);
    assert!(back < 3 * NEAR, "rescue and dump must lose: got back {back}");
}

/// The v2 co-invest paid a lone rescuer out of the fund (review finding: +2.44 NEAR on a 7 NEAR
/// fund). With v3 the fund spends nothing, so the same attack loses the fees.
#[test]
fn rescue_and_dump_loses_money_with_a_large_fund() {
    let mut c = setup_demo(FeePreset::Standard);
    let users = crew();
    for u in &users {
        register(&mut c, u);
    }
    for _ in 0..20 {
        let t = buy_at(&mut c, &users[0], 10 * NEAR, 0);
        sell_at(&mut c, &users[0], t, 0);
    }
    buy_at(&mut c, &users[1], 5 * NEAR, 0);
    let st = status_at(&c, 15);
    assert!(st.ejectable && st.fund.0 > 6 * NEAR, "a dying coin with a large fund");
    let fund_before = st.fund.0;
    let attacker = &users[3];
    let target = st.alive_threshold.0 * 3;
    mayday_at(&mut c, attacker, target, target, 15);
    let tokens = collect_at(&mut c, attacker, 15);
    let back = sell_at(&mut c, attacker, tokens, 15);
    assert!(back < target, "rescue and dump must lose: pledged {target}, got back {back}");
    assert!(c.fund > fund_before, "the fund only grew (fees), it paid nothing");
}

#[test]
fn random_ops_with_maydays_keep_all_invariants() {
    // Only valid calls are made (preconditions are read from the views first), so every call
    // succeeds and every invariant is checked after every step.
    let (mut c, users) = dying_coin();
    let all = with_escrow(&users);
    let mut seed: u64 = 7;
    let mut rnd = move || {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        seed >> 33
    };
    let mut total_in = c.reserve + c.fund + c.protocol_fees;
    let mut total_out = 0u128;
    let (mut rescues, mut fails, mut collects, mut withdrawals) = (0, 0, 0, 0);
    let mut day = 14;
    for _ in 0..600 {
        day += rnd() % 2;
        if day > 160 {
            break;
        }
        let u = &users[(rnd() % 4) as usize];
        let st = status_at(&c, day);
        ctx(u, 0, at_day(day));
        let v = c.holder(u.clone());
        let free_to_pledge = v.pledge_state == "none" || v.pledge_state == "rescued";
        match rnd() % 6 {
            0 if st.can_mayday && free_to_pledge => {
                let line = st.alive_threshold.0;
                let target = line + line * (rnd() as u128 % 3) / 2;
                let dep = target / 10 + (rnd() as u128 % 6) * NEAR / 10;
                mayday_at(&mut c, u, target, dep, day);
                total_in += dep.min(target); // the part above the target is sent back
            }
            1 if st
                .mayday
                .as_ref()
                .is_some_and(|m| at_day(day) / SEC < m.deadline_ts && (v.pledge_round == m.round || free_to_pledge)) =>
            {
                let a = NEAR / 10 + (rnd() as u128 % 8) * NEAR / 5;
                let m = st.mayday.as_ref().unwrap();
                let room = m.target.0 - m.pledged.0;
                pledge_at(&mut c, u, a, day);
                total_in += a.min(room); // the part above the target is sent back
            }
            2 => {
                let a = MIN_BUY + (rnd() as u128 % 4) * NEAR / 10;
                buy_at(&mut c, u, a, day);
                total_in += a;
            }
            3 if v.pledge_state == "failed" && !st.mayday.as_ref().is_some_and(|m| m.round == v.pledge_round && at_day(day) / SEC < m.deadline_ts) => {
                total_out += withdraw_at(&mut c, u, day);
                withdrawals += 1;
            }
            4 if v.pledge_state == "rescued" => {
                collect_at(&mut c, u, day);
            }
            5 => {
                let b = v.balance.0 + v.collectable.0;
                ctx(u, 0, at_day(day));
                if b > 3 && c.quote_sell(U128(b / 3)).near_out.0 > 0 {
                    total_out += sell_at(&mut c, u, b / 3, day);
                }
            }
            _ => {}
        }
        // an explicit collect, or an automatic one inside a buy, sell or pledge
        if v.pledge_state == "rescued" && h(&c, u).pledge == 0 {
            collects += 1;
        }
        let after = status_at(&c, day);
        if after.rescues > st.rescues {
            rescues += 1;
        }
        if after.mayday.is_none() && st.mayday.is_some() && after.rescues == st.rescues {
            fails += 1;
        }
        assert_curve_invariant(&c);
        assert_s_pos(&c, &all);
        assert_weights(&c, &all, at_day(day) / SEC);
        assert_eq!(
            total_in - total_out,
            c.reserve + c.fund + c.protocol_fees + c.pledges_held,
            "every yoctoNEAR is accounted for (day {day})"
        );
        // the escrow holds exactly what the rescued rounds still owe
        let owed: u128 = (1..=c.round_count)
            .filter_map(|k| c.get_round(k))
            .filter(|r| r.rescued)
            .map(|r| r.tokens_left.0)
            .sum();
        assert_eq!(balance(&c, &coin_id()), owed, "escrow matches the open rounds");
    }
    assert!(rescues > 0 && fails > 0 && collects > 0 && withdrawals > 0,
        "the run must cover rescues ({rescues}), failures ({fails}), collects ({collects}) and withdrawals ({withdrawals})");
}
