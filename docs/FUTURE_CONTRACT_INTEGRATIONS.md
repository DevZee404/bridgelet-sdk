# Future Feature: Wire Up ReserveContract & AccountFactory

**Status:** Both contracts are deployed on testnet but have zero integration
in this backend (or, in ReserveContract's case, in `bridgelet-core` either).
Confirmed via full-repo search — no `ACCOUNT_FACTORY_CONTRACT_ID` or
`RESERVE_CONTRACT_CONTRACT_ID` anywhere in `bridgelet-sdk`.

These are two separate, unrelated pieces of work — don't bundle them.

---

## 1. AccountFactory — backend-only work

**What it unlocks:** creating many `EphemeralAccount` instances in a single
transaction (`AccountFactory::batch_initialize()`), instead of one
transaction per account. Relevant if a "bulk payout" style feature ever
shows up (e.g. pay 500 recipients at once).

**Where the fix goes:** entirely in `bridgelet-sdk`. The contract-side
capability already exists and works — nothing in `bridgelet-core` needs to
change.

**Sketch:**

- Add `ACCOUNT_FACTORY_CONTRACT_ID` to `.env.example` and `stellar.config.ts` (`contracts.accountFactory`).
- New endpoint, e.g. `POST /accounts/batch`, accepting an array of the same
  fields `CreateAccountDto` takes today.
- New service method (`AccountsService.createBatch()`) that calls
  `AccountFactory::batch_initialize()` once instead of looping
  `AccountsService.create()` N times.
- **Known contract-side limitation to design around:** `batch_initialize()`
  currently swallows per-account error detail — a failed account in the
  batch comes back as `{ success: false, error: None }`, no reason why. Your
  batch endpoint's response schema needs to account for "some succeeded,
  some failed, and you won't know why the failed ones failed" as a real
  possible outcome, not an edge case to paper over.

**Rough size:** small–medium. Mostly plumbing; the hard part is the
service-layer decision on what "partial batch success" looks like in the
API response and any webhook events.

---

## 2. ReserveContract — needs a `bridgelet-core` change FIRST

**What it (would) unlock:** a single, centrally-updatable base reserve
amount, instead of the hardcoded `BASE_RESERVE_STROOPS` constant baked into
`EphemeralAccount`.

**Where the fix goes:** this is NOT purely a backend task. Today,
`EphemeralAccount` never calls `ReserveContract` — it has its own internal
constant. Wiring this up means:

1. **In `bridgelet-core` first:** `EphemeralAccount` needs a new
   cross-contract call to `ReserveContract::get_base_reserve()` (same
   `contractimport!` pattern used for `SweepController` → `EphemeralAccount`
   calls), replacing the hardcoded constant. This requires a contract
   rebuild and **redeploy** — `EphemeralAccount`'s interface/behavior is
   changing, so treat it as a breaking change to already-deployed instances
   (existing ephemeral accounts on testnet would keep the old hardcoded
   behavior; only newly-deployed ones would read from `ReserveContract`).
2. **Then in `bridgelet-sdk`:** add `RESERVE_CONTRACT_CONTRACT_ID` to config
   (same pattern as above), and only if you want an admin endpoint to call
   `ReserveContract::set_base_reserve()` — the backend doesn't strictly need
   to touch this contract at all otherwise, since `EphemeralAccount` would
   read it directly on-chain.

**Rough size:** small on the backend side, but the contract-side change is
the real work, and needs its own audit-level review before redeploying —
this touches reserve/reclaim math, which is fund-safety-adjacent code.

**Recommendation:** don't start this until there's an actual product reason
to make the base reserve configurable post-deploy (e.g. Stellar network
protocol changes the reserve requirement). Until then, the hardcoded
constant is simpler and has one less moving part / cross-contract call to
audit.

---

## Suggested priority

AccountFactory (self-contained, backend-only, clear use case) before
ReserveContract (cross-repo, touches fund-safety math, no concrete driving
need yet).
