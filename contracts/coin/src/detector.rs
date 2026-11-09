//! Alive detector: 14 daily buy buckets and the peak window. See docs/product-spec.md section 7.

use near_sdk::near;

/// Number of days in the window.
pub const WINDOW_DAYS: u64 = 14;
/// Minimum coin age (in days) before EJECT is possible.
pub const MIN_AGE_DAYS: u64 = 14;
/// Alive threshold floor: 1 NEAR.
pub const ALIVE_MIN: u128 = 1_000_000_000_000_000_000_000_000;
/// Alive threshold: 5% of the peak window (in basis points).
pub const ALIVE_PEAK_BPS: u128 = 500;

const EMPTY: u64 = u64::MAX;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Detector {
    /// (day, buy volume in yoctoNEAR). `day == EMPTY` marks an unused bucket.
    buckets: [(u64, u128); WINDOW_DAYS as usize],
    /// Highest window volume ever observed.
    pub peak_window: u128,
}

impl Default for Detector {
    fn default() -> Self {
        Self {
            buckets: [(EMPTY, 0); WINDOW_DAYS as usize],
            peak_window: 0,
        }
    }
}

impl Detector {
    /// Records a buy of `amount` yoctoNEAR on `day` and updates the peak.
    pub fn record_buy(&mut self, day: u64, amount: u128) {
        let i = (day % WINDOW_DAYS) as usize;
        if self.buckets[i].0 != day {
            self.buckets[i] = (day, 0);
        }
        self.buckets[i].1 += amount;
        self.peak_window = self.peak_window.max(self.window_buys(day));
    }

    /// Buy volume over the last 14 days including `day`.
    pub fn window_buys(&self, day: u64) -> u128 {
        self.buckets
            .iter()
            .filter(|(d, _)| *d != EMPTY && *d <= day && day - *d < WINDOW_DAYS)
            .map(|(_, v)| *v)
            .sum()
    }

    /// max(1 NEAR, 5% of the peak window).
    pub fn alive_threshold(&self) -> u128 {
        ALIVE_MIN.max(self.peak_window * ALIVE_PEAK_BPS / 10_000)
    }

    /// True when the rule in spec section 7 allows EJECT (ignoring the ejected flag).
    pub fn ejectable(&self, day: u64) -> bool {
        day >= MIN_AGE_DAYS && self.window_buys(day) < self.alive_threshold()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const NEAR: u128 = ALIVE_MIN;

    #[test]
    fn window_counts_only_last_14_days() {
        let mut d = Detector::default();
        d.record_buy(0, 10 * NEAR);
        d.record_buy(5, 3 * NEAR);
        assert_eq!(d.window_buys(5), 13 * NEAR);
        assert_eq!(d.window_buys(13), 13 * NEAR);
        assert_eq!(d.window_buys(14), 3 * NEAR); // day 0 left the window
        assert_eq!(d.window_buys(19), 0);
        assert_eq!(d.peak_window, 13 * NEAR);
    }

    #[test]
    fn bucket_reuse_resets_old_day() {
        let mut d = Detector::default();
        d.record_buy(1, 7 * NEAR);
        d.record_buy(15, 2 * NEAR); // same bucket index as day 1
        assert_eq!(d.window_buys(15), 2 * NEAR);
    }

    #[test]
    fn threshold_is_relative_with_floor() {
        let mut d = Detector::default();
        assert_eq!(d.alive_threshold(), NEAR);
        d.record_buy(0, 100 * NEAR);
        assert_eq!(d.alive_threshold(), 5 * NEAR);
    }

    #[test]
    fn ejectable_needs_age_and_low_volume() {
        let mut d = Detector::default();
        d.record_buy(0, 100 * NEAR);
        assert!(!d.ejectable(13), "too young");
        assert!(!d.ejectable(10), "too young and busy");
        // day 14: window drops day 0, volume 0 < 5 NEAR
        assert!(d.ejectable(14));
        d.record_buy(14, 6 * NEAR);
        assert!(!d.ejectable(14), "a buy above threshold revives it");
        assert!(d.ejectable(28));
    }
}
