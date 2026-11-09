//! Ejecto factory. Launches every coin as a keyless sub-account `<symbol>.<factory>`.
//! See docs/architecture.md section 3.
//!
//! The factory owner can only replace the coin code used for future launches. Coins that
//! already exist are never affected: each coin account has no access keys and its contract
//! has no upgrade or admin method.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{LazyOption, LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

/// Extra deposit on top of the code storage, for the coin state and the first registrations.
pub const LAUNCH_MARGIN: u128 = 300_000_000_000_000_000_000_000; // 0.3 NEAR
const GAS_FOR_INIT: Gas = Gas::from_tgas(30);
/// Launch argument limits. They MUST match the coin's `new` (contracts/coin/src/lib.rs), so
/// that bad input is rejected here, synchronously, before the async launch batch.
pub const MIN_DAY_LENGTH: u64 = 10;
pub const MAX_DAY_LENGTH: u64 = 86_400;
pub const MAX_NAME_CHARS: usize = 32;
pub const MAX_ICON_BYTES: usize = 2048;
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(15);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    CoinCode,
    Coins,
    BySymbol,
    PendingRefunds,
}

/// Registry entry for a launched coin.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CoinInfo {
    pub account_id: AccountId,
    pub symbol: String,
    pub name: String,
    pub creator: AccountId,
    pub fee_preset: String,
    pub day_length_sec: u64,
    pub created_at: u64,
}

/// Factory configuration for the web app.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub owner: AccountId,
    pub protocol_account: AccountId,
    pub coin_code_len: u64,
    pub coin_code_hash: Option<String>,
    pub launch_deposit: U128,
    pub coins: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    owner: AccountId,
    protocol_account: AccountId,
    coin_code: LazyOption<Vec<u8>>,
    coin_code_len: u64,
    coin_code_hash: Option<String>,
    coins: Vector<CoinInfo>,
    by_symbol: LookupMap<String, u32>,
    /// Deposits of failed launches, withdrawn by the creator with `withdraw_refund`.
    pending_refunds: LookupMap<AccountId, u128>,
}

/// State layout before `pending_refunds` existed (deployed on testnet 2026-11-09).
#[near(serializers = [borsh])]
struct FactoryV1 {
    owner: AccountId,
    protocol_account: AccountId,
    coin_code: LazyOption<Vec<u8>>,
    coin_code_len: u64,
    coin_code_hash: Option<String>,
    coins: Vector<CoinInfo>,
    by_symbol: LookupMap<String, u32>,
}

fn valid_symbol(symbol: &str) -> bool {
    (2..=10).contains(&symbol.len())
        && symbol
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[near]
impl Factory {
    #[init]
    pub fn new(owner: AccountId, protocol_account: AccountId) -> Self {
        Self {
            owner,
            protocol_account,
            coin_code: LazyOption::new(StorageKey::CoinCode, None),
            coin_code_len: 0,
            coin_code_hash: None,
            coins: Vector::new(StorageKey::Coins),
            by_symbol: LookupMap::new(StorageKey::BySymbol),
            pending_refunds: LookupMap::new(StorageKey::PendingRefunds),
        }
    }

    /// One-time state migration from `FactoryV1`. Only the factory account itself can call it.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: FactoryV1 = env::state_read().unwrap_or_else(|| env::panic_str("No v1 state"));
        Self {
            owner: old.owner,
            protocol_account: old.protocol_account,
            coin_code: old.coin_code,
            coin_code_len: old.coin_code_len,
            coin_code_hash: old.coin_code_hash,
            coins: old.coins,
            by_symbol: old.by_symbol,
            pending_refunds: LookupMap::new(StorageKey::PendingRefunds),
        }
    }

    /// Stores the coin wasm used for future launches. Owner only.
    /// The raw wasm bytes are the call input (near-cli `file-args`), not JSON.
    pub fn set_coin_code(&mut self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can set the coin code"
        );
        let code = env::input().unwrap_or_else(|| env::panic_str("Missing wasm input"));
        require!(code.starts_with(b"\0asm"), "Input is not a wasm module");
        self.coin_code_len = code.len() as u64;
        self.coin_code_hash = Some(hex(&env::sha256(&code)));
        self.coin_code.set(Some(code));
    }

    /// Launches a coin at `<symbol>.<this factory>`. The new account gets no access keys.
    /// Attach at least `launch_deposit()`. Exactly `launch_deposit()` goes to the coin for its
    /// storage, anything above it is refunded at once. If the launch fails, the deposit is
    /// booked as a pending refund that the creator withdraws with `withdraw_refund`.
    #[payable]
    pub fn create_coin(
        &mut self,
        name: String,
        symbol: String,
        icon: Option<String>,
        fee_preset: String,
        day_length_sec: u64,
    ) -> Promise {
        require!(
            valid_symbol(&symbol),
            "symbol must be 2 to 10 characters, lowercase a-z and 0-9"
        );
        require!(
            matches!(fee_preset.as_str(), "light" | "standard" | "high"),
            "fee_preset must be light, standard or high"
        );
        require!(
            !self.by_symbol.contains_key(&symbol),
            "Symbol already taken"
        );
        // Same rules as the coin's `new`. Checking here makes bad input fail synchronously,
        // so the deposit is refunded by the runtime instead of by the async callback.
        require!(
            !name.is_empty() && name.chars().count() <= MAX_NAME_CHARS,
            "name must be 1 to 32 characters"
        );
        if let Some(i) = &icon {
            require!(i.len() <= MAX_ICON_BYTES, "icon must be at most 2 KB");
        }
        require!(
            (MIN_DAY_LENGTH..=MAX_DAY_LENGTH).contains(&day_length_sec),
            "day_length_sec must be between 10 and 86400"
        );
        let code = self
            .coin_code
            .get()
            .clone()
            .unwrap_or_else(|| env::panic_str("Coin code not set"));
        let deposit = env::attached_deposit().as_yoctonear();
        let min = self.launch_deposit().0;
        require!(
            deposit >= min,
            format!("Attach at least {min} yoctoNEAR to launch a coin")
        );

        let coin_id: AccountId = format!("{symbol}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("Invalid coin account id"));
        let creator = env::predecessor_account_id();
        // A keyless coin could never give back extra NEAR, so send exactly `min` and refund the rest.
        if deposit > min {
            Promise::new(creator.clone())
                .transfer(NearToken::from_yoctonear(deposit - min))
                .detach();
        }
        let init_args = json!({
            "name": name,
            "symbol": symbol,
            "icon": icon,
            "fee_preset": fee_preset,
            "day_length_sec": day_length_sec,
            "protocol_account": self.protocol_account,
        })
        .to_string()
        .into_bytes();
        let info = CoinInfo {
            account_id: coin_id.clone(),
            symbol,
            name,
            creator: creator.clone(),
            fee_preset,
            day_length_sec,
            created_at: env::block_timestamp() / 1_000_000_000,
        };

        // One atomic batch: if any action fails, all of them are reverted and the deposit
        // comes back to the factory. The callback books it as a pending refund.
        // No `add_full_access_key` / `add_access_key`: the coin account is keyless.
        Promise::new(coin_id)
            .create_account()
            .transfer(NearToken::from_yoctonear(min))
            .deploy_contract(code)
            .function_call(
                "new".to_string(),
                init_args,
                NearToken::from_yoctonear(0),
                GAS_FOR_INIT,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_coin_created(info, creator, U128(min)),
            )
    }

    /// Registers the coin after a successful launch. After a failed launch the deposit is
    /// booked as a pending refund. It is not sent right away, because the system refund of
    /// the failed batch may reach the factory only after this callback runs.
    #[private]
    pub fn on_coin_created(
        &mut self,
        info: CoinInfo,
        creator: AccountId,
        deposit: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_err() {
            let pending = self.pending_refunds.get(&creator).copied().unwrap_or(0);
            self.pending_refunds
                .insert(creator.clone(), pending + deposit.0);
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({
                    "standard": "ejecto",
                    "version": "1.0.0",
                    "event": "ejecto_launch_failed",
                    "data": [{ "creator": creator, "symbol": info.symbol, "refund": deposit }],
                })
            ));
            return false;
        }
        // On success the deposit was spent on the coin account. Never refund it here.
        if !self.by_symbol.contains_key(&info.symbol) {
            self.by_symbol.insert(info.symbol.clone(), self.coins.len());
            env::log_str(&format!(
                "EVENT_JSON:{}",
                json!({
                    "standard": "ejecto",
                    "version": "1.0.0",
                    "event": "ejecto_coin_created",
                    "data": [info],
                })
            ));
            self.coins.push(info);
        }
        true
    }

    /// Sends the caller's pending refunds from failed launches.
    pub fn withdraw_refund(&mut self) -> U128 {
        let account = env::predecessor_account_id();
        let amount = self.pending_refunds.remove(&account).unwrap_or(0);
        require!(amount > 0, "No pending refund");
        Promise::new(account)
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
        U128(amount)
    }

    pub fn pending_refund(&self, account_id: AccountId) -> U128 {
        U128(self.pending_refunds.get(&account_id).copied().unwrap_or(0))
    }

    // ---------- views ----------

    /// Minimum deposit for `create_coin`: code storage plus a margin.
    pub fn launch_deposit(&self) -> U128 {
        U128(self.coin_code_len as u128 * env::storage_byte_cost().as_yoctonear() + LAUNCH_MARGIN)
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            protocol_account: self.protocol_account.clone(),
            coin_code_len: self.coin_code_len,
            coin_code_hash: self.coin_code_hash.clone(),
            launch_deposit: self.launch_deposit(),
            coins: self.coins.len(),
        }
    }

    /// Newest coins last. Use `from_index` and `limit` to page.
    pub fn get_coins(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<CoinInfo> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.coins.len().min(from.saturating_add(limit)))
            .filter_map(|i| self.coins.get(i).cloned())
            .collect()
    }

    pub fn get_coin(&self, symbol: String) -> Option<CoinInfo> {
        self.by_symbol
            .get(&symbol)
            .and_then(|i| self.coins.get(*i).cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(predecessor: &str, deposit: u128, input: Vec<u8>) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("factory.ejecto.testnet"))
            .predecessor_account_id(acc(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        b.context.input = input.into();
        testing_env!(b.build());
    }

    fn setup() -> Factory {
        ctx("ejecto.testnet", 0, vec![]);
        Factory::new(acc("ejecto.testnet"), acc("fees.ejecto.testnet"))
    }

    fn fake_wasm() -> Vec<u8> {
        let mut w = b"\0asm\x01\0\0\0".to_vec();
        w.extend(vec![7u8; 1000]);
        w
    }

    #[test]
    fn owner_sets_code_and_deposit_follows_size() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, fake_wasm());
        f.set_coin_code();
        let cfg = f.get_config();
        assert_eq!(cfg.coin_code_len, 1008);
        assert!(cfg.coin_code_hash.is_some());
        assert_eq!(
            cfg.launch_deposit.0,
            1008 * env::storage_byte_cost().as_yoctonear() + LAUNCH_MARGIN
        );
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn stranger_cannot_set_code() {
        let mut f = setup();
        ctx("mallory.testnet", 0, fake_wasm());
        f.set_coin_code();
    }

    #[test]
    #[should_panic(expected = "not a wasm module")]
    fn rejects_non_wasm_code() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, b"hello".to_vec());
        f.set_coin_code();
    }

    #[test]
    #[should_panic(expected = "Coin code not set")]
    fn create_without_code_panics() {
        let mut f = setup();
        ctx("ani.ejecto.testnet", 3 * NEAR, vec![]);
        f.create_coin("Seato".into(), "seato".into(), None, "standard".into(), 10)
            .detach();
    }

    #[test]
    #[should_panic(expected = "symbol must be")]
    fn create_bad_symbol_panics() {
        let mut f = setup();
        ctx("ani.ejecto.testnet", 3 * NEAR, vec![]);
        f.create_coin("Seato".into(), "Sea.to".into(), None, "standard".into(), 10)
            .detach();
    }

    #[test]
    #[should_panic(expected = "fee_preset must be")]
    fn create_bad_preset_panics() {
        let mut f = setup();
        ctx("ani.ejecto.testnet", 3 * NEAR, vec![]);
        f.create_coin("Seato".into(), "seato".into(), None, "free".into(), 10)
            .detach();
    }

    #[test]
    #[should_panic(expected = "name must be")]
    fn create_bad_name_panics() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, fake_wasm());
        f.set_coin_code();
        ctx("ani.ejecto.testnet", 3 * NEAR, vec![]);
        f.create_coin("".into(), "seato".into(), None, "standard".into(), 10)
            .detach();
    }

    #[test]
    #[should_panic(expected = "day_length_sec")]
    fn create_bad_day_length_panics() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, fake_wasm());
        f.set_coin_code();
        ctx("ani.ejecto.testnet", 3 * NEAR, vec![]);
        f.create_coin("Seato".into(), "seato".into(), None, "standard".into(), 5)
            .detach();
    }

    #[test]
    #[should_panic(expected = "icon must be")]
    fn create_big_icon_panics() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, fake_wasm());
        f.set_coin_code();
        ctx("ani.ejecto.testnet", 3 * NEAR, vec![]);
        f.create_coin(
            "Seato".into(),
            "seato".into(),
            Some("x".repeat(3000)),
            "standard".into(),
            10,
        )
        .detach();
    }

    #[test]
    #[should_panic(expected = "Attach at least")]
    fn create_with_low_deposit_panics() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, fake_wasm());
        f.set_coin_code();
        ctx("ani.ejecto.testnet", NEAR / 10, vec![]);
        f.create_coin("Seato".into(), "seato".into(), None, "standard".into(), 10)
            .detach();
    }

    #[test]
    fn callback_registers_or_refunds() {
        let mut f = setup();
        let info = CoinInfo {
            account_id: acc("seato.factory.ejecto.testnet"),
            symbol: "seato".into(),
            name: "Seato".into(),
            creator: acc("ani.ejecto.testnet"),
            fee_preset: "standard".into(),
            day_length_sec: 10,
            created_at: 0,
        };
        ctx("factory.ejecto.testnet", 0, vec![]);
        assert!(f.on_coin_created(info.clone(), info.creator.clone(), U128(NEAR), Ok(())));
        assert_eq!(f.get_coin("seato".into()), Some(info.clone()));
        assert_eq!(f.get_coins(None, None).len(), 1);
        // a second success for the same symbol must not register twice and never refunds
        assert!(f.on_coin_created(info.clone(), info.creator.clone(), U128(NEAR), Ok(())));
        assert_eq!(f.get_config().coins, 1);
        assert_eq!(f.pending_refund(info.creator.clone()).0, 0);
        // a failed launch registers nothing and books a pending refund
        let mut other = info.clone();
        other.symbol = "moon".into();
        assert!(!f.on_coin_created(
            other.clone(),
            info.creator.clone(),
            U128(NEAR),
            Err(PromiseError::Failed)
        ));
        assert!(!f.on_coin_created(
            other,
            info.creator.clone(),
            U128(NEAR),
            Err(PromiseError::Failed)
        ));
        assert_eq!(f.get_coin("moon".into()), None);
        assert_eq!(f.pending_refund(info.creator.clone()).0, 2 * NEAR);
        // the creator withdraws it once
        ctx("ani.ejecto.testnet", 0, vec![]);
        assert_eq!(f.withdraw_refund().0, 2 * NEAR);
        assert_eq!(f.pending_refund(info.creator).0, 0);
    }

    #[test]
    #[should_panic(expected = "No pending refund")]
    fn withdraw_without_refund_panics() {
        let mut f = setup();
        ctx("ani.ejecto.testnet", 0, vec![]);
        f.withdraw_refund();
    }

    #[test]
    fn day_length_boundaries_match_the_coin() {
        for (day, ok) in [(9u64, false), (10, true), (86_400, true), (86_401, false)] {
            let result = std::thread::spawn(move || {
                let mut f = setup();
                ctx("ejecto.testnet", 0, fake_wasm());
                f.set_coin_code();
                ctx("ani.ejecto.testnet", 3 * NEAR, vec![]);
                f.create_coin("Seato".into(), "seato".into(), None, "standard".into(), day)
                    .detach();
            })
            .join();
            assert_eq!(result.is_ok(), ok, "day_length_sec {day}");
        }
    }

    #[test]
    fn excess_deposit_is_refunded_at_once() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, fake_wasm());
        f.set_coin_code();
        let min = f.launch_deposit().0;
        ctx("ani.ejecto.testnet", min + 5 * NEAR, vec![]);
        f.create_coin("Seato".into(), "seato".into(), None, "standard".into(), 10)
            .detach();
        let receipts = near_sdk::test_utils::get_created_receipts();
        let refund_to_creator = receipts.iter().any(|r| {
            r.receiver_id.as_str() == "ani.ejecto.testnet"
                && r.actions.iter().any(|a| matches!(a, near_sdk::mock::MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == 5 * NEAR))
        });
        assert!(
            refund_to_creator,
            "the 5 NEAR above the minimum must go back to the creator"
        );
        let coin_gets_min = receipts.iter().any(|r| {
            r.receiver_id.as_str() == "seato.factory.ejecto.testnet"
                && r.actions.iter().any(|a| matches!(a, near_sdk::mock::MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == min))
        });
        assert!(
            coin_gets_min,
            "the coin account must receive exactly the minimum"
        );
    }

    #[test]
    #[should_panic(expected = "Symbol already taken")]
    fn create_taken_symbol_panics() {
        let mut f = setup();
        ctx("ejecto.testnet", 0, fake_wasm());
        f.set_coin_code();
        let info = CoinInfo {
            account_id: acc("seato.factory.ejecto.testnet"),
            symbol: "seato".into(),
            name: "Seato".into(),
            creator: acc("ani.ejecto.testnet"),
            fee_preset: "standard".into(),
            day_length_sec: 10,
            created_at: 0,
        };
        ctx("factory.ejecto.testnet", 0, vec![]);
        f.on_coin_created(info.clone(), info.creator, U128(NEAR), Ok(()));
        ctx("budi.ejecto.testnet", 3 * NEAR, vec![]);
        f.create_coin(
            "Seato 2".into(),
            "seato".into(),
            None,
            "standard".into(),
            10,
        )
        .detach();
    }
}
