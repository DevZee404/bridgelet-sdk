/**
 * Test data factory for the Account entity and its related DTOs.
 *
 * Usage:
 *   import { makeAccount, makeAccountResponse } from '../../testing/factories/account.factory.js';
 *
 *   const account = makeAccount();                           // all defaults
 *   const account = makeAccount({ status: AccountStatus.CLAIMED }); // override one field
 *   const dto     = makeAccountResponse({ txHash: 'abc...' });
 *
 * Design notes:
 *  - No external factory library is required — plain functions keep the
 *    dependency graph minimal and the output types fully explicit.
 *  - Every default value satisfies the database column constraints documented
 *    in the migration files (length limits, non-null columns, enum values).
 *  - Call-site overrides always win via the spread operator, so tests only
 *    need to specify the fields relevant to their assertions.
 */

import { Account } from '../../modules/accounts/entities/account.entity.js';
import { AccountStatus } from '../../modules/accounts/enums/account-status.enum.js';
import { AccountResponseDto } from '../../modules/accounts/dto/account-response.dto.js';

// ---------------------------------------------------------------------------
// Shared constants — re-exported so spec files can import them without
// duplicating the same literal in multiple places.
// ---------------------------------------------------------------------------

/** Valid Stellar G-address used as the default ephemeral public key. */
export const DEFAULT_PUBLIC_KEY = 'G' + 'A'.repeat(55);

/** Valid Stellar G-address used as the default funding source. */
export const DEFAULT_FUNDING_SOURCE = 'G' + 'B'.repeat(55);

/** Seed timestamp used for deterministic date defaults. */
const BASE_DATE = new Date('2026-01-01T00:00:00.000Z');
const EXPIRES_DATE = new Date('2099-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Account entity factory
// ---------------------------------------------------------------------------

/**
 * Creates an Account entity instance with production-representative defaults.
 *
 * All fields satisfy their column constraints:
 *  - publicKey / fundingSource: 56 chars, starts with G
 *  - amount: decimal(18,7) stored as string
 *  - asset: ≤ 100 chars
 *  - status: valid AccountStatus enum value
 *  - claimTokenHash: 64-char hex (nullable)
 *  - secretKeyEncrypted: text (non-empty placeholder)
 */
export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01',
    publicKey: DEFAULT_PUBLIC_KEY,
    contractId: null,
    secretKeyEncrypted: 'enc-secret-placeholder',
    fundingSource: DEFAULT_FUNDING_SOURCE,
    amount: '100.0000000',
    asset: 'native',
    status: AccountStatus.PENDING_PAYMENT,
    claimTokenHash: 'a'.repeat(64),
    destinationAddress: null,
    expiresAt: EXPIRES_DATE,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    claimedAt: null,
    expiredAt: null,
    metadata: null,
    deletedAt: null,
    ...overrides,
  } as Account;
}

// ---------------------------------------------------------------------------
// AccountResponseDto factory
// ---------------------------------------------------------------------------

/**
 * Creates an AccountResponseDto with sensible defaults.
 * Mirrors the shape returned by AccountsService.create / findOne.
 */
export function makeAccountResponse(
  overrides: Partial<AccountResponseDto> = {},
): AccountResponseDto {
  return {
    accountId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01',
    publicKey: DEFAULT_PUBLIC_KEY,
    claimUrl: 'https://claim.bridgelet.io/c/mock-jwt-token',
    txHash: 'a'.repeat(64),
    amount: '100.0000000',
    asset: 'native',
    status: AccountStatus.PENDING_PAYMENT,
    expiresAt: EXPIRES_DATE,
    createdAt: BASE_DATE,
    claimedAt: null,
    destination: undefined,
    metadata: undefined,
    ...overrides,
  };
}
