# Account Expiry Flow Review Checklist

## Timing and Thresholds

- [ ] Are expiry checks occurring within the expected timeframe (e.g. grace period)?
- [ ] Is the SDK properly identifying accounts nearing expiry using `getLedgerSequence()`?
- [ ] Are boundary conditions tested (exactly at expiry, 1 ledger before, 1 ledger after)?

## State Transitions

- [ ] Are state transitions properly handled when an account shifts to `EXPIRED`?
- [ ] Are related balances zeroed out or placed in a recovery state securely?
- [ ] Is there an event or log emitted upon successful expiry processing?

## Recovery & Re-activation

- [ ] Is the recovery process documented and tested?
- [ ] Can users re-activate accounts that were incorrectly marked expired (if applicable)?
