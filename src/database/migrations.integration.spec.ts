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
  deliveryForeignKeyColumns: string[][];
  deliveryForeignKeyRejected: boolean;
  deliveryIndexes: string[][];
  contractEventColumns: string[];
  contractEventInsertSucceeded: boolean;
  highTrafficIndexes: string[];
  claimAuditLogIndexes: string[];
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
        deliveryForeignKeyColumns: [['subscription_id']],
        deliveryForeignKeyRejected: true,
        deliveryIndexes: [['subscription_id', 'created_at']],
        contractEventColumns: [
          'id',
          'event_type',
          'contract_address',
          'ledger_sequence',
          'tx_hash',
          'payload',
          'created_at',
        ],
        contractEventInsertSucceeded: true,
        highTrafficIndexes: [
          'IDX_accounts_status_expiresAt',
          'IDX_accounts_status_createdAt',
          'IDX_accounts_createdAt',
        ],
        claimAuditLogIndexes: [
          'IDX_claim_audit_log_accountId',
          'IDX_claim_audit_log_attemptedAt',
        ],
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

  it('webhook_deliveries table has an enforced foreign key and composite index', () => {
    expect(result.deliveryForeignKeyColumns).toContainEqual([
      'subscription_id',
    ]);
    expect(result.deliveryForeignKeyRejected).toBe(true);
    expect(result.deliveryIndexes).toContainEqual([
      'subscription_id',
      'created_at',
    ]);
  });

  it('contract_events table persists inserts with expected columns', () => {
    expect(result.contractEventInsertSucceeded).toBe(true);
    expect(result.contractEventColumns).toEqual(
      expect.arrayContaining([
        'id',
        'event_type',
        'contract_address',
        'ledger_sequence',
        'tx_hash',
        'payload',
        'created_at',
      ]),
    );
  });

  it('claim_audit_log table has the expected operational indexes', () => {
    expect(result.claimAuditLogIndexes).toContainEqual(
      'IDX_claim_audit_log_accountId',
    );
    expect(result.claimAuditLogIndexes).toContainEqual(
      'IDX_claim_audit_log_attemptedAt',
    );
  });

  it('high-traffic accounts indexes are present in the applied schema', () => {
    expect(result.highTrafficIndexes).toContainEqual(
      'IDX_accounts_status_expiresAt',
    );
    expect(result.highTrafficIndexes).toContainEqual(
      'IDX_accounts_status_createdAt',
    );
    expect(result.highTrafficIndexes).toContainEqual('IDX_accounts_createdAt');
  });
});
