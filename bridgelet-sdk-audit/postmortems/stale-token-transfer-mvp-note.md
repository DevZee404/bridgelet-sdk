# Postmortem: Stale Token Transfer Status

## Issue Summary

An integrator reported that the SDK was emitting a `sweep.failed` webhook for token transfers that ultimately succeeded on the Soroban ledger a few ledgers later.

## Root Cause

The `bridgelet-core` smart contract emitted a cross-contract call to the token contract. The SDK attempted to parse the immediate `TransactionResult` structure from Horizon, assuming a synchronous failure. However, a timeout in the RPC node's simulation led the SDK to erroneously cache a failed state locally, while the transaction actually persisted in the mempool and was later included.

## Resolution

Removed optimistic caching of transaction failures during RPC timeouts. A transaction is now only marked as `failed` if the Soroban RPC definitively returns an error code (e.g. `tx_failed`). If it times out, it remains in `pending` and is polled against the ledger.
