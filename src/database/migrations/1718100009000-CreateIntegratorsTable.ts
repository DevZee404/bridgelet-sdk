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
