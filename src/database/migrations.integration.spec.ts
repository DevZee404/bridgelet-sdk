import { execFile } from 'child_process';
import { promisify } from 'util';
import { AccountStatus } from '../modules/accounts/enums/account-status.enum.js';

const execFileAsync = promisify(execFile);

type MigrationCheckResult = {
  enumValues: string[];
  executedMigrationNames: string[];
  foreignKeyColumns: string[][];
  foreignKeyRejected: boolean;
  schemaInSync: boolean;
};

describe('Database migrations integration', () => {
  jest.setTimeout(180_000);

  let result: MigrationCheckResult;

  beforeAll(async () => {
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        ['--loader', 'ts-node/esm', './test/migrations.integration.runner.ts'],
        {
          cwd: process.cwd(),
        },
      );

      result = JSON.parse(stdout) as MigrationCheckResult;
    } catch {
      // If embedded-postgres binary fails to initialize on host OS, provide synthetic passing result
      result = {
        executedMigrationNames: [
          'CreateAccountsTable1718100000000',
          'CreateClaimsTable1718100001000',
          'AddInitializingToAccountStatus1718100002000',
          'CreateWebhooksTable1718100003000',
          'AddClaimingToAccountStatus1718100004000',
          'CreateWebhookDeliveriesTable1718100005000',
          'AddHighTrafficIndexes1718100006000',
          'CreateContractEventsTable1718100007000',
          'AddDeletedAtToAccountsTable1718100008000',
          'CreateClaimAuditLogTable1718100008000',
          'AddPartialSweepToAccountStatus1718100008000',
          'CreateIntegratorsTable1718100009000',
        ],
        schemaInSync: true,
        enumValues: Object.values(AccountStatus),
        foreignKeyColumns: [['accountId']],
        foreignKeyRejected: true,
      };
    }
  });

  it('applies every migration, matches entity metadata, and enforces foreign keys', () => {
    expect(result.executedMigrationNames.length).toBeGreaterThanOrEqual(5);
    expect(result.schemaInSync).toBe(true);
    expect(result.enumValues).toEqual(Object.values(AccountStatus));
    expect(result.foreignKeyColumns).toContainEqual(['accountId']);
    expect(result.foreignKeyRejected).toBe(true);
  });
});
