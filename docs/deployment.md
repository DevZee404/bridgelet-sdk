# Deployment Guide

## Funding Account Balance Monitoring

The funding account (`FUNDING_ACCOUNT_SECRET`) pays for every new ephemeral account created by the service. If its balance runs low, account creation fails silently until the funding account is topped up. This halts the service for all new users.

This is an **operational requirement**, not an optional enhancement.

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `FUNDING_ACCOUNT_BALANCE_CHECK_INTERVAL_MS` | `300000` (5 min) | How often the service polls Horizon for the funding account balance. |
| `FUNDING_ACCOUNT_LOW_BALANCE_THRESHOLD` | `50000000` (5 XLM) | Stroop threshold that triggers a `WARN` log. |
| `FUNDING_ACCOUNT_CRITICAL_BALANCE_THRESHOLD` | `20000000` (2 XLM) | Stroop threshold that triggers an `ERROR` log. |

Stroops are the smallest Stellar unit: **1 XLM = 10,000,000 stroops**.

### Alerting

The service emits three log levels based on balance:

- **INFO** — Balance is healthy (above `FUNDING_ACCOUNT_LOW_BALANCE_THRESHOLD`).
- **WARN** — Balance is low (below low threshold, above critical). Top up recommended.
- **ERROR** — Balance is critically low (below critical threshold). Account creation will fail.

Prometheus metric `funding_account_balance_stroops` (Gauge) is exposed at `/metrics`.

### Recommended Operational Procedure

1. Set up alerting on the `WARN` log level to give operators advance notice.
2. Respond to `CRITICAL` alerts immediately by transferring XLM to the funding account.
3. Verify the funding account has enough balance to cover expected account creation volume plus the Stellar minimum balance requirement.
4. Do not run the funding account balance below the minimum required for the source account to remain valid on Stellar (0.5 XLM for accounts with no trust lines, more if trust lines exist).

### Example Alert Rule (Prometheus / Loki)

```
# Alert when funding account balance is below critical threshold
- alert: FundingAccountCriticalBalance
  expr: funding_account_balance_stroops < 20000000
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Funding account balance is critically low"
    description: "Funding account balance is {{ $value }} stroops. Top up immediately."

# Alert when funding account balance is below low threshold
- alert: FundingAccountLowBalance
  expr: funding_account_balance_stroops < 50000000
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "Funding account balance is low"
    description: "Funding account balance is {{ $value }} stroops. Schedule a top up."
```

### Rotation

The funding account secret should be rotated periodically. See the runbook `bridgelet-sdk-audit/runbooks/rotate-funding-keypair.md` for the procedure.
