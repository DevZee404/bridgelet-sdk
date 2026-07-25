import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ClaimLookupProvider } from './claim-lookup.provider.js';
import { Claim } from '../entities/claim.entity.js';
import { Account } from '../../accounts/entities/account.entity.js';

/**
 * Unit tests for ClaimLookupProvider
 *
 * These tests verify that the ClaimLookupProvider correctly retrieves claim
 * details from the database and handles various scenarios including:
 * - Successful claim retrieval with account relation
 * - Proper DTO formatting
 * - NotFoundException for non-existent claims
 * - Logger behavior
 * - Database error handling
 */
describe('ClaimLookupProvider', () => {
  let provider: ClaimLookupProvider;
  let mockClaimsRepository: { findOne: jest.Mock };

  // Mock claim data used across multiple tests
  const mockClaimId = '550e8400-e29b-41d4-a716-446655440000';
  const mockAccountId = '660e8400-e29b-41d4-a716-446655440000';

  // Mock claim object with account relation as returned from database
  const mockClaim: Claim = {
    id: mockClaimId,
    accountId: mockAccountId,
    destinationAddress:
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    amountSwept: '100.0000000',
    asset: 'native',
    sweepTxHash:
      '571a84bc59fefb3fd17fe167b9c76286e83c31972649441a2d09da87f5b997a7',
    claimedAt: new Date('2026-01-14T17:49:20.265Z'),
    createdAt: new Date('2026-01-14T17:45:00.000Z'),
    updatedAt: new Date('2026-01-14T17:49:20.265Z'),
    account: {
      id: mockAccountId,
      publicKey: 'GTEST47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA',
    } as Account,
  };

  // Setup the testing module before each test
  beforeEach(async () => {
    // Create mock repository with jest.fn() for all methods used by the provider
    mockClaimsRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLookupProvider,
        {
          provide: getRepositoryToken(Claim),
          useValue: mockClaimsRepository,
        },
      ],
    }).compile();

    provider = module.get<ClaimLookupProvider>(ClaimLookupProvider);

    // Clear all mocks after module creation to ensure clean state
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Basic provider instantiation test
   * Verifies that the provider is properly defined and injectable
   */
  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  /**
   * Test: Successfully retrieve claim by ID with account relation
   *
   * Verifies that:
   * 1. The repository findOne method is called with correct parameters
   * 2. The query includes the account relation
   * 3. The correct claim ID is used in the query
   */
  describe('findClaimById', () => {
    it('should retrieve claim by ID with account relation', async () => {
      // Arrange: Setup mock to return the claim
      mockClaimsRepository.findOne.mockResolvedValue(mockClaim);

      // Act: Call the provider method
      await provider.findClaimById(mockClaimId);

      // Assert: Verify repository was called with correct parameters
      expect(mockClaimsRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockClaimId },
        relations: ['account'],
      });
      expect(mockClaimsRepository.findOne).toHaveBeenCalledTimes(1);
    });

    /**
     * Test: Return properly formatted ClaimDetailsDto
     *
     * Verifies that the provider correctly maps the Claim entity
     * to a ClaimDetailsDto with all required fields
     */
    it('should return properly formatted ClaimDetailsDto', async () => {
      // Arrange: Setup mock to return the claim
      mockClaimsRepository.findOne.mockResolvedValue(mockClaim);

      // Act: Call the provider method
      const result = await provider.findClaimById(mockClaimId);

      // Assert: Verify the returned DTO has all expected fields with correct values
      expect(result).toBeDefined();
      expect(result.id).toBe(mockClaim.id);
      expect(result.accountId).toBe(mockClaim.accountId);
      expect(result.destinationAddress).toBe(mockClaim.destinationAddress);
      expect(result.amountSwept).toBe(mockClaim.amountSwept);
      expect(result.asset).toBe(mockClaim.asset);
      expect(result.sweepTxHash).toBe(mockClaim.sweepTxHash);
      expect(result.claimedAt).toBe(mockClaim.claimedAt);

      // Verify the structure matches ClaimDetailsDto expectations
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

    /**
     * Test: Throw NotFoundException when claim does not exist
     *
     * Verifies that the provider properly handles the case where
     * a claim with the given ID is not found in the database
     */
    it('should throw NotFoundException when claim does not exist', async () => {
      // Arrange: Setup mock to return null (claim not found)
      mockClaimsRepository.findOne.mockResolvedValue(null);

      // Act & Assert: Verify that NotFoundException is thrown with correct message
      await expect(provider.findClaimById(mockClaimId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(provider.findClaimById(mockClaimId)).rejects.toThrow(
        `Claim ${mockClaimId} not found`,
      );
    });

    /**
     * Test: Verify logger is called with appropriate messages
     *
     * Verifies that the provider logs:
     * 1. An info log when starting the lookup
     * 2. A warning log when claim is not found
     * 3. A success log when claim is retrieved
     */
    it('should log lookup attempt when searching for claim', async () => {
      // Arrange: Setup mock and spy on logger
      mockClaimsRepository.findOne.mockResolvedValue(mockClaim);
      const loggerSpy = jest.spyOn(
        (provider as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      );

      // Act: Call the provider method
      await provider.findClaimById(mockClaimId);

      // Assert: Verify initial lookup log message
      expect(loggerSpy).toHaveBeenCalledWith(
        `Looking up claim: ${mockClaimId}`,
      );
    });

    it('should log warning when claim is not found', async () => {
      // Arrange: Setup mock to return null and spy on logger warn
      mockClaimsRepository.findOne.mockResolvedValue(null);
      const loggerWarnSpy = jest.spyOn(
        (provider as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      );

      // Act: Call the provider method (expecting it to throw)
      try {
        await provider.findClaimById(mockClaimId);
      } catch {
        // Expected to throw
      }

      // Assert: Verify warning log was called with correct message
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        `Claim ${mockClaimId} not found`,
      );
    });

    it('should log success when claim is retrieved', async () => {
      // Arrange: Setup mock and spy on logger
      mockClaimsRepository.findOne.mockResolvedValue(mockClaim);
      const loggerSpy = jest.spyOn(
        (provider as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      );

      // Act: Call the provider method
      await provider.findClaimById(mockClaimId);

      // Assert: Verify success log message
      expect(loggerSpy).toHaveBeenCalledWith(
        `Claim ${mockClaimId} retrieved successfully`,
      );
    });

    /**
     * Test: Handle database errors gracefully
     *
     * Verifies that the provider propagates database errors appropriately
     * without swallowing them or causing unexpected behavior
     */
    it('should propagate database errors', async () => {
      // Arrange: Setup mock to throw a database error
      const dbError = new Error('Connection lost');
      mockClaimsRepository.findOne.mockRejectedValue(dbError);

      // Act & Assert: Verify the error is propagated
      await expect(provider.findClaimById(mockClaimId)).rejects.toThrow(
        'Connection lost',
      );
    });

    it('should handle TypeORM query errors', async () => {
      // Arrange: Setup mock to throw a TypeORM-specific error
      const queryError = new Error('Query failed: column does not exist');
      mockClaimsRepository.findOne.mockRejectedValue(queryError);

      // Act & Assert: Verify the error is propagated
      await expect(provider.findClaimById(mockClaimId)).rejects.toThrow(
        'Query failed: column does not exist',
      );
    });

    /**
     * Test: Handle edge cases
     *
     * Verifies behavior with various edge case inputs
     */
    it('should handle claims with different asset types', async () => {
      // Arrange: Create claim with USDC asset
      const usdcClaim: Claim = {
        ...mockClaim,
        asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };
      mockClaimsRepository.findOne.mockResolvedValue(usdcClaim);

      // Act: Call the provider method
      const result = await provider.findClaimById(mockClaimId);

      // Assert: Verify asset is correctly mapped
      expect(result.asset).toBe(
        'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      );
    });

    it('should handle claims with very small amounts', async () => {
      // Arrange: Create claim with small amount
      const smallAmountClaim: Claim = {
        ...mockClaim,
        amountSwept: '0.0000001',
      };
      mockClaimsRepository.findOne.mockResolvedValue(smallAmountClaim);

      // Act: Call the provider method
      const result = await provider.findClaimById(mockClaimId);

      // Assert: Verify small amount is correctly mapped
      expect(result.amountSwept).toBe('0.0000001');
    });

    it('should handle claims with large amounts', async () => {
      // Arrange: Create claim with large amount
      const largeAmountClaim: Claim = {
        ...mockClaim,
        amountSwept: '1000000000.0000000',
      };
      mockClaimsRepository.findOne.mockResolvedValue(largeAmountClaim);

      // Act: Call the provider method
      const result = await provider.findClaimById(mockClaimId);

      // Assert: Verify large amount is correctly mapped
      expect(result.amountSwept).toBe('1000000000.0000000');
    });
  });
});
