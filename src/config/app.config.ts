import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  jwtPreviousSecret: process.env.JWT_PREVIOUS_SECRET,
  claimTokenExpiry: parseInt(process.env.CLAIM_TOKEN_EXPIRY ?? '2592000', 10),
  webhookRetryAttempts: parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS ?? '3', 10),
  webhookTimeout: parseInt(process.env.WEBHOOK_TIMEOUT ?? '10000', 10),
  // Issue #495: a subscription is considered in "sustained failure" once
  // this many of its most recent delivery attempts have all failed.
  webhookSustainedFailureThreshold: parseInt(
    process.env.WEBHOOK_SUSTAINED_FAILURE_THRESHOLD ?? '5',
    10,
  ),
  // How often the internal health monitor scans subscriptions for
  // sustained failure and logs an alert (issue #495).
  webhookHealthCheckIntervalMs: parseInt(
    process.env.WEBHOOK_HEALTH_CHECK_INTERVAL_MS ?? '300000',
    10,
  ),
  /** Days to retain claim audit log rows before the expiry job purges them. */
  claimAuditRetentionDays: parseInt(
    process.env.CLAIM_AUDIT_RETENTION_DAYS ?? '90',
    10,
  ),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  enableSwagger: process.env.ENABLE_SWAGGER === 'true',
}));
