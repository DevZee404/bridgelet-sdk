# SweepController executeSweep() Argument Order Verification

## Background

Cross-repository contract interfaces must be verified to ensure that the SDK constructs Soroban contract invocations with arguments in the exact order expected by the on-chain contract. An argument-order mismatch between the SDK and bridgelet-core would cause runtime failures that are difficult to diagnose, because the SDK may still compile and type-check successfully while the on-chain contract reverts.

## SDK Argument Construction

The `executeSweep()` method in `src/modules/stellar/stellar.service.ts` constructs the Soroban contract call at lines 406-413. The arguments are passed to `SweepController.execute_sweep()` in this order:

1. `ephemeralAccountContractId` — converted via `StellarSdk.Address.fromString(params.ephemeralAccountContractId).toScVal()`
2. `destination` — converted via `StellarSdk.Address.fromString(params.destination).toScVal()`
3. `authSignature` — converted via `StellarSdk.xdr.ScVal.scvBytes(params.authSignature)`

The relevant source snippet:

```typescript
contract.call(
  'execute_sweep',
  StellarSdk.Address.fromString(params.ephemeralAccountContractId).toScVal(),
  StellarSdk.Address.fromString(params.destination).toScVal(),
  StellarSdk.xdr.ScVal.scvBytes(params.authSignature),
);
```

## bridgelet-core Signature Verification

The `SweepController` contract in `bridgelet-core` defines the `execute_sweep` function in the `SweepControllerInterface` trait. The function signature is:

```rust
fn execute_sweep(
    env: Env,
    ephemeral_account: Address,
    destination: Address,
    auth_signature: BytesN<64>,
) -> Result<(), Error>;
```

Parameter details:

| Position | Name                | Type         |
| -------- | ------------------- | ------------ |
| 1        | `ephemeral_account` | `Address`    |
| 2        | `destination`       | `Address`    |
| 3        | `auth_signature`    | `BytesN<64>` |

The SDK's argument order and types match bridgelet-core's `execute_sweep` signature as of this writing:

- SDK argument 1 (`ephemeralAccountContractId`, type `Address`) corresponds to bridgelet-core parameter 1 (`ephemeral_account`, type `Address`).
- SDK argument 2 (`destination`, type `Address`) corresponds to bridgelet-core parameter 2 (`destination`, type `Address`).
- SDK argument 3 (`authSignature`, type `BytesN<64>`) corresponds to bridgelet-core parameter 3 (`auth_signature`, type `BytesN<64>`).

## Why This Matters

Soroban contract invocations pass arguments as an ordered `ScVal` array. Changing the argument order in the contract interface (e.g., swapping `destination` and `ephemeral_account`) would produce an on-chain revert at runtime. The SDK would still compile without errors because the TypeScript types are resolved at the SDK level, not at the contract boundary. This makes argument-order mismatches particularly insidious — they surface only when the transaction is submitted to the network and the contract rejects the call.

## Recommendation

Re-run this verification whenever:

- `bridgelet-core`'s `SweepController` interface changes
- `execute_sweep` signature changes
- `executeSweep()` is modified
- Contract bindings are regenerated

An argument-order mismatch would most likely surface as a confusing runtime error (e.g., `Error::AuthorizationFailed` or a contract revert) rather than a compile-time error in the SDK.
