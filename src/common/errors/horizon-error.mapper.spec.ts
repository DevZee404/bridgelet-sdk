import { HttpStatus } from '@nestjs/common';
import { mapHorizonError, throwHorizonError } from './horizon-error.mapper.js';

describe('mapHorizonError', () => {
  // ── Transaction-level codes ─────────────────────────────────────────────────
  it.each([
    ['tx_failed', HttpStatus.BAD_REQUEST, 'TX_FAILED'],
    ['tx_bad_auth', HttpStatus.UNAUTHORIZED, 'TX_BAD_AUTH'],
    ['tx_no_account', HttpStatus.NOT_FOUND, 'TX_NO_ACCOUNT'],
    ['tx_bad_seq', HttpStatus.CONFLICT, 'TX_BAD_SEQ'],
    ['tx_insufficient_fee', HttpStatus.BAD_REQUEST, 'TX_INSUFFICIENT_FEE'],
    [
      'tx_insufficient_balance',
      HttpStatus.PAYMENT_REQUIRED,
      'TX_INSUFFICIENT_BALANCE',
    ],
    ['tx_bad_auth_extra', HttpStatus.UNAUTHORIZED, 'TX_BAD_AUTH_EXTRA'],
    [
      'tx_bad_minseq_age_or_gap',
      HttpStatus.BAD_REQUEST,
      'TX_BAD_MINSEQ_AGE_OR_GAP',
    ],
    ['tx_malformed', HttpStatus.BAD_REQUEST, 'TX_MALFORMED'],
    ['tx_too_late', HttpStatus.REQUEST_TIMEOUT, 'TX_TOO_LATE'],
    ['tx_too_early', HttpStatus.BAD_REQUEST, 'TX_TOO_EARLY'],
    ['tx_too_large', HttpStatus.PAYLOAD_TOO_LARGE, 'TX_TOO_LARGE'],
  ])(
    'maps %s to correct statusCode and errorCode',
    (code, expectedStatus, expectedErrorCode) => {
      const result = mapHorizonError(code);
      expect(result.statusCode).toBe(expectedStatus);
      expect(result.errorCode).toBe(expectedErrorCode);
      expect(result.message).toBeTruthy();
    },
  );

  // ── Operation-level codes ───────────────────────────────────────────────────
  it.each([
    ['op_no_destination', HttpStatus.NOT_FOUND, 'OP_NO_DESTINATION'],
    ['op_underfunded', HttpStatus.PAYMENT_REQUIRED, 'OP_UNDERFUNDED'],
    ['op_no_issuer', HttpStatus.NOT_FOUND, 'OP_NO_ISSUER'],
    ['op_no_trust', HttpStatus.BAD_REQUEST, 'OP_NO_TRUST'],
    ['op_not_authorized', HttpStatus.FORBIDDEN, 'OP_NOT_AUTHORIZED'],
    ['op_line_full', HttpStatus.CONFLICT, 'OP_LINE_FULL'],
    ['op_low_reserve', HttpStatus.PAYMENT_REQUIRED, 'OP_LOW_RESERVE'],
    ['op_src_no_trust', HttpStatus.BAD_REQUEST, 'OP_SRC_NO_TRUST'],
    [
      'op_low_starting_balance',
      HttpStatus.BAD_REQUEST,
      'OP_LOW_STARTING_BALANCE',
    ],
    ['op_already_exists', HttpStatus.CONFLICT, 'OP_ALREADY_EXISTS'],
    ['op_malformed', HttpStatus.BAD_REQUEST, 'OP_MALFORMED'],
  ])(
    'maps operation code %s to correct statusCode and errorCode',
    (code, expectedStatus, expectedErrorCode) => {
      const result = mapHorizonError(code);
      expect(result.statusCode).toBe(expectedStatus);
      expect(result.errorCode).toBe(expectedErrorCode);
      expect(result.message).toBeTruthy();
    },
  );

  it('maps an unknown error to HORIZON_UNKNOWN_ERROR with HTTP 502', () => {
    const result = mapHorizonError('some_completely_unknown_code');
    expect(result.statusCode).toBe(HttpStatus.BAD_GATEWAY);
    expect(result.errorCode).toBe('HORIZON_UNKNOWN_ERROR');
    expect(result.message).toContain('some_completely_unknown_code');
  });

  it('extracts code from a JSON extras string', () => {
    const raw = JSON.stringify({ transaction: 'tx_insufficient_fee' });
    const result = mapHorizonError(raw);
    expect(result.errorCode).toBe('TX_INSUFFICIENT_FEE');
  });

  it('extracts an operation-level code from a JSON extras string', () => {
    const raw = JSON.stringify({ operations: ['op_no_destination'] });
    const result = mapHorizonError(raw);
    expect(result.errorCode).toBe('OP_NO_DESTINATION');
  });

  it('is case-insensitive in code matching', () => {
    const result = mapHorizonError('TX_INSUFFICIENT_FEE');
    expect(result.errorCode).toBe('TX_INSUFFICIENT_FEE');
  });

  it('prefers the more-specific op_low_starting_balance over op_low_reserve (longest-first)', () => {
    const result = mapHorizonError('op_low_starting_balance');
    expect(result.errorCode).toBe('OP_LOW_STARTING_BALANCE');
  });

  it('matches a code embedded in a longer string', () => {
    const result = mapHorizonError(
      'Horizon returned an error with extras: {"transaction":"tx_bad_auth"}',
    );
    expect(result.errorCode).toBe('TX_BAD_AUTH');
  });
});

describe('throwHorizonError', () => {
  it('throws an HttpException with the correct status for a known tx code', () => {
    expect(() => throwHorizonError('tx_no_account')).toThrow();
    try {
      throwHorizonError('tx_no_account');
    } catch (e: unknown) {
      const ex = e as {
        getStatus: () => number;
        getResponse: () => { errorCode: string };
      };
      expect(ex.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(ex.getResponse().errorCode).toBe('TX_NO_ACCOUNT');
    }
  });

  it('throws an HttpException with HTTP 502 for an unknown error', () => {
    try {
      throwHorizonError('mystery_horizon_error');
    } catch (e: unknown) {
      const ex = e as {
        getStatus: () => number;
        getResponse: () => { errorCode: string };
      };
      expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(ex.getResponse().errorCode).toBe('HORIZON_UNKNOWN_ERROR');
    }
  });

  it('throws an HttpException for tx_insufficient_fee', () => {
    try {
      throwHorizonError('tx_insufficient_fee');
    } catch (e: unknown) {
      const ex = e as {
        getStatus: () => number;
        getResponse: () => { errorCode: string; message: string };
      };
      expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(ex.getResponse().errorCode).toBe('TX_INSUFFICIENT_FEE');
      expect(ex.getResponse().message).toContain('fee');
    }
  });
});
