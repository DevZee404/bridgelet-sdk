import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarService, EXPIRY_BUFFER_LEDGERS } from './stellar.service.js';
import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Mock Horizon Server
// ---------------------------------------------------------------------------

const mockLedgersCall = jest.fn();
const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();

const mockHorizonServer = {
  ledgers: jest.fn().mockReturnValue({
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    call: mockLedgersCall,
  }),
  loadAccount: mockLoadAccount,
  submitTransaction: mockSubmitTransaction,
  payments: jest.fn().mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    stream: jest.fn().mockReturnValue(jest.fn()),
  }),
};

// ---------------------------------------------------------------------------
// Mock Soroban RPC Server
// ---------------------------------------------------------------------------

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockGetTransaction = jest.fn();

const mockSorobanServer = {
  getAccount: mockGetAccount,
  prepareTransaction: mockPrepareTransaction,
  sendTransaction: mockSendTransaction,
  simulateTransaction: mockSimulateTransaction,
  getTransaction: mockGetTransaction,
};

// Mock StellarSdk constructors
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual<typeof import('@stellar/stellar-sdk')>(
    '@stellar/stellar-sdk',
  );
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => mockHorizonServer),
    },
    rpc: {
      ...actual.rpc,
      Server: jest.fn().mockImplementation(() => mockSorobanServer),
    },
  };
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const mockConfigService = {
  getOrThrow: (key: string): string => {
    const config: Record<string, string> = {
      'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
      'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
      'stellar.network': 'testnet',
      'stellar.fundingSecret':
        'SCZANGBA5YHTNYVVV1J77DT4NK7WVIGZFFR3KDWZEQFEMFX65ZDFNEKX',
    };
    const value = config[key];
    if (value === undefined) throw new Error('Config key not found: ' + key);
    return value;
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StellarService', () => {
  let service: StellarService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mock returns
    mockGetTransaction.mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    });
    mockGetAccount.mockResolvedValue(
      new StellarSdk.Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0'),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
  });

  // -------------------------------------------------------------------------
  // generateKeypair
  // -------------------------------------------------------------------------

  describe('generateKeypair', () => {
    it('returns a valid Stellar Keypair', () => {
      const keypair = service.generateKeypair();
      expect(keypair).toBeInstanceOf(StellarSdk.Keypair);
      expect(keypair.publicKey()).toMatch(/^G[A-Z2-7]{55}$/);
    });

    it('generates unique keypairs on each call', () => {
      const kp1 = service.generateKeypair();
      const kp2 = service.generateKeypair();
      expect(kp1.publicKey()).not.toBe(kp2.publicKey());
    });
  });

  // -------------------------------------------------------------------------
  // getCurrentLedger
  // -------------------------------------------------------------------------

  describe('getCurrentLedger', () => {
    it('returns the latest ledger sequence from Horizon', async () => {
      mockLedgersCall.mockResolvedValue({
        records: [{ sequence: 42000 }],
      });

      const sequence = await service.getCurrentLedger();
      expect(sequence).toBe(42000);
      expect(mockHorizonServer.ledgers).toHaveBeenCalled();
    });

    it('requests the most recent ledger in descending order', async () => {
      mockLedgersCall.mockResolvedValue({ records: [{ sequence: 1 }] });
      await service.getCurrentLedger();

      const builder = mockHorizonServer.ledgers();
      expect(builder.order).toHaveBeenCalledWith('desc');
      expect(builder.limit).toHaveBeenCalledWith(1);
    });
  });

  // -------------------------------------------------------------------------
  // toExpiryLedger
  // -------------------------------------------------------------------------

  describe('toExpiryLedger', () => {
    it('converts 1 hour (3600s) to the correct expiry ledger', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(3600);
      // 3600 / 5 = 720 ledgers + 10 buffer + 1000 current = 1730
      expect(result).toBe(1730);
    });

    it('converts 1 day (86400s) to the correct expiry ledger', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(86400);
      // 86400 / 5 = 17280 ledgers + 10 buffer + 1000 current = 18290
      expect(result).toBe(18290);
    });

    it('converts 30 days (2592000s) to the correct expiry ledger', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(2592000);
      // 2592000 / 5 = 518400 ledgers + 10 buffer + 1000 current = 519410
      expect(result).toBe(519410);
    });

    it('rounds fractional ledger counts up, not down (7s -> 2 ledgers)', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
      const result = await service.toExpiryLedger(7);
      // 7 / 5 = 1.4 -> ceil = 2 ledgers + 10 buffer + 1000 current = 1012
      expect(result).toBe(1012);
    });

    it('applies the buffer on top of the ledger conversion', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(500);
      const result = await service.toExpiryLedger(5);
      expect(result).toBe(511); // 500 + 1 + 10 (buffer)
    });

    it('handles edge case: getCurrentLedger returns a very low value', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1);
      const result = await service.toExpiryLedger(3600);
      expect(result).toBe(731);
    });

    it('minimum expiresIn (3600s) produces an expiry ledger well above the current ledger', async () => {
      const currentLedger = 1000;
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(currentLedger);
      const result = await service.toExpiryLedger(3600);
      expect(result).toBeGreaterThan(currentLedger + 100);
    });
  });

  // -------------------------------------------------------------------------
  // createEphemeralAccount
  // -------------------------------------------------------------------------

  describe('createEphemeralAccount', () => {
    const params = {
      publicKey: 'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
      amount: '2',
      asset: 'native',
      expiresIn: 3600,
      recoveryAddress: 'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
      contractId: 'CONTRACT_ID_123',
      fundingKeypairSecret:
        'SCZANGBA5YHTNYVVV1J77DT4NK7WVIGZFFR3KDWZEQFEMFX65ZDFNEKX',
    };

    beforeEach(() => {
      mockLoadAccount.mockResolvedValue(
        new StellarSdk.Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        ),
      );
      mockSubmitTransaction.mockResolvedValue({ hash: 'TX_HASH_123' });
      mockGetAccount.mockResolvedValue(
        new StellarSdk.Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        ),
      );
      mockPrepareTransaction.mockImplementation(async (tx) => tx);
      mockSendTransaction.mockResolvedValue({
        status: 'SUCCESS',
        hash: 'INIT_HASH_456',
      });
      jest
        .spyOn(service, 'getCurrentLedger')
        .mockResolvedValue(1000);
    });

    it('returns a transaction hash on success', async () => {
      const hash = await service.createEphemeralAccount(params);
      expect(hash).toBe('TX_HASH_123');
    });

    it('calls Horizon to create the account', async () => {
      await service.createEphemeralAccount(params);
      expect(mockHorizonServer.loadAccount).toHaveBeenCalled();
      expect(mockSubmitTransaction).toHaveBeenCalled();
    });

    it('calls Soroban to initialize the contract', async () => {
      await service.createEphemeralAccount(params);
      expect(mockSorobanServer.prepareTransaction).toHaveBeenCalled();
      expect(mockSorobanServer.sendTransaction).toHaveBeenCalled();
    });

    it('throws when contract initialization fails', async () => {
      mockSendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'ContractError(NotInitialized)',
      });

      await expect(service.createEphemeralAccount(params)).rejects.toThrow(
        'Contract initialization failed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // recordPayment
  // -------------------------------------------------------------------------

  describe('recordPayment', () => {
    const params = {
      contractId: 'CONTRACT123',
      amount: 1000000n,
      assetAddress: 'CASSETTE_ADDR',
      signerSecret:
        'SCZANGBA5YHTNYVVV1J77DT4NK7WVIGZFFR3KDWZEQFEMFX65ZDFNEKX',
    };

    beforeEach(() => {
      mockGetAccount.mockResolvedValue(
        new StellarSdk.Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        ),
      );
      mockPrepareTransaction.mockImplementation(async (tx) => tx);
      mockSendTransaction.mockResolvedValue({
        status: 'SUCCESS',
        hash: 'RECORD_HASH',
      });
    });

    it('succeeds and returns void', async () => {
      await expect(service.recordPayment(params)).resolves.toBeUndefined();
    });

    it('throws when Soroban returns an error', async () => {
      mockSendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'ContractError(DuplicateAsset)',
      });

      await expect(service.recordPayment(params)).rejects.toThrow(
        'record_payment failed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getAccountInfo
  // -------------------------------------------------------------------------

  describe('getAccountInfo', () => {
    it('parses get_info simulation result correctly', async () => {
      // Build a mock ScVal map result
      const mockVal = {
        map: () => [
          {
            key: () => ({ sym: () => 'status' }),
            val: () => ({ u32: () => 2 }),
          },
          {
            key: () => ({ sym: () => 'expiry_ledger' }),
            val: () => ({ u32: () => 5000 }),
          },
          {
            key: () => ({ sym: () => 'payment_received' }),
            val: () => ({ b: () => true }),
          },
          {
            key: () => ({ sym: () => 'payment_count' }),
            val: () => ({ u32: () => 1 }),
          },
          {
            key: () => ({ sym: () => 'recovery_address' }),
            val: () => null,
          },
        ],
      };

      // Mock Address.fromScVal to return a fake address string
      const originalFromScVal = StellarSdk.Address.fromScVal;
      StellarSdk.Address.fromScVal = jest.fn().mockReturnValue({
        toString: () => 'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
      });

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: mockVal },
      });

      // We need to mock 'get' lookup for recovery_address
      // The function accesses the fields array, so we need the recovery_address entry to have a val
      // Re-do with recovery_address present
      const mockVal2 = {
        map: () => [
          {
            key: () => ({ sym: () => 'status' }),
            val: () => ({ u32: () => 2 }),
          },
          {
            key: () => ({ sym: () => 'expiry_ledger' }),
            val: () => ({ u32: () => 5000 }),
          },
          {
            key: () => ({ sym: () => 'payment_received' }),
            val: () => ({ b: () => true }),
          },
          {
            key: () => ({ sym: () => 'payment_count' }),
            val: () => ({ u32: () => 1 }),
          },
          {
            key: () => ({ sym: () => 'recovery_address' }),
            val: () => ({ dummy: true }),
          },
        ],
      };
      mockSimulateTransaction.mockResolvedValue({
        result: { retval: mockVal2 },
      });

      const info = await service.getAccountInfo('CONTRACT123');

      expect(info.expiry_ledger).toBe(5000);
      expect(info.payment_received).toBe(true);
      expect(info.payment_count).toBe(1);
      expect(info.recovery_address).toBe(
        'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
      );

      StellarSdk.Address.fromScVal = originalFromScVal;
    });

    it('throws when simulation returns an error', async () => {
      mockSimulateTransaction.mockResolvedValue({
        error: 'contract not found',
      });

      await expect(service.getAccountInfo('BAD')).rejects.toThrow(
        'get_info simulation failed',
      );
    });
  });
});
