# Sweep Execution Flow Review Checklist

## Authorisation & Pre-conditions

- [ ] Are sweeping operations properly authorised using the correct signatures?
- [ ] Are checks in place to ensure the sweep target is a valid and trusted account?
- [ ] Does the sweep check minimum reserve requirements before initiating?

## Execution & Atomicity

- [ ] Are sweep operations executed atomically in a single transaction?
- [ ] In the event of a partial failure, are funds locked in an unrecoverable state?
- [ ] Does the transaction properly sponsor reserves if needed?

## Post-condition Validation

- [ ] Does the SDK verify the balances post-execution?
- [ ] Are logs/events accurately reflecting the amount swept and any associated fees?
