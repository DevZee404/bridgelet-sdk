# Contract-Address Configuration Checklist

## Address Validation

- [ ] Has each configured contract address (`EPHEMERAL_ACCOUNT_CONTRACT_ID`, `STELLAR_SWEEP_CONTROLLER_CONTRACT_ID`) been cross-checked against bridgelet-core's deployment-artifacts for the target network?
- [ ] Are the addresses in the correct format (Stellar contract address starting with `C...`) and not accidentally set to classic account addresses?
- [ ] Has each address been verified to host the expected contract bytecode on-chain via `soroban contract inspect`?

## Network Isolation

- [ ] Can Testnet and Mainnet contract addresses be accidentally mixed in a single deployment?
- [ ] Is there a mechanism (e.g., environment variable validation at startup) that rejects a Mainnet ephemeral-account address with a Testnet sweep-controller address, or vice versa?
- [ ] Does the `stellar.config.ts` fallback logic for `STELLAR_SWEEP_CONTROLLER_CONTRACT_ID` / `SWEEP_CONTROLLER_CONTRACT_ID` preserve network isolation?

## Test Coverage

- [ ] Is a change to any of these contract addresses covered by an integration test that invokes the contract on the target network, not just a unit test with a mocked address?
- [ ] Do integration tests verify that the configured `ephemeralAccount` address matches the `execute_sweep` entry point on-chain?
- [ ] Do integration tests verify that the configured `sweepController` address is the correct authorization source for `generate_auth_signature`?

## Deployment Artifacts

- [ ] Are deployment-artifact addresses versioned and pinned to specific contract releases?
- [ ] Is there a documented procedure for rotating contract addresses when a new version is deployed?
- [ ] Are contract address changes announced to integrators before they take effect on Mainnet?

## Operational Safety

- [ ] Is there an alert or health-check that verifies on-chain contract state matches the configured addresses at startup?
- [ ] Are stale addresses from a previous deployment cleaned up from all environments?
