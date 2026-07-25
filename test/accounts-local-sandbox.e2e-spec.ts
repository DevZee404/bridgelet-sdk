import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { mkdtemp, rm } from 'fs/promises';
import EmbeddedPostgres from 'embedded-postgres';
import * as StellarSdk from '@stellar/stellar-sdk';

import { AppModule } from '../src/app.module.js';
import { AccountsService } from '../src/modules/accounts/accounts.service.js';
import { Account } from '../src/modules/accounts/entities/account.entity.js';
import { AccountStatus } from '../src/modules/accounts/enums/account-status.enum.js';
import { StellarService } from '../src/modules/stellar/stellar.service.js';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service.js';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service.js';
import { PaymentMonitorService } from '../src/modules/payment-monitor/payment-monitor.service.js';

const LOCAL_SANDBOX_ENABLED =
  process.env.STELLAR_LOCAL_SANDBOX === 'true' ||
  process.env.LOCAL_STELLAR_SANDBOX === 'true';

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Port not allocated'));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

(LOCAL_SANDBOX_ENABLED ? describe : describe.skip)(
  'Local Stellar sandbox + bridgelet-core contract integration',
  () => {
    let app: INestApplication | null = null;
    let ds: DataSource | null = null;
    let accountsService: AccountsService | null = null;
    let pg: EmbeddedPostgres | null = null;
    let pgDataDir: string | null = null;

    const requiredEnv = [
      'STELLAR_HORIZON_URL',
      'STELLAR_SOROBAN_RPC_URL',
      'EPHEMERAL_ACCOUNT_CONTRACT_ID',
      'SWEEP_CONTROLLER_CONTRACT_ID',
      'FUNDING_ACCOUNT_SECRET',
      'RECOVERY_ACCOUNT_PUBLIC',
      'SWEEP_SIGNING_KEY_SEED',
      'JWT_SECRET',
    ];

    beforeAll(async () => {
      process.env.JWT_SECRET =
        process.env.JWT_SECRET || 'local-sandbox-jwt-secret';
      process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
      const missing = requiredEnv.filter((key) => !process.env[key]);
      if (missing.length > 0) {
        throw new Error(
          `Local sandbox integration test requires env vars: ${missing.join(', ')}`,
        );
      }

      const port = await getFreePort();
      pgDataDir = await mkdtemp(path.join(os.tmpdir(), 'bridgelet-sandbox-'));
      pg = new EmbeddedPostgres({
        databaseDir: pgDataDir,
        port,
        user: 'postgres',
        password: 'postgres',
        persistent: false,
        onLog: () => undefined,
        onError: () => undefined,
      });

      await pg.initialise();
      await pg.start();
      await pg.createDatabase('bridgelet_sandbox_test');

      process.env.DATABASE_HOST = '127.0.0.1';
      process.env.DATABASE_PORT = String(port);
      process.env.DATABASE_USER = 'postgres';
      process.env.DATABASE_PASSWORD = 'postgres';
      process.env.DATABASE_NAME = 'bridgelet_sandbox_test';
      process.env.NODE_ENV = 'test';
      process.env.KMS_ENABLED = 'false';
      process.env.API_RATE_LIMIT = '1000';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(WebhooksService)
        .useValue({ triggerEvent: jest.fn().mockResolvedValue(undefined) })
        .overrideProvider(SchedulerService)
        .useValue({ handleCron: jest.fn(), handleExpiredClaims: jest.fn() })
        .overrideProvider(PaymentMonitorService)
        .useValue({
          start: jest.fn(),
          stop: jest.fn(),
          pollAllAccounts: jest.fn(),
        })
        .compile();

      app = moduleFixture.createNestApplication();
      await app.init();
      ds = app.get(DataSource);
      accountsService = app.get(AccountsService);
    }, 180_000);

    afterAll(async () => {
      if (app) {
        await app.close();
        app = null;
      }
      if (pg) {
        await pg.stop();
        pg = null;
      }
      if (pgDataDir) {
        await rm(pgDataDir, { recursive: true, force: true });
        pgDataDir = null;
      }
    });

    beforeEach(async () => {
      if (!ds) {
        throw new Error('Data source is not initialized');
      }
      await ds.getRepository(Account).createQueryBuilder().delete().execute();
    });

    it('creates an ephemeral account and verifies on-chain contract initialization', async () => {
      if (!accountsService) {
        throw new Error('AccountsService is not initialized');
      }

      const fundingKeypair = StellarSdk.Keypair.fromSecret(
        process.env.FUNDING_ACCOUNT_SECRET!,
      );

      const result = await accountsService.create({
        fundingSource: fundingKeypair.publicKey(),
        recovery_address: process.env.RECOVERY_ACCOUNT_PUBLIC!,
        amount: '100',
        asset_code: 'native',
        expiresIn: 3600,
      });

      expect(result.accountId).toBeTruthy();
      expect(result.txHash).toBeTruthy();
      expect(result.status).toBe(AccountStatus.PENDING_PAYMENT);
      expect(result.contractId).toBeUndefined();

      const account = await ds!.getRepository(Account).findOneByOrFail({
        id: result.accountId,
      });

      expect(account.contractId).toBe(
        process.env.EPHEMERAL_ACCOUNT_CONTRACT_ID,
      );
      expect(account.status).toBe(AccountStatus.PENDING_PAYMENT);
      expect(account.publicKey).toHaveLength(56);

      const stellarService = app!.get(StellarService);
      const info = await stellarService.getAccountInfo(account.contractId!);

      expect(info.recovery_address).toBe(process.env.RECOVERY_ACCOUNT_PUBLIC);
      expect(typeof info.expiry_ledger).toBe('number');
      expect(info.payment_received).toBe(false);
      expect(typeof info.payment_count).toBe('number');
    });
  },
);
