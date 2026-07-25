import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Application } from 'express';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import { mkdtemp, rm } from 'fs/promises';
import EmbeddedPostgres from 'embedded-postgres';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as StellarSdk from '@stellar/stellar-sdk';

import { AppModule } from '../src/app.module.js';
import { Account } from '../src/modules/accounts/entities/account.entity.js';
import { AccountStatus } from '../src/modules/accounts/enums/account-status.enum.js';
import { IntegratorsService } from '../src/modules/integrators/integrators.service.js';
import { StellarService } from '../src/modules/stellar/stellar.service.js';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service.js';
import { SchedulerService } from '../src/modules/scheduler/scheduler.service.js';
import { PaymentMonitorService } from '../src/modules/payment-monitor/payment-monitor.service.js';

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
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe('Accounts concurrency load (e2e)', () => {
  let app: INestApplication | null = null;
  let ds: DataSource | null = null;
  const authKeys: string[] = [];
  let pg: EmbeddedPostgres | null = null;
  let pgDataDir: string | null = null;

  const getHttpServer = (): Application => {
    if (!app) throw new Error('App is not initialized');
    return app.getHttpServer() as Application;
  };

  beforeAll(async () => {
    const port = await getFreePort();
    pgDataDir = await mkdtemp(path.join(os.tmpdir(), 'bridgelet-e2e-'));
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
    await pg.createDatabase('bridgelet_accounts_concurrency_test');

    process.env.DATABASE_HOST = '127.0.0.1';
    process.env.DATABASE_PORT = String(port);
    process.env.DATABASE_USER = 'postgres';
    process.env.DATABASE_PASSWORD = 'postgres';
    process.env.DATABASE_NAME = 'bridgelet_accounts_concurrency_test';
    process.env.JWT_SECRET = 'e2e-jwt-secret';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
    process.env.STELLAR_SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.FUNDING_ACCOUNT_SECRET =
      'SC6I4SO5DXZWCOTMQ4IZZXLSJ2QTLU5HTMH4F6G3R7GOWT2RXCQJDXGZ';
    process.env.RECOVERY_ACCOUNT_PUBLIC =
      'GBMOCKRECOVERYACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    process.env.EPHEMERAL_ACCOUNT_CONTRACT_ID =
      'CONTRACT_EPHEMERAL_ACCOUNT_000000000000000000000000';
    process.env.SWEEP_CONTROLLER_CONTRACT_ID =
      'CONTRACT_SWEEP_CONTROLLER_0000000000000000000000';
    process.env.CORS_ORIGINS = '*';
    process.env.NODE_ENV = 'test';
    process.env.API_RATE_LIMIT = '1000';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StellarService)
      .useValue({
        generateKeypair: jest.fn(() => StellarSdk.Keypair.random()),
        createEphemeralAccount: jest.fn(() => `txhash-${randomUUID()}`),
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

    const integratorsService = app.get(IntegratorsService);
    for (let i = 1; i <= 50; i += 1) {
      const { rawApiKey } = await integratorsService.create(`loadtest-${i}`);
      authKeys.push(rawApiKey);
    }
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
    if (!ds) throw new Error('Data source not initialized');
    await ds.getRepository(Account).createQueryBuilder().delete().execute();
  });

  it('handles 50 concurrent POST /accounts requests without failure', async () => {
    if (!app) throw new Error('Application not initialized');

    const results = await Promise.all(
      authKeys.map(
        async (
          apiKey,
        ): Promise<{
          durationMs: number;
          status: number;
          body: unknown;
        }> => {
          const res = await request(getHttpServer())
            .post('/accounts')
            .set('X-API-Key', apiKey)
            .send({
              fundingSource:
                'GBMOCKFUNDINGACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
              recovery_address:
                'GBMOCKRECOVERYACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
              amount: '100',
              asset_code: 'native',
              expiresIn: 3600,
              metadata: { loadTest: true },
            })
            .timeout({ response: 15000, deadline: 20000 });
          return {
            durationMs: Date.now() - start,
            status: res.status,
            body: res.body,
          };
        },
      ),
    );

    const failures = results.filter((result) => result.status !== 201);
    expect(failures).toHaveLength(0);

    const sorted = results
      .map((result) => result.durationMs)
      .sort((a, b) => a - b);
    const p99Index = Math.max(0, Math.ceil(0.99 * sorted.length) - 1);
    const p99 = sorted[p99Index];

    expect(p99).toBeLessThan(10000);
    expect(sorted[sorted.length - 1]).toBeLessThan(15000);

    const accounts = await ds!.getRepository(Account).find();
    expect(accounts).toHaveLength(50);
    expect(
      accounts.every(
        (account) => account.status === AccountStatus.PENDING_PAYMENT,
      ),
    ).toBe(true);
    expect(new Set(accounts.map((account) => account.publicKey)).size).toBe(50);
  });
});
