# Integration Note: Partial Sweep Recovery

> **For integrators** using the bridgelet-sdk sweep/claim flow.

## What Is a Partial Sweep?

A partial sweep occurs when the Soroban contract call (`execute_sweep`) **succeeds** but the subsequent Horizon payment to the destination address **fails**. The SDK tracks this as `PARTIAL_SWEEP` status.

```
Contract call: ✓ Swept on-chain
Horizon payment: ✗ Failed to send funds
Result: Account is PARTIAL_SWEEP
```

This is a transient, recoverable state.

## How Recovery Works

When a sweep fails with `PARTIAL_SWEEP`:

1. The SDK enqueues the account into an in-memory retry queue with exponential backoff.
2. On retry, the SDK skips the Soroban contract call (`skipContractAuth: true`) since the contract is already in `Swept` state.
3. It synthesizes a deterministic `contractAuthHash` for the audit trail without making a contract call.
4. It then executes the Horizon payment directly to the destination address.

The retry parameters are:

- **Base delay**: 2 seconds
- **Maximum delay**: 5 minutes
- **Max attempts**: 5

## What You Need to Know

1. **Webhook**: You will receive an `sweep.partial` webhook when this happens. This webhook includes the account ID and the current retry state.

2. **No action required on your side**: The SDK handles recovery automatically. You do not need to re-trigger the claim.

3. **If the service restarts**: The retry queue is in-memory. If the SDK service restarts during the retry cycle, the queue is lost. In this case, the sweep may need to be manually re-triggered by calling the claim endpoint again.

4. **Terminal failure**: If all 5 retries are exhausted, the account will be marked as `FAILED`. You will receive an `sweep.failed` webhook and should investigate the underlying Horizon error.

## Error Codes You May See

| Horizon Error             | Meaning                       | Resolution                               |
| ------------------------- | ----------------------------- | ---------------------------------------- |
| `tx_bad_auth`             | Invalid ephemeral secret key  | Check SDK key encryption and decryption  |
| `tx_insufficient_balance` | Account lacks XLM for payment | Verify account was properly funded       |
| `tx_too_late`             | Transaction expired           | Check network congestion; SDK will retry |
| `tx_bad_seq`              | Sequence number conflict      | SDK will retry with fresh sequence       |
