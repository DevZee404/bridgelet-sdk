# API Reference

## POST /accounts

Creates an ephemeral Stellar escrow account backed by a temporary on-chain contract and returns a claim URL.

Request body:

- `fundingSource` (string, required): Stellar public key of the funding account.
- `recovery_address` (string, required): Stellar public key for recovery if the ephemeral account expires.
- `amount` (string, required): Amount to fund the ephemeral account.
- `asset_code` (string, optional): Asset code to fund with, or `native` for XLM.
- `asset_issuer` (string, optional): Asset issuer public key when using a non-native asset.
- `expiresIn` (number, required): Expiry in seconds (minimum 3600, maximum 2592000). The SDK converts this to an absolute `expiresAt` timestamp using `new Date(Date.now() + expiresIn * 1000)` and then derives the contract `expiry_ledger` from that deadline during account initialization.
- `metadata` (object, optional): Free-form metadata attached to the account.

### Expiry conversion

The SDK treats the wall-clock `expiresAt` timestamp as the source of truth for account lifetime. At creation time, `expiresIn` is converted to an absolute timestamp, and `StellarService.toExpiryLedger()` converts that remaining lifetime into a ledger sequence number for the `EphemeralAccount.initialize()` call.

The ledger conversion uses the Stellar assumption that a new ledger closes in roughly 5 seconds:

`expiry_ledger = current_ledger + ceil(remaining_seconds / 5) + 10`

The extra `+ 10` is the `EXPIRY_BUFFER_LEDGERS` safety buffer to absorb normal network latency and keep the on-chain expiry from firing earlier than the intended wall-clock deadline.

Headers:

- `X-API-Key` (string, required): API key for integrator authentication.

Responses:

- `201 Created`: Account created successfully.
- `400 Bad Request`: Invalid request payload.
- `401 Unauthorized`: Missing or invalid API key.
- `429 Too Many Requests`: Rate limit exceeded for the API key.

## Claim tokens (expiry & single-use)

Each ephemeral account is redeemed with a short-lived JWT claim token returned in
the `claimUrl`.

**Expiry:** The token's lifetime is controlled by `CLAIM_TOKEN_EXPIRY`
(default `2592000` seconds = 30 days). The account's `expiresAt` timestamp is
set from the same value, and both the JWT and the account record are checked at
redeem time. A token past its expiry is rejected with `401 Unauthorized`.

**Single-use guarantee:** A claim token authorizes exactly one redemption.
Immediately after a successful redemption the account transitions to
`CLAIMED`, and any subsequent attempt to redeem the same token is rejected
(`409 Conflict`, "claim already redeemed") — it is never swept a second time.
The token therefore cannot be replayed after the first successful use,
regardless of any remaining time-to-expiry.

## POST /claims/redeem

Redeems a claim token and sweeps the ephemeral account's funds to a destination
Stellar address.

Request body:

- `claimToken` (string, required): JWT claim token from the claim URL.
- `destinationAddress` (string, required): Stellar address to receive the swept funds.

Responses:

- `200 OK`: Redemption completed (or was already completed — idempotent).
- `400 Bad Request`: Invalid destination address, or the account is in a
  non-redeemable state.
- `401 Unauthorized`: Invalid or expired claim token.
- `409 Conflict`: Claim has already been redeemed / is already being processed.
