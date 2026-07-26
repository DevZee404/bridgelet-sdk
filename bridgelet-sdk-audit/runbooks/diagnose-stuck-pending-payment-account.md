# Runbook: Diagnosing an Account Stuck in PENDING_PAYMENT

> **Scope:** SDK-side triage only. For on-chain contract diagnostics, see bridgelet-audit's `diagnose-failed-sweep.md`.

## Symptom

An account remains in `PENDING_PAYMENT` status long after creation. The expected inbound Stellar payment either never arrived or was not detected by the SDK.

## Prerequisites

- Database access to the `accounts` table
- Stellar account public key of the ephemeral account
- Access to SDK application logs (Pino / CloudWatch)

---

## Step 1 — Verify the Account Exists On-Chain

```sql
SELECT id, "publicKey", status, "expiresAt", "createdAt"
FROM accounts
WHERE status = 'pending_payment';
```

Copy the `publicKey` and check it on Stellar Expert or Horizon:

```
GET https://horizon.stellar.org/accounts/{publicKey}
```

- If **404**: the Horizon `CreateAccount` operation never landed. See `diagnose-failed-account-creation.md`.
- If **200**: the account exists and is funded. Proceed to Step 2.

## Step 2 — Check Horizon for Inbound Payments

Query the account's payment history on Horizon:

```
GET https://horizon.stellar.org/accounts/{publicKey}/payments?order=desc&limit=20
```

Look for any payment whose `to` matches the ephemeral `publicKey`.

- **No payments found**: The funding integrator or user never sent funds to this account. Confirm the amount and asset with the caller. This is the most common root cause.
- **Payments found**: A payment arrived. Proceed to Step 3.

## Step 3 — Check the Payment-Monitor Logs

Search SDK logs for the account's public key around the time the payment arrived:

```
grep "{publicKey}" /var/log/bridgelet/payment-monitor*.log
```

Look for these patterns:

| Log message | Meaning |
|---|---|
| `DuplicateAsset` | On-chain `record_payment()` was called but the asset was already recorded. This is benign and indicates the payment-monitor detected the payment but the on-chain call succeeded for a *different* asset first. |
| `TooManyPayments` | The on-chain contract hit its 10-asset limit. The account is likely terminal — check status. |
| `InvalidAmount` | The payment amount could not be parsed to i128 stroops. The account is terminal. |
| `PENDING_PAYMENT → PENDING_CLAIM` | The transition succeeded — the account should no longer be `PENDING_PAYMENT`. If it still is, the DB write may have failed. |

## Step 4 — Single-Asset Limitation (Cross-Reference)

If a payment arrived on-chain but was not the **first** payment detected by the SDK's payment monitor, it will be silently ignored. The SDK's `PaymentMonitorService` transitions the account to `PENDING_CLAIM` after the first detected payment and stops polling for that account entirely.

The on-chain contract (`record_payment`) supports up to 10 distinct assets, but the SDK only processes one. Any subsequent asset sent to this account will never be recorded in the database or reflected in the claim flow.

**Detection:** Compare the first payment's asset against what the integrator expected. If the integrator sent a different asset second, it will be invisible to the SDK.

See `integration-notes/payment-monitor-single-asset-limitation.md` for full details.

## Step 5 — Check Payment-Monitor Service Health

If the payment monitor is not running or is behind schedule:

1. Check the process is alive: `ps aux | grep payment-monitor` (or the NestJS scheduler logs).
2. Check the polling interval: default is 30 seconds (`PAYMENT_MONITOR_INTERVAL_MS`).
3. If using the SSE-based `PaymentMonitorProvider`, check for stream disconnection logs.

A stalled payment monitor will cause all `PENDING_PAYMENT` accounts to appear stuck.

## Step 6 — Check Account Expiry

```sql
SELECT "expiresAt" FROM accounts WHERE "publicKey" = '{publicKey}';
```

If the account is close to expiry, the expiry scheduler may run before the payment is detected. In that case, the account will transition to `EXPIRED` rather than `PENDING_CLAIM`.

---

## Resolution Summary

| Root cause | Resolution |
|---|---|
| No payment sent | Ask integrator to resend |
| Payment sent but wrong asset | Note single-asset limitation; second payment is invisible |
| Payment monitor down / stalled | Restart the monitor service |
| DuplicateAsset warnings only | On-chain is fine; check DB connection for the status transition |
| InvalidAmount / TooManyPayments | Terminal — status should be `FAILED` or `PENDING_CLAIM` already |
| Account near expiry | May expire before claim; coordinate with integrator on timing |
