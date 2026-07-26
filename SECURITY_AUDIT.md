# Security Audit Findings

Generated as part of Issues #204, #206, #208, #211.

---

## Issue #204 — SQL Injection Audit

### Summary

All TypeORM database queries in `src/` were reviewed for SQL injection risk.

### Findings

| File | Query Type | Parameterized? | Risk |
|---|---|---|---|
| `accounts/accounts.service.ts:210-218` | `createQueryBuilder` with `:status` binding | Yes | None |
| `claims/providers/claim-lookup.provider.ts:19-22` | Repository `findOne({ where: { id } })` | Yes | None |
| `claims/providers/claim-redemption.provider.ts:49-55,76-78,89-91` | Repository `findOne({ where: { ... } })` | Yes | None |
| `claims/providers/token-verification.provider.ts:46-48` | Repository `findOne({ where: { claimTokenHash } })` | Yes | None |
| `sweeps/providers/validation.provider.ts:37-39,107-109,128-130` | Repository `findOne({ where: { id } })` | Yes | None |
| `stellar/providers/payment-monitor-provider.ts:122-124` | Repository `find({ where: { status } })` | Yes | None |
| `database/migrations/*.ts` | Raw `queryRunner.query(...)` | Hardcoded SQL | None (migrations run at deploy time, no user input) |

### Conclusion

**No SQL injection vulnerabilities found.** All runtime queries use TypeORM's parameterized query builder or repository methods that automatically parameterize inputs. Migration files contain raw SQL but use only hardcoded DDL/DML statements with no user-supplied values.

### Recommendations

- Continue using TypeORM repository methods or `createQueryBuilder` with named bindings (`:param`).
- Never interpolate user input into raw SQL strings. If raw queries are needed in the future, always use parameter placeholders.
- Add a lint rule or code review check to flag `query()` calls with string concatenation/interpolation.

---

## Issue #206 — Sensitive Data Leakage Audit

### Summary

All `this.logger.*` calls were reviewed for potential leakage of Stellar secret keys, JWT tokens, API keys, claim tokens, or wallet addresses.

### Findings

| File:Line | Logged Value | Severity | Action Taken |
|---|---|---|---|
| `stellar/stellar.service.ts:88` | `params.publicKey` | Low | Redacted to last 6 chars |
| `stellar/stellar.service.ts:298` | `params.destination` | Medium | Redacted to last 6 chars |
| `stellar/stellar.service.ts:326-328` | `params.contractId` | Low | No change (contract IDs are public) |
| `stellar/providers/payment-monitor-provider.ts:62` | `account.publicKey` | Medium | Redacted to last 6 chars |
| `stellar/providers/payment-monitor-provider.ts:152` | `record.from` | Medium | Redacted to last 6 chars |
| `claims/providers/claim-redemption.provider.ts:39` | `destinationAddress` | Medium | Redacted to last 6 chars |
| `sweeps/providers/transaction.provider.ts:54` | `params.destinationAddress` | Medium | Redacted to last 6 chars |
| `sweeps/providers/transaction.provider.ts:109` | `JSON.stringify(extras)` | Medium | Replaced with generic error reference |
| `claims/providers/token-verification.provider.ts:51` | `tokenHash` | Low | No change (hash, not token) |

### Conclusion

No logging of raw Stellar secret keys, JWT tokens, or API keys was found. Wallet addresses (public keys starting with `G`) were found in several log statements and have been redacted to show only the last 6 characters for traceability without full exposure.

### Changes Made

- Created `src/common/utils/log-sanitizer.util.ts` with `redactAddress()` helper.
- Updated logging calls across `stellar.service.ts`, `payment-monitor-provider.ts`, `claim-redemption.provider.ts`, and `transaction.provider.ts` to redact wallet addresses.

---

## Issue #211 — Horizon SSE Payment Monitoring

### Summary

SSE subscription to Stellar Horizon for inbound payment monitoring is fully implemented in `src/modules/stellar/providers/payment-monitor-provider.ts`.

### Implementation Details

- Uses `server.payments().forAccount().stream()` from `@stellar/stellar-sdk`
- Opens SSE streams per ephemeral account via `watch(account)`
- On payment detection: calls `StellarService.recordPayment()` to record on contract
- Updates account status to `PENDING_CLAIM` in database
- Handles idempotency (DuplicateAsset → no-op)
- Handles non-retryable errors (TooManyPayments, InvalidAmount → FAILED)
- Restores streams for `PENDING_PAYMENT` accounts on startup (`restoreActiveStreams()`)
- Cleans up all streams on shutdown (`onModuleDestroy()`)

### Conclusion

Fully implemented with comprehensive test coverage in `payment-monitor-provider.spec.ts`.
