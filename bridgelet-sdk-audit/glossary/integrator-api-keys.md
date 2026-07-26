# Integrator authentication model

## Summary

The integrators module defines the server-to-server identity for callers of the SDK's account-management API. In this codebase, an integrator is not a Stellar account or a human user; it is a business-facing client identity that can authenticate to the `/accounts` API using a shared API key.

At a high level, the integrators service is responsible for:

- storing a durable integrator record with a stable identifier and display name;
- hashing and validating API keys without persisting the raw secret;
- resolving an active integrator from an incoming request when the caller presents a valid key; and
- supporting revocation by marking an integrator as disabled without deleting its record.

## How authentication works

The request flow is intentionally separate from on-chain signing:

- The HTTP layer uses the `X-API-Key` header and the `ApiKeyAuthGuard` to authenticate the caller.
- The guard resolves the integrator by hashing the supplied key and checking the corresponding stored hash in the `integrators` table.
- If the key is valid and the integrator is still active, the guard attaches the integrator identity to the request so downstream services can scope behavior to that integrator.

The raw API key itself is created once at issuance time and returned only once to the caller. After issuance, the system stores only the SHA-256 hash, which means the original key cannot be recovered later.

## Relationship to Stellar keypairs

This authentication model is distinct from the Stellar keypairs used for on-chain signing.

- Integrator API keys are used to authenticate the SDK client to the backend service.
- Stellar keypairs are used for cryptographic operations on-chain, such as account creation, claim processing, and sweep authorization.
- A valid integrator identity does not imply control of a Stellar account, and a Stellar signing key does not grant API access to the SDK service.

In other words, integrator authentication governs access to the bridgelet service, while Stellar signing keys govern authorization for blockchain operations.

## Forward-looking auth scoping note

The repository already contains a design note for the next step in this model: [src/modules/accounts/FUTURE_AUTH_SCOPING.md](../../src/modules/accounts/FUTURE_AUTH_SCOPING.md).

That document explains the rationale for the current per-integrator API key approach and describes the forward-looking direction for tighter scoping, including making account access and data visibility explicitly tied to the authenticated integrator instead of relying on a shared generic guard.
