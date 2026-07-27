# Status Field Returned as Raw u32

## Issue Summary

The status field parsing logic in `src/modules/stellar/stellar.service.ts` uses `get('status')?.u32()?.toString()`, which returns a bare numeric string (e.g., `"2"`) instead of a named, semantic status value. This is surprising to SDK consumers who expect human-readable strings mapped to the `AccountStatus` enum values.

## Root Cause

The contract returns a numeric discriminant for the status, but the SDK merely converts the underlying `u32` to a string without mapping it to a named domain model. For example, `AccountStatus` in `src/modules/accounts/enums/account-status.enum.ts` defines clear semantic states like `PENDING_PAYMENT` (`'pending_payment'`) and `CLAIMED` (`'claimed'`). Returning a raw numeric string like `"2"` creates a disconnect between the data returned from the blockchain and the SDK's internal type definitions.

## Risk

This implementation introduces a concrete failure mode: callers might end up comparing the returned numeric string against a hardcoded numeric literal (e.g., `if (status === "2")`) because there is no shared enum or mapping tying that literal back to the actual `AccountStatus` discriminants in `bridgelet-core` / the SDK. If the contract's discriminant values ever change or are reordered in a future update, these hardcoded comparisons will silently break.

## Resolution / Lesson

**Recommendation:** Maintain a single canonical enum mapping shared between the SDK and the contract's status codes. This ensures a single source of truth, provides compile-time safety, and prevents silent drift if contract implementations change. The raw `u32` value should be explicitly mapped to its corresponding `AccountStatus` enum value before being returned by the SDK layer.
