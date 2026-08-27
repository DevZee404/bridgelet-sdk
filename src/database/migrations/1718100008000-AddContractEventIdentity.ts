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
    await queryRunner.query(
      `DROP INDEX "UQ_contract_events_identity"`,
    );
  }
}