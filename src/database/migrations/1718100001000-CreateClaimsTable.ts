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
