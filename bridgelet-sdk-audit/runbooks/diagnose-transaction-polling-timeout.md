# Diagnosing a waitForTransaction() Timeout

## Overview

When `waitForTransaction()` times out, it means the transaction was submitted to the network but Horizon did not report its completion within the expected timeframe.

## Diagnosis Steps

1. **Check Mempool / Network Load**
   A timeout often indicates network congestion. The transaction might still be in the mempool waiting for consensus.

2. **Check Transaction Hash on Stellar Expert**
   Look up the transaction hash manually.
   - If it eventually succeeded: The SDK's timeout was too aggressive. Consider increasing the timeout duration.
   - If it failed: The SDK missed the error response from Horizon. Investigate Horizon logs.
   - If it doesn't exist: The transaction was dropped by the network (e.g., fee too low).

3. **Handling Dropped Transactions**
   If the transaction was dropped, you can safely resubmit it with a higher fee, provided you use the same sequence number to ensure idempotency.
