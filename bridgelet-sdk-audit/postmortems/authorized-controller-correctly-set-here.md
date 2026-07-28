# Postmortem / Lessons Learned: Authorized Controller Correctly Set

## Purpose

This document serves as a knowledge-base article specifically documenting a case where this codebase correctly handles an aspect of the contract initialization flow. We use this for contrast against issues found in other repositories (like `bridgelet-core`).

## Walkthrough: `createEphemeralAccount()` Initialization

In the `bridgelet-sdk` codebase, ephemeral accounts are initialized within the `createEphemeralAccount()` method of the `StellarService` (`src/modules/stellar/stellar.service.ts`).

When the SDK constructs the transaction to call the Soroban contract's `initialize` function, it correctly orders the `ScVal` arguments according to the contract's expected signature. Specifically, the 4th argument dynamically sets the `authorized_controller` to the `sweepControllerContractId` provided in the parameters:

```typescript
contract.call(
  'initialize',
  StellarSdk.Address.fromString(fundingKeypair.publicKey()).toScVal(), // creator
  StellarSdk.xdr.ScVal.scvU32(expiryLedger), // expiry_ledger
  StellarSdk.Address.fromString(params.recoveryAddress).toScVal(), // recovery_address
  StellarSdk.Address.fromString(params.sweepControllerContractId).toScVal(), // authorized_controller
  StellarSdk.Address.fromString(fundingKeypair.publicKey()).toScVal(),
);
```

By passing `params.sweepControllerContractId` as the `authorized_controller`, the SDK guarantees that only the legitimately connected Sweep Controller is authorized to sweep the ephemeral account.

## Cross-Reference: `bridgelet-core`'s AccountFactory

This implementation contrasts directly with a vulnerability found during the `bridgelet-core` audit. In the postmortem `bridgelet-audit` -> `hardcoded-authorized-controller.md`, it was discovered that `bridgelet-core`'s `AccountFactory.batch_initialize` function made the opposite mistake: it hardcoded or improperly handled the `authorized_controller` argument rather than dynamically setting it to a designated sweep controller.

## Recommendation for Future Implementations

Because `bridgelet-sdk` constructs the invocation correctly—explicitly resolving the sweep controller address and passing it as `authorized_controller` via `params.sweepControllerContractId`—it ensures a secure sweeping architecture.

It is strongly recommended that this SDK's account-creation flow be used as the reference implementation if/when the `AccountFactory`'s equivalent bug is fixed in `bridgelet-core`. Any future SDKs or factory contracts MUST dynamically set the `authorized_controller` to avoid hardcoding or misattribution vulnerabilities.
