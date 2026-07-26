# Postmortem: record_payment Trust Assumption Mismatch

## Issue Summary

During an internal audit, it was discovered that the SDK implicitly assumed the `record_payment` contract function was secured by `require_auth` at the contract level. However, the contract actually allowed anyone to invoke the function, relying on the caller to provide a valid signature payload.

## Root Cause

A communication gap between the contract engineers and the SDK engineers led to a mismatch in trust assumptions. The SDK assumed the network/contract rejected unauthorized payloads during simulation, but the contract simply verified the signature structurally without enforcing caller identity for that specific function.

## Resolution

The smart contract was patched to include `require_auth` for the `record_payment` function. On the SDK side, we added a strict check against the `auth` array returned by `simulateTransaction` to ensure that every contract invocation explicitly lists the expected authorized signers before signing and submitting.
