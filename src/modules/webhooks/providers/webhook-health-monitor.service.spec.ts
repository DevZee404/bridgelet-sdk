import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookHealthMonitorService } from './webhook-health-monitor.service.js';
import { WebhooksService } from '../webhooks.service.js';
import { WebhookHealthResponseDto } from '../dto/webhook-health-response.dto.js';

function makeSnapshot(
  overrides: Partial<WebhookHealthResponseDto> = {},
): WebhookHealthResponseDto {
  return {
    webhookId: 'hook-1',
    recentAttemptsChecked: 5,
    consecutiveFailures: 0,
    recentFailureRate: 0,
    isSustainedFailure: false,
    sustainedFailureThreshold: 5,
    lastAttemptAt: new Date('2026-01-05'),
    lastSuccessAt: new Date('2026-01-05'),
    ...overrides,
  };
}

describe('WebhookHealthMonitorService', () => {
  let service: WebhookHealthMonitorService;
  let webhooksService: {
    getHealthSnapshotsForActiveWebhooks: jest.Mock;
  };
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    webhooksService = {
      getHealthSnapshotsForActiveWebhooks: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookHealthMonitorService,
        { provide: WebhooksService, useValue: webhooksService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'app.webhookHealthCheckIntervalMs') return 300_000;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(WebhookHealthMonitorService);

    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('onModuleInit / onModuleDestroy', () => {
    it('starts a setInterval on init and clears it on destroy', () => {
      const setIntervalSpy = jest
        .spyOn(global, 'setInterval')
        .mockImplementation(() => 999 as unknown as NodeJS.Timeout);
      const clearIntervalSpy = jest
        .spyOn(global, 'clearInterval')
        .mockImplementation(() => undefined);

      service.onModuleInit();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
      expect(clearIntervalSpy).toHaveBeenCalledWith(999);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // runHealthCheck()
  // -------------------------------------------------------------------------

  describe('runHealthCheck()', () => {
    it('does not log an alert when no subscription is in sustained failure', async () => {
      webhooksService.getHealthSnapshotsForActiveWebhooks.mockResolvedValue([
        makeSnapshot({ isSustainedFailure: false }),
      ]);

      await service.runHealthCheck();

      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('logs an ALERT for each subscription in sustained failure', async () => {
      webhooksService.getHealthSnapshotsForActiveWebhooks.mockResolvedValue([
        makeSnapshot({ webhookId: 'hook-ok', isSustainedFailure: false }),
        makeSnapshot({
          webhookId: 'hook-failing',
          consecutiveFailures: 7,
          recentFailureRate: 1,
          isSustainedFailure: true,
        }),
      ]);

      await service.runHealthCheck();

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('hook-failing'),
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('issue #495'),
      );
    });

    it('does not throw when the snapshot query fails', async () => {
      webhooksService.getHealthSnapshotsForActiveWebhooks.mockRejectedValue(
        new Error('DB error'),
      );

      await expect(service.runHealthCheck()).resolves.not.toThrow();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Webhook health check query failed'),
      );
    });
  });
});
