import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ClaimsService } from './claims.service.js';
import { TokenVerificationProvider } from './providers/token-verification.provider.js';
import { ClaimRedemptionProvider } from './providers/claim-redemption.provider.js';
import { ClaimLookupProvider } from './providers/claim-lookup.provider.js';
import { Claim } from './entities/claim.entity.js';
import { Account, AccountStatus } from '../accounts/entities/account.entity.js';
import { SweepsService } from '../sweeps/sweeps.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import jwt from 'jsonwebtoken';

// Mock jwt
jest.mock('jsonwebtoken');

describe('ClaimsService', () => {
  let service: ClaimsService;
  let tokenVerificationProvider: TokenVerificationProvider;
  let claimRedemptionProvider: ClaimRedemptionProvider;
  let claimLookupProvider: ClaimLookupProvider;

  const mockClaimRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockAccountRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const mockSweepsService = {
    executeSweep: jest.fn(),
  };

  const mockWebhooksService = {
    triggerEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimsService,
        TokenVerificationProvider,
        ClaimRedemptionProvider,
        ClaimLookupProvider,
        {
          provide: getRepositoryToken(Claim),
          useValue: mockClaimRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: SweepsService,
          useValue: mockSweepsService,
        },
        {
          provide: WebhooksService,
          useValue: mockWebhooksService,
        },
      ],
    }).compile();

    service = module.get<ClaimsService>(ClaimsService);
    tokenVerificationProvider = module.get<TokenVerificationProvider>(
      TokenVerificationProvider,
    );
    claimRedemptionProvider = module.get<ClaimRedemptionProvider>(
      ClaimRedemptionProvider,
    );
    claimLookupProvider = module.get<ClaimLookupProvider>(ClaimLookupProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('TokenVerificationProvider', () => {
    const validToken = 'valid.jwt.token';
    const tokenHash =
      '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';

    const mockAccount = {
      id: 'account-id',
      publicKey: 'GTEST...',
      claimTokenHash: tokenHash,
      amount: '100.0000000',
      asset: 'native',
      status: AccountStatus.PENDING_CLAIM,
      expiresAt: new Date(Date.now() + 86400000), // 24 hours from now
    };

    const mockDecodedToken = {
      publicKey: 'GTEST...',
      type: 'claim',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    beforeEach(() => {
      mockConfigService.getOrThrow.mockReturnValue('test-secret');
      (jwt.verify as jest.Mock).mockReturnValue(mockDecodedToken);
    });

    it('should successfully verify valid token with eligible account', async () => {
      mockAccountRepository.findOne.mockResolvedValue(mockAccount);

      const result =
        await tokenVerificationProvider.verifyClaimToken(validToken);

      expect(result).toEqual({
        valid: true,
        accountId: mockAccount.id,
        amount: mockAccount.amount,
        asset: mockAccount.asset,
        expiresAt: mockAccount.expiresAt,
      });
      expect(jwt.verify).toHaveBeenCalledWith(validToken, 'test-secret');
    });

    it('should return correct verification response with amount and expiry', async () => {
      mockAccountRepository.findOne.mockResolvedValue(mockAccount);

      const result =
        await tokenVerificationProvider.verifyClaimToken(validToken);

      expect(result.valid).toBe(true);
      expect(result.amount).toBe('100.0000000');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should throw UnauthorizedException for expired JWT', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        const error: any = new Error('jwt expired');
        error.name = 'TokenExpiredError';
        throw error;
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid JWT signature', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        const error: any = new Error('invalid signature');
        error.name = 'JsonWebTokenError';
        throw error;
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for token with wrong type', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({
        ...mockDecodedToken,
        type: 'access',
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent account', async () => {
      mockAccountRepository.findOne.mockResolvedValue(null);

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw ConflictException for already claimed account', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        status: AccountStatus.CLAIMED,
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw UnauthorizedException for expired account', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        status: AccountStatus.EXPIRED,
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException for account without payment', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        status: AccountStatus.PENDING_PAYMENT,
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException when current time exceeds expiry', async () => {
      mockAccountRepository.findOne.mockResolvedValue({
        ...mockAccount,
        expiresAt: new Date(Date.now() - 1000), // Already expired
      });

      await expect(
        tokenVerificationProvider.verifyClaimToken(validToken),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('ClaimLookupProvider', () => {
    const claimId = 'claim-id-123';

    const mockClaim = {
      id: claimId,
      accountId: 'account-id',
      destinationAddress: 'GDEST...',
      amountSwept: '100.0000000',
      asset: 'native',
      sweepTxHash: 'tx-hash',
      claimedAt: new Date('2026-01-14T17:49:20.265Z'),
      account: {
        id: 'account-id',
        publicKey: 'GTEST...',
      },
    };

    it('should retrieve claim by ID with account relation', async () => {
      mockClaimRepository.findOne.mockResolvedValue(mockClaim);

      await claimLookupProvider.findClaimById(claimId);

      expect(mockClaimRepository.findOne).toHaveBeenCalledWith({
        where: { id: claimId },
        relations: ['account'],
      });
    });

    it('should return properly formatted ClaimDetailsDto', async () => {
      mockClaimRepository.findOne.mockResolvedValue(mockClaim);

      const result = await claimLookupProvider.findClaimById(claimId);

      expect(result).toEqual({
        id: mockClaim.id,
        accountId: mockClaim.accountId,
        destinationAddress: mockClaim.destinationAddress,
        amountSwept: mockClaim.amountSwept,
        asset: mockClaim.asset,
        sweepTxHash: mockClaim.sweepTxHash,
        claimedAt: mockClaim.claimedAt,
      });
    });

    it('should throw NotFoundException when claim does not exist', async () => {
      mockClaimRepository.findOne.mockResolvedValue(null);

      await expect(claimLookupProvider.findClaimById(claimId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('ClaimsService Integration - Token & Lookup', () => {
    const validToken = 'valid.jwt.token';
    const claimId = 'claim-id';

    const mockVerificationResponse = {
      valid: true,
      accountId: 'account-id',
      amount: '100.0000000',
      asset: 'native',
      expiresAt: new Date(),
    };

    const mockClaimDetails = {
      id: claimId,
      accountId: 'account-id',
      destinationAddress:
        'GDEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      amountSwept: '100.0000000',
      asset: 'native',
      sweepTxHash: 'tx-hash',
      claimedAt: new Date(),
    };

    it('should delegate verifyClaimToken to TokenVerificationProvider', async () => {
      jest
        .spyOn(tokenVerificationProvider, 'verifyClaimToken')
        .mockResolvedValue(mockVerificationResponse);

      const result = await service.verifyClaimToken(validToken);

      expect(tokenVerificationProvider.verifyClaimToken).toHaveBeenCalledWith(
        validToken,
      );
      expect(result).toEqual(mockVerificationResponse);
    });

    it('should delegate findClaimById to ClaimLookupProvider', async () => {
      jest
        .spyOn(claimLookupProvider, 'findClaimById')
        .mockResolvedValue(mockClaimDetails);

      const result = await service.findClaimById(claimId);

      expect(claimLookupProvider.findClaimById).toHaveBeenCalledWith(claimId);
      expect(result).toEqual(mockClaimDetails);
    });

    it('should properly pass parameters to providers', async () => {
      jest
        .spyOn(tokenVerificationProvider, 'verifyClaimToken')
        .mockResolvedValue(mockVerificationResponse);

      await service.verifyClaimToken(validToken);

      expect(tokenVerificationProvider.verifyClaimToken).toHaveBeenCalledWith(
        validToken,
      );
    });

    it('should return provider responses unchanged', async () => {
      jest
        .spyOn(tokenVerificationProvider, 'verifyClaimToken')
        .mockResolvedValue(mockVerificationResponse);

      const result = await service.verifyClaimToken(validToken);

      expect(result).toBe(mockVerificationResponse);
    });
  });
});
