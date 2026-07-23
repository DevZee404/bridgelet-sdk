# Soroban Contract Events Indexer

## Overview

`SorobanEventsIndexerService` (`src/modules/stellar/soroban-events-indexer.service.ts`) indexes Soroban smart contract events emitted by the Ephemeral Account and Sweep Controller contracts.

## Indexed Event Types

1. **`AccountCreated`**: Emitted when an ephemeral account contract is initialized on-chain.
2. **`PaymentReceived`**: Emitted when an inbound payment is recorded on the contract.
3. **`SweepExecutedMulti`**: Emitted when multi-asset or single-asset sweep execution completes.
4. **`AccountExpired`**: Emitted when an expired account's funds are recovered.

## Schema (`contract_events` Table)

| Column             | Type         | Description                                        |
| ------------------ | ------------ | -------------------------------------------------- |
| `id`               | UUID         | Primary Key                                        |
| `event_type`       | VARCHAR(255) | Type of event (`AccountCreated`, etc.)             |
| `contract_address` | VARCHAR(128) | Address of the Soroban contract                    |
| `ledger_sequence`  | BIGINT       | Ledger sequence number                             |
| `tx_hash`          | VARCHAR(64)  | 64-character hex Stellar transaction hash          |
| `payload`          | JSONB        | Event topic arguments and data values              |
| `created_at`       | TIMESTAMP    | Record creation timestamp                          |

## Indexing Mechanism

- Primary polling attempts to query Soroban RPC `getEvents()`.
- Fallback queries Horizon `/events` endpoint if Soroban RPC is unreachable.
- Events are deduplicated by `(tx_hash, event_type, contract_address)` before insertion into PostgreSQL for auditability.
