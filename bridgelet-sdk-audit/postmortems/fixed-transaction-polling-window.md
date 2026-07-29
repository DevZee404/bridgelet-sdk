# waitForTransaction()'s Fixed ~20-Second Confirmation Window

## Issue Summary

The `waitForTransaction()` method in `StellarService` and `ContractProvider` uses hardcoded polling parameters (10 attempts with a 2000ms delay between attempts), establishing a fixed confirmation window of approximately 20 seconds. This retry budget is static and independent of network conditions or environment configuration.

## Root Cause

In `src/modules/stellar/stellar.service.ts` and `src/modules/sweeps/providers/contract.provider.ts`, transaction confirmation polling is implemented via `waitForTransaction()`:

```typescript
private async waitForTransaction(
  txHash: string,
  maxAttempts = 10,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const endTimer = this.sorobanRpcLatency.startTimer();
    let status: SorobanRpc.Api.GetTransactionResponse;
    try {
      status = await this.sorobanServer.getTransaction(txHash);
    } finally {
      endTimer();
    }

    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return;
    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction ${txHash} failed on-chain`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Transaction ${txHash} not confirmed after ${maxAttempts} attempts`,
  );
}
```

The polling mechanism relies on two hardcoded magic numbers:
1. **10 attempts**: Specifies the maximum number of RPC status polling iterations.
2. **2000ms interval**: Hardcodes a 2-second sleep (`setTimeout(resolve, 2000)`) between successive polling requests.

These values are static constants within the code and are not derived from any network-specific parameters (such as network target block/ledger close times, Soroban RPC response latency, or environment configurations like mainnet vs. testnet).

## Impact during High Latency or Congestion

When running on a network experiencing longer-than-usual confirmation times, RPC node index delays, or heavy ledger congestion:
- Transactions that take longer than ~20 seconds to be indexed and confirmed on-chain hit max attempts and fail client-side with `"Transaction <hash> not confirmed after 10 attempts"`.
- Every affected operation (including `initAccount`, `recordPayment`, `claimAccount`, `expireAccount`, and `authorizeSweep`) times out identically regardless of the underlying root cause.
- Callers may assume the transaction failed when it may actually commit successfully on-chain shortly after the 20-second mark, introducing potential state divergence between the client application and the Soroban ledger.

## Tradeoffs: Fixed Retry Budget vs. Adaptive Strategy

### 1. Fixed Retry Budget (Current Implementation)
- **Pros**: Simple, predictable maximum wait ceiling on client calls, low implementation complexity.
- **Cons**: Rigid threshold that produces false-negative errors during temporary network congestion or prolonged ledger closing intervals. Uniform 2-second sleep can unnecessarily delay response when a transaction lands quickly between retries.

### 2. Adaptive & Configurable Strategy (Recommended)
- **Configurable Budgets**: Move `maxAttempts` and `pollingIntervalMs` into configuration (`stellar.polling.maxAttempts`, `stellar.polling.intervalMs`) managed by NestJS `ConfigService`.
- **Exponential Backoff with Jitter**: Implement dynamic polling intervals starting with short initial delays (e.g., 500ms) and scaling up with backoff to prevent RPC endpoint thundering herds.
- **Network-Aware Timeouts**: Derive confirmation timeouts dynamically based on network telemetry and target environment parameters.

## Action Items

- [x] Document the fixed ~20-second transaction polling window finding in the audit knowledge base
- [ ] Make `maxAttempts` and `pollingIntervalMs` configurable via NestJS `ConfigService`
- [ ] Add exponential backoff support to Soroban RPC transaction status polling
