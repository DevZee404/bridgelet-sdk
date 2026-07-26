# Account DB states: PENDING_PAYMENT vs PENDING_CLAIM

**Purpose:** Document the off-chain `AccountStatus` enum's state machine and how it relates to the on-chain `AccountStatus`.

This document explains the role of the `PaymentMonitorService` in transitioning an account from `PENDING_PAYMENT` to `PENDING_CLAIM`.

## State Machine Flow

The `PaymentMonitorService` is responsible for monitoring accounts in the `PENDING_PAYMENT` state. Here's a breakdown of the process:

1.  **Polling:** The service periodically polls all non-expired accounts with the status `PENDING_PAYMENT`.
2.  **Payment Detection:** For each account, it checks for inbound payments on the Stellar network.
3.  **On-Chain Recording:** When a payment is found, the `PaymentMonitorService` calls `stellarService.recordPayment()` to record the payment details on the smart contract.
4.  **Database Transition:** After the on-chain transaction is processed, the service updates the account's status in the database from `PENDING_PAYMENT` to `PENDING_CLAIM`. This is an atomic operation that only allows the transition from `PENDING_PAYMENT` and prevents any backward status changes.

## Off-Chain vs. On-Chain States

It is crucial to understand that the `AccountStatus` enum in the SDK's database is a separate, off-chain state machine from the on-chain `AccountStatus` enum in `bridgelet-core`. While the names are similar, they represent different states in different systems.

For details on the on-chain state machine, please refer to the [`account-status-state-machine.md`](../account-status-state-machine.md) documentation.
