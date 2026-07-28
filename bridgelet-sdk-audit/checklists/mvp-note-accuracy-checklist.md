# MVP Note and Doc-Comment Accuracy Checklist

## Purpose

Periodic verification that every `⚠️ MVP Note` comment in the contract-consumption layer still reflects the actual behavior of `bridgelet-core` and the SDK's interaction with it. Run this checklist after any bridgelet-core contract upgrade, redeployment, or SDK refactor touching the Stellar service layer.

## MVP Note Inventory

All MVP notes reside in `src/modules/stellar/stellar.service.ts`.

### 1. Horizon-Soroban Non-Atomicity (`createEphemeralAccount`)

- [ ] Confirm that `createEphemeralAccount()` still performs Horizon `CreateAccount` and Soroban `initialize()` as two separate transactions.
- [ ] Confirm that the SDK still throws an error (does not persist a DB record) when `initialize()` fails after `CreateAccount` succeeds.
- [ ] Confirm that Issue #15 tracking the compensation strategy is still open or that a resolution has been shipped.
- [ ] Confirm the MVP note's description of the failure window (unrestricted funded account on-chain) matches the current on-chain behavior.

### 2. Token Transfer Completeness (`executeSweep`)

- [ ] Confirm that `SweepController.execute_sweep()` / `EphemeralAccount.sweep()` still updates state and emits events but does **not** execute token transfers on-chain.
- [ ] Confirm that the SDK's `executeSweep()` method in `stellar.service.ts` does not assume tokens have moved when logging success.
- [ ] Confirm the contract error mapping (AlreadySwept, AccountExpired, UnauthorizedDestination, AuthorizationFailed) still matches the current bridgelet-core error set.

### 3. Fund Recovery Completeness (`expireAccount`)

- [ ] Confirm that `EphemeralAccount.expire()` still does not perform actual token transfers to `recovery_address` because bridgelet-core token transfer is incomplete.
- [ ] Confirm the SDK's `expireAccount()` method in `stellar.service.ts` does not assume funds have been recovered when logging success.
- [ ] Confirm the contract error mapping (NotExpired, InvalidStatus, NotInitialized) still matches the current bridgelet-core error set.

## Re-verification Triggers

Re-run this checklist when any of the following occur:

- A new version of `bridgelet-core` contracts is deployed to testnet or mainnet.
- The `stellar.service.ts` contract-call methods are refactored or their transaction structure changes.
- The `sweep-controller-mvp-note-accuracy.md` runbook (when created) flags a drift.
- An integrator reports behavior inconsistent with an MVP note's description.

## Recording Results

After each sweep, update the "last verified" date below. If a note is found stale, open a new postmortem issue in the audit repository and update or remove the `⚠️ MVP Note` comment in source.

| MVP Note                      | Last Verified | Status |
| ----------------------------- | ------------- | ------ |
| Horizon-Soroban Non-Atomicity |               |        |
| Token Transfer Completeness   |               |        |
| Fund Recovery Completeness    |               |        |
