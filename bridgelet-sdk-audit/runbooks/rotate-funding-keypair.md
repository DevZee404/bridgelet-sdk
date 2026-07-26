# Runbook: Rotating the Stellar Funding Keypair

> **Scope:** Operational steps for rotating the `stellar.fundingSecret` environment variable used by the SDK.

## Background

The Stellar funding keypair (`FUNDING_ACCOUNT_SECRET`) is used in two critical SDK paths:

1. **Account creation** (`createEphemeralAccount()`): Signs the Horizon `CreateAccount` operation (funds the new ephemeral account with 2 XLM) and the Soroban `initialize()` contract call.
2. **Payment recording / expiry** (`recordPayment()`, `expireAccount()`): Signs the Soroban `record_payment()` and `expire()` contract calls on the ephemeral account's contract.

The same keypair is used as `signerSecret` in `StellarService` for all contract-related transactions.

---

## Pre-Rotation Checklist

- [ ] Confirm the **new** keypair has been generated and its secret is available.
- [ ] Confirm the new keypair has been **funded** with sufficient XLM:
  ```
  GET https://horizon.stellar.org/accounts/{newPublicKey}
  ```
  Minimum recommended balance: **100 XLM** (each account creation costs 2 XLM + fees; each sweep costs fees).
- [ ] Confirm the new public key matches the `authorized_signer` registered in the `SweepController` Soroban contract (if the contract enforces it). **If the contract's `authorized_signer` does not match the new public key, sweeps will fail with `AuthorizationFailed`.**
- [ ] Schedule a **maintenance window** during low traffic.

## Rotation Steps

### 1. Update the Environment Variable

Update `FUNDING_ACCOUNT_SECRET` (or `stellar.fundingSecret` in the NestJS config) with the new keypair's **secret seed** (starts with `S...`).

- For AWS: update the Secrets Manager entry or SSM Parameter Store value.
- For Docker/K8s: update the secret and trigger a rolling restart.
- For bare metal: update the `.env` file and restart the service.

### 2. Restart the SDK Service

Perform a **graceful restart** (SIGTERM → SIGKILL after drain timeout) to ensure:
- In-flight account creation requests complete before shutdown.
- The payment monitor SSE streams are re-established.
- The new funding keypair is loaded into `StellarService`.

### 3. Verify Funding Keypair Balance

After restart, confirm the service is using the new keypair:

```
grep "fundingKeypair" /var/log/bridgelet/stellar*.log | tail -5
```

Or query the Stellar network for transactions signed by the new public key after restart.

### 4. Test Account Creation

Create a test account via the API:

```bash
curl -X POST https://{api-host}/accounts \
  -H "X-API-Key: {test-integrator-key}" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "1.0000000",
    "asset_code": "native",
    "expiresIn": 3600
  }'
```

Verify:
- The Horizon `CreateAccount` transaction was signed by the **new** public key.
- The account status transitions to `PENDING_PAYMENT`.

### 5. Test Payment Recording (Optional)

If possible, send a small payment to the test account and verify the payment monitor detects it and calls `record_payment()` successfully.

### 6. Drain Old Keypair (Optional but Recommended)

If the old keypair has remaining XLM balance, merge it back to a known treasury account:

```
stellar --network public account merge --source {oldSecret} --destination {treasuryPublicKey}
```

Or send all remaining funds via a payment operation.

## Downtime and Coordination

- **Minimal downtime expected**: The rotation is a configuration change followed by a restart. The service should be back within 30–60 seconds.
- **In-flight requests**: Account creation requests that started before the restart will use the **old** keypair. These will still succeed because the old keypair remains valid on Stellar until explicitly removed from the network. No special handling is needed.
- **Pending payments**: Accounts in `PENDING_PAYMENT` status that have not yet had their payment recorded will continue to use the old keypair for `record_payment()` calls. These calls succeed because the old keypair is still the account's signer. After rotation, the payment monitor picks up these accounts and uses the new keypair for subsequent Soroban calls **only if the contract authorization has been updated**.

## Post-Rotation Monitoring

- [ ] Monitor sweep success rate for 24 hours after rotation.
- [ ] Check for `AuthorizationFailed` errors in sweep logs (indicates contract `authorized_signer` mismatch).
- [ ] Verify new accounts created after rotation use the new keypair.
- [ ] Confirm old keypair has no remaining balance after drain.
