# Postmortem: Horizon-Soroban Non-Atomicity in Account Creation

## Issue Summary

Creating an ephemeral account requires two independent ledger operations—a Horizon `CreateAccount` and a Soroban `EphemeralAccount.initialize()` call—that cannot be committed atomically. A failure between the two leaves an unrestricted, funded account on-chain with no contract restrictions.

## Root Cause

Stellar's Horizon (classic ledger) and Soroban (smart-contract layer) are separate systems with independent transaction pipelines. The SDK's `createEphemeralAccount()` flow in `stellar.service.ts:180` performs these as two discrete steps:

1. **Horizon:** `CreateAccount` operation funds the new public key with the 2 XLM base reserve.
2. **Soroban:** `EphemeralAccount.initialize()` is called to set expiry, recovery address, and sweep controller restrictions on-chain.

Because there is no cross-system atomic commit, a failure at step 2 (RPC timeout, invalid expiry ledger, network partition, contract already initialized) after step 1 succeeds results in an orphaned account: a funded Stellar classic account that has no Soroban contract backing it, meaning no expiry, no recovery mechanism, and no sweep restrictions apply.

The concrete failure window an operator observes:

- **Step 1 succeeded:** Horizon returns a successful `CreateAccount` transaction; the account holds 2 XLM on the classic ledger.
- **Step 2 failed:** The Soroban RPC rejects or times out on `initialize()`.
- **Resulting state:** An unrestricted account exists on-chain. It cannot be swept (no contract to call), cannot expire (no expiry ledger), and can only be recovered via manual account-merge back to the funding keypair.

The SDK throws an error to prevent persisting a database record for the unrestricted account, but the on-chain orphan remains and requires manual intervention.

This is the class of problem described as internal Issue #15, which tracks the compensation strategy for orphaned accounts. The failure runbook at `bridgelet-sdk-audit/runbooks/diagnose-failed-account-creation.md` documents the triage steps.

## Resolution

The current mitigation is defensive: the SDK prevents database persistence of uninitialized accounts and the cleanup scheduler marks stuck `INITIALIZING` records as `FAILED` after a timeout. The orphaned on-chain account itself requires manual account-merge remediation (documented in the runbook). A proper resolution—either an on-chain compensating transaction or a protocol-level two-phase commit—remains tracked as Issue #15 and is outside the scope of the SDK MVP.
