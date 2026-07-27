# Postmortem: Hand-Rolled i128 Bit-Splitting for Contract Calls

## Issue Summary

The SDK uses a manually written hi/lo bit-split to encode `bigint` values as Soroban `i128` parameters for the `record_payment` contract call. This hand-rolled encoding is inlined at a single call site rather than centralized in a reusable helper, creating a maintenance risk as more contract calls are added.

## Root Cause

In `src/modules/stellar/stellar.service.ts`, the `recordPayment()` method constructs the `i128` XDR value by splitting a `bigint` into high and low 64-bit parts:

```typescript
StellarSdk.xdr.Int128Parts({
  hi: StellarSdk.xdr.Int64.fromString(
    (params.amount >> 64n).toString(),
  ),
  lo: StellarSdk.xdr.Uint64.fromString(
    (params.amount & 0xffffffffffffffffn).toString(),
  ),
}),
```

What could go wrong:

- **Sign assumptions**: If a negative amount were ever passed, the right-shift and mask operations would produce incorrect two's-complement representation, resulting in a silently wrong value on-chain.
- **Magnitude overflow**: A value exceeding 128 bits would silently truncate during the shift/mask, producing an incorrect encoding without any runtime error.
- **Duplication**: As more contract calls accept `i128` parameters, each call site would need to re-implement this same logic, multiplying the risk of inconsistency.

Today the blast radius is contained—there is exactly one call site (`recordPayment`), and the amount is always a positive stroop value derived from a Horizon decimal string. But this is a fragile assumption.

## Resolution

No code change is required for the immediate finding; the current implementation is correct for its single call site. The key recommendation is to centralize the i128 encoding into a single, well-tested helper function so that future call sites do not duplicate the bit-splitting logic.

## Action Items

- [ ] Extract the i128 encoding into a shared utility (e.g., `encodeI128(value: bigint): StellarSdk.xdr.Int128Parts`).
- [ ] Add validation in the helper to reject negative values or values exceeding 128-bit range.
- [ ] Add unit tests covering edge cases: zero, maximum positive i128, minimum positive value, and boundary values near the 64-bit boundary.
- [ ] Refactor `recordPayment()` to use the new helper.
