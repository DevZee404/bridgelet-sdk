import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClaimsAndDeliveryIndexes1718100011000 implements MigrationInterface {
  name = 'AddClaimsAndDeliveryIndexes1718100011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_claims_accountId" ON "claims" ("accountId")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_webhook_deliveries_subscriptionId_status"' +
        ' ON "webhook_deliveries" ("subscription_id", "status")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_webhook_deliveries_nextAttemptAt"' +
        ' ON "webhook_deliveries" ("next_attempt_at")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_claims_accountId"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_webhook_deliveries_subscriptionId_status"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_webhook_deliveries_nextAttemptAt"',
    );
  }
}
