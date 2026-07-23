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
