import { TransactionHashValidator } from './transaction-hash.validator.js';

describe('TransactionHashValidator', () => {
  const validHash =
    '571a84bc59fefb3fd17fe167b9c76286e83c31972649441a2d09da87f5b997a7';
  describe('isValid', () => {
    it('returns true for a valid 64-char hex hash', () => {
      expect(TransactionHashValidator.isValid(validHash)).toBe(true);
    });

    it('returns false for the string pending', () => {
      expect(TransactionHashValidator.isValid('pending')).toBe(false);
    });

    it('returns false for a hash that is too short', () => {
      expect(TransactionHashValidator.isValid('abc123')).toBe(false);
    });

    it('returns false for a hash that is too long', () => {
      expect(TransactionHashValidator.isValid(validHash + 'ff')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(TransactionHashValidator.isValid('')).toBe(false);
    });

    it('returns false for null without throwing', () => {
      expect(TransactionHashValidator.isValid(null as unknown as string)).toBe(
        false,
      );
    });

    it('accepts uppercase hex', () => {
      expect(TransactionHashValidator.isValid(validHash.toUpperCase())).toBe(
        true,
      );
    });
  });

  describe('assertValid', () => {
    it('does not throw for a valid hash', () => {
      expect(() =>
        TransactionHashValidator.assertValid(validHash),
      ).not.toThrow();
    });

    it('throws for the string pending', () => {
      expect(() => TransactionHashValidator.assertValid('pending')).toThrow(
        'Invalid transaction hash',
      );
    });

    it('throws with the invalid value in the message', () => {
      expect(() => TransactionHashValidator.assertValid('pending')).toThrow(
        '"pending"',
      );
    });

    it('throws for an empty string', () => {
      expect(() => TransactionHashValidator.assertValid('')).toThrow();
    });
  });
});
