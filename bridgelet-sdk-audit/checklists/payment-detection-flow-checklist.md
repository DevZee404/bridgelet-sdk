# Payment Detection and Recording Flow Review Checklist

## Network Monitoring

- [ ] Is the SDK reliably polling or subscribing to Horizon for new payments?
- [ ] Are cursor states persisted properly to ensure no payments are missed during restarts?
- [ ] How does the SDK handle Horizon rate limits (HTTP 429) during polling?

## Verification

- [ ] Is the transaction hash validated to exist on the Stellar network before recording?
- [ ] Is the asset and amount validated against the expected payment parameters?
- [ ] Is the memo (if required) properly matched to a user or invoice ID?

## Idempotency

- [ ] Are duplicate payments prevented from being processed twice in the downstream database?
- [ ] Are replay attacks mitigated if a transaction is resubmitted to the network?
