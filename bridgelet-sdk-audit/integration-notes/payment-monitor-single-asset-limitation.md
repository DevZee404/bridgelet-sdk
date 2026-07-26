# Integration Note: Sweeping an Account That Was Never Paid

> **For integrators** using the bridgelet-sdk sweep/claim flow.

## Context

The expected lifecycle is: create account → send payment → record payment → sweep. If you attempt to sweep an account that has never received a payment, the contract returns a `NO_PAYMENT_RECEIVED` error and the SDK maps it to HTTP 400.

## What Happens

```
POST /accounts/{accountId}/sweep
→ 400 "No payment received"
   error_code: "NO_PAYMENT_RECEIVED"
```

The SDK will **not** retry this error. It is classified as terminal and non-retriable.

## Why This Matters

- If your integration has a race condition where the sweep is triggered before the payment monitor confirms the payment, you will get this error.
- The payment monitor polls every 30 seconds by default (`PAYMENT_MONITOR_INTERVAL_MS`). If you trigger a sweep immediately after creating the account, the monitor may not have detected the payment yet.

## Recommendation

Wait for the `sweep.pending` webhook to fire before initiating the sweep. This webhook confirms the SDK has detected the payment and the account is ready for sweeping.
