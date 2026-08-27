# Bridgelet SDK Integration Notes

These notes document points of contact between this SDK and the bridgelet-core contracts. Use the module grouping below to find the integration boundary relevant to a review or implementation.

## Stellar Service

- [record_payment Trust Assumption](./record-payment-trust-assumption.md) - Documents the SDK signer convention and the contract-side authorization assumption for recording payments.

## Payment Monitor

- [Payment Monitor Single Asset Limitation](./payment-monitor-single-asset-limitation.md) - Describes how payment detection and asset filtering affect the account payment flow.

## Sweeps

- [Partial Sweep Recovery](./partial-sweep-recovery.md) - Explains recovery after the contract sweep succeeds but the follow-up Horizon payment fails.
- [SDK-Side Error Mapping](./sdk-side-error-mapping.md) - Lists the SDK responses and retry behavior for Soroban and Horizon errors used by sweep flows.

## Claims

- [Ed25519 Signature Verification](./ed25519-signature-verification.md) - Describes structured authorization failures versus Wasm traps during claim and sweep authorization.

## Webhooks

There are no integration notes dedicated primarily to webhooks yet.
