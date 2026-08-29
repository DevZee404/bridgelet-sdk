# Deployment Guide

This guide covers production configuration, with particular attention to the
high-privilege Stellar secrets that the service consumes.

## High-Privilege Secrets

The following environment variables control accounts that can move funds on
Stellar. They must **never** be stored in a plain `.env` file in production, in
source control, or in CI logs:

| Variable                  | Purpose                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `FUNDING_ACCOUNT_SECRET`  | Secret key of the funding account used to create ephemeral accounts and sign expiry/sweep operations. |
| `RECOVERY_ACCOUNT_PUBLIC` | Public key funds are swept to when an account expires unclaimed (public, not secret).                 |
| `SWEEP_SIGNING_KEY_SEED`  | Seed used to generate the sweep-authorisation signature.                                              |
| `JWT_SECRET`              | Signs/verifies claim tokens and JWTs (see below).                                                     |
| `ENCRYPTION_KEY`          | AES-256-GCM key used to encrypt stored account secrets.                                               |

Access to any of the secret values can authorise real fund movement, so
protect them at the same level as your own wallet keys.

## Storing `FUNDING_ACCOUNT_SECRET` in Production

`FUNDING_ACCOUNT_SECRET` controls the account that funds new ephemeral
accounts and pays transaction fees. Treat it as a key whose compromise (or
drain) would stop account creation and break sweeps.

**Recommended storage:** a secrets manager (AWS Secrets Manager / SSM Parameter
Store, HashiCorp Vault, GCP Secret Manager) or KMS-backed injection at deploy
time. The process environment should only ever receive the secret from the
secrets manager at runtime — never from a checked-in file.

When deploying to a managed runtime, inject the value via the platform's
secret mechanism (e.g. ECS Secrets, EKS `external-secrets`, or
`aws secretsmanager` + `jq` in the entrypoint) rather than baking it into the
image or an env file.

## Rotating `FUNDING_ACCOUNT_SECRET`

Because the funding account is long-lived and central to operations, rotations
should be deliberate and coordinated:

1. **Fund the new account.** Create (or choose) the replacement Stellar account
   and ensure it holds enough XLM (minimum reserve plus a cushion for fees) to
   take over funding and sweep-signing.
2. **Verify no in-flight operations.** Confirm there are no active
   account-creation or sweep transactions being signed by the old key (nonce /
   sequence-number contention is the main risk). Ideally perform rotation
   during a maintenance window or when load is low.
3. **Switch the secret.** Update the secrets-manager value so the next process
   restart (or secret-reload) picks up the new key.
4. **Roll the deployment.** Redeploy so all running instances re-read the
   secret. Confirm the new instance uses the new key (observe funding/sweep
   operations in logs).
5. **Keep the old key briefly as a fallback** for any in-flight transactions,
   then revoke/drain it once the network confirms the switch is stable.

There is no automated rotation job today; rotation is a manually orchestrated
process following the steps above.

## Monitoring the Funding Account Balance

The funding account must always hold enough XLM to cover:

- the minimum account reserve plus initial balance for each new ephemeral
  account, and
- transaction fees for account creation and sweep operations.

If it runs low, account creation silently fails and sweeps stall. Recommended
guardrails:

- **Balance alerting:** poll the funding account's Stellar balance (e.g. via
  Horizon `GET /accounts/{id}`) on a schedule and alert when the total XLM
  balance drops below a configured floor (for example `< 100 XLM`) or shows a
  sustained downward trend.
- **Health check hook:** if you expose a health endpoint, have it include the
  funding account balance (and mark the service unhealthy when the balance
  falls below the floor), so orchestrators can page on it.
- **Threshold review:** re-evaluate the alert floor whenever the expected
  account-creation volume or fee market (p75 fee) changes materially.

## Redeploying With a New Funding Account

See "Rotating `FUNDING_ACCOUNT_SECRET`" above. Because account creation reads
the secret on every call via the config layer, a restart with a new key is
sufficient; no data migration is required. In-flight operations should be
drained (or allowed to fail and retry) before switching.

## Database Backup and Point-in-Time Restore

### Backup strategy

The Bridgelet SDK stores all ephemeral account state, claim tokens, webhook subscriptions,
and audit logs in PostgreSQL. A backup failure can result in irrecoverable data loss for
in-flight financial operations.

**Recommended configuration:**

| Parameter             | Recommended value |
| --------------------- | ----------------- |
| Full backup frequency | Daily             |
| WAL archiving (PITR)  | Continuous        |
| Backup retention      | 30 days           |
| RPO target            | < 5 minutes       |
| RTO target            | < 1 hour          |

### Taking a backup (pg_dump)

```bash
pg_dump -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME \
  --format=custom --compress=9 \
  -f "bridgelet-$(date +%Y%m%d-%H%M%S).dump"
```

Store the `.dump` file in a separate region from the primary database (e.g. S3 cross-region replication).

### Point-in-time restore procedure

1. **Identify the target time** — determine the exact timestamp to restore to.
2. **Provision a fresh PostgreSQL instance** at the same major version as production.
3. **Restore the most recent full backup:**
   ```bash
   pg_restore -h <new-host> -U postgres -d bridgelet_restore \
     --no-owner --no-privileges bridgelet-<timestamp>.dump
   ```
4. **Apply WAL segments** up to the target time (if using continuous archiving or cloud PITR).
5. **Verify schema integrity:** run `npm run migration:show` against the restored database.
6. **Smoke-test** by querying a known account and confirming its status is correct.
7. **Switch traffic** to the restored instance once verified.

### Managed service PITR

If running on AWS RDS, Azure Database for PostgreSQL, or Google Cloud SQL, enable the
platform's built-in PITR feature with a retention window of at least 7 days.

### RPO / RTO expectations

- **RPO:** < 5 minutes with WAL archiving enabled.
- **RTO:** < 1 hour for datasets up to ~10 GB; test your actual restore time during a maintenance window and record the measured result here.
