import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarService } from './stellar.service.js';
import {
  FundingAccountMonitorService,
  STROOPS_PER_XLM,
} from './funding-account-monitor.service.js';
import { getToken } from '@willsoto/nestjs-prometheus';

const mockConfigService = {
  getOrThrow: (key: string): string => {
    const config: Record<string, string | number> = {
      'stellar.fundingSecret':
        'SCOCOEM6N6JNB5MAPWFRMMTMSUZW6RZ4KPKOMYUFXJKCUQUNVWDCJK2K',
      'stellar.fundingAccountBalanceCheckIntervalMs': 300000,
      'stellar.fundingAccountLowBalanceThreshold': 50000000,
      'stellar.fundingAccountCriticalBalanceThreshold': 20000000,
    };
    const value = config[key];
    if (value === undefined) throw new Error('Config key not found: ' + key);
    return String(value);
  },
  get: (key: string): string | undefined => {
    const config: Record<string, string | number> = {
      'stellar.fundingAccountBalanceCheckIntervalMs': 300000,
      'stellar.fundingAccountLowBalanceThreshold': 50000000,
      'stellar.fundingAccountCriticalBalanceThreshold': 20000000,
    };
    const value = config[key];
    return value !== undefined ? String(value) : undefined;
  },
};

describe('FundingAccountMonitorService', () => {
  let service: FundingAccountMonitorService;
  let mockStellarService: jest.Mocked<StellarService>;
  let mockGauge: jest.Mocked<Gauge<string>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();

    mockStellarService = {
      getAccountBalance: jest.fn(),
    } as unknown as jest.Mocked<StellarService>;

    mockGauge = {
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FundingAccountMonitorService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StellarService, useValue: mockStellarService },
        {
          provide: getToken('funding_account_balance_stroops'),
          useValue: mockGauge,
        },
      ],
    }).compile();

    service = module.get<FundingAccountMonitorService>(
      FundingAccountMonitorService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  describe('checkBalance', () => {
    it('fetches balance and updates gauge in stroops', async () => {
      mockStellarService.getAccountBalance.mockResolvedValue('10.0000000');

      await service['checkBalance']();

      expect(mockStellarService.getAccountBalance).toHaveBeenCalledWith(
        'GDWTSHU3BQ4XGRRTGBOLW7KWOPPFSMZTF5UK3TKSO7MDDYGYGRQNCHFO',
      );
      expect(mockGauge.set).toHaveBeenCalledWith(10 * STROOPS_PER_XLM);
    });

    it('logs warning when balance is below low threshold', async () => {
      mockStellarService.getAccountBalance.mockResolvedValue(
        (49999999 / STROOPS_PER_XLM).toFixed(7),
      );

      const warnSpy = jest.spyOn(service['logger'], 'warn');

      await service['checkBalance']();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('LOW BALANCE'),
      );
    });

    it('logs error when balance is below critical threshold', async () => {
      mockStellarService.getAccountBalance.mockResolvedValue(
        (19999999 / STROOPS_PER_XLM).toFixed(7),
      );

      const errorSpy = jest.spyOn(service['logger'], 'error');

      await service['checkBalance']();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
      );
    });

    it('logs info when balance is above low threshold', async () => {
      mockStellarService.getAccountBalance.mockResolvedValue(
        (50000001 / STROOPS_PER_XLM).toFixed(7),
      );

      const logSpy = jest.spyOn(service['logger'], 'log');

      await service['checkBalance']();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('balance:'));
    });

    it('logs error and does not crash on StellarService failure', async () => {
      mockStellarService.getAccountBalance.mockRejectedValue(
        new Error('Horizon unreachable'),
      );

      const errorSpy = jest.spyOn(service['logger'], 'error');

      await expect(service['checkBalance']()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to check funding account balance'),
      );
    });
  });

  describe('onModuleInit', () => {
    it('starts a periodic balance check interval', async () => {
      const setIntervalSpy = jest
        .spyOn(global, 'setInterval')
        .mockImplementation((fn) => {
          fn();
          return 1 as unknown as NodeJS.Timeout;
        });

      service.onModuleInit();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockStellarService.getAccountBalance).toHaveBeenCalledTimes(2);
      expect(mockGauge.set).toHaveBeenCalledTimes(2);

      setIntervalSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('clears the interval', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

      service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });
});
