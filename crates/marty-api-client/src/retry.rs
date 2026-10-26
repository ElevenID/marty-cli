//! Transport-independent retry defaults and backoff calculations.
pub(crate) const RETRYABLE_STATUSES: [u16; 6] = [408, 429, 500, 502, 503, 504];

#[derive(Clone, Copy)]
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) enum DelayCap {
    BeforeJitter,
    AfterJitter,
}

/// Preserve each public transport's existing cap placement. Randomness is supplied
/// by the adapter so calculations can be tested without network or timer fixtures.
pub(crate) fn backoff_delay_ms(
    base: f64,
    maximum: f64,
    multiplier: f64,
    attempt: u32,
    jitter: f64,
    cap: DelayCap,
) -> f64 {
    let exponential = base * multiplier.powf(f64::from(attempt));
    match cap {
        DelayCap::BeforeJitter => {
            let capped = exponential.min(maximum);
            capped + capped * 0.25 * jitter
        }
        DelayCap::AfterJitter => (exponential * (1.0 + 0.25 * jitter)).min(maximum),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic_backoff_preserves_native_and_browser_caps() {
        let cases = [
            (0, -1.0, DelayCap::BeforeJitter, 750.0),
            (0, -1.0, DelayCap::AfterJitter, 750.0),
            (2, 0.0, DelayCap::BeforeJitter, 4000.0),
            (2, 0.0, DelayCap::AfterJitter, 4000.0),
            (8, 1.0, DelayCap::BeforeJitter, 12500.0),
            (8, 1.0, DelayCap::AfterJitter, 10000.0),
        ];
        for (attempt, jitter, cap, expected) in cases {
            let actual = backoff_delay_ms(1000.0, 10000.0, 2.0, attempt, jitter, cap);
            assert!((actual - expected).abs() < 1e-6);
        }
        assert!(
            backoff_delay_ms(0.0, 0.0, 1.0, 0, 0.0, DelayCap::AfterJitter).abs() < f64::EPSILON
        );
    }
}
