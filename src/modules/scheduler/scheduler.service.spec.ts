import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Account } from '../accounts/entities/account.entity.js';
import { ClaimAuditLog } from '../claims/entities/claim-audit-log.entity.js';
import { AccountStatus } from '../accounts/enums/account-status.enum.js';
import { SchedulerService } from './scheduler.service.js';
import { StellarService } from '../stellar/stellar.service.js';
import { SweepsService } from '../sweeps/sweeps.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { KmsKeyProvider } from '../../common/crypto/kms-key.provider.js';
import { SecretEncryptionUtil } from '../../common/crypto/secret-encryption.util.js';

const makeAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 'acc-uuid-1',
    publicKey: 'GPUBKEY1234',
    contractId: 'CONTRACT123',
    status: AccountStatus.PENDING_PAYMENT,
    secretKeyEncrypted: 'enc',
    fundingSource: 'GFUNDING',
    amount: '100',
    asset: 'USDC',
    claimTokenHash: 'abc123',
    destinationAddress: null,
    expiresAt: new Date(Date.now() - 60_000),
    createdAt: new Date(Date.now() - 3_600_000),
    updatedAt: new Date(),
    claimedAt: null,
    expiredAt: null,
    deletedAt: null,
    metadata: null,
    ...overrides,
  }) as Account;

describe('SchedulerService', () => {
  let service: SchedulerService;
  let stellarService: {
    expireAccount: jest.MockedFunction<StellarService['expireAccount']>;
  };
  let sweepsService: {
    executeRecoverySweep: jest.MockedFunction<
      SweepsService['executeRecoverySweep']
    >;
  };
  let accountsRepo: {
    find: jest.MockedFunction<() => Promise<Account[]>>;
    update: jest.MockedFunction<() => Promise<any>>;
  };
  let claimAuditRepo: {
    delete: jest.MockedFunction<() => Promise<any>>;
  };

  beforeEach(async () => {
    accountsRepo = {
      find: jest.fn<() => Promise<Account[]>>().mockResolvedValue([]),
      update: jest.fn<() => Promise<any>>().mockResolvedValue({ affected: 1 }),
    };

    claimAuditRepo = {
      delete: jest.fn<() => Promise<any>>().mockResolvedValue({ affected: 0 }),
    };

    const stellarMock = {
      expireAccount: jest
        .fn<StellarService['expireAccount']>()
        .mockResolvedValue(undefined),
    };

    const sweepsMock = {
      executeRecoverySweep: jest
        .fn<SweepsService['executeRecoverySweep']>()
        .mockResolvedValue({ success: true, txHash: 'a'.repeat(64) }),
    };

    const configMock = {
      get: jest.fn((key: string) => {
        if (key === 'app.claimAuditRetentionDays') return 90;
        return undefined;
      }),
      getOrThrow: jest.fn((key: string) => {
        const map: Record<string, string> = {
          'stellar.fundingSecret': 'SFUNDING_SECRET',
        };
        if (!(key in map)) throw new Error(`Config key not found: ${key}`);
        return map[key];
      }),
    };

    const webhooksMock = {
      triggerEvent: jest
        .fn<WebhooksService['triggerEvent']>()
        .mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: getRepositoryToken(Account), useValue: accountsRepo },
        {
          provide: getRepositoryToken(ClaimAuditLog),
          useValue: claimAuditRepo,
        },
        { provide: StellarService, useValue: stellarMock },
        { provide: SweepsService, useValue: sweepsMock },
        { provide: ConfigService, useValue: configMock },
        { provide: WebhooksService, useValue: webhooksMock },
        {
          provide: KmsKeyProvider,
          useValue: {
            getEncryptionKey: jest.fn().mockReturnValue('a'.repeat(64)),
          },
        },
      ],
    }).compile();

    service = module.get(SchedulerService);
    stellarService = module.get(StellarService);
    sweepsService = module.get(SweepsService);

    jest.spyOn(SecretEncryptionUtil, 'decrypt').mockReturnValue('SSECRET');

    jest.spyOn(service, 'onModuleInit').mockImplementation(() => undefined);
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('starts two setIntervals on init and clears both on destroy', () => {
      jest.restoreAllMocks();

      const handles = [111, 222];
      let callCount = 0;
      const setIntervalSpy = jest
        .spyOn(global, 'setInterval')
        .mockImplementation(() => handles[callCount++] as any);
      const clearIntervalSpy = jest
        .spyOn(global, 'clearInterval')
        .mockImplementation(() => undefined);

      service.onModuleInit();
      expect(setInterval).toHaveBeenCalledTimes(2);

      service.onModuleDestroy();
      expect(clearInterval).toHaveBeenCalledWith(111);
      expect(clearInterval).toHaveBeenCalledWith(222);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });

  describe('runExpiryJob()', () => {
    it('calls expireAccount(), recovery sweep, and invalidates claim token (issues #477/#487)', async () => {
      const account = makeAccount({
        status: AccountStatus.PENDING_CLAIM,
        claimTokenHash: 'deadbeef',
      });
      accountsRepo.find.mockResolvedValueOnce([account]);

      await service.runExpiryJob();

      expect(stellarService.expireAccount).toHaveBeenCalledWith({
        contractId: 'CONTRACT123',
        signerSecret: 'SFUNDING_SECRET',
      });
      expect(sweepsService.executeRecoverySweep).toHaveBeenCalledWith(
        account.id,
        account.publicKey,
        'SSECRET',
        account.amount,
        account.asset,
      );
      expect(accountsRepo.update).toHaveBeenCalledWith(account.id, {
        status: AccountStatus.EXPIRED,
        expiredAt: expect.any(Date),
        claimTokenHash: null,
        destinationAddress: '',
      });
    });

    it('processes PENDING_CLAIM accounts too', async () => {
      const account = makeAccount({ status: AccountStatus.PENDING_CLAIM });
      accountsRepo.find.mockResolvedValueOnce([account]);

      await service.runExpiryJob();

      expect(stellarService.expireAccount).toHaveBeenCalledTimes(1);
      expect(accountsRepo.update).toHaveBeenCalledWith(account.id, {
        status: AccountStatus.EXPIRED,
        expiredAt: expect.any(Date),
        claimTokenHash: null,
        destinationAddress: '',
      });
    });

    it('does nothing when no expired accounts are found', async () => {
      accountsRepo.find.mockResolvedValueOnce([]);

      await service.runExpiryJob();

      expect(stellarService.expireAccount).not.toHaveBeenCalled();
      expect(sweepsService.executeRecoverySweep).not.toHaveBeenCalled();
    });

    it('queries only accounts with expiresAt in the past', async () => {
      await service.runExpiryJob();

      expect(accountsRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({
              status: AccountStatus.PENDING_PAYMENT,
            }),
            expect.objectContaining({
              status: AccountStatus.PENDING_CLAIM,
            }),
          ]),
        }),
      );
    });

    it('purges stale claim audit logs after processing', async () => {
      accountsRepo.find.mockResolvedValueOnce([]);

      await service.runExpiryJob();

      expect(claimAuditRepo.delete).toHaveBeenCalled();
    });
  });

  describe('runExpiryJob() failure isolation', () => {
    it('continues processing other accounts when one expireAccount() call fails', async () => {
      const acc1 = makeAccount({ id: 'a1', publicKey: 'GPK1' });
      const acc2 = makeAccount({ id: 'a2', publicKey: 'GPK2' });
      accountsRepo.find.mockResolvedValueOnce([acc1, acc2]);

      stellarService.expireAccount
        .mockRejectedValueOnce(new Error('Soroban RPC unavailable'))
        .mockResolvedValueOnce(undefined);

      await expect(service.runExpiryJob()).resolves.not.toThrow();

      expect(stellarService.expireAccount).toHaveBeenCalledTimes(2);
      expect(accountsRepo.update).toHaveBeenCalledWith(
        'a2',
        expect.objectContaining({ status: AccountStatus.EXPIRED }),
      );
    });

    it('does not throw when the DB query itself fails', async () => {
      accountsRepo.find.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(service.runExpiryJob()).resolves.not.toThrow();
      expect(stellarService.expireAccount).not.toHaveBeenCalled();
    });
  });

  describe('runExpiredClaimCleanup()', () => {
    it('invalidates claim tokens on already-expired accounts', async () => {
      await service.runExpiredClaimCleanup();

      expect(accountsRepo.update).toHaveBeenCalled();
    });
  });

  describe('runInitializingCleanup()', () => {
    it('marks stale INITIALIZING accounts as FAILED with metadata', async () => {
      const account = makeAccount({
        status: AccountStatus.INITIALIZING,
        createdAt: new Date(Date.now() - 700_000),
        metadata: { existingKey: 'value' },
      });
      accountsRepo.find.mockResolvedValueOnce([account]);

      await service.runInitializingCleanup();

      expect(accountsRepo.update).toHaveBeenCalledWith(account.id, {
        status: AccountStatus.FAILED,
        metadata: {
          existingKey: 'value',
          failureReason: 'initialization_timeout',
          detectedAt: expect.any(String),
        },
      });
    });

    it('does not call expireAccount() for INITIALIZING accounts', async () => {
      const account = makeAccount({ status: AccountStatus.INITIALIZING });
      accountsRepo.find.mockResolvedValueOnce([account]);

      await service.runInitializingCleanup();

      expect(stellarService.expireAccount).not.toHaveBeenCalled();
    });

    it('emits an error-level alert log when stale accounts are found (issue #463)', async () => {
      const account = makeAccount({
        id: 'a1',
        status: AccountStatus.INITIALIZING,
        createdAt: new Date(Date.now() - 700_000),
      });
      accountsRepo.find.mockResolvedValueOnce([account]);

      const errorSpy = jest.spyOn((service as any).logger, 'error');
      errorSpy.mockImplementation(() => undefined);

      await service.runInitializingCleanup();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ALERT'));
      errorSpy.mockRestore();
    });

    it('does nothing when no stale INITIALIZING accounts are found', async () => {
      accountsRepo.find.mockResolvedValueOnce([]);

      await service.runInitializingCleanup();

      expect(accountsRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('metadata handling', () => {
    it('merges failureReason into existing metadata without overwriting other keys', async () => {
      const account = makeAccount({
        status: AccountStatus.INITIALIZING,
        metadata: { source: 'api', userId: 'u1' },
      });
      accountsRepo.find.mockResolvedValueOnce([account]);

      await service.runInitializingCleanup();

      expect(accountsRepo.update).toHaveBeenCalledWith(
        account.id,
        expect.objectContaining({
          metadata: expect.objectContaining({
            source: 'api',
            userId: 'u1',
            failureReason: 'initialization_timeout',
          }),
        }),
      );
    });
  });
});
