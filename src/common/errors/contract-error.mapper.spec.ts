import { HttpStatus } from '@nestjs/common';
import {
  mapContractError,
  throwContractError,
} from './contract-error.mapper.js';

describe('mapContractError', () => {
  it.each([
    ['AlreadyInitialized', HttpStatus.CONFLICT, 'ALREADY_INITIALIZED'],
    ['NotInitialized', HttpStatus.INTERNAL_SERVER_ERROR, 'NOT_INITIALIZED'],
    ['InvalidExpiry', HttpStatus.BAD_REQUEST, 'INVALID_EXPIRY'],
    ['InvalidAmount', HttpStatus.BAD_REQUEST, 'INVALID_AMOUNT'],
    ['DuplicateAsset', HttpStatus.CONFLICT, 'DUPLICATE_ASSET'],
    ['TooManyPayments', HttpStatus.CONFLICT, 'TOO_MANY_PAYMENTS'],
    ['AlreadySwept', HttpStatus.GONE, 'ALREADY_SWEPT'],
    ['NoPaymentReceived', HttpStatus.BAD_REQUEST, 'NO_PAYMENT_RECEIVED'],
    ['AccountExpired', HttpStatus.GONE, 'ACCOUNT_EXPIRED'],
    ['NotExpired', HttpStatus.CONFLICT, 'NOT_EXPIRED'],
    ['InvalidStatus', HttpStatus.CONFLICT, 'INVALID_STATUS'],
    ['AuthorizationFailed', HttpStatus.FORBIDDEN, 'AUTHORIZATION_FAILED'],
    [
      'UnauthorizedDestination',
      HttpStatus.FORBIDDEN,
      'UNAUTHORIZED_DESTINATION',
    ],
    ['AccountNotReady', HttpStatus.CONFLICT, 'ACCOUNT_NOT_READY'],
    ['AccountAlreadySwept', HttpStatus.GONE, 'ACCOUNT_ALREADY_SWEPT'],
  ])(
    'maps %s to correct statusCode and errorCode',
    (variant, expectedStatus, expectedCode) => {
      const result = mapContractError(`Error(Contract, ${variant})`);
      expect(result.statusCode).toBe(expectedStatus);
      expect(result.errorCode).toBe(expectedCode);
    },
  );

  it('maps an unknown error to UNKNOWN_CONTRACT_ERROR with HTTP 500', () => {
    const result = mapContractError('completely unknown error');
    expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.errorCode).toBe('UNKNOWN_CONTRACT_ERROR');
    expect(result.message).toContain('completely unknown error');
  });

  it('prefers AccountAlreadySwept over AlreadySwept (longest-first matching)', () => {
    const result = mapContractError('Error(Contract, AccountAlreadySwept)');
    expect(result.errorCode).toBe('ACCOUNT_ALREADY_SWEPT');
  });

  it('matches a variant that appears as a raw substring', () => {
    const result = mapContractError('AlreadySwept');
    expect(result.errorCode).toBe('ALREADY_SWEPT');
  });
});

describe('throwContractError', () => {
  it('throws an HttpException with the correct status and errorCode for a known variant', () => {
    expect(() => throwContractError('AccountExpired')).toThrow();
    try {
      throwContractError('AccountExpired');
    } catch (e: unknown) {
      const ex = e as {
        getStatus: () => number;
        getResponse: () => { errorCode: string };
      };
      expect(ex.getStatus()).toBe(HttpStatus.GONE);
      expect(ex.getResponse().errorCode).toBe('ACCOUNT_EXPIRED');
    }
  });

  it('throws an HttpException with HTTP 500 for an unknown error', () => {
    try {
      throwContractError('mystery error');
    } catch (e: unknown) {
      const ex = e as {
        getStatus: () => number;
        getResponse: () => { errorCode: string };
      };
      expect(ex.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(ex.getResponse().errorCode).toBe('UNKNOWN_CONTRACT_ERROR');
    }
  });
});
