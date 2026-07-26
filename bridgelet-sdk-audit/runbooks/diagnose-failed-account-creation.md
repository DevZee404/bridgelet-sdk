# Runbook: Diagnosing a Failed createEphemeralAccount() Call

> **Scope:** SDK-side triage only. This runbook covers the Horizon + Soroban two-phase creation flow and how to determine which phase failed.

## Symptom

An account creation request returned an error, or the account is stuck in `INITIALIZING` status past the timeout window.

## Prerequisites

- Database access to the `accounts` table
- Stellar account public key of the ephemeral account
- Access to SDK application logs

---

## Step 1 — Check Account Status in the Database

```sql
SELECT id, "publicKey", status, "contractId", "expiresAt", "createdAt", metadata
FROM accounts
WHERE "publicKey" = '{publicKey}' OR id = '{accountId}';
```

| Status | Meaning |
|---|---|
| `INITIALIZING` | DB record created, but neither Horizon nor Soroban completed. Timeout job will mark it `FAILED`. |
| `PENDING_PAYMENT` | Horizon `CreateAccount` succeeded **and** Soroban `initialize()` succeeded. Account is fully operational. |
| `FAILED` | One of the two steps failed. Check `metadata.failureReason`. |

## Step 2 — Check if the Stellar Account Exists

```
GET https://horizon.stellar.org/accounts/{publicKey}
```

- **404 — Account not found**: The Horizon `CreateAccount` operation failed or was never submitted. The failure is at the Horizon stage. Proceed to Step 3.
- **200 — Account found**: The Horizon `CreateAccount` succeeded. Check `balances` for 2 XLM (base reserve). If found, proceed to Step 4.

## Step 3 — Horizon-Stage Failure

If the account does not exist on-chain:

1. Check SDK logs for `CreateAccount` errors around the creation timestamp.
2. Common Horizon failures:
   - `tx_insufficient_balance`: The **funding keypair** (`stellar.fundingSecret`) has insufficient XLM to fund the 2 XLM base reserve.
   - `tx_bad_auth`: The funding keypair could not sign the transaction.
   - `tx_too_late`: The transaction expired before Horizon processed it.
3. Check the funding keypair's balance:
   ```
   GET https://horizon.stellar.org/accounts/{fundingPublicKey}
   ```
   Ensure it holds more than 2 XLM (plus fees for subsequent operations).

## Step 4 — Soroban-Stage Failure (Account Exists but Uninitialized)

If the account exists on Horizon with 2 XLM but is in `INITIALIZING` status:

1. The Horizon `CreateAccount` succeeded, but the Soroban `EphemeralAccount.initialize()` call failed.
2. Check SDK logs for the specific contract error:
   - `AlreadyInitialized`: The contract was somehow already initialized (rare, indicates a retry).
   - `InvalidExpiry`: The calculated expiry ledger is in the past or invalid.
   - Network/RPC errors: Soroban RPC was unreachable or timed out.
3. Check the on-chain contract state directly (if the contract address is known):
   - This requires the contract's C... address, which is stored in `accounts.contractId`. If `contractId` is NULL, the Soroban call never completed.

## Step 5 — Check the INITIALIZING Cleanup Job

The SDK has a scheduler that marks `INITIALIZING` accounts as `FAILED` after a timeout (default: `INITIALIZING_TIMEOUT_MS = 10 minutes`, runs every 15 minutes).

```sql
SELECT id, "publicKey", metadata
FROM accounts
WHERE status = 'initializing'
AND "createdAt" < now() - interval '10 minutes';
```

Accounts stuck here beyond the timeout indicate the cleanup scheduler is also not running. Check scheduler service health.

## Step 6 — Unfunded, Uninitialized Account Cleanup

If the Horizon account was created (Step 2 returns 200) but the contract was never initialized (Step 4), you have an **unrestricted funded account** on-chain. This is the non-atomicity issue documented as internal Issue #15.

**Remediation options:**
1. **Wait for expiry**: If `expiresAt` is set, the expiry scheduler will eventually call `expire()`. However, `expire()` requires the contract to be initialized, which it is not in this case.
2. **Account merge**: Manually merge the account's 2 XLM back to the funding keypair using the ephemeral secret key (if it can be decrypted from `secretKeyEncrypted`). This is a manual intervention.
3. **Mark as FAILED**: Update the DB status and log the orphaned account for manual on-chain cleanup.

---

## Resolution Summary

| Root cause | Resolution |
|---|---|
| Horizon CreateAccount failed (no on-chain account) | Check funding keypair balance, retry creation |
| Horizon succeeded, Soroban initialize() failed | Retry initialization or mark FAILED and fund manually |
| Funding keypair insufficient balance | Top up the funding keypair |
| INITIALIZING cleanup job not running | Restart scheduler service, accounts will be auto-marked FAILED |
| Non-atomic orphaned account (Issue #15) | Manual intervention: merge account back to funding keypair |
