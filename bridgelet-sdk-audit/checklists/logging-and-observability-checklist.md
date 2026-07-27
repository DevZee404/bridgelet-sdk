# Logging and Observability Checklist

## Error Logging Completeness

- [ ] Is every terminal on-chain error (Soroban contract error, Horizon submission failure) logged with enough context (contract ID, account ID, raw error) to diagnose without re-running the call?
- [ ] Are error log messages in `TransactionProvider` and `SweepsService` distinct enough to differentiate timeout from auth failure from on-chain rejection?
- [ ] Is the error-mapping review from [error-mapping-completeness-checklist.md](./error-mapping-completeness-checklist.md) sufficient to ensure no contract error falls through to a generic 500?

## Metrics and Alerting

- [ ] Is the `soroban_rpc_latency_seconds` metric (from `StellarModule`) sufficient for building an alert on elevated sweep failure rates?
- [ ] Are the `claim_redemption_total` Prometheus counter labels (from `ClaimsModule`) broken down by outcome (success / failure / partial)?
- [ ] Are there metrics or log-based alerts for accounts stuck in `CLAIMING` status beyond an expected threshold?

## Log Level Consistency

- [ ] Are log levels (debug vs log vs error vs warn) used consistently across the contract-consumption modules?
- [ ] Is sensitive data (secret keys, claim tokens, destination addresses) redacted from all log levels via `LogSanitizer`?
- [ ] Are `logger.debug` statements safe to leave enabled in production, or do they log high-frequency events that could cause log volume issues?

## Sweep and Payment Monitoring

- [ ] Is the `SweepMonitorService` initialization logged with enough context to confirm monitoring started for all expected accounts?
- [ ] Are partial sweep failures logged at `error` level with the `contractAuthHash` for correlation with on-chain state?
- [ ] Is the `SweepRetryQueueService` retry count and backoff delay visible in logs for debugging stuck retries?

## Audit Trail

- [ ] Are claim audit log writes (success / failure / partial) distinguishable in application logs, not only in the database?
- [ ] Is the audit logger's fire-and-forget resilience (audit failures never propagate) tested and documented?
