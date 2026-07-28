# How the SDK obtains and uses the on-chain sweep nonce

This document traces the call path through which the SDK reads the sweep nonce (from bridgelet-core's `SweepController`) and uses it when constructing a signed sweep message.

## Sweep nonce: on-chain background

The `SweepController` contract in bridgelet-core maintains a monotonically increasing `nonce` in its instance storage. Each call to `execute_sweep()` bumps the nonce by one — or, equivalently, the nonce represents the **next expected sequence number** that the authorization signature must match.

The on-chain verification (`authorization.rs::verify_sweep_authorization`) reconstructs the message as:

```
SHA256( destination_xdr | nonce_u64_be | sweep_controller_contract_id_xdr )
```

and checks that the Ed25519 signature was produced by the `authorized_signer` keypair whose public key was registered during `SweepController.initialize()`. If the nonce embedded in the signed message does not match the contract's current `nonce` storage slot, verification fails and the `execute_sweep()` call reverts.

## SDK call path for nonce-handling

### 1. Orchestration entry point: `ClaimRedemptionProvider.redeemClaim()`

```
src/modules/claims/providers/claim-redemption.provider.ts
```

The redemption flow calls `SweepsService.executeSweep()` with the account's ephemeral credentials and the user-supplied destination address. It is the top-level orchestrator and does not interact with the nonce directly.

### 2. Sweep orchestration: `SweepsService.executeSweep()`

```
src/modules/sweeps/sweeps.service.ts
```

The service calls `ContractProvider.generateAuthSignature()` (line 96) to produce the Ed25519 authorization signature. Crucially, the call does **not** pass a `nonce` value:

```ts
// sweeps.service.ts, line 96-99
const authSignature = this.contractProvider.generateAuthSignature({
  ephemeralPublicKey: sweepExecutionRequest.ephemeralPublicKey,
  destinationAddress: sweepExecutionRequest.destinationAddress,
});
```

The `AuthorizeSweepParams` interface (defined in `src/modules/sweeps/interfaces/authorize-sweep-params.interface.ts`) declares `nonce` as an optional `bigint`:

```ts
export interface AuthorizeSweepParams {
  ephemeralPublicKey: string;
  destinationAddress: string;
  nonce?: bigint;
}
```

### 3. Signature generation: `ContractProvider.generateAuthSignature()`

```
src/modules/sweeps/providers/contract.provider.ts
```

This method receives `params` (type `AuthorizeSweepParams`) and resolves the nonce on line 183:

```ts
const nonce = params.nonce ?? 0n;
```

The code comment on lines 179-182 explicitly notes that the nonce should come from the `SweepController` contract:

> Fetch the current nonce from the SweepController contract before signing. The nonce must match what the contract will read during verification. This call is synchronous here for interface compatibility; the caller (SweepsService) should ensure the nonce is current before invoking.

However, as shown above, **`SweepsService` does not fetch or pass a nonce**, so every call currently defaults to `nonce = 0n`.

The nonce is then passed to `SweepSignerUtil.sign()` along with the destination address, the sweep controller contract ID, and the signing key seed:

```ts
return SweepSignerUtil.sign(
  params.destinationAddress,
  nonce,
  sweepControllerContractId,
  signingKeySeed,
);
```

### 4. Message construction and signing: `SweepSignerUtil`

```
src/common/crypto/sweep-signer.util.ts
```

`SweepSignerUtil.buildMessage()` reconstructs the exact byte sequence that the on-chain contract hashes:

```ts
static buildMessage(
  destinationStrKey: string,
  nonce: bigint,
  sweepControllerContractId: string,
): Buffer {
  const destXdr = encodeAddressToXdr(destinationStrKey);
  const contractXdr = encodeAddressToXdr(sweepControllerContractId);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64BE(nonce);
  const combined = Buffer.concat([destXdr, nonceBuf, contractXdr]);
  return crypto.createHash('sha256').update(combined).digest();
}
```

The message format is therefore:

| Field | Encoding | Source |
|-------|----------|--------|
| Destination address | XDR-encoded ScVal (AccountId) | `Address.fromString(destination).toScVal().toXDR()` |
| Nonce | 8-byte big-endian u64 | `params.nonce` (defaults to `0n`) |
| SweepController contract ID | XDR-encoded ScVal (ContractId) | `Address.fromString(sweepControllerContractId).toScVal().toXDR()` |

This must stay in sync with `bridgelet-core/contracts/sweep_controller/src/authorization.rs::construct_sweep_message()`.

`SweepSignerUtil.sign()` hashes this combined buffer with SHA256 and signs the hash using the Ed25519 private key derived from `SWEEP_SIGNING_KEY_SEED` (wrapped into PKCS#8 DER format for Node.js `crypto.sign()`).

### 5. On-chain submission: `StellarService.executeSweep()`

```
src/modules/stellar/stellar.service.ts
```

The generated `authSignature` (64-byte Buffer) is passed as the third argument to the `SweepController.execute_sweep()` contract call:

```ts
contract.call(
  'execute_sweep',
  Address.fromString(params.ephemeralAccountContractId).toScVal(),
  Address.fromString(params.destination).toScVal(),
  xdr.ScVal.scvBytes(params.authSignature),
);
```

The on-chain contract will:
1. Read its current `nonce` from instance storage.
2. Reconstruct the same SHA256 message.
3. Verify the Ed25519 signature against the registered `authorized_signer`.
4. If valid, execute the sweep and increment the nonce.

## Current gap: nonce is never fetched on-chain

At present, the SDK does not contain a `SweepController.get_nonce()` contract call or equivalent RPC simulation that would read the current nonce before signing. The `ContractProvider` accepts an optional nonce parameter on `AuthorizeSweepParams`, but no caller provides it, so the signing path always uses `nonce = 0n`.

The consequence of any mismatch is deterministic failure:

> Signing against a stale nonce produces a valid Ed25519 signature for a message that contains an incorrect nonce. The on-chain verification will reconstruct the message with the contract's current nonce, compute a different SHA256 hash, and reject the signature. The `execute_sweep()` call will revert with `Error::AuthorizationFailed`.

## Cross-references

- **bridgelet-core on-chain nonce mechanics:** `bridgelet-audit/glossary/sweep-nonce.md` — describes how the `SweepController` initializes, reads, and increments its nonce in instance storage.
- **bridgelet-core message construction:** `bridgelet-audit/glossary/sha256-message-construction.md` — documents the exact Rust-side `construct_sweep_message()` that this SDK's `SweepSignerUtil.buildMessage()` must mirror.
- **Sweep authorization flow (SDK side):** `bridgelet-sdk-audit/glossary/authorized-controller-sdk-side.md` — describes how `authorized_controller` is set during account creation, which determines which `SweepController` address ends up as the signer verifier on-chain.
- **Sweep diagnostics runbook:** `bridgelet-sdk-audit/runbooks/diagnose-failed-sweep-from-sdk-side.md` — operational guidance for investigating `AuthorizationFailed` errors that may stem from nonce mismatch.
