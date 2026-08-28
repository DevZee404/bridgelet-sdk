import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { getToken } from '@willsoto/nestjs-prometheus';
import { AccountsService } from './accounts.service.js';
import { Account } from './entities/account.entity.js';
import { StellarService } from '../stellar/stellar.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { AccountStatus } from './enums/account-status.enum.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AccountLatencyMetricsProvider } from './providers/account-latency-metrics.provider.js';
import { KmsKeyProvider } from '../../common/crypto/kms-key.provider.js';
import { JwtKeyRotationProvider } from '../../common/crypto/jwt-key-rotation.provider.js';
import {
  makeAccount,
  DEFAULT_PUBLIC_KEY as VALID_KEY,
  DEFAULT_FUNDING_SOURCE as VALID_KEY2,
} from '../../testing/factories/account.factory.js';

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockStellarService = {
  generateKeypair: jest.fn(),
  createEphemeralAccount: jest.fn(),
};

const mockJwtKeyRotation = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn().mockReturnValue({
    publicKey: 'test',
    type: 'claim',
    iat: 0,
    exp: 9999999999,
  }),
  getJwks: jest.fn().mockReturnValue({ keys: [] }),
};

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    const cfg: Record<string, string> = {
      'stellar.encryptionKey': 'a'.repeat(64),
      'stellar.contracts.ephemeralAccount': 'CONTRACT123',
      'stellar.contracts.sweepController': 'CONTRACT456',
    };
    const v = cfg[key];
    if (!v) throw new Error(`Config key not found: ${key}`);
    return v;
  }),
  get: jest.fn((key: string) => {
    if (key === 'app.claimTokenExpiry') return 2592000;
    return undefined;
  }),
};

const mockWebhooksService = {
  triggerEvent: jest.fn().mockResolvedValue(undefined),
};

describe('AccountsService', () => {
  let service: AccountsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default keypair mock
    mockStellarService.generateKeypair.mockReturnValue({
      publicKey: () => VALID_KEY,
      secret: () => 'STEST',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: getRepositoryToken(Account), useValue: mockRepo },
        { provide: StellarService, useValue: mockStellarService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WebhooksService, useValue: mockWebhooksService },
        AccountLatencyMetricsProvider,
        {
          provide: getToken('account_creation_total'),
          useValue: {
            inc: jest.fn(),
          },
        },
        {
          provide: KmsKeyProvider,
          useValue: {
            getEncryptionKey: jest.fn().mockReturnValue('a'.repeat(64)),
          },
        },
        {
          provide: JwtKeyRotationProvider,
          useValue: mockJwtKeyRotation,
        },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateAccountDto = {
      fundingSource: VALID_KEY2,
      amount: '100',
      asset: 'native',
      expiresIn: 3600,
    };

    it('returns an AccountResponseDto with publicKey and txHash on success', async () => {
      const saved = makeAccount();
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);
      mockStellarService.createEphemeralAccount.mockResolvedValue('txhash-abc');

      const result = await service.create(dto);

      expect(result.publicKey).toBe(VALID_KEY);
      expect(result.txHash).toBe('txhash-abc');
      expect(result.status).toBe(AccountStatus.PENDING_PAYMENT);
    });

    it('stamps the owning integratorId on the account', async () => {
      const saved = makeAccount();
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);
      mockStellarService.createEphemeralAccount.mockResolvedValue('txhash-abc');

      await service.create(dto, 'integrator-1');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ integratorId: 'integrator-1' }),
      );
    });

    it('rejects native funding below the configured Stellar minimum reserve before any on-chain call', async () => {
      const lowDto: CreateAccountDto = {
        fundingSource: VALID_KEY2,
        amount: '0.1',
        asset_code: 'native',
        expiresIn: 3600,
      };

      mockConfigService.get.mockReturnValue(0.5);

      await expect(service.create(lowDto)).rejects.toThrow(
        'Stellar minimum reserve',
      );
      expect(mockStellarService.createEphemeralAccount).not.toHaveBeenCalled();
    });

    it('passes expiresIn to createEphemeralAccount for ledger conversion', async () => {
      const saved = makeAccount();
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);
      mockStellarService.createEphemeralAccount.mockResolvedValue('txhash-abc');

      await service.create(dto);

      expect(mockStellarService.createEphemeralAccount).toHaveBeenCalledWith(
        expect.objectContaining({ expiresIn: 3600 }),
      );
    });

    it('triggers account.created webhook after success', async () => {
      const saved = makeAccount();
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);
      mockStellarService.createEphemeralAccount.mockResolvedValue('txhash-abc');

      await service.create(dto);

      expect(mockWebhooksService.triggerEvent).toHaveBeenCalledWith(
        'account.created',
        expect.objectContaining({ publicKey: VALID_KEY }),
      );
    });

    it('includes a claimUrl in the response', async () => {
      const saved = makeAccount();
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);
      mockStellarService.createEphemeralAccount.mockResolvedValue('txhash-abc');

      const result = await service.create(dto);

      expect(result.claimUrl).toContain('mock-jwt-token');
    });

    it('marks account as FAILED and re-throws when createEphemeralAccount fails', async () => {
      const saved = makeAccount({ status: AccountStatus.INITIALIZING });
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);
      mockStellarService.createEphemeralAccount.mockRejectedValue(
        new Error('Horizon error'),
      );

      await expect(service.create(dto)).rejects.toThrow('Horizon error');
      expect(saved.status).toBe(AccountStatus.FAILED);
      expect(mockRepo.save).toHaveBeenCalledTimes(2); // initial save + failed save
    });

    it('wraps non-Error exceptions thrown by createEphemeralAccount', async () => {
      const saved = makeAccount();
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);
      mockStellarService.createEphemeralAccount.mockRejectedValue(
        'raw string error',
      );

      await expect(service.create(dto)).rejects.toThrow('raw string error');
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────

  describe('findOne', () => {
    function makeQueryBuilder(account: Account | null) {
      return {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(account),
      };
    }

    it('returns an AccountResponseDto for an existing account', async () => {
      mockRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(makeAccount({ id: 'uuid-1' })),
      );

      const result = await service.findOne('uuid-1');

      expect(result.accountId).toBe('uuid-1');
      expect(result.publicKey).toBe(VALID_KEY);
    });

    it('scopes the lookup to the owning integrator when provided', async () => {
      const qb = makeQueryBuilder(makeAccount({ id: 'uuid-1' }));
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findOne('uuid-1', 'integrator-1');

      expect(qb.where).toHaveBeenCalledWith('account.id = :id', {
        id: 'uuid-1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'account.integratorId = :integratorId',
        { integratorId: 'integrator-1' },
      );
    });

    it('throws NotFoundException when account does not exist', async () => {
      mockRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(null));

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns NotFoundException (not 403) for cross-integrator access to hide existence', async () => {
      mockRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(null));

      await expect(
        service.findOne('uuid-1', 'different-integrator'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns null claimUrl when claimTokenHash is absent', async () => {
      mockRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(makeAccount({ id: 'uuid-1', claimTokenHash: null })),
      );

      const result = await service.findOne('uuid-1');

      expect(result.claimUrl).toBeNull();
    });

    it('returns a masked claimUrl when claimTokenHash is present', async () => {
      mockRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(makeAccount({ id: 'uuid-1', claimTokenHash: 'abc' })),
      );

      const result = await service.findOne('uuid-1');

      expect(result.claimUrl).toContain('***');
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────

  describe('findAll', () => {
    function makeQueryBuilder(accounts: Account[], total: number) {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([accounts, total]),
      };
      return qb;
    }

    it('returns accounts and total', async () => {
      const accounts = [makeAccount()];
      mockRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilder(accounts, 1),
      );
      const result = await service.findAll({ limit: 50, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.accounts).toHaveLength(1);
    });
    it('excludes soft-deleted accounts by default', async () => {
      const qb = makeQueryBuilder([], 0);
      mockRepo.createQueryBuilder.mockReturnValue(qb);
      await service.findAll({ limit: 50, offset: 0 });
      expect(qb.where).toHaveBeenCalledWith('account.deletedAt IS NULL');
    });
    it('applies status filter when provided', async () => {
      const qb = makeQueryBuilder([], 0);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({
        status: AccountStatus.PENDING_PAYMENT,
        limit: 10,
        offset: 0,
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'account.status = :status',
        expect.objectContaining({ status: AccountStatus.PENDING_PAYMENT }),
      );
    });

    it('caps limit at 100', async () => {
      const qb = makeQueryBuilder([], 0);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({ limit: 999, offset: 0 });

      expect(qb.take).toHaveBeenCalledWith(100);
    });

    it('returns empty list when no accounts match', async () => {
      mockRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder([], 0));

      const result = await service.findAll({ limit: 50, offset: 0 });

      expect(result.total).toBe(0);
      expect(result.accounts).toHaveLength(0);
    });
  });
});
