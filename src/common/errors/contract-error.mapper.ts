import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Structured representation of a mapped contract error.
 */
export interface ContractErrorDetails {
  statusCode: number;
  errorCode: string;
  message: string;
}

/**
 * All known contract error variants across EphemeralAccount and SweepController.
 */
const CONTRACT_ERROR_MAP: Record<string, ContractErrorDetails> = {
  /** Contract was already initialized — not retryable */
  AlreadyInitialized: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'ALREADY_INITIALIZED',
    message: 'Contract has already been initialized.',
  },

  /** Contract was never initialized — system error */
  NotInitialized: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: 'NOT_INITIALIZED',
    message: 'Contract has not been initialized.',
  },

  /** Expiry ledger is in the past — bad input */
  InvalidExpiry: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'INVALID_EXPIRY',
    message: 'The provided expiry ledger is in the past.',
  },

  /** Payment amount is zero or negative — bad input */
  InvalidAmount: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'INVALID_AMOUNT',
    message: 'Payment amount must be greater than zero.',
  },

  /** Asset already recorded — not retryable */
  DuplicateAsset: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'DUPLICATE_ASSET',
    message: 'This asset has already been registered on the account.',
  },

  /** 10 asset limit reached — not retryable */
  TooManyPayments: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'TOO_MANY_PAYMENTS',
    message: 'The account has reached the maximum number of supported assets.',
  },

  /** Account already swept — terminal */
  AlreadySwept: {
    statusCode: HttpStatus.GONE,
    errorCode: 'ALREADY_SWEPT',
    message: 'This account has already been swept.',
  },

  /** Sweep attempted before any payment — bad state */
  NoPaymentReceived: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'NO_PAYMENT_RECEIVED',
    message: 'No payment has been received on this account yet.',
  },

  /** Account is past expiry ledger — terminal */
  AccountExpired: {
    statusCode: HttpStatus.GONE,
    errorCode: 'ACCOUNT_EXPIRED',
    message: 'This account has expired and can no longer be used.',
  },

  /** expire() called before expiry ledger — scheduling race */
  NotExpired: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'NOT_EXPIRED',
    message: 'This account has not yet reached its expiry ledger.',
  },

  /** Account is in a terminal state — not retryable */
  InvalidStatus: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'INVALID_STATUS',
    message: 'The account is in a terminal state and cannot be modified.',
  },

  // ── SweepController errors ───────────────────────────────────────────────

  /** Signature invalid or controller not initialized */
  AuthorizationFailed: {
    statusCode: HttpStatus.FORBIDDEN,
    errorCode: 'AUTHORIZATION_FAILED',
    message:
      'Authorization failed: invalid signature or uninitialized controller.',
  },

  /** Destination does not match locked mode config */
  UnauthorizedDestination: {
    statusCode: HttpStatus.FORBIDDEN,
    errorCode: 'UNAUTHORIZED_DESTINATION',
    message:
      'The sweep destination is not authorized under the current locked-mode configuration.',
  },

  /** Payment not yet received */
  AccountNotReady: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'ACCOUNT_NOT_READY',
    message: 'The account is not ready: payment has not been received yet.',
  },

  /** Destination update after sweep attempted */
  AccountAlreadySwept: {
    statusCode: HttpStatus.GONE,
    errorCode: 'ACCOUNT_ALREADY_SWEPT',
    message: 'Cannot update destination: the account has already been swept.',
  },
};

/**
 * Parses a raw Soroban transaction error string and extracts the contract
 * error variant name.
 *
 * Soroban error strings typically look like:
 *   "Error(Contract, #1)"  or  "ContractError(AlreadySwept)"  or  "AlreadySwept"
 *
 * This function checks against all known variant names directly by substring
 * match so it is resilient to minor format changes in the SDK.
 */
/**
 * Variants sorted longest-first so that more-specific names (e.g.
 * "AccountAlreadySwept") are tested before shorter substrings they contain
 * (e.g. "AlreadySwept").
 */
const SORTED_VARIANTS = Object.keys(CONTRACT_ERROR_MAP).sort(
  (a, b) => b.length - a.length,
);

function extractVariantFromError(raw: string): string | null {
  for (const variant of SORTED_VARIANTS) {
    if (raw.includes(variant)) {
      return variant;
    }
  }
  return null;
}

/**
 * Maps a raw contract error string to a structured {@link ContractErrorDetails}.
 *
 * If the error string matches a known variant the corresponding entry is
 * returned. Unknown errors always surface as HTTP 500 so they are never
 * silently swallowed.
 */
export function mapContractError(raw: string): ContractErrorDetails {
  const variant = extractVariantFromError(raw);

  if (variant && CONTRACT_ERROR_MAP[variant]) {
    return CONTRACT_ERROR_MAP[variant];
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    errorCode: 'UNKNOWN_CONTRACT_ERROR',
    message: `An unexpected contract error occurred: ${raw}`,
  };
}

/**
 * Maps a raw contract error string and throws the appropriate
 * {@link HttpException}.
 *
 * Use this inside service methods after catching a Soroban transaction error:
 *
 * ```ts
 * try {
 *   await this.stellarService.sweep(accountId);
 * } catch (err: unknown) {
 *   throwContractError(err instanceof Error ? err.message : String(err));
 * }
 * ```
 */
export function throwContractError(raw: string): never {
  const { statusCode, errorCode, message } = mapContractError(raw);
  throw new HttpException({ errorCode, message }, statusCode);
}
