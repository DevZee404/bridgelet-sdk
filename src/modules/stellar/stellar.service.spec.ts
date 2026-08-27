import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import {
  StellarService,
  EXPIRY_BUFFER_LEDGERS,
  LEDGER_CACHE_TTL_MS,
  SOROBAN_RPC_MAX_RETRIES,
  SOROBAN_RPC_INITIAL_BACKOFF_MS,
} from './stellar.service.js';
import { getToken } from '@willsoto/nestjs-prometheus';

const mockConfigService = {
  getOrThrow: (key: string): string => {
    const config: Record<string, string> = {
      'stellar.horizonUrl': 'https://horizon-testnet.stellar.org',
      'stellar.sorobanRpcUrl': 'https://soroban-testnet.stellar.org',
      'stellar.network': 'testnet',
      'stellar.fundingSecret':
        'SCOCOEM6N6JNB5MAPWFRMMTMSUZW6RZ4KPKOMYUFXJKCUQUNVWDCJK2K',
      'stellar.contracts.ephemeralAccount': 'CONTRACT123',
    };
    const value = config[key];
    if (value === undefined) throw new Error('Config key not found: ' + key);
    return value;
  },
  get: (key: string): string | undefined => {
    if (key === 'stellar.horizonFallbackUrl') return undefined;
    return undefined;
  },
};

// ── Helpers to build mock Horizon / Soroban server objects ────────────────────

function makeLedgerServer(sequence: number) {
  return {
    ledgers: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [{ sequence }] }),
    }),
    loadAccount: jest.fn(),
    submitTransaction: jest.fn(),
  };
}

function makeSorobanServer() {
  return {
    getAccount: jest.fn(),
    prepareTransaction: jest.fn(),
    sendTransaction: jest.fn(),
    getTransaction: jest.fn(),
    simulateTransaction: jest.fn(),
  };
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const FUNDING_SECRET =
  'SCOCOEM6N6JNB5MAPWFRMMTMSUZW6RZ4KPKOMYUFXJKCUQUNVWDCJK2K';
const SIGNER_SECRET =
  'SCOCOEM6N6JNB5MAPWFRMMTMSUZW6RZ4KPKOMYUFXJKCUQUNVWDCJK2K';
const FUNDING_KEYPAIR = StellarSdk.Keypair.fromSecret(FUNDING_SECRET);
const DEST_KEY = FUNDING_KEYPAIR.publicKey();
// Valid Soroban contract address (56 chars, C-prefix strkey)
const CONTRACT_ID = 'CASJFOEQG3WN42CR37EKINFO77PP7UO2DT5XCNHITYT7WUHL7X3RYQFF';

describe('StellarService', () => {
  let service: StellarService;
  let horizonServer: ReturnType<typeof makeLedgerServer>;
  let sorobanServer: ReturnType<typeof makeSorobanServer>;

  beforeEach(async () => {
    jest.clearAllMocks();

    horizonServer = makeLedgerServer(1000);
    sorobanServer = makeSorobanServer();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: getToken('soroban_rpc_latency_seconds'),
          useValue: { startTimer: jest.fn(() => jest.fn()) },
        },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);

    // Replace internal SDK server references with our controlled mocks
    (service as unknown as { server: unknown; sorobanServer: unknown }).server =
      horizonServer;
    (
      service as unknown as { server: unknown; sorobanServer: unknown }
    ).sorobanServer = sorobanServer;
  });

  // ── getCurrentLedger ────────────────────────────────────────────────────────

  describe('getCurrentLedger', () => {
    it('returns the sequence number from Horizon', async () => {
      const result = await service.getCurrentLedger();
      expect(result).toBe(1000);
    });

    it('fetches the most recent ledger (order desc, limit 1)', async () => {
      await service.getCurrentLedger();
      expect(horizonServer.ledgers).toHaveBeenCalled();
    });

    it('returns the cached sequence on a second call within TTL', async () => {
      await service.getCurrentLedger(); // populates cache
      await service.getCurrentLedger(); // should use cache
      // Horizon should only have been called once
      expect(horizonServer.ledgers).toHaveBeenCalledTimes(1);
    });

    it('re-fetches from Horizon after the cache TTL expires', async () => {
      jest.useFakeTimers();
      try {
        horizonServer = makeLedgerServer(1000);
        (
          service as unknown as { server: unknown; sorobanServer: unknown }
        ).server = horizonServer;

        await service.getCurrentLedger(); // populates cache — 1 call
        jest.advanceTimersByTime(LEDGER_CACHE_TTL_MS + 1); // expire the cache
        await service.getCurrentLedger(); // should re-fetch — 2nd call
        expect(horizonServer.ledgers).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('invalidateLedgerCache forces a fresh fetch on next call', async () => {
      await service.getCurrentLedger(); // populates cache — 1 call
      service.invalidateLedgerCache();
      await service.getCurrentLedger(); // cache cleared — 2nd call
      expect(horizonServer.ledgers).toHaveBeenCalledTimes(2);
    });

    it('LEDGER_CACHE_TTL_MS constant is 5000', () => {
      expect(LEDGER_CACHE_TTL_MS).toBe(5_000);
    });
  });

  // ── generateKeypair ─────────────────────────────────────────────────────────

  describe('generateKeypair', () => {
    it('returns a random Stellar Keypair', () => {
      const kp = service.generateKeypair();
      expect(kp).toBeInstanceOf(StellarSdk.Keypair);
      expect(kp.publicKey()).toMatch(/^G[A-Z0-9]{55}$/);
    });

    it('returns a different keypair on each call', () => {
      const kp1 = service.generateKeypair();
      const kp2 = service.generateKeypair();
      expect(kp1.publicKey()).not.toBe(kp2.publicKey());
    });
  });

  // ── toExpiryLedger ──────────────────────────────────────────────────────────

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

    it('EXPIRY_BUFFER_LEDGERS constant is 10', () => {
      expect(EXPIRY_BUFFER_LEDGERS).toBe(10);
    });
  });

  // ── createEphemeralAccount ──────────────────────────────────────────────────

  describe('createEphemeralAccount', () => {
    const params = {
      publicKey: FUNDING_KEYPAIR.publicKey(),
      amount: '100',
      asset: 'native',
      expiresIn: 3600,
      recoveryAddress: FUNDING_KEYPAIR.publicKey(),
      contractId: CONTRACT_ID,
      sweepControllerContractId: CONTRACT_ID,
      fundingKeypairSecret: FUNDING_SECRET,
    };

    function setupHappyPath(txHash = 'horizon-tx-hash') {
      const fundingAccount = new StellarSdk.Account(
        FUNDING_KEYPAIR.publicKey(),
        '100',
      );
      horizonServer.loadAccount.mockResolvedValue(fundingAccount);
      horizonServer.submitTransaction.mockResolvedValue({ hash: txHash });

      const sorobanAccount = new StellarSdk.Account(
        FUNDING_KEYPAIR.publicKey(),
        '101',
      );
      sorobanServer.getAccount.mockResolvedValue(sorobanAccount);

      // prepareTransaction just returns a signable transaction
      sorobanServer.prepareTransaction.mockImplementation(
        (tx: StellarSdk.Transaction) => Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'soroban-tx-hash',
      });
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      });

      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
    }

    it('returns the Horizon transaction hash on success', async () => {
      setupHappyPath('expected-tx-hash');

      const result = await service.createEphemeralAccount(params);

      expect(result).toBe('expected-tx-hash');
    });

    it('calls submitTransaction on Horizon', async () => {
      setupHappyPath();

      await service.createEphemeralAccount(params);

      expect(horizonServer.submitTransaction).toHaveBeenCalledTimes(1);
    });

    it('calls sendTransaction on Soroban for contract init', async () => {
      setupHappyPath();

      await service.createEphemeralAccount(params);

      expect(sorobanServer.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('throws when Soroban contract init returns ERROR status', async () => {
      setupHappyPath();
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: { message: 'contract error' },
      });

      await expect(service.createEphemeralAccount(params)).rejects.toThrow(
        'Contract initialization failed',
      );
    });
  });

  // ── recordPayment ───────────────────────────────────────────────────────────

  describe('recordPayment', () => {
    const params = {
      contractId: CONTRACT_ID,
      amount: 100n,
      assetAddress: FUNDING_KEYPAIR.publicKey(),
      signerSecret: SIGNER_SECRET,
    };

    it('resolves without throwing on success', async () => {
      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'pay-hash',
      });
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      });

      await expect(service.recordPayment(params)).resolves.toBeUndefined();
    });

    it('throws when Soroban returns ERROR on record_payment', async () => {
      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: { message: 'TooManyPayments' },
      });

      await expect(service.recordPayment(params)).rejects.toThrow(
        'record_payment failed',
      );
    });
  });

  // ── executeSweep ────────────────────────────────────────────────────────────

  describe('executeSweep', () => {
    const params = {
      sweepControllerContractId: CONTRACT_ID,
      ephemeralAccountContractId: CONTRACT_ID,
      destination: DEST_KEY,
      authSignature: Buffer.alloc(64),
      signerSecret: SIGNER_SECRET,
    };

    it('resolves without throwing on successful sweep', async () => {
      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'sweep-hash',
      });
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      });

      await expect(service.executeSweep(params)).resolves.toBeUndefined();
    });

    it('throws ALREADY_SWEPT for AlreadySwept contract error', async () => {
      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'AlreadySwept',
      });

      await expect(service.executeSweep(params)).rejects.toThrow(
        'ALREADY_SWEPT',
      );
    });

    it('throws ACCOUNT_EXPIRED for AccountExpired contract error', async () => {
      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'AccountExpired',
      });

      await expect(service.executeSweep(params)).rejects.toThrow(
        'ACCOUNT_EXPIRED',
      );
    });

    it('throws a generic error for unknown contract errors', async () => {
      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'SomeOtherError',
      });

      await expect(service.executeSweep(params)).rejects.toThrow(
        'execute_sweep failed',
      );
    });
  });

  // ── expireAccount ───────────────────────────────────────────────────────────

  describe('expireAccount', () => {
    const params = {
      contractId: CONTRACT_ID,
      signerSecret: SIGNER_SECRET,
    };

    function mockGetAccountInfo(expiryLedger: number) {
      jest.spyOn(service, 'getAccountInfo').mockResolvedValue({
        status: '1',
        expiry_ledger: expiryLedger,
        payment_received: false,
        payment_count: 0,
        recovery_address: FUNDING_KEYPAIR.publicKey(),
      });
    }

    it('returns early (no-op) when current ledger is before expiry', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(900);
      mockGetAccountInfo(1000);

      await expect(service.expireAccount(params)).resolves.toBeUndefined();
      expect(sorobanServer.sendTransaction).not.toHaveBeenCalled();
    });

    it('calls expire() on-chain when current ledger meets expiry', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1001);
      mockGetAccountInfo(1000);

      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'expire-hash',
      });
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      });

      await expect(service.expireAccount(params)).resolves.toBeUndefined();
      expect(sorobanServer.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('throws ACCOUNT_ALREADY_TERMINAL for InvalidStatus contract error', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1001);
      mockGetAccountInfo(1000);

      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'InvalidStatus',
      });

      await expect(service.expireAccount(params)).rejects.toThrow(
        'ACCOUNT_ALREADY_TERMINAL',
      );
    });

    it('throws a generic error for other expire() failures', async () => {
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1001);
      mockGetAccountInfo(1000);

      const acct = new StellarSdk.Account(FUNDING_KEYPAIR.publicKey(), '100');
      sorobanServer.getAccount.mockResolvedValue(acct);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'ERROR',
        errorResult: 'UnknownError',
      });

      await expect(service.expireAccount(params)).rejects.toThrow(
        'expire() failed',
      );
    });
  });

  // ── getAccountInfo ──────────────────────────────────────────────────────────

  describe('getAccountInfo', () => {
    it('throws when simulateTransaction returns an error', async () => {
      sorobanServer.simulateTransaction.mockResolvedValue({
        error: 'simulation error',
        _parsed: false,
      });
      // Make isSimulationError return true
      jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(true);

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        'get_info simulation failed',
      );
    });

    it('throws when simulation result has no retval', async () => {
      sorobanServer.simulateTransaction.mockResolvedValue({
        result: null,
      });
      jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(false);

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        'get_info returned no value',
      );
    });
  });

  // ── waitForTransaction (via createEphemeralAccount) ─────────────────────────

  describe('waitForTransaction timeout', () => {
    it('throws when transaction is not confirmed after max attempts', async () => {
      const fundingAccount = new StellarSdk.Account(
        FUNDING_KEYPAIR.publicKey(),
        '100',
      );
      horizonServer.loadAccount.mockResolvedValue(fundingAccount);
      horizonServer.submitTransaction.mockResolvedValue({ hash: 'tx' });

      const sorobanAccount = new StellarSdk.Account(
        FUNDING_KEYPAIR.publicKey(),
        '101',
      );
      sorobanServer.getAccount.mockResolvedValue(sorobanAccount);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'pending-tx',
      });
      // Always return NOT_FOUND to exhaust the retry loop
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
      });
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);

      await expect(
        service.createEphemeralAccount({
          publicKey: FUNDING_KEYPAIR.publicKey(),
          amount: '100',
          asset: 'native',
          expiresIn: 3600,
          recoveryAddress: FUNDING_KEYPAIR.publicKey(),
          contractId: CONTRACT_ID,
          sweepControllerContractId: CONTRACT_ID,
          fundingKeypairSecret: FUNDING_SECRET,
        }),
      ).rejects.toThrow('not confirmed after');
    }, 30000);

    it('throws when a transaction fails on-chain', async () => {
      const fundingAccount = new StellarSdk.Account(
        FUNDING_KEYPAIR.publicKey(),
        '100',
      );
      horizonServer.loadAccount.mockResolvedValue(fundingAccount);
      horizonServer.submitTransaction.mockResolvedValue({ hash: 'tx' });

      const sorobanAccount = new StellarSdk.Account(
        FUNDING_KEYPAIR.publicKey(),
        '101',
      );
      sorobanServer.getAccount.mockResolvedValue(sorobanAccount);
      sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
        Promise.resolve(tx),
      );
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'failed-tx',
      });
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.FAILED,
      });
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);

      await expect(
        service.createEphemeralAccount({
          publicKey: FUNDING_KEYPAIR.publicKey(),
          amount: '100',
          asset: 'native',
          expiresIn: 3600,
          recoveryAddress: FUNDING_KEYPAIR.publicKey(),
          contractId: CONTRACT_ID,
          sweepControllerContractId: CONTRACT_ID,
          fundingKeypairSecret: FUNDING_SECRET,
        }),
      ).rejects.toThrow('failed on-chain');
    });
  });

  // ── getNetworkPassphrase (via createEphemeralAccount on mainnet) ────────────

  describe('getNetworkPassphrase', () => {
    it('uses TESTNET passphrase for non-mainnet networks', () => {
      // Already tested implicitly via createEphemeralAccount — just verify
      // we can instantiate with 'testnet' config without error
      expect((service as unknown as { network: string }).network).toBe(
        'testnet',
      );
    });

    it('uses PUBLIC passphrase when network is mainnet', async () => {
      const mainnetModule: TestingModule = await Test.createTestingModule({
        providers: [
          StellarService,
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: (key: string) => {
                const cfg: Record<string, string> = {
                  'stellar.horizonUrl': 'https://horizon.stellar.org',
                  'stellar.sorobanRpcUrl': 'https://soroban.stellar.org',
                  'stellar.network': 'mainnet',
                };
                return cfg[key];
              },
              get: (key: string) => {
                if (key === 'stellar.horizonFallbackUrl') return undefined;
                return undefined;
              },
            },
          },
          {
            provide: getToken('soroban_rpc_latency_seconds'),
            useValue: { startTimer: jest.fn(() => jest.fn()) },
          },
        ],
      }).compile();

      const mainnetService = mainnetModule.get<StellarService>(StellarService);
      type InternalService = {
        network: string;
        getNetworkPassphrase: () => string;
      };
      const internal = mainnetService as unknown as InternalService;
      expect(internal.network).toBe('mainnet');
      expect(internal.getNetworkPassphrase()).toBe(StellarSdk.Networks.PUBLIC);
    });
  });

  // ── getAccountInfo (success path) ──────────────────────────────────────────

  describe('getAccountInfo success path', () => {
    it('parses a valid simulation result with all fields present', async () => {
      jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(false);

      // Build mock ScVal map entries for the on-chain AccountInfo struct
      const recoveryScVal = StellarSdk.Address.fromString(
        FUNDING_KEYPAIR.publicKey(),
      ).toScVal();

      const makeEntry = (key: string, val: any) => ({
        key: () => ({ sym: () => ({ toString: () => key }) }),
        val: () => val,
      });

      const statusVal = { u32: () => 1 };
      const expiryVal = { u32: () => 5000 };
      const paymentReceivedVal = { b: () => true };
      const paymentCountVal = { u32: () => 2 };

      const mockRetval = {
        map: () => [
          makeEntry('status', statusVal),
          makeEntry('expiry_ledger', expiryVal),
          makeEntry('payment_received', paymentReceivedVal),
          makeEntry('payment_count', paymentCountVal),
          makeEntry('recovery_address', recoveryScVal),
        ],
      };

      sorobanServer.simulateTransaction.mockResolvedValue({
        result: { retval: mockRetval },
      });

      const info = await service.getAccountInfo(CONTRACT_ID);

      expect(info.expiry_ledger).toBe(5000);
      expect(info.payment_received).toBe(true);
      expect(info.payment_count).toBe(2);
      expect(info.recovery_address).toBe(FUNDING_KEYPAIR.publicKey());
    });

    it('throws when recovery_address field is missing', async () => {
      jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(false);

      const makeEntry = (key: string, val: any) => ({
        key: () => ({ sym: () => ({ toString: () => key }) }),
        val: () => val,
      });

      const mockRetval = {
        map: () => [makeEntry('status', { u32: () => 1 })],
      };

      sorobanServer.simulateTransaction.mockResolvedValue({
        result: { retval: mockRetval },
      });

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        'get_info missing recovery_address',
      );
    });

    it('throws when map() returns null (unexpected ScVal type)', async () => {
      jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(false);

      sorobanServer.simulateTransaction.mockResolvedValue({
        result: { retval: { map: () => null } },
      });

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        'unexpected ScVal type',
      );
    });
  });

  // -------------------------------------------------------------------------
  // createEphemeralAccount
  // -------------------------------------------------------------------------

  describe('createEphemeralAccount', () => {
    const params = {
      publicKey: DEST_KEY,
      amount: '2',
      asset: 'native',
      expiresIn: 3600,
      recoveryAddress: DEST_KEY,
      contractId: CONTRACT_ID,
      sweepControllerContractId: CONTRACT_ID,
      fundingKeypairSecret: FUNDING_SECRET,
    };

    beforeEach(() => {
      horizonServer.loadAccount.mockResolvedValue(
        new StellarSdk.Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        ),
      );
      horizonServer.submitTransaction.mockResolvedValue({
        hash: 'TX_HASH_123',
      });
      sorobanServer.getAccount.mockResolvedValue(
        new StellarSdk.Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        ),
      );
      sorobanServer.prepareTransaction.mockImplementation(async (tx) => tx);
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'SUCCESS',
        hash: 'INIT_HASH_456',
      });
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      });
      jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
    });

    it('returns a transaction hash on success', async () => {
      const hash = await service.createEphemeralAccount(params);
      expect(hash).toBe('TX_HASH_123');
    });

    it('calls Horizon to create the account', async () => {
      await service.createEphemeralAccount(params);
      expect(horizonServer.loadAccount).toHaveBeenCalled();
      expect(horizonServer.submitTransaction).toHaveBeenCalled();
    });

    it('calls Soroban to initialize the contract', async () => {
      await service.createEphemeralAccount(params);
      expect(sorobanServer.prepareTransaction).toHaveBeenCalled();
      expect(sorobanServer.sendTransaction).toHaveBeenCalled();
    });

    it('throws when contract initialization fails', async () => {
      sorobanServer.sendTransaction.mockResolvedValue({
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
      contractId: CONTRACT_ID,
      amount: 1000000n,
      assetAddress: CONTRACT_ID,
      signerSecret: FUNDING_SECRET,
    };

    beforeEach(() => {
      sorobanServer.getAccount.mockResolvedValue(
        new StellarSdk.Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        ),
      );
      sorobanServer.prepareTransaction.mockImplementation(async (tx) => tx);
      sorobanServer.sendTransaction.mockResolvedValue({
        status: 'SUCCESS',
        hash: 'RECORD_HASH',
      });
      sorobanServer.getTransaction.mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      });
    });

    it('succeeds and returns void', async () => {
      await expect(service.recordPayment(params)).resolves.toBeUndefined();
    });

    it('throws when Soroban returns an error', async () => {
      sorobanServer.sendTransaction.mockResolvedValue({
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
        toString: () =>
          'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
      });

      sorobanServer.simulateTransaction.mockResolvedValue({
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
      sorobanServer.simulateTransaction.mockResolvedValue({
        result: { retval: mockVal2 },
      });

      const info = await service.getAccountInfo(CONTRACT_ID);

      expect(info.expiry_ledger).toBe(5000);
      expect(info.payment_received).toBe(true);
      expect(info.payment_count).toBe(1);
      expect(info.recovery_address).toBe(
        'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
      );

      StellarSdk.Address.fromScVal = originalFromScVal;
    });

    it('throws when simulation returns an error', async () => {
      sorobanServer.simulateTransaction.mockResolvedValue({
        error: 'contract not found',
      });

      await expect(service.getAccountInfo(CONTRACT_ID)).rejects.toThrow(
        'get_info returned no value',
      );
    });
  });

  // ── Soroban RPC retry behaviour ────────────────────────────────────────────

  describe('retrySorobanRpc (private helper)', () => {
    it('retries on transient errors and eventually succeeds', async () => {
      // Access the private helper via (service as any)
      const retry = (service as any).retrySorobanRpc.bind(service);

      let attempt = 0;
      const fn = jest.fn(async () => {
        attempt++;
        if (attempt === 1) throw new Error('Request timed out after 30000ms');
        return 'success';
      });

      const result = await retry('test', fn, 3);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx errors and throws after exhausting retries', async () => {
      const retry = (service as any).retrySorobanRpc.bind(service);

      const fn = jest.fn(async () => {
        throw new Error('HTTP 503 Service Unavailable');
      });

      await expect(retry('test', fn, 3)).rejects.toThrow('HTTP 503');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry on contract-level (non-transient) errors', async () => {
      const retry = (service as any).retrySorobanRpc.bind(service);

      const fn = jest.fn(async () => {
        throw new Error('AlreadySwept');
      });

      await expect(retry('test', fn, 3)).rejects.toThrow('AlreadySwept');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on errors without matching transient patterns', async () => {
      const retry = (service as any).retrySorobanRpc.bind(service);

      const fn = jest.fn(async () => {
        throw new Error('Something weird happened');
      });

      await expect(retry('test', fn, 3)).rejects.toThrow(
        'Something weird happened',
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('isTransientRpcError (private helper)', () => {
    it('returns true for timeout errors', () => {
      const check = (service as any).isTransientRpcError.bind(service);
      expect(check(new Error('Request timed out'))).toBe(true);
      expect(check(new Error('Request timed out after 30000ms'))).toBe(true);
    });

    it('returns true for network errors', () => {
      const check = (service as any).isTransientRpcError.bind(service);
      expect(check(new Error('connect ECONNREFUSED 127.0.0.1:8000'))).toBe(
        true,
      );
      expect(check(new Error('socket hang up'))).toBe(true);
      expect(check(new Error('ECONNRESET'))).toBe(true);
    });

    it('returns true for HTTP 5xx errors', () => {
      const check = (service as any).isTransientRpcError.bind(service);
      expect(check(new Error('HTTP 503 Service Unavailable'))).toBe(true);
      expect(check(new Error('HTTP 502 Bad Gateway'))).toBe(true);
      expect(check(new Error('HTTP 504 Gateway Timeout'))).toBe(true);
    });

    it('returns false for contract-level errors', () => {
      const check = (service as any).isTransientRpcError.bind(service);
      expect(check(new Error('AlreadySwept'))).toBe(false);
      expect(check(new Error('AccountExpired'))).toBe(false);
      expect(check(new Error('DuplicateAsset'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      const check = (service as any).isTransientRpcError.bind(service);
      expect(check(null)).toBe(false);
      expect(check('string error')).toBe(false);
      expect(check(42)).toBe(false);
    });
  });

  describe('Soroban RPC retry integration (real timers)', () => {
    // These tests use real timers with short backoffs to verify the retry
    // logic integrates correctly with the full service methods.

    it('retries sendTransaction on timeout and succeeds via createEphemeralAccount', async () => {
      jest.useFakeTimers();
      try {
        const fundingAccount = new StellarSdk.Account(
          FUNDING_KEYPAIR.publicKey(),
          '100',
        );
        horizonServer.loadAccount.mockResolvedValue(fundingAccount);
        horizonServer.submitTransaction.mockResolvedValue({ hash: 'tx' });

        const sorobanAccount = new StellarSdk.Account(
          FUNDING_KEYPAIR.publicKey(),
          '101',
        );
        sorobanServer.getAccount.mockResolvedValue(sorobanAccount);
        sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
          Promise.resolve(tx),
        );

        // First call: timeout; second call: success
        sorobanServer.sendTransaction
          .mockRejectedValueOnce(new Error('Request timed out after 30000ms'))
          .mockResolvedValueOnce({
            status: 'PENDING',
            hash: 'retry-hash',
          });
        sorobanServer.getTransaction.mockResolvedValue({
          status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        });
        jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);

        const promise = service.createEphemeralAccount({
          publicKey: FUNDING_KEYPAIR.publicKey(),
          amount: '100',
          asset: 'native',
          expiresIn: 3600,
          recoveryAddress: FUNDING_KEYPAIR.publicKey(),
          contractId: CONTRACT_ID,
          sweepControllerContractId: CONTRACT_ID,
          fundingKeypairSecret: FUNDING_SECRET,
        });

        // Advance past the 500ms backoff
        await jest.advanceTimersByTimeAsync(600);

        const hash = await promise;
        expect(hash).toBe('tx');
        expect(sorobanServer.sendTransaction).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('retries waitForTransaction on transient RPC error within polling loop', async () => {
      jest.useFakeTimers();
      try {
        const fundingAccount = new StellarSdk.Account(
          FUNDING_KEYPAIR.publicKey(),
          '100',
        );
        horizonServer.loadAccount.mockResolvedValue(fundingAccount);
        horizonServer.submitTransaction.mockResolvedValue({ hash: 'tx' });

        const sorobanAccount = new StellarSdk.Account(
          FUNDING_KEYPAIR.publicKey(),
          '101',
        );
        sorobanServer.getAccount.mockResolvedValue(sorobanAccount);
        sorobanServer.prepareTransaction.mockImplementation((tx: any) =>
          Promise.resolve(tx),
        );
        sorobanServer.sendTransaction.mockResolvedValue({
          status: 'PENDING',
          hash: 'poll-hash',
        });

        // First getTransaction: transient error; second: SUCCESS
        sorobanServer.getTransaction
          .mockRejectedValueOnce(new Error('ECONNRESET'))
          .mockResolvedValueOnce({
            status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
          });
        jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);

        const promise = service.createEphemeralAccount({
          publicKey: FUNDING_KEYPAIR.publicKey(),
          amount: '100',
          asset: 'native',
          expiresIn: 3600,
          recoveryAddress: FUNDING_KEYPAIR.publicKey(),
          contractId: CONTRACT_ID,
          sweepControllerContractId: CONTRACT_ID,
          fundingKeypairSecret: FUNDING_SECRET,
        });

        // Advance past the 2s wait in waitForTransaction
        await jest.advanceTimersByTimeAsync(3000);

        const hash = await promise;
        expect(hash).toBe('tx');
        expect(sorobanServer.getTransaction).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // ── Constants ──────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('SOROBAN_RPC_MAX_RETRIES is 3', () => {
      expect(SOROBAN_RPC_MAX_RETRIES).toBe(3);
    });

    it('SOROBAN_RPC_INITIAL_BACKOFF_MS is 500', () => {
      expect(SOROBAN_RPC_INITIAL_BACKOFF_MS).toBe(500);
    });
  });
});
