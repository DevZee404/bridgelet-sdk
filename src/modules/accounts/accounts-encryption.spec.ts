import { SecretEncryptionUtil } from '../../common/crypto/secret-encryption.util.js';

/**
 * Unit tests for SecretEncryptionUtil — locking in correct encrypt/decrypt
 * behaviour for AccountsService (issue #521).
 *
 * Uses a local test key — no KMS dependency, runs fast in CI.
 */
describe('AccountsService — secret encryption (issue #521)', () => {
  // 32-byte deterministic key for testing (64 hex chars)
  const TEST_KEY = 'a'.repeat(64);

  it('encrypts and decrypts a Stellar secret key round-trip without data loss', () => {
    const original = 'S' + 'A'.repeat(55);
    const encrypted = SecretEncryptionUtil.encrypt(original, TEST_KEY);
    const decrypted = SecretEncryptionUtil.decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it('encrypted value differs from the plaintext (actually encrypts)', () => {
    const original = 'S' + 'A'.repeat(55);
    const encrypted = SecretEncryptionUtil.encrypt(original, TEST_KEY);
    expect(encrypted).not.toBe(original);
  });

  it('throws when decrypting with the wrong key (tampered ciphertext)', () => {
    const original = 'S' + 'A'.repeat(55);
    const encrypted = SecretEncryptionUtil.encrypt(original, TEST_KEY);
    const wrongKey = 'b'.repeat(64);
    expect(() => SecretEncryptionUtil.decrypt(encrypted, wrongKey)).toThrow();
  });

  it('produces a different ciphertext on each call (random IV per call)', () => {
    const original = 'S' + 'A'.repeat(55);
    const enc1 = SecretEncryptionUtil.encrypt(original, TEST_KEY);
    const enc2 = SecretEncryptionUtil.encrypt(original, TEST_KEY);
    expect(enc1).not.toBe(enc2);
  });

  it('produces v1-prefixed ciphertext', () => {
    const encrypted = SecretEncryptionUtil.encrypt('secret', TEST_KEY);
    expect(encrypted.startsWith('aes256gcm:v1:')).toBe(true);
  });
});
