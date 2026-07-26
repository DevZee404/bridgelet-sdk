# Postmortem: Tight Coupling in getAccountInfo() Parsing

## Issue Summary

When the Soroban smart contract added a new optional field to the `AccountInfo` struct, the SDK's `getAccountInfo()` method started throwing unhandled XDR decoding errors in production.

## Root Cause

The `getAccountInfo()` implementation relied on a hand-written array index-based parser to decode the XDR response from the contract. The addition of a field shifted the expected tuple indices, breaking backward compatibility even though the field was optional in Rust.

## Resolution

Refactored the SDK to use auto-generated TypeScript bindings (via `soroban contract bindings typescript`) instead of manual XDR parsing, which gracefully handles optional struct fields and provides compile-time type safety.
