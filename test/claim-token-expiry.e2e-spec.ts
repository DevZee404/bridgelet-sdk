import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { ClaimsModule } from '@/modules/claims/claims.module.js';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Account } from '@/modules/accounts/entities/account.entity.js';
import { ConfigService } from '@nestjs/config';
import { AccountStatus } from '@/modules/accounts/enums/account-status.enum.js';

describe('Claim Token Expiry (e2e)', () => {
  let app: INestApplication<App>;

  const mockAccountRepository = {
    findOne: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
    getOrThrow: jest.fn().mockReturnValue('test-jwt-secret'),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ClaimsModule],
    })
      .overrideProvider(getRepositoryToken(Account))
      .useValue(mockAccountRepository)
      .overrideProvider(ConfigService)
      .useValue(mockConfigService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 (not 404) when claim token is expired', async () => {
    // Mock an account with an expired expiresAt
    mockAccountRepository.findOne.mockResolvedValue({
      id: 'test-account',
      publicKey: 'GTEST...',
      claimTokenHash: 'hash',
      amount: '100.0000000',
      asset: 'native',
      status: AccountStatus.PENDING_CLAIM,
      expiresAt: new Date(Date.now() - 86400000), // Expired 1 day ago
    });

    const response = await request(app.getHttpServer())
      .post('/claims/verify')
      .send({ claimToken: 'expired-token' });

    // Should be 401 Unauthorized, NOT 404 Not Found
    expect(response.status).toBe(401);
  });

  it('should return 401 when JWT token itself is expired', async () => {
    // No account lookup needed - JWT verification fails first
    mockAccountRepository.findOne.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/claims/verify')
      .send({ claimToken: 'completely-invalid-token' });

    // Should be 401 Unauthorized (invalid/expired token)
    expect(response.status).toBe(401);
  });
});
