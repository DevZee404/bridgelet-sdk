# Security Audit Findings

Generated as part of Issues #204, #206, #208, #211..

---

## Issue #204 — SQL Injection Audit

### Summary

All TypeORM database queries in `src/` were reviewed for SQL injection risk.

### Findings.

| File                                                              | Query Type                                          | Parameterized? | Risk                                                |
| ----------------------------------------------------------------- | --------------------------------------------------- | -------------- | --------------------------------------------------- |
| `accounts/accounts.service.ts:210-218`                            | `createQueryBuilder` with `:status` binding         | Yes            | None                                                |
| `claims/providers/claim-lookup.provider.ts:19-22`                 | Repository `findOne({ where: { id } })`             | Yes            | None                                                |
| `claims/providers/claim-redemption.provider.ts:49-55,76-78,89-91` | Repository `findOne({ where: { ... } })`            | Yes            | None                                                |
| `claims/providers/token-verification.provider.ts:46-48`           | Repository `findOne({ where: { claimTokenHash } })` | Yes            | None                                                |
| `sweeps/providers/validation.provider.ts:37-39,107-109,128-130`   | Repository `findOne({ where: { id } })`             | Yes            | None                                                |
| `stellar/providers/payment-monitor-provider.ts:122-124`           | Repository `find({ where: { status } })`            | Yes            | None                                                |
| `database/migrations/*.ts`                                        | Raw `queryRunner.query(...)`                        | Hardcoded SQL  | None (migrations run at deploy time, no user input) |

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

| File:Line                                            | Logged Value                | Severity | Action Taken                          |
| ---------------------------------------------------- | --------------------------- | -------- | ------------------------------------- |
| `stellar/stellar.service.ts:88`                      | `params.publicKey`          | Low      | Redacted to last 6 chars              |
| `stellar/stellar.service.ts:298`                     | `params.destination`        | Medium   | Redacted to last 6 chars              |
| `stellar/stellar.service.ts:326-328`                 | `params.contractId`         | Low      | No change (contract IDs are public)   |
| `stellar/providers/payment-monitor-provider.ts:62`   | `account.publicKey`         | Medium   | Redacted to last 6 chars              |
| `stellar/providers/payment-monitor-provider.ts:152`  | `record.from`               | Medium   | Redacted to last 6 chars              |
| `claims/providers/claim-redemption.provider.ts:39`   | `destinationAddress`        | Medium   | Redacted to last 6 chars              |
| `sweeps/providers/transaction.provider.ts:54`        | `params.destinationAddress` | Medium   | Redacted to last 6 chars              |
| `sweeps/providers/transaction.provider.ts:109`       | `JSON.stringify(extras)`    | Medium   | Replaced with generic error reference |
| `claims/providers/token-verification.provider.ts:51` | `tokenHash`                 | Low      | No change (hash, not token)           |

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

---

## Issue #469 — Claim Token Generation Entropy

### Summary

Claim tokens gate real fund movement: redeeming a token moves the ephemeral
account's funds to the supplied destination. A guessed or enumerated token
lets an attacker redeem someone else's funds, so token generation must be
resistant to guessing and enumeration.

### How tokens are generated

Tokens are short-lived HWAC-signed JWTs produced by `JwtKeyRotationProvider`
(`src/common/crypto/jwt-key-rotation.provider.ts`) with `HS256`. The signature
cannot be forged without the signing secret.

### Entropy sources

1. **HMAC signature (HS256).** Without the signing secret (`JWT_SECRET`), an
   attacker cannot forge a token that verifies. This alone blocks guessing of
   _content_, but a deterministic JWT (same payload + same second) is still
   identical, and tokens are only accepted if their SHA-256 hash matches a
   stored `claimTokenHash`. The practical risk is an attacker reusing/guessing
   an issued token value.

2. **Unique random `jti` claim (added for this issue).** Every issued token now
   embeds `jti = crypto.randomBytes(32).toString('hex')`. `crypto.randomBytes`
   is a **cryptographically secure pseudo-random number generator (CSPRNG)** —
   it is explicitly NOT `Math.random()`, which is deterministic-seeded and not
   suitable for secrets.

### Why this resists brute-force / enumeration

- The `jti` adds **256 bits of entropy** (32 bytes) unique per token. Even if
  two tokens are signed for the same `publicKey` within the same second, their
  values differ.
- To enumerate a valid token, an attacker must guess the 256-bit `jti` AND
  produce a valid HMAC signature for it, requiring the signing secret.
- Brute-forcing 2^256 values is computationally infeasible. For practical
  comparison, a 128-bit random value has ~2^128 possible values; a collision
  becomes likely only after ~2^64 (~1.8×10^19) samples.

### Implementation

- `src/modules/accounts/accounts.service.ts` — `generateClaimToken()` now adds
  the random `jti` claim.
- No change to token _length_ was required (JWT length is not the entropy
  carrier; the signed random claim is).
- Defense-in-depth: token entropy is _not_ a substitute for the rate limiting
  and failed-attempt scrutiny applied to the redemption endpoint (see the
  claims rate-limiting issue). Both layers are enforced.

### Conclusion

Token generation uses a cryptographically secure random source with 256 bits
of entropy per token. No use of `Math.random` or equivalent insecure sources
was found in the claim-token path.

---

## Issue #468 — Per-Integrator Account Authorization

### Summary

Prior to this change, `GET /accounts/:id` and the account list resolved an
account by id without any ownership check, so any valid API key could read any
account's details across tenants.

### Fix

- Accounts are now stamped with the owning `integratorId` at creation (from the
  authenticated `X-API-Key` - see `ApiKeyAuthGuard`).
- `GET /accounts/:id` scopes the lookup to the caller's `integratorId`. When
  the caller is not the owner the service returns `404 NotFoundException`
  rather than `403`, so an unauthorized caller cannot distinguish an existing
  account from a missing one (no existence leakage).
- Migration `1718100008500-AddIntegratorIdToAccountsTable` adds the `uuid`
  column, an index, and a foreign key to `integrators`.

### Coverage

Unit tests in `accounts.service.spec.ts` assert that cross-integrator access
returns `NotFoundException` and that `create()` stamps the `integratorId`.

## Issue #472 — Audit Log Each Attempt

### Summary

Every claim redemption attempt — success **and** failure — is recorded in the
`claim_audit_log` table via `ClaimAuditProvider.record(...)`.

### Implementation Details

- `ClaimRedemptionProvider` writes a `success` row when a sweep completes (with
  account id, destination, IP) and a `failure` row (with `failureReason`) on any
  redemption failure (including unauthorized/expired tokens, invalid destinations,
  and sweep errors).
- Unauthorized attempts (invalid or expired tokens) also resolve the account by
  token hash and record a failure entry even before redemption is attempted.
- The audit write is independent of the sweep itself, so a failed sweep still
  leaves an audit trail.

### Conclusion

Covered by updated tests in `claim-redemption.provider.spec.ts`.

## Issue #473 — Rate Limit Claim Token Generation

### Summary

Claim tokens are generated when an ephemeral account is created (`POST
/accounts`). There is no separate `/claims/initiate` endpoint in the current
implementation (the README lists it aspirationally), so rate limiting the
`POST /accounts` path throttles token generation.

### Implementation Details

- `POST /accounts` is limited to **10 requests/min per API key AND per IP**
  (see the `getTracker` config in `src/app.module.ts` that combines `x-api-key`
  with the client IP).
- `POST /claims/redeem` and `POST /claims/verify` retain stricter per-key+IP
  limits (5/min and 20/min respectively).
- Limits, justification, and the `429` + `Retry-After` behavior are documented
  in the README "Rate Limiting" section.

### Conclusion

Limits are applied, justified, and documented. Tracked per API key and per IP
to prevent cross-account enumeration.

## Issue #474 — Rate Limit Claim Redemption

### Summary

`POST /claims/redeem` moves funds, so it gets the most aggressive rate limit,
plus a brute-force/failed-attempt alert as defense-in-depth on top of the
high-entropy claim token (see issue #469).

### Implementation Details

- `@Throttle({ limit: 5, ttl: 60s })` on `POST /claims/redeem`, tracked per
  API key and per IP.
- `ClaimRedemptionProvider` tracks consecutive failures per token hash
  (`failedAttempts` map). On crossing `failureAlertThreshold = 5`, it logs a
  brute-force alert. Success resets the counter (`resetFailureScrutiny`).

### Conclusion

Rate limit documented in README + tight per-key/IP tracking; brute-force alert
covers repeated failed redemption attempts against the same token.

## Issue #475 — Transactional DB/On-Chain Integrity

### Summary

A redemption spans three independent systems: the DB account row, the DB claim
row, and the on-chain Soroban payment. These are **not** atomic, so there is
inherent drift risk. This is analyzed and a reconciliation mechanism added.

### Failure-mode analysis (in code order)

| DB before | On-chain sweep | DB after                | Result / handling                                                                                                            |
| --------- | -------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| CLAIMING  | success        | CLAIMED + Claim row     | Consistent. `sweep.completed` webhook fired.                                                                                 |
| CLAIMING  | success        | crash before write      | DB stuck in CLAIMING → reconciliation job marks it PARTIAL_SWEEP; token retry re-sweeps idempotently via `skipContractAuth`. |
| CLAIMING  | failure        | CLAIMING (unchanged)    | Consistent failure. `sweep.failed` webhook + audit row; user may retry.                                                      |
| CLAIMING  | partial        | CLAIMED + PARTIAL_SWEEP | Represented via `PARTIAL_SWEEP` status; `sweep.failed` webhook.                                                              |
| CLAIMED   | -              | -                       | Idempotent re-redemption returns the existing claim record (no funds re-swept).                                              |

### Reconciliation mechanism

- `SchedulerService.runSweepReconciliation()` (gated by
  `SWEEP_RECONCILIATION_TIMEOUT_MS`, default 10 min) finds accounts stuck in
  `CLAIMING` past the timeout — the clearest signal that a sweep started but
  the DB/on-chain never reconciled.
- Such accounts are transitioned to `PARTIAL_SWEEP` (the designated
  "inconsistent DB/chain" status) and logged as an alert. A subsequent claim-token
  retry recovers the sweep, because the redemption provider re-submits the
  Horizon payment with `skipContractAuth` for PARTIAL_SWEEP entries.
- Per-account failures are isolated (`Promise.allSettled`) so one bad row never
  blocks the run. Registered on the same cadence as the INITIALIZING cleanup.

### Conclusion

Drift between DB and on-chain state is detected and corrected (→ PARTIAL_SWEEP
for recovery), PARTIAL_SWEEP is the designated inconsistent-state sentinel, and
the failure modes across every DB/chain success/failure combination are
documented above.
