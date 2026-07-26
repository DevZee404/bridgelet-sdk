# i128 BigInt Encoding

This document explains how `StellarService.recordPayment()` encodes a JavaScript `bigint` into the `hi` and `lo` parts of a Soroban `i128` XDR structure.

## `bigint` for Precision

When dealing with large numerical values, especially in the context of financial transactions, JavaScript's standard `number` type is insufficient. The `number` type can only safely represent integers up to `Number.MAX_SAFE_INTEGER`, and any value larger than that is subject to precision loss. To avoid this, we use the `bigint` type, which can represent arbitrarily large integers with perfect precision.

## Bit-Shifting Logic

A Soroban `i128` is a 128-bit signed integer. To represent this in JavaScript, we use a `bigint`. To convert the `bigint` into the XDR `Int128Parts` structure, which is composed of two 64-bit integers (`hi` and `lo`), we use bitwise operations:

1.  **High part (`hi`):** The expression `amount >> 64n` is a right bit shift operation. It shifts the bits of the `bigint` amount 64 places to the right. This effectively discards the lower 64 bits, leaving us with the higher 64 bits, which represent the `hi` part of the `i128`.

2.  **Low part (`lo`):** The expression `amount & 0xffffffffffffffffn` is a bitwise AND operation. The hexadecimal constant `0xffffffffffffffffn` is a 64-bit mask (it has 64 ones in its binary representation). This operation zeroes out all but the lower 64 bits of the `amount`, giving us the `lo` part of the `i128`.

This pattern of splitting a `bigint` into `hi` and `lo` parts is a standard way to construct a 128-bit integer for Soroban and would need to be replicated in any other part of the codebase where an `i128` `ScVal` is constructed from a `bigint`.
