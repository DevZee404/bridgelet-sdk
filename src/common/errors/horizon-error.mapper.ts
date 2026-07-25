import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Structured representation of a mapped Horizon transaction error.
 */
export interface HorizonErrorDetails {
  statusCode: number;
  errorCode: string;
  message: string;
}

/**
 * Mapping of Horizon transaction-level result codes to user-facing error details.
 *
 * Reference: https://developers.stellar.org/docs/data/horizon/api-reference/errors/result-codes/transactions
 */
const HORIZON_TX_ERROR_MAP: Record<string, HorizonErrorDetails> = {
  // ── Transaction-level result codes ─────────────────────────────────────────

  /** Transaction failed for an unspecified reason */
  tx_failed: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'TX_FAILED',
    message: 'The transaction failed to execute.',
  },

  /** Too few valid signatures or wrong network passphrase */
  tx_bad_auth: {
    statusCode: HttpStatus.UNAUTHORIZED,
    errorCode: 'TX_BAD_AUTH',
    message:
      'Transaction authorization failed: invalid signature or wrong network.',
  },

  /** Source account not found on the network */
  tx_no_account: {
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: 'TX_NO_ACCOUNT',
    message: 'The source account does not exist on the Stellar network.',
  },

  /** Sequence number is incorrect */
  tx_bad_seq: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'TX_BAD_SEQ',
    message:
      'Transaction sequence number mismatch. Please reload the account and retry.',
  },

  /** Fee is below the network minimum */
  tx_insufficient_fee: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'TX_INSUFFICIENT_FEE',
    message: 'The transaction fee is too low. Increase the fee and resubmit.',
  },

  /** Account does not have enough XLM to pay the fee and keep the minimum balance */
  tx_insufficient_balance: {
    statusCode: HttpStatus.PAYMENT_REQUIRED,
    errorCode: 'TX_INSUFFICIENT_BALANCE',
    message:
      'The source account has an insufficient balance to cover the fee and minimum reserve.',
  },

  /** Source account is missing the required signers */
  tx_bad_auth_extra: {
    statusCode: HttpStatus.UNAUTHORIZED,
    errorCode: 'TX_BAD_AUTH_EXTRA',
    message: 'Unnecessary signatures were provided for this transaction.',
  },

  /** One or more operations in the transaction failed */
  tx_bad_minseq_age_or_gap: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'TX_BAD_MINSEQ_AGE_OR_GAP',
    message: 'Transaction minimum sequence age or gap constraint is not met.',
  },

  /** Transaction is malformed */
  tx_malformed: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'TX_MALFORMED',
    message: 'The transaction is malformed and cannot be processed.',
  },

  /** Transaction was not submitted within its time bounds */
  tx_too_late: {
    statusCode: HttpStatus.REQUEST_TIMEOUT,
    errorCode: 'TX_TOO_LATE',
    message: 'The transaction expired before it could be submitted.',
  },

  /** Transaction was submitted before its valid time window */
  tx_too_early: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'TX_TOO_EARLY',
    message:
      'The transaction was submitted before its valid time window opened.',
  },

  /** Transaction exceeds the byte limit */
  tx_too_large: {
    statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
    errorCode: 'TX_TOO_LARGE',
    message: 'The transaction exceeds the maximum allowed size.',
  },

  // ── Operation-level result codes ────────────────────────────────────────────

  /** The destination account does not exist */
  op_no_destination: {
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: 'OP_NO_DESTINATION',
    message: 'The destination account does not exist on the Stellar network.',
  },

  /** Source account does not have sufficient balance for the payment */
  op_underfunded: {
    statusCode: HttpStatus.PAYMENT_REQUIRED,
    errorCode: 'OP_UNDERFUNDED',
    message:
      'The source account does not have enough funds to complete this operation.',
  },

  /** The issuer of the asset is missing */
  op_no_issuer: {
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: 'OP_NO_ISSUER',
    message: 'The asset issuer account does not exist.',
  },

  /** The destination account does not have a trustline for the asset */
  op_no_trust: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'OP_NO_TRUST',
    message: 'The destination account does not trust the asset being sent.',
  },

  /** The destination account is not authorized to hold the asset */
  op_not_authorized: {
    statusCode: HttpStatus.FORBIDDEN,
    errorCode: 'OP_NOT_AUTHORIZED',
    message: 'The destination account is not authorized to hold this asset.',
  },

  /** The destination account would exceed its asset limit */
  op_line_full: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'OP_LINE_FULL',
    message:
      'The destination account cannot receive more of this asset (trustline full).',
  },

  /** The source account does not have enough XLM to maintain the minimum reserve */
  op_low_reserve: {
    statusCode: HttpStatus.PAYMENT_REQUIRED,
    errorCode: 'OP_LOW_RESERVE',
    message:
      'The account does not have enough XLM to meet the minimum reserve after this operation.',
  },

  /** The source account would be left with less than the minimum balance */
  op_src_no_trust: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'OP_SRC_NO_TRUST',
    message: 'The source account does not trust the asset being sent.',
  },

  /** Account creation failed because starting balance is too low */
  op_low_starting_balance: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'OP_LOW_STARTING_BALANCE',
    message: 'The starting balance is too low to create a new Stellar account.',
  },

  /** CreateAccount operation but the destination account already exists */
  op_already_exists: {
    statusCode: HttpStatus.CONFLICT,
    errorCode: 'OP_ALREADY_EXISTS',
    message: 'The destination account already exists.',
  },

  /** General operation failure */
  op_malformed: {
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: 'OP_MALFORMED',
    message: 'The operation is malformed.',
  },
};

/**
 * Sorted variants (longest first) so that more-specific codes are matched
 * before shorter codes they may contain as substrings.
 */
const SORTED_HORIZON_VARIANTS = Object.keys(HORIZON_TX_ERROR_MAP).sort(
  (a, b) => b.length - a.length,
);

/**
 * Extracts a known Horizon result code from a raw error string.
 *
 * Horizon error extras typically look like:
 *   `{"transaction": "tx_insufficient_fee"}` or
 *   `{"operations": ["op_no_destination"]}` or
 *   a plain `tx_insufficient_fee` string.
 */
function extractHorizonCode(raw: string): string | null {
  const lowered = raw.toLowerCase();
  for (const code of SORTED_HORIZON_VARIANTS) {
    if (lowered.includes(code)) {
      return code;
    }
  }
  return null;
}

/**
 * Maps a raw Horizon error string to a structured {@link HorizonErrorDetails}.
 *
 * If the error string contains a known Horizon result code, the corresponding
 * entry is returned.  Unknown errors surface as HTTP 502 (Bad Gateway) since
 * they originate from the upstream Horizon service rather than from our
 * application logic.
 *
 * @example
 * ```ts
 * const details = mapHorizonError('{"transaction":"tx_insufficient_fee"}');
 * // { statusCode: 400, errorCode: 'TX_INSUFFICIENT_FEE', message: '...' }
 * ```
 */
export function mapHorizonError(raw: string): HorizonErrorDetails {
  const code = extractHorizonCode(raw);

  if (code && HORIZON_TX_ERROR_MAP[code]) {
    return HORIZON_TX_ERROR_MAP[code];
  }

  return {
    statusCode: HttpStatus.BAD_GATEWAY,
    errorCode: 'HORIZON_UNKNOWN_ERROR',
    message: `An unexpected Horizon error occurred: ${raw}`,
  };
}

/**
 * Maps a raw Horizon error string and throws the appropriate
 * {@link HttpException}.
 *
 * Use this when catching Horizon submission errors in service methods:
 *
 * ```ts
 * try {
 *   await this.server.submitTransaction(tx);
 * } catch (err: unknown) {
 *   throwHorizonError(err instanceof Error ? err.message : String(err));
 * }
 * ```
 */
export function throwHorizonError(raw: string): never {
  const { statusCode, errorCode, message } = mapHorizonError(raw);
  throw new HttpException({ errorCode, message }, statusCode);
}
