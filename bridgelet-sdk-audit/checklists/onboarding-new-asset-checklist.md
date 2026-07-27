# New-Asset Onboarding Checklist

## Asset Address Resolution

- [ ] Has `resolveAssetAddress()` been validated against the new asset using the procedure in [validate-asset-address-resolution.md](../runbooks/validate-asset-address-resolution.md)?
- [ ] Does the resolved Stellar Asset Contract (SAC) address match the contract ID reported by Horizon for the same asset code/issuer pair?
- [ ] Has the resolved address been verified on Stellar Expert or via `soroban contract inspect` to confirm it implements the standard token interface?

## Decimal Precision

- [ ] Has the asset's decimal precision been confirmed? Stellar native assets are always 7 decimals (stroops), but wrapped or bridged tokens may differ.
- [ ] Does the `parseAmountToStroops()` conversion in `payment-monitor-provider.ts` produce correct values for this asset's expected amount ranges?
- [ ] For assets with fewer than 7 decimals, has the padding logic in `parseAmountToStroops()` been tested to avoid truncation or overflow?

## Contract-Side Cap

- [ ] Has the 10-asset-per-account cap been evaluated against the new asset's expected usage pattern?
- [ ] If the asset is expected on high-traffic accounts, is the risk of hitting the cap documented and communicated to integrators?
- [ ] Is there a monitoring alert for accounts that reach the 10-asset limit with the new asset included?

## Network and Configuration

- [ ] Has the asset been tested on Testnet before Mainnet deployment?
- [ ] Is the asset's issuer account properly funded and activated on the target network?
- [ ] Does the asset have sufficient trustline depth for expected sweep volumes?

## Integration Testing

- [ ] Has an end-to-end payment detection been run with the new asset on Testnet?
- [ ] Has a full sweep cycle (payment detect, contract authorization, Horizon payment) been verified with the new asset?
- [ ] Are the `payment.detected` and `sweep.completed` webhook payloads correct for the new asset?
