import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import { StellarService } from '../stellar/stellar.service.js';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MOCK_AUTH_SIGNATURE = Buffer.alloc(64, 1);
const MOCK_TX_HASH = 'abc123txhash';
const MOCK_CONTRACT_AUTH_HASH = 'deadbeef'.repeat(8); // 64-char hex

const validRequest = {
  accountId: 'test-account-id',
  ephemeralPublicKey:
    'GEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  ephemeralSecret: 'SEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  destinationAddress:
    'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN',
  amount: '100.0000000',
  asset: 'native',
};

const mockTxResult = {
  hash: MOCK_TX_HASH,
  ledger: 12345,
  successful: true,
  timestamp: new Date('2024-01-01T12:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SweepsService', () => {
  let service: SweepsService;

  let validationProvider: {
    validateSweepParameters: jest.Mock;
    canSweep: jest.Mock;
    getSweepStatus: jest.Mock;
  };
  let contractProvider: {
    generateAuthSignature: jest.Mock;
    generateAuthHash: jest.Mock;
  };
  let transactionProvider: { executeSweepTransaction: jest.Mock };
  let stellarService: { executeSweep: jest.Mock };

  beforeEach(async () => {
    validationProvider = {
      validateSweepParameters: jest.fn<any>().mockResolvedValue(undefined),
      canSweep: jest.fn<any>().mockResolvedValue(true),
      getSweepStatus: jest.fn<any>().mockResolvedValue({ canSweep: true }),
    };

    contractProvider = {
      generateAuthSignature: jest
        .fn<any>()
        .mockReturnValue(MOCK_AUTH_SIGNATURE),
      generateAuthHash: jest.fn<any>().mockReturnValue(MOCK_CONTRACT_AUTH_HASH),
    };

    transactionProvider = {
      executeSweepTransaction: jest.fn<any>().mockResolvedValue(mockTxResult),
    };

    stellarService = {
      executeSweep: jest.fn<any>().mockResolvedValue(undefined),
    };

    const configMock = {
      getOrThrow: jest.fn((key: string) => {
        const map: Record<string, string> = {
          'stellar.contracts.sweepController': 'SWEEP_CTRL_CONTRACT_ID',
          'stellar.contracts.ephemeralAccount': 'EPHEMERAL_CONTRACT_ID',
        };
        if (!(key in map)) throw new Error(`Config key not found: ${key}`);
        return map[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SweepsService,
        { provide: ValidationProvider, useValue: validationProvider },
        { provide: ContractProvider, useValue: contractProvider },
        { provide: TransactionProvider, useValue: transactionProvider },
        { provide: StellarService, useValue: stellarService },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<SweepsService>(SweepsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path — full flow
  // -------------------------------------------------------------------------

  describe('executeSweep — happy path', () => {
    it('calls validation first', async () => {
      await service.executeSweep(validRequest);
      expect(validationProvider.validateSweepParameters).toHaveBeenCalledWith(
        validRequest,
      );
    });

    it('generates auth signature via ContractProvider', async () => {
      await service.executeSweep(validRequest);
      expect(contractProvider.generateAuthSignature).toHaveBeenCalledWith({
        ephemeralPublicKey: validRequest.ephemeralPublicKey,
        destinationAddress: validRequest.destinationAddress,
      });
    });

    it('submits the contract call via StellarService.executeSweep()', async () => {
      await service.executeSweep(validRequest);
      expect(stellarService.executeSweep).toHaveBeenCalledWith({
        sweepControllerContractId: 'SWEEP_CTRL_CONTRACT_ID',
        ephemeralAccountContractId: 'EPHEMERAL_CONTRACT_ID',
        destination: validRequest.destinationAddress,
        authSignature: MOCK_AUTH_SIGNATURE,
        signerSecret: validRequest.ephemeralSecret,
      });
    });

    it('executes the Horizon payment via TransactionProvider', async () => {
      await service.executeSweep(validRequest);
      expect(transactionProvider.executeSweepTransaction).toHaveBeenCalledWith({
        ephemeralSecret: validRequest.ephemeralSecret,
        destinationAddress: validRequest.destinationAddress,
        amount: validRequest.amount,
        asset: validRequest.asset,
      });
    });

    it('calls validation before the contract call', async () => {
      const order: string[] = [];
      validationProvider.validateSweepParameters.mockImplementation(() => {
        order.push('validate');
      });
      stellarService.executeSweep.mockImplementation(() => {
        order.push('contract');
      });

      await service.executeSweep(validRequest);

      expect(order.indexOf('validate')).toBeLessThan(order.indexOf('contract'));
    });

    it('calls the contract before the Horizon payment', async () => {
      const order: string[] = [];
      stellarService.executeSweep.mockImplementation(() => {
        order.push('contract');
      });
      transactionProvider.executeSweepTransaction.mockImplementation(() => {
        order.push('payment');
        return mockTxResult;
      });

      await service.executeSweep(validRequest);

      expect(order.indexOf('contract')).toBeLessThan(order.indexOf('payment'));
    });

    it('returns the real txHash from the Horizon payment', async () => {
      const result = await service.executeSweep(validRequest);
      expect(result.txHash).toBe(MOCK_TX_HASH);
    });

    it('returns success: true and correct fields', async () => {
      const result = await service.executeSweep(validRequest);
      expect(result).toEqual({
        success: true,
        txHash: MOCK_TX_HASH,
        contractAuthHash: MOCK_CONTRACT_AUTH_HASH,
        amountSwept: validRequest.amount,
        destination: validRequest.destinationAddress,
        timestamp: mockTxResult.timestamp,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------

  describe('executeSweep — error propagation', () => {
    it('propagates validation errors and does not proceed', async () => {
      validationProvider.validateSweepParameters.mockRejectedValue(
        new Error('Validation failed'),
      );

      await expect(service.executeSweep(validRequest)).rejects.toThrow(
        'Validation failed',
      );
      expect(stellarService.executeSweep).not.toHaveBeenCalled();
      expect(
        transactionProvider.executeSweepTransaction,
      ).not.toHaveBeenCalled();
    });

    it('propagates StellarService.executeSweep() errors and does not call Horizon payment', async () => {
      stellarService.executeSweep.mockRejectedValue(new Error('ALREADY_SWEPT'));

      await expect(service.executeSweep(validRequest)).rejects.toThrow(
        'ALREADY_SWEPT',
      );
      expect(
        transactionProvider.executeSweepTransaction,
      ).not.toHaveBeenCalled();
    });

    it('propagates TransactionProvider errors', async () => {
      transactionProvider.executeSweepTransaction.mockRejectedValue(
        new Error('Horizon payment failed'),
      );

      await expect(service.executeSweep(validRequest)).rejects.toThrow(
        'Horizon payment failed',
      );
    });

    it('logs a CRITICAL error when the Horizon payment fails after contract authorization', async () => {
      const horizonError = new Error('Horizon payment failed');
      transactionProvider.executeSweepTransaction.mockRejectedValue(
        horizonError,
      );

      // Spy on the service's private logger
      const loggerErrorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => {});

      await expect(service.executeSweep(validRequest)).rejects.toThrow(
        'Horizon payment failed',
      );

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
        horizonError.stack,
      );
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(validRequest.accountId),
        horizonError.stack,
      );
    });
  });

  // -------------------------------------------------------------------------
  // canSweep / getSweepStatus — delegates unchanged
  // -------------------------------------------------------------------------

  describe('canSweep', () => {
    it('delegates to ValidationProvider', async () => {
      validationProvider.canSweep.mockResolvedValue(true);
      const result = await service.canSweep('account-id', 'GDEST...');
      expect(validationProvider.canSweep).toHaveBeenCalledWith(
        'account-id',
        'GDEST...',
      );
      expect(result).toBe(true);
    });
  });

  describe('getSweepStatus', () => {
    it('delegates to ValidationProvider', async () => {
      validationProvider.getSweepStatus.mockResolvedValue({
        canSweep: false,
        reason: 'expired',
      } as any);
      const result = await service.getSweepStatus('account-id');
      expect(validationProvider.getSweepStatus).toHaveBeenCalledWith(
        'account-id',
      );
      expect(result).toEqual({ canSweep: false, reason: 'expired' });
    });
  });
});
