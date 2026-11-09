//! Ejecto NEP-297 events. Standard "ejecto", version "1.0.0".
//! Token mint and burn also emit the standard NEP-141 events (FtMint, FtBurn).

use crate::{BuyQuote, EjectSnapshot, SellQuote};
use near_sdk::serde_json::json;
use near_sdk::{env, AccountId};

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let payload = json!({
        "standard": "ejecto",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

pub fn buy(buyer: &AccountId, near_in: u128, q: &BuyQuote) {
    emit(
        "ejecto_buy",
        json!({
            "account_id": buyer,
            "near_in": near_in.to_string(),
            "tokens_out": q.tokens_out,
            "cost": q.cost,
            "fund_fee": q.fund_fee,
            "protocol_fee": q.protocol_fee,
            "dust_to_fund": q.dust_to_fund,
        }),
    );
}

pub fn sell(seller: &AccountId, tokens_in: u128, q: &SellQuote) {
    emit(
        "ejecto_sell",
        json!({
            "account_id": seller,
            "tokens_in": tokens_in.to_string(),
            "gross": q.gross,
            "fund_fee": q.fund_fee,
            "near_out": q.near_out,
        }),
    );
}

pub fn protocol_withdraw(to: &AccountId, amount: u128) {
    emit(
        "ejecto_protocol_withdraw",
        json!({ "account_id": to, "amount": amount.to_string() }),
    );
}

pub fn eject(snap: &EjectSnapshot) {
    emit("ejecto_eject", json!(snap));
}

pub fn claim(account: &AccountId, tokens_burned: u128, reserve_part: u128, fund_part: u128) {
    emit(
        "ejecto_claim",
        json!({
            "account_id": account,
            "tokens_burned": tokens_burned.to_string(),
            "reserve_part": reserve_part.to_string(),
            "fund_part": fund_part.to_string(),
        }),
    );
}
