//! Ejecto coin contract. Spec: docs/product-spec.md. Architecture: docs/architecture.md.
//!
//! Modules:
//! - `curve`: bonding curve math (spec section 5)
//! - `accounting`: holder net basis x time (spec section 6)
//! - `detector`: alive detector (spec section 7)
//! - `events`: NEP-297 events
//! - Mayday (spec section 10): crowd rescue of a dying coin, in this file

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

pub mod accounting;
pub mod curve;
pub mod detector;
mod events;

use accounting::{claim_parts, moved_basis, scaled, Holder, Ledger};
use detector::Detector;

use curve::{price_at, proceeds_of_burn, reserve_at, tokens_for_net};

/// Basis points denominator.
const BPS: u128 = 10_000;
/// Protocol fee on every buy: 0.5%.
const PROTOCOL_BUY_BPS: u128 = 50;
/// Smallest accepted buy: 0.001 NEAR. Stops dust spam.
pub const MIN_BUY: u128 = 1_000_000_000_000_000_000_000;
/// Token decimals.
pub const DECIMALS: u8 = 18;
/// Allowed range for `day_length_sec` (spec section 4).
pub const MIN_DAY_LENGTH: u64 = 10;
pub const REAL_DAY: u64 = 86_400;

// Mayday (spec section 10). Durations are in coin days.
/// How long a Mayday stays open.
pub const MAYDAY_DAYS: u64 = 3;
/// After a failed Mayday, the next one may open this many days after its deadline.
pub const MAYDAY_COOLDOWN_DAYS: u64 = 7;
/// The target is at most this many times the alive line.
pub const MAYDAY_MAX_TARGET_X: u128 = 3;
/// The opener pledges at least this share of the target (basis points).
pub const MAYDAY_OPENER_BPS: u128 = 1_000;
/// On a rescue the fund adds this share of the pledges (basis points)...
pub const COINVEST_BPS: u128 = 2_500;
/// ...but never more than this share of the fund (basis points).
pub const COINVEST_FUND_MAX_BPS: u128 = 5_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Holders,
    Rounds,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FeePreset {
    Light,
    Standard,
    High,
}

impl FeePreset {
    /// (fund fee on buy, fund fee on sell) in basis points. Spec section 5.
    pub fn fund_bps(self) -> (u16, u16) {
        match self {
            FeePreset::Light => (50, 100),
            FeePreset::Standard => (150, 200),
            FeePreset::High => (300, 500),
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Coin {
    // immutable after init
    name: String,
    symbol: String,
    icon: Option<String>,
    fee_preset: FeePreset,
    fund_buy_bps: u16,
    fund_sell_bps: u16,
    day_length_sec: u64,
    launch_ts: u64,
    protocol_account: AccountId,
    factory: AccountId,

    // token (balances, total supply, storage)
    token: FungibleToken,

    // money, all in yoctoNEAR
    reserve: u128,
    fund: u128,
    protocol_fees: u128,

    // holder accounting (spec section 6)
    holders: LookupMap<AccountId, Holder>,
    ledger: Ledger,

    // alive detector (spec section 7)
    detector: Detector,

    // terminal state (spec section 8)
    ejected: Option<EjectSnapshot>,
    // Mayday (spec section 10)
    mayday: Option<Mayday>,
    rounds: LookupMap<u32, Round>,
    round_count: u32,
    rescues: u32,
    /// A new Mayday may open from this time on (end of the cooldown after a failed one).
    mayday_open_after_ts: u64,
    /// NEAR held for pledges that are neither filled nor withdrawn.
    pledges_held: u128,
}

/// The open Mayday round.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mayday {
    pub round: u32,
    pub opener: AccountId,
    pub target: U128,
    pub pledged: U128,
    pub opened_ts: u64,
    pub deadline_ts: u64,
}

/// A closed Mayday round. For a rescue, what is still in escrow for the pledgers who did not collect.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Round {
    pub rescued: bool,
    /// Rescue (or failure) time.
    pub ts: u64,
    /// Rescue tokens still in escrow.
    pub tokens_left: U128,
    /// Pledges of this round not yet collected (rescue) or withdrawn (failure).
    pub pledges_left: U128,
}

/// Frozen numbers at EJECT. Claims are computed from these.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EjectSnapshot {
    pub t_e: u64,
    pub reserve_e: U128,
    pub supply_e: U128,
    pub fund_e: U128,
    pub w_e: U128,
}

/// Per-holder view for the web app ("your seat").
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct HolderView {
    pub balance: U128,
    /// Net basis in yoctoNEAR as a decimal string (can be negative).
    pub basis: String,
    /// Weight accrued up to now (or up to EJECT), in weight units.
    pub weight: U128,
    /// Total weight of all holders at the same moment.
    pub total_weight: U128,
    pub claimed: bool,
    /// Payout if EJECT happened now (before EJECT), or the actual claimable payout (after).
    /// Includes rescue tokens still waiting in escrow.
    pub reserve_part: U128,
    pub fund_part: U128,
    /// NEAR pledged to a Mayday and not yet filled or withdrawn.
    pub pledge: U128,
    pub pledge_round: u32,
    /// "open", "rescued" (tokens waiting to be collected), "failed" (withdraw the pledge) or "none".
    pub pledge_state: String,
    /// Rescue tokens waiting in escrow for this account.
    pub collectable: U128,
}

/// Fee and output breakdown of a buy. Used by `buy` and `quote_buy`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BuyQuote {
    pub tokens_out: U128,
    pub cost: U128,
    pub fund_fee: U128,
    pub protocol_fee: U128,
    pub dust_to_fund: U128,
    pub price_after: U128,
}

/// Fee and output breakdown of a sell. Used by `sell` and `quote_sell`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SellQuote {
    pub gross: U128,
    pub fund_fee: U128,
    pub near_out: U128,
    pub price_after: U128,
}

/// Everything the web app needs about the coin in one call.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Status {
    pub name: String,
    pub symbol: String,
    pub fee_preset: FeePreset,
    pub fund_buy_bps: u16,
    pub fund_sell_bps: u16,
    pub protocol_buy_bps: u16,
    pub day_length_sec: u64,
    pub demo_time: bool,
    pub launch_ts: u64,
    pub now_ts: u64,
    pub protocol_account: AccountId,
    pub factory: AccountId,
    pub supply: U128,
    pub price: U128,
    pub reserve: U128,
    pub fund: U128,
    pub protocol_fees: U128,
    pub day: u64,
    pub window_buys: U128,
    pub peak_window: U128,
    pub alive_threshold: U128,
    /// True when EJECT would succeed now (no Mayday open).
    pub ejectable: bool,
    pub total_weight: U128,
    pub ejected: Option<EjectSnapshot>,
    /// The open Mayday, if any (one past its deadline is shown until a call closes it).
    pub mayday: Option<Mayday>,
    /// True when a Mayday could be opened now.
    pub can_mayday: bool,
    /// End of the cooldown after a failed Mayday (0 when there is none).
    pub mayday_open_after_ts: u64,
    /// Successful rescues so far.
    pub rescues: u32,
    /// NEAR held for open or unwithdrawn pledges.
    pub pledges_held: U128,
}

/// Rounds `amount * bps / BPS` up (fees always round in favor of the contract).
fn fee_up(amount: u128, bps: u128) -> u128 {
    let num = amount.checked_mul(bps).expect("fee overflow");
    num.div_ceil(BPS)
}

fn now_sec() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[near]
impl Coin {
    /// Initializes the coin. Callable once, only by the parent account (the factory)
    /// or by the coin account itself (fallback deploy without a factory).
    #[init]
    pub fn new(
        name: String,
        symbol: String,
        icon: Option<String>,
        fee_preset: FeePreset,
        day_length_sec: u64,
        protocol_account: AccountId,
    ) -> Self {
        let me = env::current_account_id();
        let caller = env::predecessor_account_id();
        // The caller must be the direct parent (`seato.factory.x` -> `factory.x`), not any ancestor.
        let is_parent =
            me.as_str().split_once('.').map(|(_, parent)| parent) == Some(caller.as_str());
        require!(
            is_parent || caller == me,
            "Only the factory (parent account) can initialize"
        );
        require!(
            !name.is_empty() && name.chars().count() <= 32,
            "name must be 1 to 32 characters"
        );
        require!(
            symbol.len() >= 2
                && symbol.len() <= 10
                && symbol
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
            "symbol must be 2 to 10 characters, lowercase a-z and 0-9"
        );
        if let Some(i) = &icon {
            require!(i.len() <= 2048, "icon must be at most 2 KB");
        }
        require!(
            (MIN_DAY_LENGTH..=REAL_DAY).contains(&day_length_sec),
            "day_length_sec must be between 10 and 86400"
        );
        let (fund_buy_bps, fund_sell_bps) = fee_preset.fund_bps();
        let now = now_sec();
        let mut this = Self {
            name,
            symbol,
            icon,
            fee_preset,
            fund_buy_bps,
            fund_sell_bps,
            day_length_sec,
            launch_ts: now,
            protocol_account,
            factory: caller,
            token: FungibleToken::new(StorageKey::Token),
            reserve: 0,
            fund: 0,
            protocol_fees: 0,
            holders: LookupMap::new(StorageKey::Holders),
            ledger: Ledger::new(now),
            detector: Detector::default(),
            ejected: None,
            mayday: None,
            rounds: LookupMap::new(StorageKey::Rounds),
            round_count: 0,
            rescues: 0,
            mayday_open_after_ts: 0,
            pledges_held: 0,
        };
        this.include_holder_storage();
        // The coin account itself holds the Mayday rescue escrow, so it needs a token account.
        this.token.internal_register_account(&me);
        this
    }

    // ---------- trading ----------

    /// Buys tokens with the attached NEAR. The buyer must be registered (storage_deposit).
    /// Returns the amount of raw tokens minted.
    #[payable]
    pub fn buy(&mut self, min_tokens_out: Option<U128>) -> U128 {
        self.assert_live();
        let buyer = env::predecessor_account_id();
        require!(
            self.token.accounts.contains_key(&buyer),
            "Register first: call storage_deposit"
        );
        let amount = env::attached_deposit().as_yoctonear();
        self.settle(&buyer);
        let q = self.compute_buy(amount);
        let tokens = q.tokens_out.0;
        require!(tokens > 0, "Buy too small for any tokens");
        if let Some(min) = min_tokens_out {
            require!(
                tokens >= min.0,
                "Slippage: fewer tokens than min_tokens_out"
            );
        }

        // effects
        self.reserve += q.cost.0;
        self.fund += q.fund_fee.0 + q.dust_to_fund.0;
        self.protocol_fees += q.protocol_fee.0;
        self.token.internal_deposit(&buyer, tokens);
        debug_assert_eq!(self.reserve, reserve_at(self.token.total_supply));

        // accounting: basis += x, then record the buy for the alive detector
        let now = now_sec();
        let mut h = self.holder_or_default(&buyer);
        self.ledger.touch(&mut h, now);
        let nb = h.basis + amount as i128;
        self.ledger.set_basis(&mut h, nb);
        self.holders.insert(buyer.clone(), h);
        self.detector.record_buy(self.day_at(now), amount);

        FtMint {
            owner_id: &buyer,
            amount: U128(tokens),
            memo: Some("ejecto buy"),
        }
        .emit();
        events::buy(&buyer, amount, &q);
        U128(tokens)
    }

    /// Sells `amount` raw tokens back to the curve. Sends NEAR to the seller.
    /// Returns the NEAR sent (after the fund fee).
    pub fn sell(&mut self, amount: U128, min_near_out: Option<U128>) -> U128 {
        self.assert_live();
        let seller = env::predecessor_account_id();
        let d = amount.0;
        require!(d > 0, "Amount must be positive");
        self.settle(&seller);
        let balance = self.token.ft_balance_of(seller.clone()).0;
        require!(d <= balance, "Not enough tokens");
        let q = self.compute_sell(d);
        require!(q.near_out.0 > 0, "Sell too small");
        if let Some(min) = min_near_out {
            require!(
                q.near_out.0 >= min.0,
                "Slippage: less NEAR than min_near_out"
            );
        }

        // effects before the outgoing transfer
        self.token.internal_withdraw(&seller, d);
        self.reserve -= q.gross.0;
        self.fund += q.fund_fee.0;
        debug_assert_eq!(self.reserve, reserve_at(self.token.total_supply));

        // accounting: basis -= proceeds, or leave the ship on a full exit
        let mut h = self.holder_or_default(&seller);
        self.ledger.touch(&mut h, now_sec());
        if !self.ledger.shed(&mut h, d, balance) {
            let nb = h.basis - q.near_out.0 as i128;
            self.ledger.set_basis(&mut h, nb);
        }
        self.holders.insert(seller.clone(), h);

        FtBurn {
            owner_id: &seller,
            amount: U128(d),
            memo: Some("ejecto sell"),
        }
        .emit();
        events::sell(&seller, d, &q);
        Promise::new(seller)
            .transfer(NearToken::from_yoctonear(q.near_out.0))
            .detach();
        q.near_out
    }

    /// Sends all accrued protocol fees to the protocol account fixed at launch. Anyone can call.
    pub fn withdraw_protocol_fees(&mut self) -> U128 {
        let amount = self.protocol_fees;
        require!(amount > 0, "No protocol fees to withdraw");
        self.protocol_fees = 0;
        events::protocol_withdraw(&self.protocol_account, amount);
        Promise::new(self.protocol_account.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
        U128(amount)
    }

    // ---------- EJECT and claim ----------

    /// Ends the coin when the alive rule allows it (spec sections 7 and 8). Anyone can call.
    pub fn eject(&mut self) -> EjectSnapshot {
        require!(self.ejected.is_none(), "Already ejected");
        let now = now_sec();
        let day = self.day_at(now);
        require!(
            day >= detector::MIN_AGE_DAYS,
            "Too young to eject: the coin needs 14 days"
        );
        require!(
            self.detector.window_buys(day) < self.detector.alive_threshold(),
            "The coin is still alive"
        );
        self.close_mayday_if_expired(now);
        require!(
            self.mayday.is_none(),
            "A Mayday is open: EJECT waits until it ends"
        );
        self.ledger.touch_global(now);
        let supply = self.token.total_supply;
        if supply == 0 && self.fund > 0 {
            // Nobody is on board, so nobody can claim the fund. Route it to protocol fees.
            self.protocol_fees += self.fund;
            self.fund = 0;
        }
        let snap = EjectSnapshot {
            t_e: now,
            reserve_e: U128(self.reserve),
            supply_e: U128(supply),
            fund_e: U128(self.fund),
            w_e: U128(self.ledger.w_total),
        };
        self.ejected = Some(snap.clone());
        events::eject(&snap);
        snap
    }

    /// Pays the caller's share after EJECT: reserve part by tokens plus fund part by weight.
    /// The caller's tokens are burned. Returns the NEAR sent.
    pub fn claim(&mut self) -> U128 {
        let snap = self
            .ejected
            .clone()
            .unwrap_or_else(|| env::panic_str("Not ejected yet"));
        let account = env::predecessor_account_id();
        self.settle(&account);
        let balance = self.token.ft_balance_of(account.clone()).0;
        require!(balance > 0, "Nothing to claim");
        let mut h = self.holder_or_default(&account);
        let weight_final = Ledger::live_weight(&h, snap.t_e);
        // The reserve part is paid for whatever balance the caller holds now, so tokens that a
        // late ft_transfer_call refund brings back can be claimed too. The fund part is paid once.
        let (reserve_part, mut fund_part) = claim_parts(
            snap.reserve_e.0,
            snap.supply_e.0,
            snap.fund_e.0,
            snap.w_e.0,
            balance,
            weight_final,
        );
        if h.claimed {
            fund_part = 0;
        }

        // effects before the outgoing transfer
        h.claimed = true;
        h.weight = weight_final;
        h.last_ts = h.last_ts.max(snap.t_e);
        self.holders.insert(account.clone(), h);
        self.token.internal_withdraw(&account, balance);
        self.reserve = self
            .reserve
            .checked_sub(reserve_part)
            .expect("claim exceeds reserve");
        self.fund = self
            .fund
            .checked_sub(fund_part)
            .expect("claim exceeds fund");
        let payout = reserve_part + fund_part;

        FtBurn {
            owner_id: &account,
            amount: U128(balance),
            memo: Some("ejecto claim"),
        }
        .emit();
        events::claim(&account, balance, reserve_part, fund_part);
        if payout > 0 {
            Promise::new(account)
                .transfer(NearToken::from_yoctonear(payout))
                .detach();
        }
        U128(payout)
    }

    // ---------- Mayday (spec section 10) ----------

    /// Opens a Mayday on a coin that EJECT could end now. The attached NEAR is the opener's pledge,
    /// at least 10% of `target`. The target is between the alive line and 3 times it.
    #[payable]
    pub fn mayday(&mut self, target: U128) -> Mayday {
        self.assert_live();
        let opener = env::predecessor_account_id();
        let now = now_sec();
        self.close_mayday_if_expired(now);
        require!(self.mayday.is_none(), "A Mayday is already open");
        require!(
            now >= self.mayday_open_after_ts,
            "Cooldown: a failed Mayday ended less than 7 days ago"
        );
        require!(
            self.detector.ejectable(self.day_at(now)),
            "A Mayday can only be called when the coin could be ejected"
        );
        let line = self.detector.alive_threshold();
        let t = target.0;
        require!(
            t >= line && t <= line * MAYDAY_MAX_TARGET_X,
            "Target must be between the alive line and 3 times it"
        );
        let amount = env::attached_deposit().as_yoctonear();
        require!(
            amount >= fee_up(t, MAYDAY_OPENER_BPS),
            "The opener pledges at least 10% of the target"
        );
        self.round_count += 1;
        let round = self.round_count;
        let m = Mayday {
            round,
            opener: opener.clone(),
            target,
            pledged: U128(0),
            opened_ts: now,
            deadline_ts: now + MAYDAY_DAYS * self.day_length_sec,
        };
        self.mayday = Some(m.clone());
        events::mayday_open(round, &opener, t, m.deadline_ts);
        self.add_pledge(&opener, amount, now);
        self.mayday.clone().unwrap_or(m)
    }

    /// Pledges the attached NEAR to the open Mayday. The pledge that reaches the target executes
    /// the rescue in the same call.
    #[payable]
    pub fn pledge(&mut self) -> U128 {
        self.assert_live();
        let account = env::predecessor_account_id();
        let now = now_sec();
        self.close_mayday_if_expired(now);
        require!(self.mayday.is_some(), "No Mayday is open");
        let amount = env::attached_deposit().as_yoctonear();
        self.add_pledge(&account, amount, now);
        U128(self.holder_or_default(&account).pledge)
    }

    /// Moves the caller's share of a rescue from the escrow to their account: tokens, plus the
    /// pledge as basis and the weight it earned since the rescue. Returns the tokens moved.
    pub fn collect(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        let moved = self.settle(&account);
        require!(moved > 0, "Nothing to collect");
        U128(moved)
    }

    /// Returns the caller's pledge in full after a failed Mayday. Returns the NEAR sent.
    pub fn withdraw_pledge(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        let now = now_sec();
        if self.ejected.is_none() {
            self.close_mayday_if_expired(now);
        }
        let mut h = self.holder_or_default(&account);
        require!(h.pledge > 0, "No pledge to withdraw");
        let round_id = h.pledge_round;
        if let Some(m) = &self.mayday {
            require!(
                m.round != round_id,
                "Pledges are locked until the Mayday ends"
            );
        }
        let mut round = self
            .rounds
            .get(&round_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Unknown Mayday round"));
        require!(!round.rescued, "This Mayday succeeded: collect your tokens instead");
        let amount = h.pledge;
        // effects before the outgoing transfer
        h.pledge = 0;
        h.pledge_round = 0;
        self.holders.insert(account.clone(), h);
        round.pledges_left = U128(round.pledges_left.0 - amount);
        self.rounds.insert(round_id, round);
        self.pledges_held -= amount;
        events::pledge_withdraw(round_id, &account, amount);
        Promise::new(account)
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
        U128(amount)
    }

    /// A closed Mayday round (rescued or failed), with what is still in escrow or still pledged.
    pub fn get_round(&self, round: u32) -> Option<Round> {
        self.rounds.get(&round).cloned()
    }

    pub fn holder(&self, account_id: AccountId) -> HolderView {
        let balance = self.token.ft_balance_of(account_id.clone()).0;
        let h = self.holders.get(&account_id).cloned().unwrap_or_default();
        let (t, reserve_e, supply_e, fund_e, w_total) = match &self.ejected {
            Some(e) => (e.t_e, e.reserve_e.0, e.supply_e.0, e.fund_e.0, e.w_e.0),
            None => {
                let now = now_sec();
                (
                    now,
                    self.reserve,
                    self.token.total_supply,
                    self.fund,
                    self.ledger.live_total(now),
                )
            }
        };
        // Rescue tokens still in escrow count as this holder's, with the weight they earned.
        let (collectable, escrow_weight, state) = match self.pledge_view(&h, t) {
            Some((tokens, dw, state)) => (tokens, dw, state),
            None => (0, 0, if h.pledge > 0 { "open" } else { "none" }),
        };
        let weight = Ledger::live_weight(&h, t) + escrow_weight;
        let (reserve_part, mut fund_part) = claim_parts(
            reserve_e,
            supply_e,
            fund_e,
            w_total,
            balance + collectable,
            weight,
        );
        if h.claimed {
            fund_part = 0;
        }
        HolderView {
            balance: U128(balance),
            basis: h.basis.to_string(),
            weight: U128(weight),
            total_weight: U128(w_total),
            claimed: h.claimed,
            reserve_part: U128(reserve_part),
            fund_part: U128(fund_part),
            pledge: U128(h.pledge),
            pledge_round: h.pledge_round,
            pledge_state: state.to_string(),
            collectable: U128(collectable),
        }
    }

    // ---------- views ----------

    pub fn quote_buy(&self, amount: U128) -> BuyQuote {
        self.compute_buy(amount.0)
    }

    pub fn quote_sell(&self, amount: U128) -> SellQuote {
        require!(amount.0 <= self.token.total_supply, "Amount above supply");
        self.compute_sell(amount.0)
    }

    pub fn status(&self) -> Status {
        let now = now_sec();
        let supply = self.token.total_supply;
        let day = self.day_at(now);
        Status {
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            fee_preset: self.fee_preset,
            fund_buy_bps: self.fund_buy_bps,
            fund_sell_bps: self.fund_sell_bps,
            protocol_buy_bps: PROTOCOL_BUY_BPS as u16,
            day_length_sec: self.day_length_sec,
            demo_time: self.day_length_sec < REAL_DAY,
            launch_ts: self.launch_ts,
            now_ts: now,
            protocol_account: self.protocol_account.clone(),
            factory: self.factory.clone(),
            supply: U128(supply),
            price: U128(price_at(supply)),
            reserve: U128(self.reserve),
            fund: U128(self.fund),
            protocol_fees: U128(self.protocol_fees),
            day,
            window_buys: U128(self.detector.window_buys(day)),
            peak_window: U128(self.detector.peak_window),
            alive_threshold: U128(self.detector.alive_threshold()),
            ejectable: self.ejected.is_none()
                && self.detector.ejectable(day)
                && !self.mayday_blocks(now),
            total_weight: U128(match &self.ejected {
                Some(e) => e.w_e.0,
                None => self.ledger.live_total(now),
            }),
            ejected: self.ejected.clone(),
            mayday: self.mayday.clone(),
            can_mayday: self.ejected.is_none()
                && self.detector.ejectable(day)
                && self.mayday.is_none()
                && now >= self.mayday_open_after_ts,
            mayday_open_after_ts: self.effective_open_after(),
            rescues: self.rescues,
            pledges_held: U128(self.pledges_held),
        }
    }

    // ---------- Mayday internals ----------

    /// True when a Mayday is open and still before its deadline (it blocks EJECT).
    fn mayday_blocks(&self, now: u64) -> bool {
        self.mayday.as_ref().is_some_and(|m| now < m.deadline_ts)
    }

    /// End of the cooldown, counting a Mayday that is past its deadline but not closed yet.
    fn effective_open_after(&self) -> u64 {
        match &self.mayday {
            Some(m) => m.deadline_ts + MAYDAY_COOLDOWN_DAYS * self.day_length_sec,
            None => self.mayday_open_after_ts,
        }
    }

    fn mayday_expired(&self, now: u64) -> bool {
        self.mayday.as_ref().is_some_and(|m| now >= m.deadline_ts)
    }

    /// Closes the open Mayday as failed when its deadline has passed below the target.
    fn close_mayday_if_expired(&mut self, now: u64) {
        let Some(m) = self.mayday.clone() else { return };
        if now < m.deadline_ts {
            return;
        }
        self.rounds.insert(
            m.round,
            Round {
                rescued: false,
                ts: m.deadline_ts,
                tokens_left: U128(0),
                pledges_left: m.pledged,
            },
        );
        self.mayday = None;
        self.mayday_open_after_ts = m.deadline_ts + MAYDAY_COOLDOWN_DAYS * self.day_length_sec;
        events::mayday_fail(m.round, m.pledged.0, m.target.0);
    }

    /// Adds `amount` to `account`'s pledge in the open round, and rescues when the target is met.
    fn add_pledge(&mut self, account: &AccountId, amount: u128, now: u64) {
        require!(amount >= MIN_BUY, "Minimum pledge is 0.001 NEAR");
        require!(
            self.token.accounts.contains_key(account),
            "Register first: call storage_deposit"
        );
        self.settle(account);
        let mut m = self.mayday.clone().unwrap_or_else(|| env::panic_str("No Mayday is open"));
        let mut h = self.holder_or_default(account);
        require!(
            h.pledge == 0 || h.pledge_round == m.round,
            "Withdraw your pledge from the earlier Mayday first"
        );
        h.pledge += amount;
        h.pledge_round = m.round;
        self.holders.insert(account.clone(), h);
        m.pledged = U128(m.pledged.0 + amount);
        self.pledges_held += amount;
        events::pledge(m.round, account, amount, m.pledged.0);
        let reached = m.pledged.0 >= m.target.0;
        self.mayday = Some(m);
        if reached {
            self.rescue(now);
        }
    }

    /// Executes the rescue: all pledges as one buy at one price, plus the fund's co-invest.
    /// The tokens go to the escrow (the coin account); pledgers collect their share later.
    fn rescue(&mut self, now: u64) {
        let m = self.mayday.take().unwrap_or_else(|| env::panic_str("No Mayday is open"));
        let pledged = m.pledged.0;
        let fund_fee = fee_up(pledged, self.fund_buy_bps as u128);
        let protocol_fee = fee_up(pledged, PROTOCOL_BUY_BPS);
        self.fund += fund_fee;
        self.protocol_fees += protocol_fee;
        let coinvest = (pledged * COINVEST_BPS / BPS).min(self.fund * COINVEST_FUND_MAX_BPS / BPS);
        self.fund -= coinvest;
        let net = pledged - fund_fee - protocol_fee + coinvest;
        let s = self.token.total_supply;
        let (tokens, cost) = tokens_for_net(s, net);
        require!(
            s + tokens < curve::MAX_SUPPLY || net == cost,
            "Rescue would exceed the supply cap"
        );
        require!(tokens > 0, "Rescue too small for any tokens");
        self.reserve += cost;
        self.fund += net - cost;
        let me = env::current_account_id();
        self.token.internal_deposit(&me, tokens);
        debug_assert_eq!(self.reserve, reserve_at(self.token.total_supply));

        // The escrow is one holder whose basis is the uncollected pledges.
        let mut e = self.holder_or_default(&me);
        self.ledger.touch(&mut e, now);
        let nb = e.basis + pledged as i128;
        self.ledger.set_basis(&mut e, nb);
        self.holders.insert(me.clone(), e);
        // The rescue is a buy of the pledged amount for the alive detector.
        self.detector.record_buy(self.day_at(now), pledged);
        self.rounds.insert(
            m.round,
            Round {
                rescued: true,
                ts: now,
                tokens_left: U128(tokens),
                pledges_left: U128(pledged),
            },
        );
        self.pledges_held -= pledged;
        self.rescues += 1;
        FtMint {
            owner_id: &me,
            amount: U128(tokens),
            memo: Some("ejecto mayday rescue"),
        }
        .emit();
        events::rescue(m.round, pledged, coinvest, tokens, price_at(self.token.total_supply));
    }

    /// The tokens and weight waiting in escrow for `h`, as of `t`, and its pledge state.
    fn pledge_view(&self, h: &Holder, t: u64) -> Option<(u128, u128, &'static str)> {
        if h.pledge == 0 || h.pledge_round == 0 {
            return None;
        }
        if self.mayday.as_ref().is_some_and(|m| m.round == h.pledge_round) {
            let expired = self.mayday_expired(env::block_timestamp() / 1_000_000_000);
            return Some((0, 0, if expired { "failed" } else { "open" }));
        }
        let r = self.rounds.get(&h.pledge_round)?;
        if !r.rescued {
            return Some((0, 0, "failed"));
        }
        let (tokens, dw) = Self::share_of(r, h.pledge, t);
        Some((tokens, dw, "rescued"))
    }

    /// A pledger's slice of a rescued round: tokens (the last one takes the rest) and the weight
    /// their pledge earned between the rescue and `t`.
    fn share_of(r: &Round, pledge: u128, t: u64) -> (u128, u128) {
        let tokens = if pledge >= r.pledges_left.0 {
            r.tokens_left.0
        } else {
            use curve::U512;
            (U512::from(r.tokens_left.0) * U512::from(pledge) / U512::from(r.pledges_left.0)).low_u128()
        };
        let dw = scaled(pledge as i128) * t.saturating_sub(r.ts) as u128;
        (tokens, dw)
    }

    /// Collects `account`'s rescue tokens from the escrow if a rescue filled their pledge.
    /// Runs before every action of a holder, so nobody has to remember to collect. Returns tokens moved.
    fn settle(&mut self, account: &AccountId) -> u128 {
        let mut h = self.holder_or_default(account);
        if h.pledge == 0 || h.pledge_round == 0 {
            return 0;
        }
        let rid = h.pledge_round;
        let Some(mut r) = self.rounds.get(&rid).cloned() else { return 0 };
        if !r.rescued {
            return 0;
        }
        let me = env::current_account_id();
        let now = now_sec();
        // After EJECT the weights are frozen at t_e.
        let t = self.ejected.as_ref().map_or(now, |e| e.t_e);
        let pledge = h.pledge;
        let (tokens, dw) = Self::share_of(&r, pledge, t);
        let mut e = self.holder_or_default(&me);
        if self.ejected.is_none() {
            self.ledger.touch(&mut e, now);
            self.ledger.touch(&mut h, now);
        } else {
            e.weight = Ledger::live_weight(&e, t);
            e.last_ts = e.last_ts.max(t);
            h.weight = Ledger::live_weight(&h, t);
            h.last_ts = h.last_ts.max(t);
        }
        let dw = dw.min(e.weight);
        e.weight -= dw;
        h.weight += dw;
        let (eb, hb) = (e.basis - pledge as i128, h.basis + pledge as i128);
        self.ledger.set_basis(&mut e, eb);
        self.ledger.set_basis(&mut h, hb);
        h.pledge = 0;
        h.pledge_round = 0;
        r.tokens_left = U128(r.tokens_left.0 - tokens);
        r.pledges_left = U128(r.pledges_left.0 - pledge);
        self.rounds.insert(rid, r);
        self.holders.insert(me.clone(), e);
        self.holders.insert(account.clone(), h);
        if tokens > 0 {
            self.token.internal_withdraw(&me, tokens);
            self.token.internal_deposit(account, tokens);
        }
        events::collect(rid, account, pledge, tokens);
        tokens
    }

    // ---------- internal ----------

    fn assert_live(&self) {
        require!(
            self.ejected.is_none(),
            "The coin was ejected: trading and transfers are closed"
        );
    }

    fn day_at(&self, now: u64) -> u64 {
        now.saturating_sub(self.launch_ts) / self.day_length_sec
    }

    fn holder_or_default(&self, account_id: &AccountId) -> Holder {
        self.holders.get(account_id).cloned().unwrap_or_default()
    }

    /// Adds the size of one holder accounting entry to the NEP-145 per-account storage,
    /// so `storage_deposit` charges for both the balance and the accounting entry.
    fn include_holder_storage(&mut self) {
        let before = env::storage_usage();
        let probe: AccountId = "a".repeat(64).parse().unwrap();
        self.holders.insert(
            probe.clone(),
            Holder {
                basis: i128::MAX,
                weight: u128::MAX,
                last_ts: u64::MAX,
                claimed: true,
                pledge: u128::MAX,
                pledge_round: u32::MAX,
            },
        );
        self.holders.flush();
        let used = env::storage_usage().saturating_sub(before);
        self.holders.remove(&probe);
        self.holders.flush();
        self.token.account_storage_usage += used;
    }

    /// Accounting for a token transfer (spec section 6): the sender's positive basis moves
    /// pro-rata to the receiver, the sender sheds the same fraction of weight, and the
    /// receiver starts accruing from now. `sender_balance` is the sender's balance before.
    fn transfer_accounting(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        amount: u128,
        sender_balance: u128,
    ) {
        require!(
            sender != receiver,
            "Sender and receiver should be different"
        );
        let now = now_sec();
        let mut hs = self.holder_or_default(sender);
        let mut hr = self.holder_or_default(receiver);
        self.ledger.touch(&mut hs, now);
        self.ledger.touch(&mut hr, now);
        let moved = moved_basis(hs.basis, amount, sender_balance);
        let (ns, nr) = (hs.basis - moved, hr.basis + moved);
        self.ledger.set_basis(&mut hs, ns);
        self.ledger.set_basis(&mut hr, nr);
        self.ledger.shed(&mut hs, amount, sender_balance);
        self.holders.insert(sender.clone(), hs);
        self.holders.insert(receiver.clone(), hr);
    }

    fn compute_buy(&self, amount: u128) -> BuyQuote {
        require!(amount >= MIN_BUY, "Minimum buy is 0.001 NEAR");
        let fund_fee = fee_up(amount, self.fund_buy_bps as u128);
        let protocol_fee = fee_up(amount, PROTOCOL_BUY_BPS);
        let net = amount - fund_fee - protocol_fee;
        let s = self.token.total_supply;
        let (tokens, cost) = tokens_for_net(s, net);
        // At the supply cap the leftover would not be dust. Reject instead of keeping it.
        require!(
            s + tokens < curve::MAX_SUPPLY || net == cost,
            "Buy would exceed the supply cap"
        );
        BuyQuote {
            tokens_out: U128(tokens),
            cost: U128(cost),
            fund_fee: U128(fund_fee),
            protocol_fee: U128(protocol_fee),
            dust_to_fund: U128(net - cost),
            price_after: U128(price_at(s + tokens)),
        }
    }

    fn compute_sell(&self, d: u128) -> SellQuote {
        let s = self.token.total_supply;
        let gross = proceeds_of_burn(s, d);
        let fund_fee = fee_up(gross, self.fund_sell_bps as u128).min(gross);
        SellQuote {
            gross: U128(gross),
            fund_fee: U128(fund_fee),
            near_out: U128(gross - fund_fee),
            price_after: U128(price_at(s - d)),
        }
    }
}

// ---------- NEP-141 ----------

#[near]
impl FungibleTokenCore for Coin {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.assert_live();
        require!(
            receiver_id != env::current_account_id(),
            "The coin account holds the rescue escrow and cannot receive tokens"
        );
        let sender = env::predecessor_account_id();
        self.settle(&sender);
        let balance = self.token.ft_balance_of(sender.clone()).0;
        require!(
            amount.0 > 0 && amount.0 <= balance,
            "Invalid transfer amount"
        );
        self.transfer_accounting(&sender, &receiver_id, amount.0, balance);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.assert_live();
        require!(
            receiver_id != env::current_account_id(),
            "The coin account holds the rescue escrow and cannot receive tokens"
        );
        self.settle(&env::predecessor_account_id());
        // No accounting here: the tokens are in flight. `ft_resolve_transfer` books only the
        // part the receiver kept, as a transfer from the sender's own basis.
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Coin {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id.clone(), amount);
        // Tokens can only be "burned" here if the sender unregistered mid-flight. Panicking
        // reverts this callback, so the receiver keeps the tokens and the supply stays consistent.
        require!(burned == 0, "Unexpected burn in resolve");
        // Book the used part as a plain transfer from the sender, as if it happened now.
        // Only the sender's own basis and weight are touched, so a refund can never pull
        // basis out of the receiver. After EJECT the accounting is frozen, only tokens move.
        if used > 0 && self.ejected.is_none() {
            let sender_after = self.token.ft_balance_of(sender_id.clone()).0;
            self.transfer_accounting(&sender_id, &receiver_id, used, sender_after + used);
        }
        used.into()
    }
}

// ---------- NEP-145 ----------

#[near]
impl StorageManagement for Coin {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// Unregistering is only allowed with a zero balance. A forced unregister would burn
    /// tokens without releasing the matching reserve, so `force` is rejected.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        require!(
            !force.unwrap_or(false),
            "Forced unregister is disabled. Sell your tokens first."
        );
        let account = env::predecessor_account_id();
        require!(
            self.holder_or_default(&account).pledge == 0,
            "Collect or withdraw your Mayday pledge first"
        );
        let removed = self.token.storage_unregister(Some(false));
        if removed {
            // Zero balance means the holder already left the ship (basis and weight are 0).
            self.holders.remove(&account);
        }
        removed
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

// ---------- NEP-148 ----------

#[near]
impl FungibleTokenMetadataProvider for Coin {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: self.name.clone(),
            symbol: self.symbol.to_uppercase(),
            icon: self.icon.clone(),
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[cfg(test)]
mod tests;
