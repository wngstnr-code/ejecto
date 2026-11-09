//! Holder accounting: net basis x time held. See docs/product-spec.md section 6.
//!
//! Weight unit: (yoctoNEAR / WEIGHT_UNIT) x seconds. Scaling the basis down by 10^12 keeps
//! every weight in u128 with a huge margin (the whole NEAR supply held for 30 years is about
//! 10^30). The scaled basis is used consistently for `s_pos`, holder weights and the global
//! total, so `sum(holder weights) == w_total` holds exactly whenever all holders are touched
//! to the same time. That is what keeps the sum of all claims at or below the fund.

use near_sdk::near;

/// Basis scaling for weights: 10^12 yoctoNEAR (10^-12 NEAR).
pub const WEIGHT_UNIT: u128 = 1_000_000_000_000;

/// Per-holder accounting. The token balance itself lives in the NEP-141 `FungibleToken`.
#[near(serializers = [borsh, json])]
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct Holder {
    /// NEAR put in minus NEAR taken out (yoctoNEAR). Can be negative after profit taking.
    pub basis: i128,
    /// Accumulated weight up to `last_ts`.
    pub weight: u128,
    /// Last time (seconds) this holder was touched.
    pub last_ts: u64,
    /// True once the holder claimed after EJECT.
    pub claimed: bool,
}

/// Global accounting totals.
#[near(serializers = [borsh, json])]
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct Ledger {
    /// Sum of scaled positive basis over all holders.
    pub s_pos: u128,
    /// Sum of all holder weights, accrued up to `last_ts`.
    pub w_total: u128,
    /// Last time (seconds) the totals were accrued.
    pub last_ts: u64,
}

/// Positive part of the basis, scaled to weight units.
pub fn scaled(basis: i128) -> u128 {
    if basis > 0 {
        (basis as u128) / WEIGHT_UNIT
    } else {
        0
    }
}

impl Ledger {
    pub fn new(now: u64) -> Self {
        Self {
            s_pos: 0,
            w_total: 0,
            last_ts: now,
        }
    }

    /// Accrues the global total and the holder's weight up to `now`.
    /// Must run before any change to the holder's basis.
    pub fn touch(&mut self, h: &mut Holder, now: u64) {
        if now > self.last_ts {
            self.w_total += self.s_pos * (now - self.last_ts) as u128;
            self.last_ts = now;
        }
        if now > h.last_ts {
            h.weight += scaled(h.basis) * (now - h.last_ts) as u128;
            h.last_ts = now;
        }
    }

    /// Accrues only the global total up to `now` (used by EJECT).
    pub fn touch_global(&mut self, now: u64) {
        if now > self.last_ts {
            self.w_total += self.s_pos * (now - self.last_ts) as u128;
            self.last_ts = now;
        }
    }

    /// Sets a holder's basis and keeps `s_pos` exact. Call `touch` first.
    pub fn set_basis(&mut self, h: &mut Holder, new_basis: i128) {
        self.s_pos = self.s_pos - scaled(h.basis) + scaled(new_basis);
        h.basis = new_basis;
    }

    /// Full exit: the holder forfeits all weight and the basis resets to 0. Call `touch` first.
    pub fn leave_ship(&mut self, h: &mut Holder) {
        self.w_total -= h.weight;
        h.weight = 0;
        self.set_basis(h, 0);
    }

    /// Holder weight accrued up to `now` without mutating state.
    pub fn live_weight(h: &Holder, now: u64) -> u128 {
        let extra = if now > h.last_ts {
            scaled(h.basis) * (now - h.last_ts) as u128
        } else {
            0
        };
        h.weight + extra
    }

    /// Global total accrued up to `now` without mutating state.
    pub fn live_total(&self, now: u64) -> u128 {
        let extra = if now > self.last_ts {
            self.s_pos * (now - self.last_ts) as u128
        } else {
            0
        };
        self.w_total + extra
    }
}

/// Basis that moves with a token transfer: the positive basis, pro-rata to the amount sent.
pub fn moved_basis(sender_basis: i128, amount: u128, sender_balance: u128) -> i128 {
    if sender_basis <= 0 || sender_balance == 0 {
        return 0;
    }
    // basis (up to ~10^33) times token amounts (up to 10^28) needs more than 128 bits.
    use crate::curve::U512;
    let moved = U512::from(sender_basis as u128) * U512::from(amount) / U512::from(sender_balance);
    moved.min(U512::from(sender_basis as u128)).low_u128() as i128
}

/// Claim payout parts after EJECT. Both parts round down, so the sum over all holders
/// never exceeds `reserve_e + fund_e`.
pub fn claim_parts(
    reserve_e: u128,
    supply_e: u128,
    fund_e: u128,
    w_e: u128,
    balance: u128,
    weight_final: u128,
) -> (u128, u128) {
    use crate::curve::U512;
    let reserve_part = if supply_e == 0 {
        0
    } else {
        (U512::from(reserve_e) * U512::from(balance) / U512::from(supply_e)).low_u128()
    };
    // Fallback when no holder has positive weight: split the fund by tokens instead.
    let fund_part = if w_e > 0 {
        (U512::from(fund_e) * U512::from(weight_final) / U512::from(w_e)).low_u128()
    } else if supply_e > 0 {
        (U512::from(fund_e) * U512::from(balance) / U512::from(supply_e)).low_u128()
    } else {
        0
    };
    (reserve_part, fund_part)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEAR: i128 = 1_000_000_000_000_000_000_000_000;
    const DAY: u64 = 86_400;
    /// Weight of 1 NEAR held for 1 day, in weight units.
    const NEAR_DAY: u128 = (NEAR as u128 / WEIGHT_UNIT) * DAY as u128;

    /// The worked example from docs/research.md section 7 (Ani, Budi, Cici).
    #[test]
    fn worked_example_ani_budi_cici() {
        let mut l = Ledger::new(0);
        let (mut ani, mut budi, mut cici) =
            (Holder::default(), Holder::default(), Holder::default());

        // day 0: Ani buys 10 NEAR
        l.touch(&mut ani, 0);
        l.set_basis(&mut ani, 10 * NEAR);
        // day 2: Cici buys 20 NEAR
        l.touch(&mut cici, 2 * DAY);
        l.set_basis(&mut cici, 20 * NEAR);
        // day 5: Cici sells half for 15 NEAR -> basis 5
        l.touch(&mut cici, 5 * DAY);
        let b = cici.basis - 15 * NEAR;
        l.set_basis(&mut cici, b);
        // day 25: Budi buys 10 NEAR
        l.touch(&mut budi, 25 * DAY);
        l.set_basis(&mut budi, 10 * NEAR);

        // EJECT on day 30
        let t_e = 30 * DAY;
        l.touch_global(t_e);
        let w_e = l.w_total;
        let wa = Ledger::live_weight(&ani, t_e);
        let wb = Ledger::live_weight(&budi, t_e);
        let wc = Ledger::live_weight(&cici, t_e);
        assert_eq!(wa, 300 * NEAR_DAY);
        assert_eq!(wb, 50 * NEAR_DAY);
        assert_eq!(wc, 185 * NEAR_DAY);
        assert_eq!(
            wa + wb + wc,
            w_e,
            "holder weights must sum to the total exactly"
        );

        // reserve 60 NEAR for 600k tokens, fund 10 NEAR
        let (reserve_e, fund_e) = (60 * NEAR as u128, 10 * NEAR as u128);
        let tok = 1_000_000_000_000_000_000u128;
        let supply_e = 600_000 * tok;
        let pa = claim_parts(reserve_e, supply_e, fund_e, w_e, 300_000 * tok, wa);
        let pb = claim_parts(reserve_e, supply_e, fund_e, w_e, 100_000 * tok, wb);
        let pc = claim_parts(reserve_e, supply_e, fund_e, w_e, 200_000 * tok, wc);
        assert_eq!(pa.0, 30 * NEAR as u128);
        assert_eq!(pb.0, 10 * NEAR as u128);
        assert_eq!(pc.0, 20 * NEAR as u128);
        // fund parts: 10 x 300/535, 10 x 50/535, 10 x 185/535
        let near = NEAR as u128;
        assert_eq!(pa.1 / (near / 10), 56); // 5.6 NEAR
        assert_eq!(pb.1 / (near / 10), 9); // 0.9 NEAR
        assert_eq!(pc.1 / (near / 10), 34); // 3.4579 NEAR
        assert!(pa.1 + pb.1 + pc.1 <= fund_e);
    }

    #[test]
    fn leave_ship_forfeits_weight() {
        let mut l = Ledger::new(0);
        let mut a = Holder::default();
        l.touch(&mut a, 0);
        l.set_basis(&mut a, NEAR);
        l.touch(&mut a, DAY);
        assert!(a.weight > 0);
        l.leave_ship(&mut a);
        assert_eq!(a.weight, 0);
        assert_eq!(a.basis, 0);
        assert_eq!(l.w_total, 0);
        assert_eq!(l.s_pos, 0);
    }

    #[test]
    fn negative_basis_has_no_weight() {
        let mut l = Ledger::new(0);
        let mut a = Holder::default();
        l.touch(&mut a, 0);
        l.set_basis(&mut a, -5 * NEAR);
        l.touch(&mut a, 10 * DAY);
        assert_eq!(a.weight, 0);
        assert_eq!(l.s_pos, 0);
    }

    #[test]
    fn moved_basis_is_pro_rata_and_bounded() {
        // realistic magnitudes: 10 NEAR basis, ~1.6e26 raw tokens (would overflow u128)
        let bal: u128 = 161_990_098_767_241_559_067_267_728;
        assert_eq!(moved_basis(10 * NEAR, bal / 2, bal), 5 * NEAR);
        assert_eq!(moved_basis(10 * NEAR, 50, 100), 5 * NEAR);
        assert_eq!(moved_basis(10 * NEAR, 100, 100), 10 * NEAR);
        assert_eq!(moved_basis(-3 * NEAR, 50, 100), 0);
        assert_eq!(moved_basis(10 * NEAR, 1, 0), 0);
    }

    #[test]
    fn claim_parts_fallbacks() {
        // no weight at all: fund split by tokens
        assert_eq!(claim_parts(100, 10, 50, 0, 5, 0), (50, 25));
        // no supply: nothing to claim
        assert_eq!(claim_parts(0, 0, 50, 0, 0, 0), (0, 0));
    }
}
