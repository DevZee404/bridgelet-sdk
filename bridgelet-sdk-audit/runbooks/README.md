# Bridgelet SDK Operational Runbooks

This directory contains standardized runbooks and operational procedures for maintaining the Bridgelet SDK. Runbooks describe current behavior and operational workarounds; they are not proposals for code changes.

## Routine Operations

- [Audit Sweep-Related Metrics](./audit-sweep-related-metrics.md) — Use when checking sweep health and related operational metrics.
- [Backfill Missed Payments](./backfill-missed-payments.md) — Use when the payment monitor missed an inbound payment.
- [Metrics Overview](./metrics-overview.md) — Use when inspecting the SDK's available metrics during normal operations.
- [Reconcile Database vs Chain State](./reconcile-database-vs-chain-state.md) — Use when confirming persisted account or transaction state against Stellar.
- [Rotate Funding Keypair](./rotate-funding-keypair.md) — Use when rotating the funding account credentials.
- [Rotate Integrator Webhook Secret](./rotate-integrator-webhook-secret.md) — Use when an integrator webhook secret must be replaced.

## Incident Response

- [Diagnose Failed Account Creation](./diagnose-failed-account-creation.md) — Use when account creation fails or leaves an unclear partial state.
- [Diagnose Failed Sweep from SDK Side](./diagnose-failed-sweep-from-sdk-side.md) — Use when a sweep transaction fails or does not complete.
- [Diagnose Stuck Pending-Payment Account](./diagnose-stuck-pending-payment-account.md) — Use when an account remains pending payment unexpectedly.
- [Diagnose Transaction Polling Timeout](./diagnose-transaction-polling-timeout.md) — Use when transaction confirmation polling times out.
- [Recover from Partial Account Creation Failure](./recover-from-partial-account-creation-failure.md) — Use when account creation completed only partially and cleanup or retry is needed.
- [Security Disclosure Triage](./security-disclosure-triage-sdk.md) — Use when a suspected security issue is reported.
- [Webhook Delivery Failure Triage](./webhook-delivery-failure-triage.md) — Use when webhook deliveries are failing or repeatedly retrying.

## Pre-Flight and Validation

- [Handle Overlapping Payment Monitor Ticks](./handle-overlapping-payment-monitor-ticks.md) — Use when validating or investigating overlapping payment-monitor work.
- [Triage Index](./triage-index.md) — Use as the quickest entry point when the right incident procedure is unclear.
- [Validate Asset Address Resolution](./validate-asset-address-resolution.md) — Use before enabling an asset or investigating an asset-address mismatch.
