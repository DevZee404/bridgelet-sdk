# Recovering from a Partial Account Creation Failure

## Context

A hybrid application might create a classic Stellar account on Horizon, but fail in a subsequent step to register that account's metadata with a Soroban smart contract. This leaves the account in a "partially created" state.

## Identification

- The account exists on Stellar Expert.
- Querying the Soroban contract for the account yields a "Not Found" error.
- The downstream database marks the account as `PENDING_SOROBAN_REGISTRATION`.

## Remediation

1. **Verify Balances**
   Ensure the account was properly funded with the base reserve during the Horizon step.

2. **Re-run the Registration Step**
   Use the SDK's retry utility to solely execute the Soroban registration transaction:

   ```bash
   npm run sdk:retry:soroban-registration -- --accountId <G_ADDRESS>
   ```

3. **Verify State**
   Confirm the script successfully registered the account by querying the contract state again. The downstream DB should automatically flip to `ACTIVE` upon success.
