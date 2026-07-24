import { Test, TestingModule } from '@nestjs/testing';

import { SweepsService } from './sweeps.service.js';

import { ValidationProvider } from './providers/validation.provider.js';

import { ContractProvider } from './providers/contract.provider.js';

import { EventEmitter2 } from '@nestjs/event-emitter';

describe('SweepsService', () => {
  let service: SweepsService;

  const mockValidationProvider = {
    validateSweepParameters: jest.fn(),

    canSweep: jest.fn(),

    getSweepStatus: jest.fn(),
  };

  const mockContractProvider = {
    authorizeSweep: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweepsService,

        {
          provide: ValidationProvider,

          useValue: mockValidationProvider,
        },
        //some
        {
          provide: ContractProvider,

          useValue: mockContractProvider,
        },
        {
          provide: EventEmitter2,

          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<SweepsService>(SweepsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeSweep', () => {
    const validDto = {
      accountId: 'test-account-id',

      ephemeralPublicKey:
        'GEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

      ephemeralSecret:
        'SEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

      destinationAddress:
        'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',

      amount: '100.0000000',

      asset: 'native',
    };

    const mockAuthResult = {
      authorized: true,

      hash: 'auth-hash',

      timestamp: new Date(),
    };

    beforeEach(() => {
      mockValidationProvider.validateSweepParameters.mockResolvedValue(
        undefined,
      );

      mockContractProvider.authorizeSweep.mockResolvedValue(mockAuthResult);
    });

    it('should execute complete sweep workflow', async () => {
      const result = await service.executeSweep(validDto);

      expect(result).toEqual({
        success: true,

        txHash: 'pending',

        contractAuthHash: mockAuthResult.hash,

        amountSwept: validDto.amount,

        destination: validDto.destinationAddress,

        timestamp: expect.any(Date),
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('sweep.completed', {
        txHash: 'pending',
        amounts: validDto.amount,
      });
    });

    it('should call validation provider first', async () => {
      await service.executeSweep(validDto);

      expect(
        mockValidationProvider.validateSweepParameters,
      ).toHaveBeenCalledWith(validDto);

      expect(mockValidationProvider.validateSweepParameters).toHaveBeenCalled();
      expect(mockContractProvider.authorizeSweep).toHaveBeenCalled();

      const validationCallOrder =
        mockValidationProvider.validateSweepParameters.mock
          .invocationCallOrder[0];
      const authCallOrder =
        mockContractProvider.authorizeSweep.mock.invocationCallOrder[0];
      expect(validationCallOrder).toBeLessThan(authCallOrder);
    });

    it('should call contract provider second', async () => {
      await service.executeSweep(validDto);

      expect(mockContractProvider.authorizeSweep).toHaveBeenCalledWith({
        ephemeralPublicKey: validDto.ephemeralPublicKey,

        destinationAddress: validDto.destinationAddress,
      });
    });

    it('should propagate validation errors', async () => {
      mockValidationProvider.validateSweepParameters.mockRejectedValue(
        new Error('Validation failed'),
      );

      await expect(service.executeSweep(validDto)).rejects.toThrow(
        'Validation failed',
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('sweep.failed', {
        error: 'Validation failed',
        retryCount: 0,
      });
    });

    it('should propagate contract errors', async () => {
      mockContractProvider.authorizeSweep.mockRejectedValue(
        new Error('Contract failed'),
      );

      await expect(service.executeSweep(validDto)).rejects.toThrow(
        'Contract failed',
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('sweep.failed', {
        error: 'Contract failed',
        retryCount: 0,
      });
    });

    it('should simulate sweep without submitting in dry-run mode', async () => {
      const dryRunDto = { ...validDto, dryRun: true };
      const result = await service.executeSweep(dryRunDto);

      expect(result.txHash).toBe('dry-run');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('sweep.completed', {
        txHash: 'dry-run',
        amounts: dryRunDto.amount,
      });
    });
  });

  describe('canSweep', () => {
    it('should delegate to ValidationProvider', async () => {
      mockValidationProvider.canSweep.mockResolvedValue(true);

      const result = await service.canSweep('account-id', 'GDEST...');

      expect(mockValidationProvider.canSweep).toHaveBeenCalledWith(
        'account-id',

        'GDEST...',
      );

      expect(result).toBe(true);
    });
  });

  describe('getSweepStatus', () => {
    it('should delegate to ValidationProvider', async () => {
      const mockStatus = { canSweep: true };

      mockValidationProvider.getSweepStatus.mockResolvedValue(mockStatus);

      const result = await service.getSweepStatus('account-id');

      expect(mockValidationProvider.getSweepStatus).toHaveBeenCalledWith(
        'account-id',
      );

      expect(result).toEqual(mockStatus);
    });
  });
});
