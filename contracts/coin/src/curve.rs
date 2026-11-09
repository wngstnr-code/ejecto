//! Pure bonding curve math. See docs/product-spec.md section 5.
//!
//! Units:
//! - supply `s` is in raw token units (18 decimals, 1 token = 10^18 raw)
//! - NEAR amounts are in yoctoNEAR (1 NEAR = 10^24 yocto)
//!
//! Price per whole token: p(s) = P0 + K * s_tokens
//! Reserve:              R(s) = P0 * s_tokens + K * s_tokens^2 / 2
//!
//! In raw units: R(s) = (2 * P0 * ONE_TOKEN * s + K * s^2) / (2 * ONE_TOKEN^2), rounded down.
//! The contract always keeps `reserve == reserve_at(supply)`, so every buy and sell
//! moves exactly the difference of two `reserve_at` values. Rounding can never drain it.

#[allow(clippy::manual_div_ceil)] // inside the uint crate macro
mod wide {
    use uint::construct_uint;
    construct_uint! {
        /// 512-bit unsigned integer for intermediate products (no overflow for any allowed input).
        pub struct U512(8);
    }
}
pub use wide::U512;

/// 1 token in raw units (18 decimals).
pub const ONE_TOKEN: u128 = 1_000_000_000_000_000_000;
/// Start price: 2e-8 NEAR per token, in yoctoNEAR.
pub const P0: u128 = 20_000_000_000_000_000;
/// Slope: 5e-16 NEAR per token per token, in yoctoNEAR.
pub const K: u128 = 500_000_000;
/// Hard cap on supply: 10 billion tokens (raw). The reserve at the cap is about 25,000 NEAR.
pub const MAX_SUPPLY: u128 = 10_000_000_000 * ONE_TOKEN;

fn u(x: u128) -> U512 {
    U512::from(x)
}

fn to_u128(x: U512) -> u128 {
    assert!(x <= u(u128::MAX), "curve: value does not fit in u128");
    x.low_u128()
}

/// Denominator 2 * ONE_TOKEN^2.
fn denom() -> U512 {
    u(2) * u(ONE_TOKEN) * u(ONE_TOKEN)
}

/// 2 * ONE_TOKEN^2 * R(s), exact (no rounding).
fn scaled_reserve(s: u128) -> U512 {
    u(2) * u(P0) * u(ONE_TOKEN) * u(s) + u(K) * u(s) * u(s)
}

/// Reserve in yoctoNEAR for a raw supply `s`, rounded down.
pub fn reserve_at(s: u128) -> u128 {
    assert!(s <= MAX_SUPPLY, "curve: supply above cap");
    to_u128(scaled_reserve(s) / denom())
}

/// Spot price of one whole token at raw supply `s`, in yoctoNEAR (rounded down).
pub fn price_at(s: u128) -> u128 {
    to_u128(u(P0) + u(K) * u(s) / u(ONE_TOKEN))
}

/// Cost in yoctoNEAR to move supply from `s` to `s + d`.
pub fn cost_to_mint(s: u128, d: u128) -> u128 {
    let end = s.checked_add(d).expect("curve: supply overflow");
    reserve_at(end) - reserve_at(s)
}

/// NEAR released by burning `d` raw tokens at supply `s` (gross, before fees).
pub fn proceeds_of_burn(s: u128, d: u128) -> u128 {
    assert!(d <= s, "curve: burn larger than supply");
    reserve_at(s) - reserve_at(s - d)
}

/// Integer square root (floor) using Newton's method.
fn isqrt(n: U512) -> U512 {
    if n.is_zero() {
        return n;
    }
    // Start from 2^ceil(bits/2), which is >= sqrt(n), so Newton converges in a few steps.
    let mut x = U512::one() << n.bits().div_ceil(2);
    let mut y = (x + n / x) >> 1;
    while y < x {
        x = y;
        y = (x + n / x) >> 1;
    }
    x
}

/// Largest raw token amount `d` such that `cost_to_mint(s, d) <= net`.
/// Also capped so that `s + d <= MAX_SUPPLY`.
/// Returns `(d, cost)` with `cost = cost_to_mint(s, d) <= net`.
pub fn tokens_for_net(s: u128, net: u128) -> (u128, u128) {
    assert!(s <= MAX_SUPPLY, "curve: supply above cap");
    // Exact form: K*d^2 + B*d <= C, with B = 2*P0*ONE_TOKEN + 2*K*s and C = 2*ONE_TOKEN^2*net.
    // Real root: d = (-B + sqrt(B^2 + 4*K*C)) / (2*K)
    let b = u(2) * u(P0) * u(ONE_TOKEN) + u(2) * u(K) * u(s);
    let c = denom() * u(net);
    let disc = b * b + u(4) * u(K) * c;
    let root = isqrt(disc);
    let mut d = if root > b { (root - b) / (u(2) * u(K)) } else { U512::zero() };
    let room = u(MAX_SUPPLY - s);
    if d > room {
        d = room;
    }
    let d = to_u128(d);
    // The floor in reserve_at moves the true answer by at most about 1 yocto of cost,
    // which is at most ~50 raw units at the lowest price (P0 = 0.02 yocto per raw unit).
    // Binary search in a small window around the real root keeps gas small and constant.
    let max_d = MAX_SUPPLY - s;
    let mut lo = d.saturating_sub(WINDOW);
    let mut hi = d.saturating_add(WINDOW).min(max_d);
    if cost_to_mint(s, lo) > net {
        lo = 0; // never expected, but stay correct
    }
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if cost_to_mint(s, mid) <= net {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    (lo, cost_to_mint(s, lo))
}

/// Search window (raw units) around the real root in `tokens_for_net`.
const WINDOW: u128 = 256;

#[cfg(test)]
mod tests {
    use super::*;

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    #[test]
    fn reserve_matches_spec_example() {
        // Buying from 0 to 1 billion tokens costs 270 NEAR (spec section 5).
        assert_eq!(reserve_at(1_000_000_000 * ONE_TOKEN), 270 * NEAR);
        assert_eq!(reserve_at(0), 0);
    }

    #[test]
    fn price_matches_spec() {
        assert_eq!(price_at(0), P0);
        // at 1 billion tokens: 2e-8 + 5e-16 * 1e9 = 5.2e-7 NEAR
        assert_eq!(price_at(1_000_000_000 * ONE_TOKEN), 520_000_000_000_000_000);
    }

    #[test]
    fn tokens_for_net_is_maximal_and_within_budget() {
        let supplies = [0u128, 1, ONE_TOKEN, 123_456_789 * ONE_TOKEN + 77, 2_000_000_000 * ONE_TOKEN];
        let nets = [1u128, 1_000, NEAR / 1000, NEAR, 37 * NEAR + 12_345, 500 * NEAR];
        for &s in &supplies {
            for &n in &nets {
                let (d, cost) = tokens_for_net(s, n);
                assert!(cost <= n, "cost above budget");
                assert_eq!(cost, cost_to_mint(s, d));
                if s + d < MAX_SUPPLY {
                    assert!(cost_to_mint(s, d + 1) > n, "not maximal at s={s} n={n}");
                }
            }
        }
    }

    #[test]
    fn mint_then_burn_round_trip_is_exact() {
        let s0 = 42 * ONE_TOKEN + 9;
        let (d, cost) = tokens_for_net(s0, 3 * NEAR);
        assert_eq!(proceeds_of_burn(s0 + d, d), cost);
    }

    #[test]
    fn respects_supply_cap() {
        let near_cap = MAX_SUPPLY - ONE_TOKEN;
        let (d, _) = tokens_for_net(near_cap, 1_000_000 * NEAR);
        assert_eq!(near_cap + d, MAX_SUPPLY);
    }

    #[test]
    fn isqrt_is_floor() {
        for n in [0u64, 1, 2, 3, 4, 15, 16, 17, 1_000_000, 999_999_999_999, u64::MAX] {
            let r = isqrt(U512::from(n));
            assert!(r * r <= U512::from(n));
            assert!((r + 1) * (r + 1) > U512::from(n));
        }
    }

    #[test]
    fn isqrt_of_huge_values_is_floor() {
        let big = (U512::one() << 400) + U512::from(12_345u64);
        let r = isqrt(big);
        assert!(r * r <= big && (r + 1) * (r + 1) > big);
    }

    #[test]
    #[should_panic(expected = "burn larger than supply")]
    fn burn_more_than_supply_panics() {
        proceeds_of_burn(10, 11);
    }
}
