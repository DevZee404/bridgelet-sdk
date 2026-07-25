import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { ClaimAuditProvider } from './claim-audit.provider.js';
import { ClaimAuditLog } from '../entities/claim-audit-log.entity.js';

const ACCOUNT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DESTINATION = 'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';
const IP = '203.0.113.42';

function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

describe('ClaimAuditProvider', () => {
  let provider: ClaimAuditProvider;
  let repo: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn<any>().mockImplementation((data) => data),
      save: jest.fn<any>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimAuditProvider,
        { provide: getRepositoryToken(ClaimAuditLog), useValue: repo },
      ],
    }).compile();

    provider = module.get<ClaimAuditProvider>(ClaimAuditProvider);
  });

  afterEach(() => jest.clearAllMocks());

  describe('record — success outcome', () => {
    it('hashes destination and never stores plain address', async () => {
      await provider.record({
        accountId: ACCOUNT_ID,
        destination: DESTINATION,
        outcome: 'success',
      });

      const saved = repo.create.mock.calls[0][0] as Partial<ClaimAuditLog>;
      expect(saved.destinationHash).toBe(sha256(DESTINATION));
      expect(JSON.stringify(saved)).not.toContain(DESTINATION);
    });

    it('hashes IP when provided', async () => {
      await provider.record({
        accountId: ACCOUNT_ID,
        destination: DESTINATION,
        ip: IP,
        outcome: 'success',
      });

      const saved = repo.create.mock.calls[0][0] as Partial<ClaimAuditLog>;
      expect(saved.ipHash).toBe(sha256(IP));
      expect(JSON.stringify(saved)).not.toContain(IP);
    });

    it('sets ipHash to null when IP is omitted', async () => {
      await provider.record({
        accountId: ACCOUNT_ID,
        destination: DESTINATION,
        outcome: 'success',
      });

      const saved = repo.create.mock.calls[0][0] as Partial<ClaimAuditLog>;
      expect(saved.ipHash).toBeNull();
    });

    it('persists outcome as success', async () => {
      await provider.record({
        accountId: ACCOUNT_ID,
        destination: DESTINATION,
        outcome: 'success',
      });

      const saved = repo.create.mock.calls[0][0] as Partial<ClaimAuditLog>;
      expect(saved.outcome).toBe('success');
    });

    it('calls repository.save()', async () => {
      await provider.record({
        accountId: ACCOUNT_ID,
        destination: DESTINATION,
        outcome: 'success',
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('record — failure outcome', () => {
    it('stores outcome as failure with reason', async () => {
      await provider.record({
        accountId: ACCOUNT_ID,
        destination: DESTINATION,
        outcome: 'failure',
        failureReason: 'Token expired',
      });

      const saved = repo.create.mock.calls[0][0] as Partial<ClaimAuditLog>;
      expect(saved.outcome).toBe('failure');
      expect(saved.failureReason).toBe('Token expired');
    });

    it('sets failureReason to null when not provided', async () => {
      await provider.record({
        accountId: ACCOUNT_ID,
        destination: DESTINATION,
        outcome: 'failure',
      });

      const saved = repo.create.mock.calls[0][0] as Partial<ClaimAuditLog>;
      expect(saved.failureReason).toBeNull();
    });
  });

  describe('record — resilience', () => {
    it('does not throw when repository.save() rejects', async () => {
      repo.save.mockRejectedValue(new Error('DB down'));

      await expect(
        provider.record({
          accountId: ACCOUNT_ID,
          destination: DESTINATION,
          outcome: 'success',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
