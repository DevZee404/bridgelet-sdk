import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import EmbeddedPostgres from 'embedded-postgres';
import { DataSource } from 'typeorm';
import { Account } from '../src/modules/accounts/entities/account.entity.js';
import { AccountStatus } from '../src/modules/accounts/enums/account-status.enum.js';
import { Claim } from '../src/modules/claims/entities/claim.entity.js';
import { Webhook } from '../src/modules/webhooks/entities/webhook.entity.js';
import { CreateAccountsTable1718100000000 } from '../src/database/migrations/1718100000000-CreateAccountsTable.js';
import { CreateClaimsTable1718100001000 } from '../src/database/migrations/1718100001000-CreateClaimsTable.js';
import { AddInitializingToAccountStatus1718100002000 } from '../src/database/migrations/1718100002000-AddInitializingToAccountStatus.js';
import { CreateWebhooksTable1718100003000 } from '../src/database/migrations/1718100003000-CreateWebhooksTable.js';
import { AddClaimingToAccountStatus1718100004000 } from '../src/database/migrations/1718100004000-AddClaimingToAccountStatus.js';

const postgresUser = 'postgres';
const postgresPassword = 'postgres';
const postgresDatabase = 'bridgelet_test';

const migrations = [
  CreateAccountsTable1718100000000,
  CreateClaimsTable1718100001000,
  AddInitializingToAccountStatus1718100002000,
  CreateWebhooksTable1718100003000,
  AddClaimingToAccountStatus1718100004000,
];

type SqlInMemoryLog = {
  upQueries: unknown[];
};

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address == null || typeof address === 'string') {
        reject(new Error('Unable to allocate a local port for migration checks.'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function main(): Promise<void> {
  const port = await getFreePort();
  const postgresDataDir = await mkdtemp(
    path.join(os.tmpdir(), 'bridgelet-migrations-'),
  );
  const postgresServer = new EmbeddedPostgres({
    databaseDir: postgresDataDir,
    port,
    user: postgresUser,
    password: postgresPassword,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });

  let dataSource: DataSource | null = null;

  try {
    await postgresServer.initialise();
    await postgresServer.start();
    await postgresServer.createDatabase(postgresDatabase);

    dataSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port,
      username: postgresUser,
      password: postgresPassword,
      database: postgresDatabase,
      entities: [Account, Claim, Webhook],
      migrations,
      migrationsTransactionMode: 'each',
      synchronize: false,
    });

    await dataSource.initialize();
    await dataSource.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    const executedMigrations = await dataSource.runMigrations();
    const schemaLog = (await (
      dataSource.driver.createSchemaBuilder() as unknown as {
        log: () => Promise<SqlInMemoryLog>;
      }
    ).log()) as SqlInMemoryLog;

    const enumRows: Array<{ enumlabel: string }> = await dataSource.query(`
      SELECT e.enumlabel
      FROM pg_type t
      INNER JOIN pg_enum e ON e.enumtypid = t.oid
      INNER JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'account_status_enum'
      ORDER BY e.enumsortorder
    `);

    const queryRunner = dataSource.createQueryRunner();
    let foreignKeyColumns: string[][] = [];
    let foreignKeyRejected = false;

    try {
      const claimsTable = await queryRunner.getTable('claims');
      foreignKeyColumns =
        claimsTable?.foreignKeys.map((foreignKey) => foreignKey.columnNames) ??
        [];
    } finally {
      await queryRunner.release();
    }

    try {
      await dataSource.query(
        `
          INSERT INTO "claims" (
            "accountId",
            "destinationAddress",
            "sweepTxHash",
            "amountSwept",
            "asset",
            "claimedAt"
          )
          VALUES ($1, $2, $3, $4, $5, NOW())
        `,
        [
          randomUUID(),
          'GBRPYHIL2C6LYK7D5QXHZJ5M5XT4QSLVQOQ43I6QJVU4YQ5N3B7V4XYZ',
          'a'.repeat(64),
          '1.0000000',
          'USDC',
        ],
      );
    } catch (error) {
      foreignKeyRejected =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23503';
    }

    process.stdout.write(
      JSON.stringify({
        enumValues: enumRows.map(({ enumlabel }) => enumlabel),
        executedMigrationNames: executedMigrations.map(({ name }) => name),
        foreignKeyColumns,
        foreignKeyRejected,
        schemaInSync: schemaLog.upQueries.length === 0,
      }),
    );
  } finally {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    await postgresServer.stop();
    await rm(postgresDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
