# Error String Matching for Contract Errors

## Purpose

This document describes the pattern used in `executeSweep()`, `expireAccount()`, and `processPayment()` to classify contract failures.

## Pattern

The pattern involves the following steps:

1.  The RPC error result from a contract call is received.
2.  The error result is converted to a string using `JSON.stringify(errorResult)`.
3.  A substring match is performed on the resulting string to check for the presence of a specific contract error name.

## Matched Error Strings

The following strings are currently matched on:

*   `AlreadySwept`
*   `AccountExpired`
*   `InvalidStatus`
*   `DuplicateAsset`

## Brittleness and Risk

This pattern is inherently brittle. It relies on the string representation of the error, which can change unexpectedly. For a more detailed analysis of the risks associated with this pattern, please refer to the corresponding postmortem entry.