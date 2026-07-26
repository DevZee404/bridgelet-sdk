# Investigating Slow Sweep Flow using soroban_rpc_latency_seconds

## Overview

When the `soroban_rpc_latency_seconds` metric shows anomalous spikes specifically during the `Sweep` operation, it indicates a bottleneck between the SDK and the Soroban RPC node.

## Steps

1. **Verify Metric Dimensions**
   Check the `method` label on the metric (e.g. `simulateTransaction` vs `sendTransaction`).
   - If `simulateTransaction` is slow: The RPC node might be overloaded, or the contract execution itself is too expensive.
   - If `sendTransaction` is slow: Network latency or node mempool congestion.

2. **Check Soroban RPC Node Health**
   Ping the RPC node's `/health` endpoint. Look for high resource usage (CPU/memory) on the node provider dashboard.

3. **Analyse Transaction Payload**
   Review the specific sweep transaction. Are there unusually large lists of accounts being merged? Consider chunking the sweeps into smaller batches.

4. **Fallback & Retry Logic**
   Verify that the SDK's internal exponential backoff is functioning and not endlessly retrying a fundamentally broken transaction.
