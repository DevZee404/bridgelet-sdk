# Why does an ephemeral account only ever get one payment recorded?

The contract can support up to ten recorded assets, but the payment monitor does not necessarily exercise that capacity. Its polling logic finds the first matching payment or asset state, records that result, and immediately transitions the account or payment to the next status. Once that status transition occurs, later polling does not keep collecting additional payments for the same account.

This is an SDK-side payment-monitor limitation, not a contract-side limit. The contract's multi-asset capacity remains broader than the monitor behavior described in [Payment Monitor Single Asset Limitation](../integration-notes/payment-monitor-single-asset-limitation.md).

For a payment that the monitor missed, the current manual workaround is documented in [Backfilling Missed Payments](../runbooks/backfill-missed-payments.md).
