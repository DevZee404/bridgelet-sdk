import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FeeStrategyProvider } from './fee-strategy.provider';
import { BASE_FEE } from '@stellar/stellar-sdk';

// Mock the Horizon server
jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        feeStats: jest.fn(),
      })),
    },
  };
});

describe('FeeStrategyProvider', () => {
  let feeStrategy: FeeStrategyProvider;
  let configService: ConfigService;
  let mockHorizonServer: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeStrategyProvider,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'stellar.horizonUrl')
                return 'https://horizon-testnet.stellar.org';
              if (key === 'stellar.network') return 'testnet';
              return null;
            }),
            get: jest.fn(() => null), // No fallback URL
          },
        },
      ],
    }).compile();

    feeStrategy = module.get<FeeStrategyProvider>(FeeStrategyProvider);
    configService = module.get<ConfigService>(ConfigService);

    // Get the mock Horizon server instance
    mockHorizonServer = (feeStrategy as any).server;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(feeStrategy).toBeDefined();
  });

  it('should initialize with default configuration', () => {
    const config = feeStrategy.getConfig();
    expect(config.maxFeeCeiling).toBe(1000000); // 10 XLM in stroops
    expect(config.feeCacheTtlMs).toBe(60000); // 60 seconds
    expect(config.feeMultiplier).toBe(1.0);
  });

  it('should return base fee when fee stats fetch fails', async () => {
    // Mock feeStats to throw an error
    mockHorizonServer.feeStats.mockRejectedValue(new Error('Network error'));

    const result = await feeStrategy.calculateFee();
    expect(result.fee).toBe(String(BASE_FEE));
    expect(result.isDynamic).toBe(false);
    expect(result.source).toBe('base_fee');
  });

  it('should return base fee when p75 value is invalid', async () => {
    // Mock feeStats to return invalid p75
    mockHorizonServer.feeStats.mockResolvedValue({
      fee_charged: { p75: 'invalid' },
    });

    const result = await feeStrategy.calculateFee();
    expect(result.fee).toBe(String(BASE_FEE));
    expect(result.isDynamic).toBe(false);
    expect(result.source).toBe('base_fee');
  });

  it('should calculate dynamic fee correctly under normal conditions', async () => {
    // Normal p75 fee (100 stroops)
    mockHorizonServer.feeStats.mockResolvedValue({
      fee_charged: { p75: '100' },
    });

    const result = await feeStrategy.calculateFee();
    expect(result.fee).toBe('100');
    expect(result.isDynamic).toBe(true);
    expect(result.source).toBe('dynamic_fee');
  });

  it('should apply fee multiplier correctly', async () => {
    // Set a custom multiplier
    feeStrategy.updateConfig({ feeMultiplier: 2.0 });

    mockHorizonServer.feeStats.mockResolvedValue({
      fee_charged: { p75: '100' },
    });

    const result = await feeStrategy.calculateFee();
    expect(result.fee).toBe('200'); // 100 * 2
    expect(result.isDynamic).toBe(true);
    expect(result.source).toBe('dynamic_fee');
  });

  it('should cap fee at max fee ceiling during high congestion', async () => {
    // Set a lower max ceiling for testing
    feeStrategy.updateConfig({
      maxFeeCeiling: 500,
      feeMultiplier: 10.0,
    });

    // High congestion scenario: p75 is 100, multiplier 10x would be 1000, but capped at 500
    mockHorizonServer.feeStats.mockResolvedValue({
      fee_charged: { p75: '100' },
    });

    const result = await feeStrategy.calculateFee();
    expect(result.fee).toBe('500');
    expect(result.isDynamic).toBe(true);
    expect(result.source).toBe('max_fee');
  });

  it('should cache fee and return cached value within TTL', async () => {
    mockHorizonServer.feeStats.mockResolvedValue({
      fee_charged: { p75: '100' },
    });

    // First call
    const firstResult = await feeStrategy.calculateFee();
    expect(firstResult.fee).toBe('100');

    // Second call should use cache, feeStats should only be called once
    const secondResult = await feeStrategy.calculateFee();
    expect(secondResult.fee).toBe('100');
    expect(mockHorizonServer.feeStats).toHaveBeenCalledTimes(1);
  });

  it('should invalidate cache and fetch fresh fee after cache invalidation', async () => {
    mockHorizonServer.feeStats
      .mockResolvedValueOnce({
        fee_charged: { p75: '100' },
      })
      .mockResolvedValueOnce({
        fee_charged: { p75: '200' }, // Fee increased in second fetch
      });

    // First call
    const firstResult = await feeStrategy.calculateFee();
    expect(firstResult.fee).toBe('100');

    // Invalidate cache
    feeStrategy.invalidateFeeCache();

    // Second call should fetch fresh value
    const secondResult = await feeStrategy.calculateFee();
    expect(secondResult.fee).toBe('200');
    expect(mockHorizonServer.feeStats).toHaveBeenCalledTimes(2);
  });

  it('should update configuration and invalidate cache', async () => {
    mockHorizonServer.feeStats
      .mockResolvedValueOnce({
        fee_charged: { p75: '100' },
      })
      .mockResolvedValueOnce({
        fee_charged: { p75: '100' },
      });

    // First calculation with default multiplier
    const firstResult = await feeStrategy.calculateFee();
    expect(firstResult.fee).toBe('100');

    // Update configuration
    feeStrategy.updateConfig({ feeMultiplier: 3.0 });

    // Second calculation should use new multiplier
    const secondResult = await feeStrategy.calculateFee();
    expect(secondResult.fee).toBe('300'); // 100 * 3
  });
});
