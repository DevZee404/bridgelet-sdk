import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SweepMetricsProvider } from './sweep-metrics.provider.js';

describe('SweepMetricsProvider', () => {
  let provider: SweepMetricsProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SweepMetricsProvider],
    }).compile();
    provider = module.get<SweepMetricsProvider>(SweepMetricsProvider);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── counters ────────────────────────────────────────────────────────────────

  describe('sweep_completed_total', () => {
    it('starts at 0', () => {
      expect(provider.getCompletedTotal()).toBe(0);
    });

    it('increments on each recordCompleted() call', () => {
      provider.recordCompleted();
      provider.recordCompleted();
      expect(provider.getCompletedTotal()).toBe(2);
    });

    it('is independent of recordFailed()', () => {
      provider.recordFailed();
      expect(provider.getCompletedTotal()).toBe(0);
    });
  });

  describe('sweep_failed_total', () => {
    it('starts at 0', () => {
      expect(provider.getFailedTotal()).toBe(0);
    });

    it('increments on each recordFailed() call', () => {
      provider.recordFailed();
      provider.recordFailed();
      provider.recordFailed();
      expect(provider.getFailedTotal()).toBe(3);
    });

    it('is independent of recordCompleted()', () => {
      provider.recordCompleted();
      expect(provider.getFailedTotal()).toBe(0);
    });
  });

  // ── success rate ────────────────────────────────────────────────────────────

  describe('getSuccessRate()', () => {
    it('returns 1 when no sweeps have been recorded', () => {
      expect(provider.getSuccessRate()).toBe(1);
    });

    it('returns 1 when all sweeps completed successfully', () => {
      provider.recordCompleted();
      provider.recordCompleted();
      expect(provider.getSuccessRate()).toBe(1);
    });

    it('returns 0 when all sweeps failed', () => {
      provider.recordFailed();
      provider.recordFailed();
      expect(provider.getSuccessRate()).toBe(0);
    });

    it('calculates the correct ratio with mixed outcomes', () => {
      provider.recordCompleted(); // 1
      provider.recordCompleted(); // 2
      provider.recordCompleted(); // 3
      provider.recordFailed(); // 1 failure → 3/4 = 0.75
      expect(provider.getSuccessRate()).toBeCloseTo(0.75);
    });
  });

  // ── snapshot ────────────────────────────────────────────────────────────────

  describe('getSnapshot()', () => {
    it('returns all three SLI fields', () => {
      provider.recordCompleted();
      provider.recordFailed();
      const snap = provider.getSnapshot();
      expect(snap).toHaveProperty('sweep_completed_total', 1);
      expect(snap).toHaveProperty('sweep_failed_total', 1);
      expect(snap).toHaveProperty('sweep_success_rate', 0.5);
    });
  });

  // ── alert ───────────────────────────────────────────────────────────────────

  describe('success-rate alert', () => {
    it('emits a warn log when success rate drops below 95%', () => {
      const warnSpy = jest
        .spyOn(provider['logger'], 'warn')
        .mockImplementation(() => {});

      // 5 completed + 1 failed → 83.3% success rate (below 95%)
      for (let i = 0; i < 5; i++) provider.recordCompleted();
      provider.recordFailed();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ALERT'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('sweep_success_rate'),
      );
    });

    it('does not warn when success rate is at or above 95%', () => {
      const warnSpy = jest
        .spyOn(provider['logger'], 'warn')
        .mockImplementation(() => {});

      // 19 completed + 1 failed → 95% success rate
      for (let i = 0; i < 19; i++) provider.recordCompleted();
      provider.recordFailed();

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not warn when all sweeps succeed', () => {
      const warnSpy = jest
        .spyOn(provider['logger'], 'warn')
        .mockImplementation(() => {});

      provider.recordCompleted();
      provider.recordCompleted();

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
