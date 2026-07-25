import { SecretEncryptionUtil } from './secret-encryption.util.js';
import * as crypto from 'crypto';

describe('SecretEncryptionUtil', () => {
  const validKey = crypto.randomBytes(32).toString('hex');
  const plaintext = 'SCZANGBA5YHTNYVSKOP3SJ2CAANRL5ZVTTHLQPTU26HQZQVTYVKBMCR';

  describe('encrypt', () => {
    it('produces output with the aes256gcm:v1: prefix', () => {
      const result = SecretEncryptionUtil.encrypt(plaintext, validKey);
      expect(result.startsWith('aes256gcm:v1:')).toBe(true);
    });

    it('produces a 4-segment colon-separated string (prefix + iv + authTag + data)', () => {
      const result = SecretEncryptionUtil.encrypt(plaintext, validKey);
      // Strip prefix, then count segments in the body.
      const body = result.slice('aes256gcm:v1:'.length);
      expect(body.split(':').length).toBe(3);
    });

    it('produces a different output each call due to random IV', () => {
      const first = SecretEncryptionUtil.encrypt(plaintext, validKey);
      const second = SecretEncryptionUtil.encrypt(plaintext, validKey);
      expect(first).not.toBe(second);
    });
  });

  describe('decrypt - prefixed payloads (v1)', () => {
    it('round-trips correctly with v1 prefix', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, validKey);
      expect(SecretEncryptionUtil.decrypt(encrypted, validKey)).toBe(plaintext);
    });

    it('throws when the wrong key is used', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, validKey);
      const wrongKey = crypto.randomBytes(32).toString('hex');
      expect(() => SecretEncryptionUtil.decrypt(encrypted, wrongKey)).toThrow();
    });

    it('throws when the ciphertext is tampered with', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, validKey);
      const tamperMarker = 'aes256gcm:v1:';
      const body = encrypted.slice(tamperMarker.length);
      const parts = body.split(':');
      parts[2] = 'aabbccdd'; // corrupt the ciphertext
      expect(() =>
        SecretEncryptionUtil.decrypt(tamperMarker + parts.join(':'), validKey),
      ).toThrow();
    });
  });

  describe('decrypt - format compatibility', () => {
    it('accepts unprefixed AES-256-GCM hex (in-flight migration rows)', () => {
      // Hand-craft a valid unprefixed AES-256-GCM payload using the same
      // crypto primitives and confirm decrypt() handles it without the prefix.
      const key = Buffer.from(validKey, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const legacyPayload = [
        iv.toString('hex'),
        authTag.toString('hex'),
        ciphertext.toString('hex'),
      ].join(':');

      expect(SecretEncryptionUtil.decrypt(legacyPayload, validKey)).toBe(
        plaintext,
      );
    });

    it('throws a descriptive error for legacy base64 format', () => {
      const base64Secret = Buffer.from(plaintext).toString('base64');
      expect(() =>
        SecretEncryptionUtil.decrypt(base64Secret, validKey),
      ).toThrow('Invalid encrypted format');
    });

    it('throws a descriptive error pointing to migrate:secrets for base64', () => {
      const base64Secret = Buffer.from(plaintext).toString('base64');
      expect(() =>
        SecretEncryptionUtil.decrypt(base64Secret, validKey),
      ).toThrow(/migrate:secrets/);
    });

    it('throws when the payload claims aes256gcm:v2 (unsupported version)', () => {
      // Build a syntactically valid v1 body and just lie about the prefix.
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, validKey);
      const body = encrypted.slice('aes256gcm:v1:'.length);
      const fake = `aes256gcm:v2:${body}`;
      expect(() => SecretEncryptionUtil.decrypt(fake, validKey)).toThrow(
        'aes256gcm:v2',
      );
    });

    it('throws when the payload claims aes256gcm:v0 (legacy unknown version)', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, validKey);
      const body = encrypted.slice('aes256gcm:v1:'.length);
      const fake = `aes256gcm:v0:${body}`;
      expect(() => SecretEncryptionUtil.decrypt(fake, validKey)).toThrow(
        'aes256gcm:v0',
      );
    });

    it('throws for an empty string', () => {
      expect(() => SecretEncryptionUtil.decrypt('', validKey)).toThrow();
    });
  });

  describe('classify', () => {
    it('returns prefixed-aes-v1 for current-format rows', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, validKey);
      expect(SecretEncryptionUtil.classify(encrypted)).toBe('prefixed-aes-v1');
    });

    it('returns unprefixed-aes for legacy AES rows', () => {
      const key = Buffer.from(validKey, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      const legacy = [
        iv.toString('hex'),
        authTag.toString('hex'),
        ciphertext.toString('hex'),
      ].join(':');
      expect(SecretEncryptionUtil.classify(legacy)).toBe('unprefixed-aes');
    });

    it('returns legacy-base64 for base64 rows', () => {
      const base64 = Buffer.from(plaintext).toString('base64');
      expect(SecretEncryptionUtil.classify(base64)).toBe('legacy-base64');
    });

    it('returns corrupt for empty / non-string inputs', () => {
      expect(SecretEncryptionUtil.classify('' as any)).toBe('corrupt');

      expect(SecretEncryptionUtil.classify(undefined as any)).toBe('corrupt');

      expect(SecretEncryptionUtil.classify(null as any)).toBe('corrupt');

      expect(SecretEncryptionUtil.classify(123 as any)).toBe('corrupt');
    });

    it('returns corrupt for a v2-prefixed row even if the body is valid', () => {
      const encrypted = SecretEncryptionUtil.encrypt(plaintext, validKey);
      const body = encrypted.slice('aes256gcm:v1:'.length);
      expect(SecretEncryptionUtil.classify(`aes256gcm:v2:${body}`)).toBe(
        'corrupt',
      );
    });
  });

  describe('key validation', () => {
    it('throws when key is wrong length', () => {
      const shortKey = 'abc123';
      expect(() => SecretEncryptionUtil.encrypt(plaintext, shortKey)).toThrow(
        'Encryption key must be 32 bytes',
      );
    });

    it('throws when key is empty', () => {
      expect(() => SecretEncryptionUtil.encrypt(plaintext, '')).toThrow();
    });
  });
});
