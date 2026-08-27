import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractEventIdentityIndex1718100010000
  implements MigrationInterface
{
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