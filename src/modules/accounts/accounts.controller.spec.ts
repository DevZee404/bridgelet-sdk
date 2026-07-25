import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { AccountStatus } from './enums/account-status.enum.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AccountResponseDto } from './dto/account-response.dto.js';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard.js';
import { ThrottlerGuard } from '@nestjs/throttler';

const VALID_KEY = 'G' + 'A'.repeat(55);

const mockAccountsService = {
  create: jest.fn(),
  findOne: jest.fn(),
  findAll: jest.fn(),
};

function makeResponse(overrides = {}): AccountResponseDto {
  return {
    accountId: 'uuid-1',
    publicKey: VALID_KEY,
    claimUrl: 'https://claim.bridgelet.io/c/token',
    txHash: 'txhash',
    amount: '100',
    asset: 'native',
    status: AccountStatus.PENDING_PAYMENT,
    expiresAt: new Date('2099-01-01'),
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('AccountsController', () => {
  let controller: AccountsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: AccountsService, useValue: mockAccountsService }],
    })
      .overrideGuard(ApiKeyAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AccountsController>(AccountsController);
  });

  describe('create', () => {
    it('delegates to accountsService.create and returns the result', async () => {
      const dto: CreateAccountDto = {
        fundingSource: VALID_KEY,
        amount: '100',
        recovery_address:
          'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        asset_code: 'native',
        expiresIn: 3600,
      };
      const response = makeResponse();
      mockAccountsService.create.mockResolvedValue(response);

      const result = await controller.create(dto);

      expect(mockAccountsService.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(response);
    });
  });

  describe('findOne', () => {
    it('delegates to accountsService.findOne with the given id', async () => {
      const response = makeResponse();
      mockAccountsService.findOne.mockResolvedValue(response);

      const result = await controller.findOne('uuid-1');

      expect(mockAccountsService.findOne).toHaveBeenCalledWith('uuid-1');
      expect(result).toBe(response);
    });
  });

  describe('findAll', () => {
    it('delegates to accountsService.findAll with default pagination', async () => {
      const response = { accounts: [makeResponse()], total: 1 };
      mockAccountsService.findAll.mockResolvedValue(response);

      const result = await controller.findAll();

      expect(mockAccountsService.findAll).toHaveBeenCalledWith({
        status: undefined,
        limit: 50,
        offset: 0,
      });
      expect(result).toBe(response);
    });

    it('passes status filter and custom pagination params', async () => {
      const response = { accounts: [], total: 0 };
      mockAccountsService.findAll.mockResolvedValue(response);

      await controller.findAll(AccountStatus.EXPIRED, 10, 20);

      expect(mockAccountsService.findAll).toHaveBeenCalledWith({
        status: AccountStatus.EXPIRED,
        limit: 10,
        offset: 20,
      });
    });
  });
});
