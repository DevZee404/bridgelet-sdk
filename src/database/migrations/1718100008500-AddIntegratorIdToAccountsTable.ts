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
