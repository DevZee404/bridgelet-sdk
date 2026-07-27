# How `authorized_controller` Is Set From the SDK's Account-Creation Flow

This document describes how `StellarService.createEphemeralAccount()` sets the
`authorized_controller` parameter when it initializes an `EphemeralAccount`
contract, and how that differs from the `AccountFactory.batch_initialize()`
path in `bridgelet-core`.

## Where `authorized_controller` Comes From

`createEphemeralAccount()` accepts a `sweepControllerContractId` parameter and
passes it straight through as the `authorized_controller` argument of the
on-chain `initialize()` call:

```ts
// src/modules/stellar/stellar.service.ts
contract.call(
  'initialize',
  StellarSdk.Address.fromString(fundingKeypair.publicKey()).toScVal(), // creator
  StellarSdk.xdr.ScVal.scvU32(expiryLedger),                           // expiry_ledger
  StellarSdk.Address.fromString(params.recoveryAddress).toScVal(),    // recovery_address
  StellarSdk.Address.fromString(
    params.sweepControllerContractId,
  ).toScVal(),                                                         // authorized_controller
  StellarSdk.Address.fromString(fundingKeypair.publicKey()).toScVal(),
),
```

## ScVal Argument Order

The `initialize` invocation is built with five `ScVal` arguments, in this
exact order:

1.  **`creator`** — `Address.fromString(fundingKeypair.publicKey()).toScVal()`.
    The funding keypair that authorizes the call and pays the transaction fee.
2.  **`expiry_ledger`** — `xdr.ScVal.scvU32(expiryLedger)`. The ledger number
    computed by `toExpiryLedger()` from `params.expiresIn`.
3.  **`recovery_address`** — `Address.fromString(params.recoveryAddress).toScVal()`.
    Where funds are returned if the account expires unclaimed.
4.  **`authorized_controller`** — `Address.fromString(params.sweepControllerContractId).toScVal()`.
    The dedicated `SweepController` contract address supplied by the caller.
5.  A final `Address` ScVal, again built from `fundingKeypair.publicKey()`.
    The code passes the funding keypair's address a second time here; unlike
    the other four positions, this one carries no inline comment identifying
    which on-chain field it binds to.

## Why This Path Doesn't Have the "Hardcoded Controller" Problem

`bridgelet-core`'s `AccountFactory.batch_initialize()` calls the same
`initialize()` entry point but reuses its own `creator` parameter for
_both_ `authorized_controller` and `admin` (see `bridgelet-core`'s
`bridgelet-audit/threat-models/account-factory-deployment-flow.md`, "Authorized
Controller and Admin Relationship" section, and
`contracts/account_factory/src/multiple.rs`, lines ~70-71:
`&creator, // authorized_controller` / `&creator, // admin`). That means every
account deployed through a given `batch_initialize()` call shares one
address as its sweep controller — there is no dedicated `SweepController`
contract in the picture at all.

This SDK's `createEphemeralAccount()` path does not have that problem: the
caller supplies `sweepControllerContractId` explicitly, and that real
`SweepController` contract address — not the funding keypair or any other
stand-in — is what ends up in the account's `authorized_controller` field.

## Why This Distinction Matters

If the two account-creation paths (this SDK's `createEphemeralAccount()` and
`bridgelet-core`'s `AccountFactory.batch_initialize()`) are ever unified into
a single flow, this difference needs to be preserved explicitly. Silently
adopting the factory's "creator doubles as controller" pattern would take away
this SDK path's use of a real, dedicated `SweepController` address.
