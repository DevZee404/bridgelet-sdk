# Postmortem: Webhook vs Confirmation Ordering

## Issue Summary

Under heavy load, integrators reported receiving `sweep.completed` webhooks before the corresponding transaction was fully confirmed as successful by their own Horizon nodes, causing internal state mismatch.

## Root Cause

The SDK was emitting the `sweep.completed` webhook immediately after receiving the `SUCCESS` status from the Soroban RPC `sendTransaction` endpoint. However, RPC nodes can sometimes report success slightly before the ledger is fully finalized across all nodes in the network.

## Resolution

Added a configuration toggle `webhook_delay_ledgers` (default: 1) which instructs the SDK to wait for at least one additional ledger close before emitting terminal webhooks, ensuring global consistency.
