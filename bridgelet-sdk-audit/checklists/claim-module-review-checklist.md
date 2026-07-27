# Claims Module Review Checklist

## Token Verification

- [ ] Has every failure mode in `TokenVerificationProvider.validateAccountStatus()` been covered by a unit test (JWT expired, wrong type, invalid signature, all account-status rejections)?
- [ ] Is the `PARTIAL_SWEEP` account status handled correctly by the token verification gate, or does it fall through to the default `BadRequestException` path?
- [ ] Is the JWKS key rotation in `JwtKeyRotationProvider` tested against expired or rotated keys?

## Claim Redemption Flow

- [ ] Does each redemption flow (fresh `PENDING_CLAIM` vs retry from `PARTIAL_SWEEP`) exercise the correct on-chain path per [claim-redemption-vs-sweep-execution.md](../glossary/claim-lifecycle.md)?
- [ ] Is the `skipContractAuth` flag correctly set: `false` for fresh claims, `true` for `PARTIAL_SWEEP` retries where the contract is already in `Swept` state?
- [ ] Are the two separate database transactions (lock acquisition and finalization) isolated correctly to prevent partial state leaks on failure?
- [ ] Is idempotency confirmed: redeeming an already-claimed token returns the original claim with `success: true` and message "Claim was already redeemed"?

## Concurrency and Locking

- [ ] Does the `SELECT FOR UPDATE` pessimistic lock prevent concurrent redemption of the same claim token?
- [ ] Is a concurrent request during `CLAIMING` status correctly rejected with a 409 Conflict?
- [ ] Is the lock released on all failure paths, or could a crashed process leave an account stuck in `CLAIMING`?

## Claim Audit

- [ ] Does the `ClaimAuditProvider` record enough detail (accountId, hashed destination, hashed IP, outcome, failureReason) to reconstruct a disputed redemption after the fact?
- [ ] Are plaintext destination addresses and IP addresses never stored in the audit log (only SHA-256 hashes)?
- [ ] Is the audit logger's fire-and-forget behavior confirmed: a database failure in audit logging does not block or alter the redemption outcome?

## Token Verification Failure Modes

- [ ] Are all token-verification error paths (JWT decode failure, expired token, wrong type, no matching account, invalid account status) tested end-to-end from the controller level?
- [ ] Is the verify endpoint (`POST /claims/verify`) rate-limited separately from the redeem endpoint (`POST /claims/redeem`)?
- [ ] Are error responses from token verification generic enough to prevent token enumeration attacks?

## Webhook and State Consistency

- [ ] Are `sweep.completed`, `sweep.partial`, and `sweep.failed` webhooks fired for every redemption outcome?
- [ ] Does the claim record in the database match the webhook payload data for successful redemptions?
- [ ] Is the `account.claimed` webhook event fired exactly once per successful claim?
