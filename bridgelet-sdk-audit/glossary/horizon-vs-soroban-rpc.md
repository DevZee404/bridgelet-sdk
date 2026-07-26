# Horizon vs Soroban RPC

## Horizon

The Horizon API is the RESTful interface for the classic Stellar network.
**In the Bridgelet SDK, Horizon is used exclusively for:**

- Monitoring incoming payments (`/payments` endpoint).
- Submitting account creation transactions (funding base reserves).
- Fetching historical ledger data.

## Soroban RPC

The Soroban RPC is a JSON-RPC interface designed specifically for interacting with Soroban smart contracts.
**In the Bridgelet SDK, Soroban RPC is used exclusively for:**

- Simulating and submitting sweep transactions.
- Querying contract state (e.g. reading balances from a custom token contract).
- Fetching contract events.
