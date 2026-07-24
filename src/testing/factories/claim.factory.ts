/**
 * Test data factory for the Claim entity and its related DTOs.
 *
 * Usage:
 *   import { makeClaim, makeClaimAuditLog, makeClaimDetails } from '../../testing/factories/claim.factory.js';
 *
 *   const claim    = makeClaim();
 *   const claim    = makeClaim({ amountSwept: '0.0000001' });
 *   const auditLog = makeClaimAuditLog({ outcome: 'failure', failureReason: 'Token expired' });
 *   const dto      = makeClaimDetails({ asset: 'USDC:GBBD...' });
 */

import { Claim } from '../../modules/claims/entities/claim.entity.js';
import { ClaimAuditLog } from '../../modules/claims/entities/claim-audit-log.entity.js';
import { ClaimDetailsDto } from '../../modules/claims/dto/claim-details.dto.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * A valid Stellar G-address used as the default claim destination.
 * This specific address passes the regex /^G[A-Z2-7]{55}$/ used in RedeemClaimDto.
 */
export const DEFAULT_DESTINATION_ADDRESS =
  'GBULQKZ7SA56UKRI6LX2IB6XH3GJW2L34BMTOWMQFJBAQNPSHJJNOTGN';

/**
 * A valid 64-character hex string used as the default sweep transaction hash.
 * Length and charset satisfy the TransactionHashValidator constraint.
 */
export const DEFAULT_SWEEP_TX_HASH =
  '571a84bc59fefb3fd17fe167b9c76286e83c31972649441a2d09da87f5b997a7';

/** Account UUID referenced by claim fixtures */
export const DEFAULT_CLAIM_ACCOUNT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeee01';

/** Primary Claim UUID */
export const DEFAULT_CLAIM_ID = 'cccccccc-dddd-eeee-ffff-000000000001';

const BASE_DATE = new Date('2026-01-14T17:49:20.265Z');
const CREATED_DATE = new Date('2026-01-14T17:45:00.000Z');

// ---------------------------------------------------------------------------
// Claim entity factory
// ---------------------------------------------------------------------------

/**
 * Creates a Claim entity with production-representative defaults.
 *
 * Column constraints honoured:
 *  - destinationAddress: varchar(56)
 *  - sweepTxHash: varchar(64), 64-char hex
 *  - amountSwept / asset: varchar(100)
 *  - claimedAt: NOT NULL timestamp
 */
export function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: DEFAULT_CLAIM_ID,
    accountId: DEFAULT_CLAIM_ACCOUNT_ID,
    account: undefined as unknown as Claim['account'], // relation — set if needed
    destinationAddress: DEFAULT_DESTINATION_ADDRESS,
    sweepTxHash: DEFAULT_SWEEP_TX_HASH,
    amountSwept: '100.0000000',
    asset: 'native',
    claimedAt: BASE_DATE,
    createdAt: CREATED_DATE,
    updatedAt: BASE_DATE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ClaimAuditLog entity factory
// ---------------------------------------------------------------------------

/**
 * Creates a ClaimAuditLog entity with sensible defaults.
 * destinationHash and ipHash are SHA-256 hex strings (64 chars) per the
 * schema — the factory stores placeholder hashes, not raw addresses.
 */
export function makeClaimAuditLog(
  overrides: Partial<ClaimAuditLog> = {},
): ClaimAuditLog {
  return {
    id: 'dddddddd-eeee-ffff-0000-000000000001',
    accountId: DEFAULT_CLAIM_ACCOUNT_ID,
    destinationHash: 'd'.repeat(64), // placeholder SHA-256
    ipHash: null,
    outcome: 'success',
    failureReason: null,
    attemptedAt: BASE_DATE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ClaimDetailsDto factory
// ---------------------------------------------------------------------------

/**
 * Creates a ClaimDetailsDto with sensible defaults.
 * Mirrors the shape returned by ClaimLookupProvider.findClaimById().
 */
export function makeClaimDetails(
  overrides: Partial<ClaimDetailsDto> = {},
): ClaimDetailsDto {
  return {
    id: DEFAULT_CLAIM_ID,
    accountId: DEFAULT_CLAIM_ACCOUNT_ID,
    destinationAddress: DEFAULT_DESTINATION_ADDRESS,
    amountSwept: '100.0000000',
    asset: 'native',
    sweepTxHash: DEFAULT_SWEEP_TX_HASH,
    claimedAt: BASE_DATE,
    ...overrides,
  };
}
