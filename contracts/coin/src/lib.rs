//! Ejecto coin contract. Spec: docs/product-spec.md. Architecture: docs/architecture.md.
//!
//! M1 scope: NEP-141 token, bonding curve buy and sell, fee presets, Ejecto Fund,
//! protocol fees, quotes and status. Holder accounting, the alive detector, EJECT and
//! claim are added in M2.

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
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

pub mod curve;
mod events;

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

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
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
    pub age_days: u64,
    pub protocol_account: AccountId,
    pub factory: AccountId,
    pub supply: U128,
    pub price: U128,
    pub reserve: U128,
    pub fund: U128,
    pub protocol_fees: U128,
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
        let is_parent = me.as_str().ends_with(&format!(".{}", caller.as_str()));
        require!(is_parent || caller == me, "Only the factory (parent account) can initialize");
        require!(!name.is_empty() && name.chars().count() <= 32, "name must be 1 to 32 characters");
        require!(
            symbol.len() >= 2
                && symbol.len() <= 10
                && symbol.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
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
        Self {
            name,
            symbol,
            icon,
            fee_preset,
            fund_buy_bps,
            fund_sell_bps,
            day_length_sec,
            launch_ts: now_sec(),
            protocol_account,
            factory: caller,
            token: FungibleToken::new(StorageKey::Token),
            reserve: 0,
            fund: 0,
            protocol_fees: 0,
        }
    }

    // ---------- trading ----------

    /// Buys tokens with the attached NEAR. The buyer must be registered (storage_deposit).
    /// Returns the amount of raw tokens minted.
    #[payable]
    pub fn buy(&mut self, min_tokens_out: Option<U128>) -> U128 {
        let buyer = env::predecessor_account_id();
        require!(
            self.token.accounts.contains_key(&buyer),
            "Register first: call storage_deposit"
        );
        let amount = env::attached_deposit().as_yoctonear();
        let q = self.compute_buy(amount);
        let tokens = q.tokens_out.0;
        require!(tokens > 0, "Buy too small for any tokens");
        if let Some(min) = min_tokens_out {
            require!(tokens >= min.0, "Slippage: fewer tokens than min_tokens_out");
        }

        // effects
        self.reserve += q.cost.0;
        self.fund += q.fund_fee.0 + q.dust_to_fund.0;
        self.protocol_fees += q.protocol_fee.0;
        self.token.internal_deposit(&buyer, tokens);
        debug_assert_eq!(self.reserve, reserve_at(self.token.total_supply));

        FtMint { owner_id: &buyer, amount: U128(tokens), memo: Some("ejecto buy") }.emit();
        events::buy(&buyer, amount, &q);
        U128(tokens)
    }

    /// Sells `amount` raw tokens back to the curve. Sends NEAR to the seller.
    /// Returns the NEAR sent (after the fund fee).
    pub fn sell(&mut self, amount: U128, min_near_out: Option<U128>) -> U128 {
        let seller = env::predecessor_account_id();
        let d = amount.0;
        require!(d > 0, "Amount must be positive");
        let balance = self.token.ft_balance_of(seller.clone()).0;
        require!(d <= balance, "Not enough tokens");
        let q = self.compute_sell(d);
        require!(q.near_out.0 > 0, "Sell too small");
        if let Some(min) = min_near_out {
            require!(q.near_out.0 >= min.0, "Slippage: less NEAR than min_near_out");
        }

        // effects before the outgoing transfer
        self.token.internal_withdraw(&seller, d);
        self.reserve -= q.gross.0;
        self.fund += q.fund_fee.0;
        debug_assert_eq!(self.reserve, reserve_at(self.token.total_supply));

        FtBurn { owner_id: &seller, amount: U128(d), memo: Some("ejecto sell") }.emit();
        events::sell(&seller, d, &q);
        // Dropping a Promise schedules it, the binding only silences the must_use lint.
        let _ = Promise::new(seller).transfer(NearToken::from_yoctonear(q.near_out.0));
        q.near_out
    }

    /// Sends all accrued protocol fees to the protocol account fixed at launch. Anyone can call.
    pub fn withdraw_protocol_fees(&mut self) -> U128 {
        let amount = self.protocol_fees;
        require!(amount > 0, "No protocol fees to withdraw");
        self.protocol_fees = 0;
        events::protocol_withdraw(&self.protocol_account, amount);
        let _ = Promise::new(self.protocol_account.clone())
            .transfer(NearToken::from_yoctonear(amount));
        U128(amount)
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
            age_days: now.saturating_sub(self.launch_ts) / self.day_length_sec,
            protocol_account: self.protocol_account.clone(),
            factory: self.factory.clone(),
            supply: U128(supply),
            price: U128(price_at(supply)),
            reserve: U128(self.reserve),
            fund: U128(self.fund),
            protocol_fees: U128(self.protocol_fees),
        }
    }

    // ---------- internal ----------

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
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        // Tokens can only be "burned" here if the sender unregistered mid-flight. That cannot
        // happen because force unregister is disabled, so the reserve invariant holds.
        require!(burned == 0, "Unexpected burn in resolve");
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
        require!(!force.unwrap_or(false), "Forced unregister is disabled. Sell your tokens first.");
        self.token.storage_unregister(Some(false))
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
