import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountLatencyMetricsProvider } from './account-latency-metrics.provider.js';

describe('AccountLatencyMetricsProvider', () => {
  let provider: AccountLatencyMetricsProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountLatencyMetricsProvider],
    }).compile();
    provider = module.get<AccountLatencyMetricsProvider>(
      AccountLatencyMetricsProvider,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  // ── basic recording ─────────────────────────────────────────────────────────

  describe('record()', () => {
    it('increments getTotalCount()', () => {
      provider.record(200, true);
      provider.record(300, false);
      expect(provider.getTotalCount()).toBe(2);
    });

    it('counts only successful samples in getSuccessCount()', () => {
      provider.record(100, true);
      provider.record(200, false);
      provider.record(150, true);
      expect(provider.getSuccessCount()).toBe(2);
    });

    it('increments histogram buckets for samples within their bound', () => {
      provider.record(100, true); // ≤ 100ms bucket
      provider.record(300, true); // ≤ 500ms bucket (not ≤100)
      const buckets = provider.getBuckets();
      const b100 = buckets.find((b) => b.upperBoundMs === 100)!;
      const b500 = buckets.find((b) => b.upperBoundMs === 500)!;
      expect(b100.count).toBe(1);
      expect(b500.count).toBe(2); // cumulative
    });
  });

  // ── percentiles ─────────────────────────────────────────────────────────────

  describe('percentile calculations', () => {
    it('returns 0 when no samples recorded', () => {
      expect(provider.getP99Ms()).toBe(0);
      expect(provider.getP95Ms()).toBe(0);
      expect(provider.getP50Ms()).toBe(0);
    });

    it('getP50Ms() returns median', () => {
      [100, 200, 300, 400, 500].forEach((d) => provider.record(d, true));
      expect(provider.getP50Ms()).toBe(300);
    });

    it('getP99Ms() returns near-max for many uniform samples', () => {
      Array.from({ length: 100 }, (_, i) => provider.record(i + 1, true));
      expect(provider.getP99Ms()).toBe(99);
    });

    it('getP95Ms() returns 95th percentile', () => {
      Array.from({ length: 100 }, (_, i) => provider.record(i + 1, true));
      expect(provider.getP95Ms()).toBe(95);
    });
  });

  // ── alert ───────────────────────────────────────────────────────────────────

  describe('p99 alert', () => {
    it('emits warn log when p99 exceeds 5000ms', () => {
      const warnSpy = jest
        .spyOn(provider['logger'], 'warn')
        .mockImplementation(() => {});

      // Drive p99 above threshold: many slow samples
      Array.from({ length: 100 }, () => provider.record(6_000, true));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ALERT'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('5000ms'));
    });

    it('does not emit warn when p99 is within threshold', () => {
      const warnSpy = jest
        .spyOn(provider['logger'], 'warn')
        .mockImplementation(() => {});

      provider.record(100, true);
      provider.record(200, true);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ── buckets ─────────────────────────────────────────────────────────────────

  describe('getBuckets()', () => {
    it('returns all default bucket boundaries', () => {
      const bounds = provider.getBuckets().map((b) => b.upperBoundMs);
      expect(bounds).toContain(50);
      expect(bounds).toContain(5_000);
      expect(bounds).toContain(10_000);
    });

    it('all counts are 0 before any recording', () => {
      const allZero = provider.getBuckets().every((b) => b.count === 0);
      expect(allZero).toBe(true);
    });
  });
});
