# Validating resolveAssetAddress() Output

## Objective

When a new or unusual asset (e.g. an unverified token or bridged asset) is added to the system, it is critical to verify that `resolveAssetAddress()` correctly maps the asset code/issuer to the correct Soroban contract address.

## Steps

1. **Invoke the Resolver Directly**
   Run the SDK's `resolveAssetAddress(assetCode, issuer)` function in a REPL or test script against the target network (Testnet/Mainnet).

2. **Cross-Check with Horizon**
   Use Horizon API to fetch the asset's TOML file or trustlines. Ensure the contract ID matches what the network reports as the wrapper contract for that classic asset.

3. **Verify Contract State**
   Query the resolved contract address on Stellar Expert or via `soroban contract inspect`.
   - Does it implement the standard token interface?
   - Is it the exact contract ID expected by the bridge?

4. **Update Whitelist (if applicable)**
   If the asset is valid but was previously rejected, ensure the internal asset whitelist config is updated and deployed.
