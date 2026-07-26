import {
  redactSecrets,
  sanitizeErrorMessage,
  sanitizeStackTrace,
  maskSecret,
} from './secret-redaction.util.js';

describe('secret-redaction.util', () => {
  describe('redactSecrets', () => {
    it('redacts a full Stellar secret key', () => {
      const secret = 'SAK62GZGXS5BMXHCNPQ5ZHQSKM5V5Q23E74QSPRZ6KRH6KRC34Y266R4';
      const result = redactSecrets(`Key: ${secret}`);
      expect(result).toBe('Key: S***REDACTED***');
    });

    it('redacts multiple secret keys in one string', () => {
      const s1 = 'SAK62GZGXS5BMXHCNPQ5ZHQSKM5V5Q23E74QSPRZ6KRH6KRC34Y266R4';
      const s2 = 'SBK62GZGXS5BMXHCNPQ5ZHQSKM5V5Q23E74QSPRZ6KRH6KRC34Y266R5';
      const result = redactSecrets(`Keys: ${s1} and ${s2}`);
      expect(result).toBe('Keys: S***REDACTED*** and S***REDACTED***');
    });

    it('does not redact public keys (G... addresses)', () => {
      const pubkey = 'GAXO33U4ZRR73S52B7APXZS5GIHRGP1H7QYGJ4N5ZGBL6H3B5MCL525';
      const result = redactSecrets(`Account: ${pubkey}`);
      expect(result).toBe(`Account: ${pubkey}`);
    });

    it('does not redact contract IDs (C... addresses)', () => {
      const contractId = 'CAAOB3U4ZRR73S52B7APXZS5GIHRGP1H7QYGJ4N5ZGBL6H3B5MCL525';
      const result = redactSecrets(`Contract: ${contractId}`);
      expect(result).toBe(`Contract: ${contractId}`);
    });

    it('returns unchanged string when no secrets present', () => {
      const input = 'No secrets here, just normal text.';
      expect(redactSecrets(input)).toBe(input);
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('sanitizes an Error object message', () => {
      const secret = 'SAK62GZGXS5BMXHCNPQ5ZHQSKM5V5Q23E74QSPRZ6KRH6KRC34Y266R4';
      const error = new Error(`Failed with key ${secret}`);
      const result = sanitizeErrorMessage(error);
      expect(result).toBe('Failed with key S***REDACTED***');
    });

    it('sanitizes a plain string', () => {
      const result = sanitizeErrorMessage('some error string');
      expect(result).toBe('some error string');
    });

    it('truncates long messages to 500 chars', () => {
      const long = 'x'.repeat(600);
      expect(sanitizeErrorMessage(long)).toHaveLength(500);
    });
  });

  describe('sanitizeStackTrace', () => {
    it('returns undefined for non-Error inputs', () => {
      expect(sanitizeStackTrace('not an error')).toBeUndefined();
      expect(sanitizeStackTrace(null)).toBeUndefined();
    });

    it('redacts secrets from stack traces', () => {
      const err = new Error('test');
      const secret = 'SAK62GZGXS5BMXHCNPQ5ZHQSKM5V5Q23E74QSPRZ6KRH6KRC34Y266R4';
      err.stack = `Error: test\n    at Object.<anonymous> (${secret}:10:5)`;
      const result = sanitizeStackTrace(err);
      expect(result).not.toContain(secret);
      expect(result).toContain('S***REDACTED***');
    });
  });

  describe('maskSecret', () => {
    it('masks a standard Stellar secret', () => {
      const secret = 'SAK62GZGXS5BMXHCNPQ5ZHQSKM5V5Q23E74QSPRZ6KRH6KRC34Y266R4';
      const result = maskSecret(secret);
      expect(result).toBe('SAK62...6R4');
      expect(result).not.toContain(secret);
    });

    it('returns short mask for very short secrets', () => {
      expect(maskSecret('SABC')).toBe('S***');
    });
  });
});
