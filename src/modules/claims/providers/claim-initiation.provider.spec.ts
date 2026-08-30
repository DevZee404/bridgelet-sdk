import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimInitiationProvider } from './claim-initiation.provider.js';
import { Account } from '../../accounts/entities/account.entity.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { JwtKeyRotationProvider } from '../../../common/crypto/jwt-key-rotation.provider.js';

describe('ClaimInitiationProvider (issue #478)', () => {
  let provider: ClaimInitiationProvider;

  const OWNER_INTEGRATOR = '11111111-1111-4111-8111-111111111111';
  const OTHER_INTEGRATOR = '22222222-2222-4222-8222-222222222222';
  const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

  const mockAccount = {
    id: ACCOUNT_ID,
    integratorId: OWNER_INTEGRATOR,
    publicKey: 'GPUBKEY47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLL',
    status: AccountStatus.PENDING_CLAIM,
    expiresAt: new Date(Date.now() + 86_400_000),
    claimTokenHash: 'old-hash',
  };

  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockAccountsRepository = {
    createQueryBuilder: jest.fn(() => mockQb),
    save: jest.fn().mockImplementation((a) => Promise.resolve(a)),
  };

  const mockJwtKeyRotation = {
    sign: jest.fn().mockReturnValue('new.jwt.token'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimInitiationProvider,
        {
          provide: getRepositoryToken(Account),
          useValue: mockAccountsRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(2592000),
          },
        },
        {
          provide: JwtKeyRotationProvider,
          useValue: mockJwtKeyRotation,
        },
      ],
    }).compile();

    provider = module.get(ClaimInitiationProvider);
  });

  it('issues a claim token for the owning integrator', async () => {
    mockQb.getOne.mockResolvedValue({ ...mockAccount });

    const result = await provider.initiateClaim(ACCOUNT_ID, OWNER_INTEGRATOR);

    expect(result.accountId).toBe(ACCOUNT_ID);
    expect(result.claimUrl).toContain('new.jwt.token');
    expect(mockAccountsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        claimTokenHash: expect.any(String),
      }),
    );
    expect(mockQb.andWhere).toHaveBeenCalledWith(
      'account.integratorId = :integratorId',
      { integratorId: OWNER_INTEGRATOR },
    );
  });

  it('denies cross-integrator initiation with a non-leaking 404', async () => {
    mockQb.getOne.mockResolvedValue(null);

    await expect(
      provider.initiateClaim(ACCOUNT_ID, OTHER_INTEGRATOR),
    ).rejects.toThrow(NotFoundException);

    await expect(
      provider.initiateClaim(ACCOUNT_ID, OTHER_INTEGRATOR),
    ).rejects.toThrow(`Account ${ACCOUNT_ID} not found`);
  });

  it('rejects initiation for non-pending_claim accounts', async () => {
    mockQb.getOne.mockResolvedValue({
      ...mockAccount,
      status: AccountStatus.CLAIMED,
    });

    await expect(
      provider.initiateClaim(ACCOUNT_ID, OWNER_INTEGRATOR),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects initiation for expired accounts', async () => {
    mockQb.getOne.mockResolvedValue({
      ...mockAccount,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      provider.initiateClaim(ACCOUNT_ID, OWNER_INTEGRATOR),
    ).rejects.toThrow('Account has expired');
  });
});
