import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller.js';

/** Shared factory: creates a NestJS test module with a mocked DataSource. */
async function buildModule(
  dataSourceMock: Partial<DataSource>,
): Promise<TestingModule> {
  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'stellar.horizonUrl')
        return 'https://horizon-testnet.stellar.org';
      return undefined;
    }),
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (key === 'stellar.horizonUrl')
        return 'https://horizon-testnet.stellar.org';
      throw new Error(`Missing config: ${key}`);
    }),
  };

  return Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      {
        provide: getDataSourceToken(),
        useValue: dataSourceMock,
      },
      {
        provide: ConfigService,
        useValue: mockConfigService,
      },
    ],
  }).compile();
}

describe('HealthController', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Happy-path: database responds quickly
  // ──────────────────────────────────────────────────────────────────────────
  describe('when the database pool is healthy', () => {
    let controller: HealthController;

    beforeEach(async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const module = await buildModule({
        query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      });
      controller = module.get(HealthController);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns status "ok"', async () => {
      const result = await controller.check();
      expect(result.status).toBe('ok');
    });

    it('marks database as healthy', async () => {
      const result = await controller.check();
      const { healthy, poolExhausted } = result.services.database;
      expect(healthy).toBe(true);
      expect(poolExhausted).toBe(false);
    });

    it('includes an ISO timestamp', async () => {
      const result = await controller.check();
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reports horizon and soroban as ok', async () => {
      const result = await controller.check();
      expect(result.services.horizon).toEqual({
        healthy: true,
        url: 'https://horizon-testnet.stellar.org',
      });
      expect(result.services.soroban).toBe('ok');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Degraded path: pool acquire timeout (all connections exhausted)
  // ──────────────────────────────────────────────────────────────────────────
  describe('when the connection pool is exhausted (acquire timeout)', () => {
    let controller: HealthController;

    beforeEach(async () => {
      jest.useFakeTimers();

      const module = await buildModule({
        query: jest.fn().mockImplementation(
          () =>
            new Promise<never>(() => {
              /* intentionally never resolves */
            }),
        ),
      });
      controller = module.get(HealthController);

      // Mock fetch to resolve immediately so the Horizon check doesn't interfere with fake timers
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('returns status "degraded"', async () => {
      const promise = controller.check();
      jest.runAllTimers();
      const result = await promise;
      expect(result.status).toBe('degraded');
    });

    it('marks database as unhealthy with poolExhausted=true', async () => {
      const promise = controller.check();
      jest.runAllTimers();
      const result = await promise;
      const { healthy, poolExhausted, error } = result.services.database;
      expect(healthy).toBe(false);
      expect(poolExhausted).toBe(true);
      expect(error).toContain('exhausted');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Degraded path: generic database error (connection refused, etc.)
  // ──────────────────────────────────────────────────────────────────────────
  describe('when the database throws a generic error', () => {
    let controller: HealthController;

    beforeEach(async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      const module = await buildModule({
        query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      });
      controller = module.get(HealthController);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns status "degraded"', async () => {
      const result = await controller.check();
      expect(result.status).toBe('degraded');
    });

    it('marks database as unhealthy but NOT pool-exhausted', async () => {
      const result = await controller.check();
      const { healthy, poolExhausted, error } = result.services.database;
      expect(healthy).toBe(false);
      expect(poolExhausted).toBe(false);
      expect(error).toContain('ECONNREFUSED');
    });
  });
});
