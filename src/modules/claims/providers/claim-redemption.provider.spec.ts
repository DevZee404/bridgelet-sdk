import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClaimRedemptionProvider } from './claim-redemption.provider.js';
import { TokenVerificationProvider } from './token-verification.provider.js';
import { Claim } from '../entities/claim.entity.js';
import { Account } from '../../accounts/entities/account.entity.js';
import { SweepsService } from '../../sweeps/sweeps.service.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { ConfigService } from '@nestjs/config';
import { SecretEncryptionUtil } from '../../../common/crypto/secret-encryption.util.js';
import { WebhooksService } from '../../webhooks/webhooks.service.js';

describe('ClaimRedemptionProvider', () => {
  let provider: ClaimRedemptionProvider;

  const mockClaimsRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockAccountsRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockTokenVerificationProvider = {
    verifyClaimToken: jest.fn(),
  };

  const mockSweepsService = {
    executeSweep: jest.fn(),
  };

  const mockWebhooksService = {
    triggerEvent: jest.fn(),
  };

  const VALID_DESTINATION =
    'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';
  const VALID_TOKEN = 'valid.jwt.token';

  const mockAccount: Partial<Account> = {
    id: 'account-uuid-1234',
    publicKey: 'GPUBKEY47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL',
    secretKeyEncrypted: Buffer.from('test-secret').toString('base64'),
    claimTokenHash: 'mock-token-hash',
    amount: '100.0000000',
    asset: 'native',
    status: AccountStatus.PENDING_CLAIM,
    expiresAt: new Date(Date.now() + 86_400_000),
    metadata: { userId: 'user-123' },
    destinationAddress: '',
    claimedAt: null,
  };

  const mockSweepResult = {
    txHash: 'a'.repeat(64),
    success: true,
  };

  const mockClaim: Partial<Claim> = {
    id: 'claim-uuid-5678',
    accountId: mockAccount.id,
    destinationAddress: VALID_DESTINATION,
    sweepTxHash: mockSweepResult.txHash,
    amountSwept: mockAccount.amount,
    asset: mockAccount.asset,
    claimedAt: new Date('2026-02-19T10:00:00.000Z'),
  };

  /** Creates a mock EntityManager whose QueryBuilder returns the given account */
  function makeManager(lockedAccount: Partial<Account> | null) {
    const qb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(lockedAccount),
    };
    return {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      save: jest.fn().mockImplementation((e: unknown) => Promise.resolve(e)),
      create: jest.fn().mockImplementation((_Entity, data) => ({ ...data })),
      qb,
    };
  }

  /**
   * Builds a DataSource mock that:
   *  - 1st call: acquires lock and sets CLAIMING (returns account in CLAIMING state)
   *  - 2nd call: finalises CLAIMED and saves claim record (returns mockClaim)
   */
  function makeHappyPathDataSource() {
    const claimingAccount = { ...mockAccount, status: AccountStatus.CLAIMING };
    const mgr1 = makeManager({ ...mockAccount });
    const mgr2 = makeManager(null); // not used for lock in 2nd txn

    return {
      transaction: jest
        .fn()
        .mockImplementationOnce(
          async (cb: (m: unknown) => Promise<unknown>) => {
            mgr1.save.mockResolvedValue(claimingAccount);
            return cb(mgr1);
          },
        )
        .mockImplementationOnce(
          async (cb: (m: unknown) => Promise<unknown>) => {
            // save is called twice: once for account update, once for new claim
            mgr2.save
              .mockResolvedValueOnce(undefined) // save(account)
              .mockResolvedValueOnce({ ...mockClaim }); // save(newClaim)
            mgr2.create.mockReturnValue({ ...mockClaim });
            return cb(mgr2);
          },
        ),
      _mgr1: mgr1,
    };
  }

  async function buildModule(dataSourceValue: object) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimRedemptionProvider,
        { provide: getRepositoryToken(Claim), useValue: mockClaimsRepository },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountsRepository,
        },
        { provide: getDataSourceToken(), useValue: dataSourceValue },
        {
          provide: TokenVerificationProvider,
          useValue: mockTokenVerificationProvider,
        },
        { provide: SweepsService, useValue: mockSweepsService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('mock-value'),
            getOrThrow: jest.fn().mockReturnValue('a'.repeat(64)),
          },
        },
        { provide: WebhooksService, useValue: mockWebhooksService },
      ],
    }).compile();

    jest.spyOn(SecretEncryptionUtil, 'decrypt').mockReturnValue('test-secret');
    return module.get<ClaimRedemptionProvider>(ClaimRedemptionProvider);
  }

  beforeEach(async () => {
    const ds = makeHappyPathDataSource();
    provider = await buildModule(ds);

    mockTokenVerificationProvider.verifyClaimToken.mockResolvedValue({
      valid: true,
    });
    mockAccountsRepository.findOne.mockResolvedValue({ ...mockAccount });
    mockAccountsRepository.update.mockResolvedValue(undefined);
    mockSweepsService.executeSweep.mockResolvedValue(mockSweepResult);
    mockClaimsRepository.findOne.mockResolvedValue({ ...mockClaim });
    mockWebhooksService.triggerEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAccountStatus', () => {
    it('throws BadRequestException with setup message for INITIALIZING status', async () => {
      mockTokenVerificationProvider.verifyClaimToken.mockRejectedValue(
        new BadRequestException('This account is still being set up'),
      );

      await expect(
        provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION),
      ).rejects.toThrow('still being set up');
    });
  });

  describe('redeemClaim - successful redemption', () => {
    it('should successfully redeem claim and execute sweep', async () => {
      const result = await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(result).toEqual({
        success: true,
        txHash: mockSweepResult.txHash,
        amountSwept: mockAccount.amount,
        asset: mockAccount.asset,
        destination: VALID_DESTINATION,
        sweptAt: expect.any(Date),
      });
    });

    it('should acquire SELECT FOR UPDATE lock before setting status to CLAIMING', async () => {
      // Rebuild with a spy-able dataSource so we can inspect the qb inside the callback
      const ds = makeHappyPathDataSource();
      const p = await buildModule(ds);
      await p.redeemClaim(VALID_TOKEN, VALID_DESTINATION);
      expect(ds._mgr1.qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('should call SweepsService.executeSweep with correct parameters', async () => {
      await provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(mockSweepsService.executeSweep).toHaveBeenCalledWith({
        accountId: mockAccount.id,
        ephemeralPublicKey: mockAccount.publicKey,
        ephemeralSecret: 'test-secret',
        destinationAddress: VALID_DESTINATION,
        amount: mockAccount.amount,
        asset: mockAccount.asset,
      });
    });

    it('should use two DB transactions: one to acquire CLAIMING, one to finalise CLAIMED', async () => {
      const ds = makeHappyPathDataSource();
      const p = await buildModule(ds);
      await p.redeemClaim(VALID_TOKEN, VALID_DESTINATION);
      expect(ds.transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('redeemClaim - idempotency for already-claimed accounts', () => {
    it('should return idempotent response when SELECT FOR UPDATE finds CLAIMED account', async () => {
      const claimedAccount = { ...mockAccount, status: AccountStatus.CLAIMED };
      const ds = {
        transaction: jest
          .fn()
          .mockImplementationOnce(
            async (cb: (m: unknown) => Promise<unknown>) =>
              cb(makeManager(claimedAccount)),
          ),
      };
      const p = await buildModule(ds);
      mockClaimsRepository.findOne.mockResolvedValue({ ...mockClaim });

      const result = await p.redeemClaim(VALID_TOKEN, VALID_DESTINATION);

      expect(result).toEqual({
        success: true,
        txHash: mockClaim.sweepTxHash,
        amountSwept: mockClaim.amountSwept,
        asset: mockClaim.asset,
        destination: mockClaim.destinationAddress,
        sweptAt: mockClaim.claimedAt,
        message: 'Claim was already redeemed',
      });
    });

    it('should handle ConflictException from token verification and return existing claim data', async () => {
      const ds = makeHappyPathDataSource();
      const p = await buildModule(ds);

      mockTokenVerificationProvider.verifyClaimToken.mockRejectedValue(
        new ConflictException('Claim has already been redeemed'),
      );
      mockAccountsRepository.findOne.mockResolvedValue({
        ...mockAccount,
        status: AccountStatus.CLAIMED,
      });
      mockClaimsRepository.findOne.mockResolvedValue({
        ...mockClaim,
        sweepTxHash: 'conflict-tx-hash',
      });

      const result = await p.redeemClaim(VALID_TOKEN, VALID_DESTINATION);
      expect(result.message).toBe('Claim was already redeemed');
    });

    it('should throw ConflictException when account is in CLAIMING state (concurrent request)', async () => {
      const claimingAccount = {
        ...mockAccount,
        status: AccountStatus.CLAIMING,
      };
      const ds = {
        transaction: jest
          .fn()
          .mockImplementationOnce(
            async (cb: (m: unknown) => Promise<unknown>) =>
              cb(makeManager(claimingAccount)),
          ),
      };
      const p = await buildModule(ds);

      await expect(
        p.redeemClaim(VALID_TOKEN, VALID_DESTINATION),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('redeemClaim - Stellar address validation', () => {
    it('should throw BadRequestException for an address with invalid format', async () => {
      await expect(
        provider.redeemClaim(VALID_TOKEN, 'invalid-address'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an address not starting with G', async () => {
      await expect(
        provider.redeemClaim(
          VALID_TOKEN,
          'SABCD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an address shorter than 56 characters', async () => {
      await expect(provider.redeemClaim(VALID_TOKEN, 'GSHORT')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for an address longer than 56 characters', async () => {
      await expect(
        provider.redeemClaim(VALID_TOKEN, VALID_DESTINATION + 'EXTRA'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('redeemClaim - sweep failure and rollback', () => {
    it('should rollback account status to PENDING_CLAIM when sweep fails', async () => {
      const ds = makeHappyPathDataSource();
      const p = await buildModule(ds);
      mockSweepsService.executeSweep.mockRejectedValue(
        new Error('Stellar network error'),
      );

      await expect(
        p.redeemClaim(VALID_TOKEN, VALID_DESTINATION),
      ).rejects.toThrow();

      expect(mockAccountsRepository.update).toHaveBeenCalledWith(
        mockAccount.id,
        expect.objectContaining({ status: AccountStatus.PENDING_CLAIM }),
      );
    });

    it('should re-throw the original sweep error after rolling back account status', async () => {
      const ds = makeHappyPathDataSource();
      const p = await buildModule(ds);
      mockSweepsService.executeSweep.mockRejectedValue(
        new Error('Stellar network error'),
      );

      await expect(
        p.redeemClaim(VALID_TOKEN, VALID_DESTINATION),
      ).rejects.toThrow('Stellar network error');
    });
  });
});
