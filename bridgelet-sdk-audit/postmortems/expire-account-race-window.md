# The check-then-call race window in `expireAccount()`

**Status:** Documentation-only — no code changes required to close this finding.
**Part of:** bridgelet-sdk-audit knowledge-base (postmortems / lessons-learned).

---

## What This Document Covers

The time-of-check-to-time-of-use (TOCTOU) window between the off-chain
ledger/expiry guard in `StellarService.expireAccount()` and the subsequent
on-chain `expire()` submission — why the pattern exists, why this instance is
**likely low-risk**, and why that judgment should stay explicit in writing.

---

## 1. The general TOCTOU pattern

A **time-of-check-to-time-of-use** (TOCTOU) race occurs whenever code:

1. **Checks** a precondition against some snapshot of state, then
2. **Acts** on the assumption that the precondition still holds,

while another actor (another thread, process, scheduler tick, or on-chain
transaction) can change that state in between.

Classic shape:

```
check(state)  ──►  [gap]  ──►  use(state)
                     ↑
              concurrent mutation
```

Off-chain guards of this form are common and often intentional: they avoid
wasted work (fees, RPC round-trips, noisy errors) when the action is clearly
not ready yet. They are **not** a substitute for the authority that actually
enforces the precondition at use time. The check answers “should we bother?”;
the use-time enforcer answers “is this still valid?”

Whenever those two moments are separated — by network latency, transaction
preparation, mempool delay, or a second concurrent caller — the gap is a
TOCTOU window. Whether the window is dangerous depends entirely on what the
use-time path does when the precondition no longer holds.

---

## 2. This instance: `expireAccount()`

In `StellarService.expireAccount()`
(`src/modules/stellar/stellar.service.ts`), the flow is:

1. **Check:** read `getCurrentLedger()` and `getAccountInfo(contractId)`.
2. **Guard:** if `currentLedger < accountInfo.expiry_ledger`, log a warning and
   return early (no transaction submitted).
3. **Use:** build, prepare, sign, and submit `contract.call('expire')`, then
   wait for confirmation.

The scheduler (`SchedulerService.runExpiryJob`) selects DB rows whose
wall-clock `expiresAt` has passed and calls into this method. Concurrent
expiry ticks, a concurrent sweep, or a second process can therefore race the
same contract between the guard and inclusion of `expire()`.

The JSDoc on `expireAccount()` already names the relevant on-chain outcomes:

| Contract error   | Intended SDK reading                                      |
| ---------------- | --------------------------------------------------------- |
| `NotExpired`     | Non-fatal race — ledger not yet reached at execution time |
| `InvalidStatus`  | Terminal — account already swept or expired               |
| `NotInitialized` | System error — contract was never initialized             |

The off-chain ledger comparison is an **optimization** to skip unnecessary
submissions. The contract’s own checks at `expire()` execution remain the
source of truth.

---

## 3. Why this instance is likely low-risk

This finding is **likely low-risk**, not because the race window is absent,
but because the on-chain `expire()` path is expected to absorb the common
outcomes of the race without corrupting funds or account semantics:

1. **On-chain enforcement still runs.** Passing the SDK guard does not bypass
   the contract. If the ledger has not actually reached expiry when the
   transaction executes, the contract can still reject with `NotExpired`.
2. **Terminal / already-done states fail closed.** If another caller already
   expired the account, or a sweep moved it to a terminal status, `expire()`
   surfaces `InvalidStatus`. The SDK maps that to `ACCOUNT_ALREADY_TERMINAL`
   rather than treating success as having occurred twice.
3. **Idempotent-enough semantics for retries.** Re-entering `expire()` after
   the account is already terminal does not re-apply recovery or invent a
   second expiry; it fails with a status error. Concurrent or repeated
   submissions therefore tend toward wasted fees / logged failures, not
   double-spend or inconsistent fund movement — **assuming** the contract’s
   `expire()` implementation keeps that idempotent (or reject-if-done)
   behavior.

Taken together, the check-then-call gap looks like a scheduling / fee
efficiency concern more than a funds-safety hole **under the current contract
behavior**.

This is **not** a claim that the window is risk-free:

- A future contract change that made `expire()` non-idempotent, partially
  applied recovery, or omitted status checks would turn the same SDK pattern
  into a real hazard without any SDK diff.
- Error-mapping gaps (e.g. not classifying `NotExpired` the same way the
  JSDoc describes) can turn a benign race into operator-visible hard failures
  or missed retries.
- Horizon ledger caching (`getCurrentLedger`) and wall-clock vs ledger-sequence
  skew can widen how often the race is hit, even if each hit remains
  “safe” on-chain.

Low risk here means “bounded and absorbed by current on-chain idempotency,”
not “impossible” or “safe forever.”

---

## 4. Document “probably fine because X” explicitly

Implicit safety assumptions rot quietly. Someone reading only the early-return
guard may believe the SDK has synchronized expiry; someone changing `expire()`
on-chain may not know the SDK depends on reject-if-done behavior to keep the
TOCTOU window harmless.

When an audit concludes **“probably fine because X”**, write **X** down next
to the finding — as this article does:

> Probably fine **because** on-chain `expire()` remains authoritative and
> idempotent / reject-if-already-terminal across the check-then-call gap;
> the off-chain guard is only an optimization.

That sentence is the durable artifact. If `X` stops being true, the finding’s
risk rating should be revisited immediately, even if no SDK code changed.

---

_References:_

- `src/modules/stellar/stellar.service.ts` — `expireAccount()`, `getCurrentLedger()`, `getAccountInfo()`
- `src/modules/scheduler/scheduler.service.ts` — `runExpiryJob()` / per-account `expireAccount()`
- `src/common/errors/contract-error.mapper.ts` — `NotExpired`, `InvalidStatus` mappings
- `bridgelet-sdk-audit/checklists/account-expiry-flow-checklist.md` — expiry flow review prompts
- `bridgelet-sdk-audit/glossary/expiry-ledger-conversion.md` — wall-clock → ledger conversion
