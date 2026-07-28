# Horizon-Soroban Non-Atomicity in Two-Phase Account Creation

## Overview
This integration note documents a specific failure window present in the two-phase account creation flow that interacts with both the Stellar Horizon API and the Soroban smart contract environment.

## The Failure Window
The current architecture splits account creation into two distinct steps:
1. **Horizon `CreateAccount`**: Funding and creating the base account on the Stellar network.
2. **Soroban `initialize()`**: Configuring the account's on-chain restrictions and smart contract state.

Because these two operations are not atomic, a failure can occur between them. As acknowledged in the codebase, if the Soroban `initialize()` call fails after a successful Horizon `createAccount()` operation, the process leaves behind a fully funded account on the network.

## Definition of 'Unrestricted'
In this failure state, the newly funded account is left **unrestricted**. Concretely, this means:
- The account actively exists and is funded on the Stellar network (via Horizon).
- It lacks any on-chain expiry, recovery constraints, or custom access controls that the Soroban contract would normally enforce.
- It will remain in this unmanaged state indefinitely unless the `initialize()` operation is manually re-attempted and succeeds.

## Open Items & Remediation
The codebase references an internal **Issue #15**, which tracks the development of a compensation strategy (or rollback mechanism) to handle these orphaned, unrestricted accounts. 

**Follow-up Action**: We must track the resolution of Issue #15 to ensure a robust compensation or cleanup strategy is implemented, preventing leaked funds and unmanaged accounts in production environments.
