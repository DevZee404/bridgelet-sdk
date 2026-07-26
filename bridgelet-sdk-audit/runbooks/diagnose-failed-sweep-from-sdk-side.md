# Runbook: Diagnosing a Failed executeSweep() Call from the SDK's Perspective

> **Scope:** SDK-side error interpretation only. For on-chain contract diagnostics, see bridgelet-audit's `diagnose-failed-sweep.md`.

## Symptom

A sweep request (from claim redemption or manual trigger) returned an error. The account may be in `PENDING_CLAIM`, `CLAIMING`, or `PARTIAL_SWEEP` status.

## Prerequisites

- Database access to the `accounts` and `claims` tables
- SDK application logs
- Access to the raw error response (not just the stringified message)

---

## Step 1 — Capture the Raw Error

**Always start here.** The SDK's `executeSweep()` method catches errors in a try/catch and returns a `SweepResult` with an `error` field. However, some error paths use string-matching (`errStr.includes(...)`) which can miss cases.

Check the SDK logs for the full error object:

```
grep "executeSweep" /var/log/bridgelet/sweeps*.log | grep "{accountId}"
```

Look for the raw `errorResult` JSON before any string matching is applied. The error string may be truncated or lose context in the catch-all path.

## Step 2 — Map the Error to the Contract Error Table

The SDK's `contract-error.mapper.ts` maps raw Soroban contract error strings to structured HTTP errors. Cross-reference the raw error string against these known variants:

| Contract Error | HTTP Status | Error Code | Retriable? | Meaning |
|---|---|---|---|---|
| `AlreadySwept` | 410 | `ALREADY_SWEPT` | No | Contract already in Swept state |
| `AccountExpired` | 410 | `ACCOUNT_EXPIRED` | No | Account's expiry_ledger has passed on-chain |
| `NoPaymentReceived` | 400 | `NO_PAYMENT_RECEIVED` | No | record_payment was never called |
| `InvalidStatus` | 409 | `INVALID_STATUS` | No | Contract not in a sweepable state |
| `AuthorizationFailed` | 403 | `AUTHORIZATION_FAILED` | No | Auth signature verification failed |
| `UnauthorizedDestination` | 403 | `UNAUTHORIZED_DESTINATION` | No | Destination not authorized |
| `AccountAlreadySwept` | 410 | `ACCOUNT_ALREADY_SWEPT` | No | Variant of AlreadySwept |
| Unknown string | 500 | `UNKNOWN_CONTRACT_ERROR` | No | Catch-all |

**Important caveat (see execute-sweep-error-mapping-completeness.md):** A bad Ed25519 signature may cause a raw Wasm trap on the contract side rather than returning a typed `AuthorizationFailed` error. If you see a generic `Error` or trap message rather than one of the known variants above, the signature verification may have panicked rather than returned an error. This gap is documented in the integration notes.

## Step 3 — Distinguish Contract vs Horizon Errors

The SDK executes sweeps in two phases:
1. **Soroban contract call** (`execute_sweep()`) — can fail with any of the above contract errors.
2. **Horizon payment** (classic `Operation.payment()`) — can fail with Horizon-specific errors.

Horizon errors are mapped by `horizon-error.mapper.ts`:

| Horizon Code | HTTP Status | Meaning |
|---|---|---|
| `tx_bad_auth` | 401 | Ephemeral account secret key invalid |
| `tx_insufficient_balance` | 402 | Not enough XLM for the payment |
| `tx_too_late` | 408 | Transaction expired before confirmation |
| `tx_bad_seq` | 409 | Sequence number conflict |

If the contract call succeeded but the Horizon payment failed, the account enters `PARTIAL_SWEEP` status. This is a specific, recoverable state.

## Step 4 — PARTIAL_SWEEP Recovery

When an account is in `PARTIAL_SWEEP`:
- The on-chain contract is already in `Swept` state (the contract call succeeded).
- The Horizon payment to the destination failed.
- On retry, the SDK sets `skipContractAuth: true`, which skips the contract call and goes directly to the Horizon payment.
- A deterministic `contractAuthHash` is synthesized for the audit trail.

Check whether the `sweep.partial` webhook was delivered to the integrator. If not, they may need to call the claim endpoint again to trigger the retry.

## Step 5 — Cross-Reference with bridgelet-audit

For the on-chain side of the diagnosis (contract state, transaction traces, authorization verification), refer to:
- `bridgelet-audit/diagnose-failed-sweep.md` — on-chain diagnostic steps
- `bridgelet-audit/ed25519-verify-panic-vs-result.md` — signature verification behavior
- `execute-sweep-error-mapping-completeness.md` in this repo — SDK-side mapping gaps

## Step 6 — Check Retry Queue State

The SDK has an in-memory retry queue (`SweepRetryQueueService`) with exponential backoff (base 2s, max 5min, default 5 attempts). Terminal errors (`ALREADY_SWEPT`, `ACCOUNT_EXPIRED`) are not retried.

If the service was restarted during a retry cycle, the queue is lost. Check logs for the most recent retry attempt. If no retry logs exist after a restart, the sweep may need to be manually retriggered.

---

## Resolution Summary

| Root cause | Resolution |
|---|---|
| `ALREADY_SWEPT` / `ACCOUNT_ALREADY_SWEPT` | No action needed; sweep completed previously |
| `ACCOUNT_EXPIRED` | Account expired on-chain; check if funds returned to recovery |
| `NO_PAYMENT_RECEIVED` | Payment was never recorded; check payment monitor |
| `AUTHORIZATION_FAILED` | Check sweep signing key matches the authorized_signer on-chain |
| Bad signature causing Wasm trap | Known gap — see execute-sweep-error-mapping-completeness.md |
| Horizon payment failed (PARTIAL_SWEEP) | Retry via claim endpoint; SDK skips contract auth on retry |
| Horizon `tx_bad_auth` | Ephemeral secret key decryption failed or key is wrong |
| Horizon `tx_insufficient_balance` | Account may have been partially drained; check balance |
