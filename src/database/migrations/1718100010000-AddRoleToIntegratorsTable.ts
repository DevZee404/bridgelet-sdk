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
