import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Account } from '../../accounts/entities/account.entity.js';
import { ValidationProvider } from './validation.provider.js';
import { StrKey } from '@stellar/stellar-sdk';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { SweepKind } from '../enums/sweep-kind.enum.js';

const RECOVERY_ADDRESS =
  'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';
const AUTHORIZED_DESTINATION =
  'GBBM6BKZPEHWYO3E3YKRETPKQ5MRNWSKA722GHBMZABXD4F2J33665O';
const UNAUTHORIZED_DESTINATION =
  'GCUE52GZKMA7S2Y7RUDAKP6RKDWAPQK6GYPFHTLDADQ3TBRK4SRRN3X2';

const mockAccount = (overrides: Partial<Account> = {}): Account =>
  ({
    id: 'acc-123',
    publicKey: 'GAB...',
    ephemeralSecret: 'S...',
    status: AccountStatus.CLAIMING,
    expiresAt: new Date(Date.now() + 86400000),
    amount: '100',
    asset: 'native',
    destinationAddress: AUTHORIZED_DESTINATION,
    ...overrides,
  }) as Account;

describe('ValidationProvider', () => {
  let provider: ValidationProvider;
  let repo: Repository<Account>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationProvider,
        {
          provide: getRepositoryToken(Account),
          useClass: Repository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'stellar.recoveryPublic') return RECOVERY_ADDRESS;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    provider = module.get<ValidationProvider>(ValidationProvider);
    repo = module.get<Repository<Account>>(getRepositoryToken(Account));
    jest.spyOn(StrKey, 'isValidEd25519PublicKey').mockReturnValue(true);
  });

  describe('validateSweepParameters — claim sweeps (issue #486)', () => {
    const base = {
      accountId: 'acc-123',
      ephemeralPublicKey: 'GABC123',
      ephemeralSecret: 'SABC123',
      amount: '100',
      asset: 'native',
      sweepKind: SweepKind.CLAIM,
    };

    it('derives destination from the locked account record', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );

      const result = await provider.validateSweepParameters(base);
      expect(result.destinationAddress).toBe(AUTHORIZED_DESTINATION);
    });

    it('rejects sweep to an unauthorized destination and logs security event', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      const errorSpy = jest
        .spyOn((provider as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(
        provider.validateSweepParameters({
          ...base,
          destinationAddress: UNAUTHORIZED_DESTINATION,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('SECURITY: sweep destination mismatch'),
      );
      errorSpy.mockRestore();
    });

    it('throws when no authorized destination is stored on the account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          destinationAddress: '',
        }),
      );

      await expect(provider.validateSweepParameters(base)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateSweepParameters — recovery sweeps (issue #487)', () => {
    const base = {
      accountId: 'acc-123',
      ephemeralPublicKey: 'GABC123',
      ephemeralSecret: 'SABC123',
      amount: '100',
      asset: 'native',
      sweepKind: SweepKind.RECOVERY,
    };

    it('derives destination from RECOVERY_ACCOUNT_PUBLIC config', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          status: AccountStatus.PENDING_CLAIM,
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      const result = await provider.validateSweepParameters(base);
      expect(result.destinationAddress).toBe(RECOVERY_ADDRESS);
    });

    it('rejects substituted recovery destination', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          status: AccountStatus.PENDING_CLAIM,
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(
        provider.validateSweepParameters({
          ...base,
          destinationAddress: UNAUTHORIZED_DESTINATION,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects recovery sweep before account expiry', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          status: AccountStatus.PENDING_CLAIM,
          expiresAt: new Date(Date.now() + 86400000),
        }),
      );

      await expect(provider.validateSweepParameters(base)).rejects.toThrow(
        'Account has not expired yet',
      );
    });
  });

  describe('validateSweepParameters', () => {
    const validDto = {
      accountId: 'acc-123',
      ephemeralPublicKey: 'GABC123',
      ephemeralSecret: 'SABC123',
      amount: '100',
      asset: 'native',
      sweepKind: SweepKind.CLAIM,
    };

    it('should pass validation for valid parameters', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: validDto.ephemeralPublicKey,
          amount: validDto.amount,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );

      await expect(
        provider.validateSweepParameters(validDto),
      ).resolves.toMatchObject({
        destinationAddress: AUTHORIZED_DESTINATION,
      });
    });

    it('should throw NotFoundException for non-existent account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(null);

      await expect(provider.validateSweepParameters(validDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for CLAIMED status', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.CLAIMED,
          publicKey: validDto.ephemeralPublicKey,
        }),
      );

      await expect(provider.validateSweepParameters(validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for EXPIRED status (logic check)', async () => {
      const pastDate = new Date(Date.now() - 10000);
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_CLAIM,
          expiresAt: pastDate,
          publicKey: validDto.ephemeralPublicKey,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );

      await expect(provider.validateSweepParameters(validDto)).rejects.toThrow(
        'Account has expired',
      );
    });

    it('should throw BadRequestException for PENDING_PAYMENT status', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_PAYMENT,
          publicKey: validDto.ephemeralPublicKey,
        }),
      );

      await expect(provider.validateSweepParameters(validDto)).rejects.toThrow(
        'Account has not received payment yet',
      );
    });

    it('should throw BadRequestException for amount mismatch', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: validDto.ephemeralPublicKey,
          amount: '500',
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );

      await expect(provider.validateSweepParameters(validDto)).rejects.toThrow(
        /Amount mismatch/,
      );
    });

    it('should throw BadRequestException for asset mismatch', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: validDto.ephemeralPublicKey,
          amount: validDto.amount,
          asset: 'USDC:G...',
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );

      await expect(provider.validateSweepParameters(validDto)).rejects.toThrow(
        /Asset mismatch/,
      );
    });
  });

  describe('canSweep', () => {
    it('should return true for valid sweep conditions', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_CLAIM,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      const result = await provider.canSweep('acc-123', AUTHORIZED_DESTINATION);
      expect(result).toBe(true);
    });

    it('should return false when destination does not match account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_CLAIM,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      const result = await provider.canSweep(
        'acc-123',
        UNAUTHORIZED_DESTINATION,
      );
      expect(result).toBe(false);
    });

    it('should return false for non-existent account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(null);
      const result = await provider.canSweep('acc-123', AUTHORIZED_DESTINATION);
      expect(result).toBe(false);
    });

    it('should return false for expired account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_CLAIM,
          expiresAt: new Date(Date.now() - 1000),
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      const result = await provider.canSweep('acc-123', AUTHORIZED_DESTINATION);
      expect(result).toBe(false);
    });

    it('should not throw errors and return false on exception', async () => {
      jest.spyOn(repo, 'findOne').mockRejectedValue(new Error('DB Error'));
      const result = await provider.canSweep('acc-123', AUTHORIZED_DESTINATION);
      expect(result).toBe(false);
    });
  });

  describe('getSweepStatus', () => {
    it('should return canSweep true for valid account', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_CLAIM,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      const result = await provider.getSweepStatus('acc-123');
      expect(result).toEqual({ canSweep: true });
    });

    it('returns "Claim not initiated" when destination is unset', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          status: AccountStatus.PENDING_CLAIM,
          destinationAddress: '',
        }),
      );
      const result = await provider.getSweepStatus('acc-123');
      expect(result.reason).toBe('Claim not initiated');
    });

    it('should return "Account not found" for non-existent', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(null);
      const result = await provider.getSweepStatus('acc-123');
      expect(result.reason).toBe('Account not found');
    });

    it('should return "Already swept" for CLAIMED status', async () => {
      jest
        .spyOn(repo, 'findOne')
        .mockResolvedValue(mockAccount({ status: AccountStatus.CLAIMED }));
      const result = await provider.getSweepStatus('acc-123');
      expect(result.reason).toBe('Already swept');
    });

    it('returns "Account expired" for EXPIRED status', async () => {
      jest
        .spyOn(repo, 'findOne')
        .mockResolvedValue(mockAccount({ status: AccountStatus.EXPIRED }));
      const result = await provider.getSweepStatus('acc-123');
      expect(result.reason).toBe('Account expired');
    });

    it('returns "Payment not received" for PENDING_PAYMENT status', async () => {
      jest
        .spyOn(repo, 'findOne')
        .mockResolvedValue(
          mockAccount({ status: AccountStatus.PENDING_PAYMENT }),
        );
      const result = await provider.getSweepStatus('acc-123');
      expect(result.reason).toBe('Payment not received');
    });

    it('returns reason for account with no publicKey', async () => {
      jest
        .spyOn(repo, 'findOne')
        .mockResolvedValue(mockAccount({ publicKey: '' }));
      const result = await provider.getSweepStatus('acc-123');
      expect(result.canSweep).toBe(false);
    });
  });

  describe('validateSweepParameters — additional branches', () => {
    const base = {
      accountId: 'acc-123',
      ephemeralPublicKey: 'GAB...',
      ephemeralSecret: 'SABC123',
      amount: '100',
      asset: 'native',
      sweepKind: SweepKind.CLAIM,
    };

    it('throws when ephemeralPublicKey does not match account', async () => {
      jest
        .spyOn(repo, 'findOne')
        .mockResolvedValue(mockAccount({ publicKey: 'GDIFFERENT...' }));
      await expect(
        provider.validateSweepParameters({
          ...base,
          ephemeralPublicKey: 'GNOT_MATCHING',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when amount is zero', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      await expect(
        provider.validateSweepParameters({ ...base, amount: '0' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when amount is NaN', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      await expect(
        provider.validateSweepParameters({ ...base, amount: 'notanumber' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws for invalid asset format (not native and not CODE:ISSUER)', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          amount: '100',
          asset: 'BADFORMAT',
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      await expect(
        provider.validateSweepParameters({ ...base, asset: 'BADFORMAT' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('isValidAssetFormat — private method via validateSweepParameters', () => {
    const base = {
      accountId: 'acc-123',
      ephemeralPublicKey: 'GAB...',
      ephemeralSecret: 'SABC123',
      amount: '100',
      sweepKind: SweepKind.CLAIM,
    };

    it('rejects asset with no colon (single-part)', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          amount: '100',
          asset: 'USDC',
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      await expect(
        provider.validateSweepParameters({ ...base, asset: 'USDC' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects asset code that is too long (>12 chars)', async () => {
      jest.spyOn(repo, 'findOne').mockResolvedValue(
        mockAccount({
          publicKey: base.ephemeralPublicKey,
          amount: '100',
          asset: 'TOOLONGCODE1X:GABC',
          destinationAddress: AUTHORIZED_DESTINATION,
        }),
      );
      jest.spyOn(StrKey, 'isValidEd25519PublicKey').mockReturnValue(true);
      await expect(
        provider.validateSweepParameters({
          ...base,
          asset: 'TOOLONGCODE1X:GABC',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
