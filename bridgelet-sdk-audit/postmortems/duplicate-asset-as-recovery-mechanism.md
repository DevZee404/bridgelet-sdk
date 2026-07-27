# DuplicateAsset as Recovery Mechanism

## Issue Summary

The `DuplicateAsset` catch branch in `processPayment()` provides accidental resilience for the on-chain-then-DB-update sequence. When the database update fails after a successful on-chain `recordPayment()` call, the next polling tick retries the operation, hits the `DuplicateAsset` error, and proceeds to update the database—effectively healing the inconsistent state.

## Root Cause

The payment monitoring service follows a two-step sequence when processing inbound payments:

1. **On-chain**: Call `stellarService.recordPayment()` to record the payment on the Soroban contract
2. **Database**: Update the account status from `PENDING_PAYMENT` to `PENDING_CLAIM`

This sequence is not atomic. If the database update fails after the on-chain operation succeeds, the account remains in `PENDING_PAYMENT` status while the payment is already recorded on-chain.

The `DuplicateAsset` error handling in `processPayment()` was originally added for idempotency:

```typescript
try {
  await this.stellarService.recordPayment({...});
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('DuplicateAsset')) {
    // Payment already recorded on-chain — still sync DB status
    this.logger.warn(
      `DuplicateAsset for account ${account.id} — payment already on contract, syncing DB`,
    );
  } else {
    throw err;
  }
}

// DB update happens regardless of DuplicateAsset
await this.accountsRepository.update(
  { id: account.id, status: AccountStatus.PENDING_PAYMENT },
  { status: AccountStatus.PENDING_CLAIM },
);
```

The catch block treats `DuplicateAsset` as a no-op (does not re-throw) but still proceeds to the database update. This design choice creates a self-healing recovery path.

## Recovery Scenario Walkthrough

1. **Tick 1**: Payment detected on Horizon
   - `recordPayment()` succeeds on-chain
   - Database update fails (e.g., connection timeout, constraint violation)
   - Account remains in `PENDING_PAYMENT` status

2. **Tick 2** (next poll interval, default 30s):
   - Same payment is found again on Horizon (it's still there)
   - `recordPayment()` is called again
   - Contract throws `DuplicateAsset` error (asset already recorded)
   - Catch block logs warning but does not throw
   - Database update proceeds successfully
   - Account transitions to `PENDING_CLAIM`

The system heals itself without manual intervention or additional retry logic.

## Resolution

No code changes are required. The existing behavior is beneficial and should be preserved. The action item is documentation-only: explicitly capture this recovery pattern so future refactors do not inadvertently remove it.

## Action Items

- [x] Document this recovery mechanism in the knowledge base
- [ ] Consider adding a comment in the code explaining the dual purpose of the `DuplicateAsset` catch branch (idempotency + recovery)
- [ ] Ensure future code reviews recognize this pattern when modifying error handling in `processPayment()`
