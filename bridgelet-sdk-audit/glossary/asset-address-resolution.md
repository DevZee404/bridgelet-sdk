# Asset Address Resolution

## Definition

Asset Address Resolution is the process of mapping a classic Stellar Asset (defined by an alphanumeric Code and an Issuer Public Key) to its corresponding Soroban Smart Contract ID (a `C...` address).

## Implementation

The `AssetResolver` module securely derives the contract address locally using the `xdr.Asset` to `xdr.ContractId` SHA-256 derivation rules defined by CAP-46, without needing an RPC roundtrip.

```typescript
const contractId = resolveAssetAddress('USDC', 'GABC123...');
```
