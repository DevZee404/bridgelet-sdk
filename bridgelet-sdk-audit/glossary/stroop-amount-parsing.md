# Stroop Amount Parsing

## Definition

A **Stroop** is the smallest unit of a Stellar lumen (XLM) and most Soroban tokens. 1 XLM = 10,000,000 stroops (10^7).

## Usage in Bridgelet SDK

Horizon typically returns amounts as decimal strings (e.g., `"1.5000000"`). Soroban smart contracts require amounts to be passed as `i128` stroops.

The SDK uses the `parseStroops()` utility function to safely convert these string values into BigInt stroops without floating-point precision loss.

```typescript
const decimalAmount = '1.5';
const stroops = parseStroops(decimalAmount); // Returns BigInt(15000000)
```
