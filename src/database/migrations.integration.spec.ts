import { execFile } from 'child_process';
import { promisify } from 'util';
import { AccountStatus } from '../modules/accounts/enums/account-status.enum.js';

const execFileAsync = promisify(execFile);

type MigrationCheckResult = {
  enumValues: string[];
  executedMigrationNames: string[];
  foreignKeyColumns: string[][];
  foreignKeyRejected: boolean;
  contractEventColumns: string[];
  contractEventInsertSucceeded: boolean;
  deliveryForeignKeyColumns: string[][];
  deliveryForeignKeyRejected: boolean;
  deliveryIndexes: string[][];
  schemaInSync: boolean;
  highTrafficIndexes: string[];
  claimAuditLogIndexes: string[];
};

describe('Database migrations integration', () => {
  jest.setTimeout(180_000);

  let result: MigrationCheckResult;

  beforeAll(async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--loader', 'ts-node/esm', './test/migrations.integration.runner.ts'],
      {
        cwd: process.cwd(),
      },
    );

    result = JSON.parse(stdout) as MigrationCheckResult;
  });

  it('applies every migration, matches entity metadata, and enforces foreign keys', () => {
    expect(result.executedMigrationNames).toHaveLength(9);
    expect(result.schemaInSync).toBe(true);
    expect(result.enumValues).toEqual(Object.values(AccountStatus));
    expect(result.foreignKeyColumns).toContainEqual(['accountId']);
    expect(result.foreignKeyRejected).toBe(true);
    expect(result.contractEventColumns).toEqual([
      'id',
      'event_type',
      'contract_address',
      'ledger_sequence',
      'tx_hash',
      'payload',
      'created_at',
    ]);
    expect(result.contractEventInsertSucceeded).toBe(true);
    expect(result.deliveryForeignKeyColumns).toContainEqual([
      'subscription_id',
    ]);
    expect(result.deliveryForeignKeyRejected).toBe(true);
    expect(result.deliveryIndexes).toContainEqual([
      'subscription_id',
      'created_at',
    ]);
  });

  it('creates composite and standalone high-traffic indexes', () => {
    expect(result.highTrafficIndexes).toContain(
      'IDX_accounts_status_expiresAt',
    );
    expect(result.highTrafficIndexes).toContain(
      'IDX_accounts_status_createdAt',
    );
    expect(result.highTrafficIndexes).toContain('IDX_accounts_createdAt');
  });

  it('creates claim_audit_log table with required indexes', () => {
    expect(result.claimAuditLogIndexes).toContain(
      'IDX_claim_audit_log_accountId',
    );
    expect(result.claimAuditLogIndexes).toContain(
      'IDX_claim_audit_log_attemptedAt',
    );
  });
});
