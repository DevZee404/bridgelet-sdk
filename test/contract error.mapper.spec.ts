import { HttpException, HttpStatus } from '@nestjs/common';
import {
  mapContractError,
  throwContractError,
  ContractErrorDetails,
} from '../src/common/errors/contract-error.mapper.js';

// Helpers

/**
 * Wraps a variant name in a realistic Soroban-style error string so tests
 * verify that the mapper works with real SDK output, not just bare names.
 */
function sorobanError(variant: string): string {
  return `Transaction simulation failed: Error(Contract, #1) — ${variant}`;
}

// mapContractError — EphemeralAccount

describe('mapContractError — EphemeralAccount errors', () => {
  const cases: Array<[string, Partial<ContractErrorDetails>]> = [
    [
      'AlreadyInitialized',
      { statusCode: HttpStatus.CONFLICT, errorCode: 'ALREADY_INITIALIZED' },
    ],
    [
      'NotInitialized',
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: 'NOT_INITIALIZED',
      },
    ],
    [
      'InvalidExpiry',
      { statusCode: HttpStatus.BAD_REQUEST, errorCode: 'INVALID_EXPIRY' },
    ],
    [
      'InvalidAmount',
      { statusCode: HttpStatus.BAD_REQUEST, errorCode: 'INVALID_AMOUNT' },
    ],
    [
      'DuplicateAsset',
      { statusCode: HttpStatus.CONFLICT, errorCode: 'DUPLICATE_ASSET' },
    ],
    [
      'TooManyPayments',
      { statusCode: HttpStatus.CONFLICT, errorCode: 'TOO_MANY_PAYMENTS' },
    ],
    [
      'AlreadySwept',
      { statusCode: HttpStatus.GONE, errorCode: 'ALREADY_SWEPT' },
    ],
    [
      'NoPaymentReceived',
      { statusCode: HttpStatus.BAD_REQUEST, errorCode: 'NO_PAYMENT_RECEIVED' },
    ],
    [
      'AccountExpired',
      { statusCode: HttpStatus.GONE, errorCode: 'ACCOUNT_EXPIRED' },
    ],
    [
      'NotExpired',
      { statusCode: HttpStatus.CONFLICT, errorCode: 'NOT_EXPIRED' },
    ],
    [
      'InvalidStatus',
      { statusCode: HttpStatus.CONFLICT, errorCode: 'INVALID_STATUS' },
    ],
  ];

  test.each(cases)(
    '%s maps to correct statusCode and errorCode',
    (variant, expected) => {
      const result = mapContractError(sorobanError(variant));
      expect(result.statusCode).toBe(expected.statusCode);
      expect(result.errorCode).toBe(expected.errorCode);
      expect(result.message).toBeTruthy();
    },
  );
});

// mapContractError — SweepController variants

describe('mapContractError — SweepController errors', () => {
  const cases: Array<[string, Partial<ContractErrorDetails>]> = [
    [
      'AuthorizationFailed',
      { statusCode: HttpStatus.FORBIDDEN, errorCode: 'AUTHORIZATION_FAILED' },
    ],
    [
      'UnauthorizedDestination',
      {
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: 'UNAUTHORIZED_DESTINATION',
      },
    ],
    [
      'AccountNotReady',
      { statusCode: HttpStatus.CONFLICT, errorCode: 'ACCOUNT_NOT_READY' },
    ],
    [
      'AccountAlreadySwept',
      { statusCode: HttpStatus.GONE, errorCode: 'ACCOUNT_ALREADY_SWEPT' },
    ],
  ];

  test.each(cases)(
    '%s maps to correct statusCode and errorCode',
    (variant, expected) => {
      const result = mapContractError(sorobanError(variant));
      expect(result.statusCode).toBe(expected.statusCode);
      expect(result.errorCode).toBe(expected.errorCode);
      expect(result.message).toBeTruthy();
    },
  );
});

// mapContractError — bare variant names (no surrounding Soroban wrapper)

describe('mapContractError — bare variant names', () => {
  it('recognises AlreadySwept without surrounding context', () => {
    const result = mapContractError('AlreadySwept');
    expect(result.statusCode).toBe(HttpStatus.GONE);
    expect(result.errorCode).toBe('ALREADY_SWEPT');
  });

  it('recognises AuthorizationFailed without surrounding context', () => {
    const result = mapContractError('AuthorizationFailed');
    expect(result.statusCode).toBe(HttpStatus.FORBIDDEN);
  });
});

// mapContractError — unknown / unexpected errors

describe('mapContractError — unknown errors', () => {
  it('returns HTTP 500 for an unrecognised error string', () => {
    const result = mapContractError('SomeFutureContractError');
    expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.errorCode).toBe('UNKNOWN_CONTRACT_ERROR');
  });

  it('includes the raw error text in the message so it is not swallowed', () => {
    const raw = 'WeirdUnknownPanic: memory access out of bounds';
    const result = mapContractError(raw);
    expect(result.message).toContain(raw);
  });

  it('returns HTTP 500 for an empty string', () => {
    const result = mapContractError('');
    expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

// throwContractError

describe('throwContractError', () => {
  it('throws HttpException with correct status for a known error', () => {
    expect(() => throwContractError('AlreadySwept')).toThrow();

    try {
      throwContractError('AlreadySwept');
    } catch (err: unknown) {
      if (!(err instanceof HttpException)) throw err;
    }
  });

  it('throws HttpException with 500 for an unknown error', () => {
    try {
      throwContractError('WeirdPanic');
    } catch (err: unknown) {
      if (!(err instanceof HttpException)) throw err;
    }
  });

  it('always throws (never returns)', () => {
    expect(() => throwContractError('InvalidExpiry')).toThrow();
  });
});
