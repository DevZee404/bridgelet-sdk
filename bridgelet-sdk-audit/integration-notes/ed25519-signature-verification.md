# Integration Note: Ed25519 Signature Verification — Panic vs Returned Error

> **For integrators** using the bridgelet-sdk sweep/claim flow.

## Context

When an account is claimed and swept, the SDK executes a Soroban smart contract call (`execute_sweep`) that performs Ed25519 signature verification on-chain. The contract uses Stellar's `Ed25519Verify128` host function to verify the caller's authorization.

## The Issue

There are two possible failure modes when a signature is invalid:

1. **Returned error**: The contract validates the signature, finds it invalid, and returns an `AuthorizationFailed` error in a structured way. The SDK can parse this and return a meaningful 403 HTTP response.

2. **Wasm trap (panic)**: The Soroban runtime encounters a situation where the signature verification triggers an unrecoverable error (e.g., invalid key length, malformed signature bytes). Instead of returning a structured error, the contract execution **panics** with a raw trap. The SDK receives an unstructured `Error` type that does not match the known contract error string patterns.

## Impact on Your Integration

If your integration ever sends an invalid Ed25519 signature during the sweep authorization step, the error you receive depends on the failure mode:

| Failure Mode      | SDK HTTP Response | SDK Error Code           | Your SDK Can Catch?                                  |
| ----------------- | ----------------- | ------------------------ | ---------------------------------------------------- |
| Returned error    | 403               | `AUTHORIZATION_FAILED`   | Yes                                                  |
| Wasm trap (panic) | 500               | `UNKNOWN_CONTRACT_ERROR` | No — indistinguishable from any other contract error |

**Recommendation**: If you see a 500 error with `UNKNOWN_CONTRACT_ERROR` during sweep authorization, check whether your Ed25519 signature or public key is correctly formatted before retrying. The SDK currently has no way to distinguish a signature-panic from other contract failures.

## What We Are Doing

We have documented this gap and are tracking it for a future fix. The contract should return a structured `AuthorizationFailed` error in all cases rather than allowing the Wasm runtime to trap. Until then, treat any 500 error during sweep authorization as a potential signature issue.
