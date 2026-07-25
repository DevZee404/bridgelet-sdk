# API Reference

## POST /accounts

Creates an ephemeral Stellar escrow account backed by a temporary on-chain contract and returns a claim URL.

Request body:

- `fundingSource` (string, required): Stellar public key of the funding account.
- `recovery_address` (string, required): Stellar public key for recovery if the ephemeral account expires.
- `amount` (string, required): Amount to fund the ephemeral account.
- `asset_code` (string, optional): Asset code to fund with, or `native` for XLM.
- `asset_issuer` (string, optional): Asset issuer public key when using a non-native asset.
- `expiresIn` (number, required): Expiry in seconds (minimum 3600, maximum 2592000).
- `metadata` (object, optional): Free-form metadata attached to the account.

Headers:

- `X-API-Key` (string, required): API key for integrator authentication.

Responses:

- `201 Created`: Account created successfully.
- `400 Bad Request`: Invalid request payload.
- `401 Unauthorized`: Missing or invalid API key.
- `429 Too Many Requests`: Rate limit exceeded for the API key.
