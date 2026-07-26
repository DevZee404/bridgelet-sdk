# Claim lifecycle terminology for the claims module

## Purpose

This glossary explains the vocabulary used by the claims module in the SDK so newcomers can tell the difference between the off-chain claim flow and the on-chain sweep/claim logic.

## Core pieces

### Claim lookup

`ClaimLookupProvider` is the read-side component for claims. Its job is to answer questions like "what claim record exists for this ID?" by reading the persisted claim data and returning the claim details that were recorded after redemption.

- It is not responsible for creating claims.
- It is not responsible for executing sweeps.
- It is mainly used for inspection and retrieval of already-known claim state.

### Claim redemption

`ClaimRedemptionProvider` is the main execution path for a user claiming a tokenized payout. It coordinates the end-to-end redemption flow:

1. Accepts a claim token and destination address.
2. Verifies the token and account state.
3. Locks the account for a single redemption attempt to prevent races.
4. Executes the sweep/payment flow.
5. Records the successful claim and updates the account to a claimed state.

In other words, claim redemption is the operational path that turns a claim request into a completed payout record.

### Claim audit

`ClaimAuditProvider` is the audit/logging side of the flow. It records attempts to redeem a claim, including whether they succeeded, failed, or were only partially completed. These records are intended for observability and troubleshooting rather than for the core redemption logic itself.

- Audit entries capture outcome and failure context.
- They are written defensively so audit failures do not block the main redemption path.
- They help explain what happened during claim attempts after the fact.

### Token verification

`TokenVerificationProvider` sits in front of redemption. Before a claim can be processed, the provider checks that the supplied JWT claim token is valid, signed correctly, tied to the expected account, and still within its allowed lifetime. It also rejects accounts that are not in a redeemable state.

In practice, token verification is a gatekeeper for redemption. It decides whether the redemption attempt is allowed to proceed.

## Relationship to SweepController's on-chain `claim()`

This is an important distinction:

- The claims module providers described above are off-chain orchestration and bookkeeping components.
- `SweepController`'s on-chain `claim()` function is the contract-side operation that performs the blockchain-level claim/sweep behavior.

The off-chain claim flow is about validating the request, coordinating the workflow, and recording outcomes. The on-chain `claim()` function is the actual contract execution point that participates in the sweep/claim transaction lifecycle.

Put differently, the SDK's claims module helps decide when and how a claim should be attempted, while the smart contract handles the on-chain enforcement and transfer semantics.

## High-level lifecycle

A typical claim lifecycle looks like this:

1. A claim token is presented to the system.
2. Token verification confirms the token is valid and the account is redeemable.
3. Claim redemption begins and locks the claim slot for safe processing.
4. The sweep/payment operation executes.
5. A claim record is stored and the account is marked as claimed or partially completed.
6. Claim audit records capture the outcome for later review.

This separation of roles makes the claims module easier to reason about: verification validates, redemption executes, lookup reads, and audit records.
