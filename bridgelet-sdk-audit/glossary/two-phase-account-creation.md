# Two-Phase Account Creation

This document explains the two-phase process that `createEphemeralAccount()` uses to create and initialize an ephemeral account on the Stellar network.

## Two-Phase Flow

The creation of an ephemeral account is a two-step process involving two separate on-chain operations:

1.  **Step 1: Horizon `CreateAccount`**
    This is a standard Stellar operation submitted to Horizon. It creates the new account on the ledger and funds it with the necessary lumens to meet the minimum balance requirements.

2.  **Step 2: Soroban `initialize()`**
    This is a Soroban contract invocation. The `initialize()` function of the `EphemeralAccount` contract is called to set the on-chain restrictions for the account, such as its expiry and the addresses it is authorized to transact with.

## Atomicity

These two operations are not performed in a single, atomic transaction. The code acknowledges this limitation, noting that true atomicity is not currently possible. This means there is a small window of time between the account's creation and the application of its on-chain restrictions where the account exists on-chain without its intended security constraints.

This documentation is purely descriptive of the current implementation and does not propose a fix for this lack of atomicity.
