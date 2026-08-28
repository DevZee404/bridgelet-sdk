#!/usr/bin/env bash
#
# generate-migrations.sh
# ------------------------
# Recreates src/database/migrations/ from scratch.
#
# This is the scripted, reproducible replacement for the migration files
# that were previously created by hand. Run it any time the migrations
# folder needs to be rebuilt (e.g. after a fresh clone problem, or to
# confirm the folder on disk matches what this script produces).
#
# What it does:
#   1. Refuses to run outside a git repo / outside the expected project
#      (safety check so it can never be run against the wrong directory).
#   2. Removes the existing src/database/migrations/ directory.
#   3. Recreates it and writes out each migration file verbatim.
#
# Usage:
#   ./scripts/generate-migrations.sh          # prompts before deleting
#   ./scripts/generate-migrations.sh --yes    # skip the confirmation prompt
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/src/database/migrations"

if [ ! -f "$REPO_ROOT/package.json" ] || ! grep -q '"bridgelet-sdk"' "$REPO_ROOT/package.json"; then
  echo "error: this does not look like the bridgelet-sdk repo root ($REPO_ROOT)." >&2
  echo "       aborting so nothing gets deleted in the wrong place." >&2
  exit 1
fi

AUTO_YES=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=true ;;
  esac
done

if [ -d "$MIGRATIONS_DIR" ] && [ "$AUTO_YES" != true ]; then
  read -r -p "This will delete and recreate $MIGRATIONS_DIR. Continue? [y/N] " reply
  case "$reply" in
    [yY][eE][sS]|[yY]) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo "Removing $MIGRATIONS_DIR ..."
rm -rf "$MIGRATIONS_DIR"
mkdir -p "$MIGRATIONS_DIR"

echo "Writing migrations ..."

cat > "$MIGRATIONS_DIR/1718100000000-CreateAccountsTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountsTable1718100000000 implements MigrationInterface {
  name = 'CreateAccountsTable1718100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."account_status_enum" AS ENUM(
        'pending_payment',
        'pending_claim',
        'claimed',
        'expired',
        'failed'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id"                  uuid                            NOT NULL DEFAULT gen_random_uuid(),
        "publicKey"           character varying(56)           NOT NULL,
        "secretKeyEncrypted"  text                            NOT NULL,
        "fundingSource"       character varying(56)           NOT NULL,
        "amount"              numeric(18,7)                   NOT NULL,
        "asset"               character varying(100)          NOT NULL,
        "status"              "public"."account_status_enum"  NOT NULL DEFAULT 'pending_payment',
        "claimTokenHash"      character varying(64),
        "destinationAddress"  character varying(56),
        "expiresAt"           TIMESTAMP                       NOT NULL,
        "createdAt"           TIMESTAMP                       NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP                       NOT NULL DEFAULT now(),
        "claimedAt"           TIMESTAMP,
        "expiredAt"           TIMESTAMP,
        "metadata"            jsonb,
        CONSTRAINT "UQ_accounts_publicKey" UNIQUE ("publicKey"),
        CONSTRAINT "PK_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_accounts_publicKey"      ON "accounts" ("publicKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_accounts_status"         ON "accounts" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_accounts_claimTokenHash" ON "accounts" ("claimTokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_accounts_expiresAt"      ON "accounts" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_accounts_expiresAt"`);
    await queryRunner.query(`DROP INDEX "IDX_accounts_claimTokenHash"`);
    await queryRunner.query(`DROP INDEX "IDX_accounts_status"`);
    await queryRunner.query(`DROP INDEX "IDX_accounts_publicKey"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP TYPE "public"."account_status_enum"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100001000-CreateClaimsTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClaimsTable1718100001000 implements MigrationInterface {
  name = 'CreateClaimsTable1718100001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "claims" (
        "id"                 uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "accountId"          uuid                   NOT NULL,
        "destinationAddress" character varying(56)  NOT NULL,
        "sweepTxHash"        character varying(64)  NOT NULL,
        "amountSwept"        character varying(100) NOT NULL,
        "asset"              character varying(100) NOT NULL,
        "claimedAt"          TIMESTAMP              NOT NULL,
        "createdAt"          TIMESTAMP              NOT NULL DEFAULT now(),
        "updatedAt"          TIMESTAMP              NOT NULL DEFAULT now(),
        CONSTRAINT "PK_claims" PRIMARY KEY ("id"),
        CONSTRAINT "FK_claims_accountId"
          FOREIGN KEY ("accountId")
          REFERENCES "accounts"("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_claims_accountId" ON "claims" ("accountId")`,
    );
    await queryRunner.query(`
      COMMENT ON COLUMN "claims"."sweepTxHash" IS
      'Stellar transaction hash of the sweep. Always a 64-character hex string — never a placeholder value. Enforced by TransactionHashValidator before record creation.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_claims_accountId"`);
    await queryRunner.query(`DROP TABLE "claims"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100002000-AddInitializingToAccountStatus.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInitializingToAccountStatus1718100002000 implements MigrationInterface {
  name = 'AddInitializingToAccountStatus1718100002000';

  // ALTER TYPE ADD VALUE cannot run inside a transaction on some PostgreSQL
  // versions -- setting transaction = false keeps this migration safe.
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."account_status_enum"
        ADD VALUE 'initializing' BEFORE 'pending_payment'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL has no DROP VALUE -- must recreate the enum type.
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" TYPE text USING "status"::text`,
    );
    await queryRunner.query(`DROP TYPE "public"."account_status_enum"`);
    await queryRunner.query(`
      CREATE TYPE "public"."account_status_enum" AS ENUM(
        'pending_payment',
        'pending_claim',
        'claimed',
        'expired',
        'failed'
      )
    `);
    // Remap any rows that were in INITIALIZING back to PENDING_PAYMENT.
    await queryRunner.query(
      `UPDATE "accounts" SET "status" = 'pending_payment' WHERE "status" = 'initializing'`,
    );
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ALTER COLUMN "status" TYPE "public"."account_status_enum"
        USING "status"::"public"."account_status_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" SET DEFAULT 'pending_payment'`,
    );
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100003000-CreateWebhooksTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhooksTable1718100003000 implements MigrationInterface {
  name = 'CreateWebhooksTable1718100003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhooks" (
        "id"               uuid                    NOT NULL DEFAULT gen_random_uuid(),
        "url"              character varying(2048)  NOT NULL,
        "secret"           character varying(256),
        "events"           jsonb                   NOT NULL DEFAULT '[]',
        "isActive"         boolean                 NOT NULL DEFAULT true,
        "description"      character varying(255),
        "lastTriggeredAt"  TIMESTAMP,
        "createdAt"        TIMESTAMP               NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP               NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhooks" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_webhooks_isActive" ON "webhooks" ("isActive")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_webhooks_isActive"`);
    await queryRunner.query(`DROP TABLE "webhooks"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100004000-AddClaimingToAccountStatus.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaimingToAccountStatus1718100004000 implements MigrationInterface {
  name = 'AddClaimingToAccountStatus1718100004000';

  // ALTER TYPE ADD VALUE cannot run inside a transaction on some PostgreSQL
  // versions -- setting transaction = false keeps this migration safe.
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."account_status_enum"
        ADD VALUE 'claiming' AFTER 'pending_claim'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL has no DROP VALUE -- must recreate the enum type.
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" TYPE text USING "status"::text`,
    );
    await queryRunner.query(`DROP TYPE "public"."account_status_enum"`);
    await queryRunner.query(`
      CREATE TYPE "public"."account_status_enum" AS ENUM(
        'initializing',
        'pending_payment',
        'pending_claim',
        'claimed',
        'expired',
        'failed'
      )
    `);
    await queryRunner.query(
      `UPDATE "accounts" SET "status" = 'pending_claim' WHERE "status" = 'claiming'`,
    );
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ALTER COLUMN "status" TYPE "public"."account_status_enum"
        USING "status"::"public"."account_status_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" SET DEFAULT 'pending_payment'`,
    );
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100005000-CreateWebhookDeliveriesTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookDeliveriesTable1718100005000 implements MigrationInterface {
  name = 'CreateWebhookDeliveriesTable1718100005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id"                  uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "subscription_id"     uuid                   NOT NULL,
        "event_type"          character varying(255) NOT NULL,
        "payload_hash"        character varying(128) NOT NULL,
        "attempt_count"       integer                NOT NULL DEFAULT 1,
        "last_response_code"  integer,
        "last_response_body"  character varying(2048),
        "delivered_at"        TIMESTAMP,
        "created_at"          TIMESTAMP              NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_webhook_deliveries_subscription_id"
          FOREIGN KEY ("subscription_id")
          REFERENCES "webhooks"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_deliveries_subscription_id_created_at"
      ON "webhook_deliveries" ("subscription_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_webhook_deliveries_subscription_id_created_at"
    `);
    await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100006000-AddHighTrafficIndexes.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddHighTrafficIndexes1718100006000
 *
 * Background — Query Audit
 * ────────────────────────
 * EXPLAIN ANALYZE patterns reviewed:
 *
 * 1. Expiry scheduler (SchedulerService.runExpiryJob):
 *      WHERE status IN ('pending_payment','pending_claim')
 *        AND "expiresAt" < NOW()
 *    Existing separate indexes on status and expiresAt allow
 *    index-only scans per column, but a composite index lets
 *    PostgreSQL satisfy both predicates in a single index scan,
 *    which eliminates the bitmap heap AND step on large tables.
 *
 * 2. INITIALIZING cleanup (SchedulerService.runInitializingCleanup):
 *      WHERE status = 'initializing'
 *        AND "createdAt" < <cutoff>
 *    No composite index existed. Without it, PostgreSQL fetches
 *    all INITIALIZING rows and then filters by createdAt, which
 *    degrades as the table grows.
 *
 * 3. Status-filtered API list (AccountsService.findAll):
 *      WHERE status = :status
 *    The single-column IDX_accounts_status already covers this
 *    efficiently; no additional index is required.
 *
 * 4. FK lookup (claims JOIN accounts):
 *      WHERE "accountId" = :id
 *    IDX_claims_accountId already exists from CreateClaimsTable.
 *    No additional index is required.
 *
 * Index decisions
 * ───────────────
 * • IDX_accounts_status_expiresAt  (composite, status first)
 *   – Chosen column order: status has lower cardinality (enum with
 *     7 values) so it prunes the row set first, and then expiresAt
 *     (timestamp) finishes the job. PostgreSQL can also use this
 *     index for status-only queries as a left-prefix scan.
 *
 * • IDX_accounts_status_createdAt  (composite, status first)
 *   – Same rationale. Covers the INITIALIZING cleanup query exactly.
 *
 * • IDX_accounts_createdAt  (single-column)
 *   – Retained as a standalone index to support future range scans
 *     on createdAt independent of status (e.g., audit queries,
 *     time-boxed reporting). Its overhead (~20 % larger write cost
 *     on accounts) is acceptable given the low insert rate.
 *
 * All indexes use the default B-tree access method which PostgreSQL
 * can use for equality, range (<, >), and ORDER BY optimisation.
 */
export class AddHighTrafficIndexes1718100006000 implements MigrationInterface {
  name = 'AddHighTrafficIndexes1718100006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index: expiry-scheduler query
    //   WHERE status IN (...) AND "expiresAt" < NOW()
    await queryRunner.query(`
      CREATE INDEX "IDX_accounts_status_expiresAt"
        ON "accounts" ("status", "expiresAt")
    `);

    // Composite index: INITIALIZING cleanup query
    //   WHERE status = 'initializing' AND "createdAt" < <cutoff>
    await queryRunner.query(`
      CREATE INDEX "IDX_accounts_status_createdAt"
        ON "accounts" ("status", "createdAt")
    `);

    // Single-column index: createdAt range scans (audit / reporting)
    await queryRunner.query(`
      CREATE INDEX "IDX_accounts_createdAt"
        ON "accounts" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_accounts_status_expiresAt"`);
    await queryRunner.query(`DROP INDEX "IDX_accounts_status_createdAt"`);
    await queryRunner.query(`DROP INDEX "IDX_accounts_createdAt"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100007000-CreateContractEventsTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContractEventsTable1718100007000 implements MigrationInterface {
  name = 'CreateContractEventsTable1718100007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "contract_events" (
        "id"                uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "event_type"        character varying(255) NOT NULL,
        "contract_address"  character varying(128) NOT NULL,
        "ledger_sequence"   bigint                 NOT NULL,
        "tx_hash"           character varying(64)  NOT NULL,
        "payload"           jsonb                  NOT NULL DEFAULT '{}'::jsonb,
        "created_at"        TIMESTAMP              NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contract_events" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "contract_events"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100008000-AddDeletedAtToAccountsTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedAtToAccountsTable1718100008000 implements MigrationInterface {
  name = 'AddDeletedAtToAccountsTable1718100008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD COLUMN "deletedAt" timestamp NULL
    `);

    // Index to keep soft-delete filtering fast on high-traffic queries,
    // mirroring the style of 1718100006000-AddHighTrafficIndexes.
    await queryRunner.query(`
      CREATE INDEX "IDX_accounts_deletedAt" ON "accounts" ("deletedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_accounts_deletedAt"
    `);

    await queryRunner.query(`
      ALTER TABLE "accounts"
        DROP COLUMN "deletedAt"
    `);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100008000-AddPartialSweepToAccountStatus.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPartialSweepToAccountStatus1718100008000 implements MigrationInterface {
  name = 'AddPartialSweepToAccountStatus1718100008000';

  // ALTER TYPE ADD VALUE cannot run inside a transaction on some PostgreSQL
  // versions -- setting transaction = false keeps this migration safe.
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."account_status_enum"
        ADD VALUE 'partial_sweep' AFTER 'claiming'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL has no DROP VALUE -- must recreate the enum type.
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" TYPE text USING "status"::text`,
    );
    await queryRunner.query(`DROP TYPE "public"."account_status_enum"`);
    await queryRunner.query(`
      CREATE TYPE "public"."account_status_enum" AS ENUM(
        'initializing',
        'pending_payment',
        'pending_claim',
        'claiming',
        'claimed',
        'expired',
        'failed'
      )
    `);
    await queryRunner.query(
      `UPDATE "accounts" SET "status" = 'claiming' WHERE "status" = 'partial_sweep'`,
    );
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ALTER COLUMN "status" TYPE "public"."account_status_enum"
        USING "status"::"public"."account_status_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "accounts" ALTER COLUMN "status" SET DEFAULT 'pending_payment'`,
    );
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100008000-CreateClaimAuditLogTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClaimAuditLogTable1718100008000 implements MigrationInterface {
  name = 'CreateClaimAuditLogTable1718100008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "claim_audit_log" (
        "id"              uuid                   NOT NULL DEFAULT gen_random_uuid(),
        "accountId"       uuid                   NOT NULL,
        "destinationHash" character varying(64)  NOT NULL,
        "ipHash"          character varying(64),
        "outcome"         character varying(10)  NOT NULL,
        "failureReason"   text,
        "attemptedAt"     TIMESTAMP              NOT NULL DEFAULT now(),
        CONSTRAINT "PK_claim_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_claim_audit_log_accountId" ON "claim_audit_log" ("accountId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_claim_audit_log_attemptedAt" ON "claim_audit_log" ("attemptedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_claim_audit_log_attemptedAt"`);
    await queryRunner.query(`DROP INDEX "IDX_claim_audit_log_accountId"`);
    await queryRunner.query(`DROP TABLE "claim_audit_log"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100008000-AddContractEventIdentity.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractEventIdentity1718100008000 implements MigrationInterface {
  name = 'AddContractEventIdentity1718100008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_contract_events_identity"
        ON "contract_events" ("event_type", "contract_address", "tx_hash")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_contract_events_identity"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100009000-CreateIntegratorsTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIntegratorsTable1718100009000 implements MigrationInterface {
  name = 'CreateIntegratorsTable1718100009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integrators" (
        "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
        "name"        text        NOT NULL,
        "apiKeyHash"  text        NOT NULL,
        "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "disabledAt"  TIMESTAMPTZ,
        CONSTRAINT "UQ_integrators_apiKeyHash" UNIQUE ("apiKeyHash"),
        CONSTRAINT "PK_integrators" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_integrators_apiKeyHash" ON "integrators" ("apiKeyHash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_integrators_apiKeyHash"`);
    await queryRunner.query(`DROP TABLE "integrators"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100008500-AddIntegratorIdToAccountsTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add integrator ownership to accounts.
 *
 * Each ephemeral account is created by an integrator (authenticated via
 * X-API-Key). Stamping `integratorId` on every account is the first step in
 * enforcing per-integrator data isolation (see issue #468) and lets the
 * accounts controller deny lookups from a different integrator without
 * leaking whether an account exists.
 *
 * The column is nullable so migration time and pre-existing rows (created
 * before this column existed) remain valid; they simply belong to no
 * integrator and are only reachable by the list/all path.
 */
export class AddIntegratorIdToAccountsTable1718100008500 implements MigrationInterface {
  name = 'AddIntegratorIdToAccountsTable1718100008500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD COLUMN "integratorId" uuid NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_accounts_integratorId" ON "accounts" ("integratorId")
    `);

    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD CONSTRAINT "FK_accounts_integratorId"
        FOREIGN KEY ("integratorId")
        REFERENCES "integrators"("id")
        ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "accounts" DROP CONSTRAINT "FK_accounts_integratorId"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_accounts_integratorId"
    `);

    await queryRunner.query(`
      ALTER TABLE "accounts" DROP COLUMN "integratorId"
    `);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100010000-AddContractEventIdentityIndex.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractEventIdentityIndex1718100010000 implements MigrationInterface {
  name = 'AddContractEventIdentityIndex1718100010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_contract_events_identity"
      ON "contract_events" ("event_type", "contract_address", "tx_hash")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_contract_events_identity"`);
  }
}
MIGRATION_EOF

cat > "$MIGRATIONS_DIR/1718100010000-AddRoleToIntegratorsTable.ts" <<'MIGRATION_EOF'
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleToIntegratorsTable1718100010000 implements MigrationInterface {
  name = 'AddRoleToIntegratorsTable1718100010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrators"
      ADD COLUMN "role" text NOT NULL DEFAULT 'integrator'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrators" DROP COLUMN "role"`);
  }
}
MIGRATION_EOF

echo "Done. Wrote $(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.ts' | wc -l) migration files to $MIGRATIONS_DIR."
echo "Run 'npm run migration:run' to apply them, or 'npm run migration:show' to check status."