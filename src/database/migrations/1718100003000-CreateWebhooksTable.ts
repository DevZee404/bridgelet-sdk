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
