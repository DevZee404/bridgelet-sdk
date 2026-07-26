# Integration Note: SDK-Side Error Mapping

> **For integrators** using the bridgelet-sdk to understand error responses.

## Overview

The bridgelet-sdk maps on-chain Soroban contract errors and Horizon transaction errors to structured HTTP responses. This note documents the mapping so you can programmatically handle errors in your integration.

## Contract Errors (Soroban)

These errors originate from the Soroban smart contract and are mapped by `contract-error.mapper.ts`:

| Contract Error String | HTTP Status | Error Code | Retriable | Description |
|---|---|---|---|---|
| `AlreadySwept` | 410 | `ALREADY_SWEPT` | No | Account was already swept |
| `AccountExpired` | 410 | `ACCOUNT_EXPIRED` | No | Account's expiry ledger passed on-chain |
| `NoPaymentReceived` | 400 | `NO_PAYMENT_RECEIVED` | No | Payment was never recorded |
| `InvalidStatus` | 409 | `INVALID_STATUS` | No | Contract not in expected state |
| `AuthorizationFailed` | 403 | `AUTHORIZATION_FAILED` | No | Signature verification failed |
| `UnauthorizedDestination` | 403 | `UNAUTHORIZED_DESTINATION` | No | Sweep destination not authorized |
| `AccountAlreadySwept` | 410 | `ACCOUNT_ALREADY_SWEPT` | No | Variant of AlreadySwept |
| Any other string | 500 | `UNKNOWN_CONTRACT_ERROR` | No | Catch-all — see note below |

### Important Caveat

Not all contract failures return a string. A malformed Ed25519 signature can cause a Wasm trap (panic) rather than returning a typed error. In this case, the SDK receives a raw `Error` that does not match any known string pattern and falls through to the catch-all 500. See `ed25519-signature-verification.md` for details.

## Horizon Errors (Classic Operations)

These errors originate from the Stellar network and are mapped by `horizon-error.mapper.ts`:

| Horizon Error Code | HTTP Status | Error Code | Retriable | Description |
|---|---|---|---|---|
| `tx_bad_auth` | 401 | `TX_BAD_AUTH` | No | Signing key invalid |
| `tx_insufficient_balance` | 402 | `TX_INSUFFICIENT_BALANCE` | No | Not enough XLM for operation |
| `tx_too_late` | 408 | `TX_TOO_LATE` | Yes | Transaction expired before confirmation |
| `tx_bad_seq` | 409 | `TX_BAD_SEQ` | Yes | Sequence number conflict |
| Other | 502 | `HORIZON_ERROR` | Varies | Upstream Stellar network error |

## Retry Behavior

The SDK's sweep retry queue classifies errors as:
- **Retriable**: `tx_too_late`, `tx_bad_seq`, network timeouts
- **Terminal**: All contract errors, `tx_bad_auth`, `tx_insufficient_balance`

Terminal errors are **never** retried and result in an immediate `FAILED` status with an `sweep.failed` webhook.

## Best Practices

1. **Always check `error_code`** in the response body, not just the HTTP status.
2. **Do not retry terminal errors** — they will fail again.
3. **For `PARTIAL_SWEEP`** status, the SDK handles recovery automatically via the retry queue.
4. **Subscribe to webhooks** (`sweep.partial`, `sweep.failed`, `sweep.completed`) rather than polling for status.
