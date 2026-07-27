# record_payment Trust Assumption

**Status:** Documentation-only — no code changes required.
**Part of:** bridgelet-sdk-audit knowledge-base initiative (19/100).

---

## What This Document Covers

The mismatch between `bridgelet-sdk`'s `signerSecret`-based call pattern and
`record_payment`'s actual on-chain access control.

---

## 1. How the SDK Calls `record_payment`

`StellarService.recordPayment()` (`src/modules/stellar/stellar.service.ts:233`)
requires a `signerSecret` parameter. It uses this secret to:

1. Derive a keypair via `Keypair.fromSecret(signerSecret)`
2. Load the signer's on-chain account from Soroban RPC
3. Build a Soroban transaction calling `EphemeralAccount::record_payment(amount, assetAddress)`
4. Sign the transaction with the signer keypair
5. Submit and wait for confirmation

The `signerSecret` is sourced from the `stellar.fundingSecret` config value —
the same key that created the ephemeral account.

**Practical implication:** the SDK treats `record_payment` as an authorized
operation that requires a specific signing key. This is a self-imposed
convention in the SDK layer.

---

## 2. What the Contract Actually Checks

Cross-referencing the bridgelet-audit's `record-payment-unauthenticated-write`
postmortem: the on-chain `record_payment` function on `EphemeralAccount` does
**not** verify the caller's identity. The contract does not enforce that the
transaction signer is the funding account, the ephemeral account holder, or any
particular address.

The contract only validates:

- `amount > 0` (returns `InvalidAmount`)
- The asset hasn't already been recorded (returns `DuplicateAsset`)
- Payment count hasn't exceeded 10 (returns `TooManyPayments`)
- The contract is initialized (returns `NotInitialized`)

**Any funded account** could theoretically submit a `record_payment` call
against any deployed `EphemeralAccount` contract — the contract won't reject
it based on caller identity.

---

## 3. The Gap

| Layer                                               | Access Control                            | Enforcement             |
| --------------------------------------------------- | ----------------------------------------- | ----------------------- |
| **SDK** (`StellarService.recordPayment()`)          | Requires `signerSecret` (funding account) | Self-imposed convention |
| **Contract** (`EphemeralAccount::record_payment()`) | None — any caller can invoke              | Not enforced on-chain   |

The SDK's signing requirement is a **self-imposed convention**, not an
**on-chain guarantee**. Until the contract-side gap is closed, the security
boundary relies entirely on the SDK enforcing caller identity at the
application layer.

---

## 4. Risk Assessment

- **Current risk is low** because `bridgelet-sdk` is the only known caller of
  `record_payment`, and it always uses the correct `stellar.fundingSecret`.
- **Risk increases** if third-party integrations or alternative clients interact
  directly with the contract, bypassing the SDK's signing convention.
- **No immediate action required** for the SDK itself, but the contract should
  eventually add caller validation (e.g. check `Address::require_auth()` against
  the stored funding address) to close the gap at the protocol level.

---

## 5. Recommendation

1. **Short-term (SDK):** No code change needed. Document this trust assumption
   for auditors and integrators (this file).
2. **Medium-term (contract):** Add `Address::require_auth()` or a stored-address
   check to `record_payment` so only the authorized signer can record payments.
3. **Long-term (SDK):** Once the contract enforces caller identity, the SDK's
   `signerSecret` requirement becomes redundant but can remain as a defense-in-depth
   measure.

---

_References:_

- `src/modules/stellar/stellar.service.ts:233-292` — `recordPayment()` implementation
- `bridgelet-audit/record-payment-unauthenticated-write.md` — postmortem (external)
- `docs/FUTURE_CONTRACT_INTEGRATIONS.md` — related integration planning
