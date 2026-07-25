import * as crypto from 'crypto';

/**
 * SecretEncryptionUtil
 *
 * Shared AES-256-GCM encryption utility for ephemeral account secret keys.
 * Used by AccountsService (encrypt on creation) and ClaimRedemptionProvider
 * (decrypt on claim redemption). Both must always use this single implementation
 * - never inline encrypt/decrypt logic elsewhere.
 *
 * Encrypted format (v1, current):
 *   aes256gcm:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * Format changelog
 * ───────────────
 * • v1 (current) ─ `aes256gcm:v1:` prefix + 16-byte random IV + 16-byte
 *   GCM auth tag + ciphertext (all hex-encoded, colon-separated). The prefix
 *   lets us detect format and crash clearly on rows from unknown versions
 *   rather than silently mis-decoding.
 * • unprefixed ─ legacy AES-256-GCM rows from the pre-PR #193 era that did
 *   not carry the version prefix. decrypt() still accepts these for the
 *   migration window, but new writes always emit `v1`.
 * • plain base64 ─ pre-AES MVP placeholder. decrypt() rejects with a
 *   descriptive error pointing operators at scripts/migrate-secrets.ts.
 *
 * Key requirements:
 * - Must be a 32-byte value provided as a 64-character hex string
 * - Sourced from ENCRYPTION_KEY environment variable
 * - Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export class SecretEncryptionUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16;
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly PREFIX_V1 = 'aes256gcm:v1:';
  private static readonly PREFIX_PATTERN = /^aes256gcm:v(\d+):(.*)$/;

  static encrypt(plaintext: string, encryptionKey: string): string {
    const key = SecretEncryptionUtil.parseKey(encryptionKey);
    const iv = crypto.randomBytes(SecretEncryptionUtil.IV_LENGTH);
    const cipher = crypto.createCipheriv(
      SecretEncryptionUtil.ALGORITHM,
      key,
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return (
      SecretEncryptionUtil.PREFIX_V1 +
      [
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex'),
      ].join(':')
    );
  }

  static decrypt(encryptedString: string, encryptionKey: string): string {
    const key = SecretEncryptionUtil.parseKey(encryptionKey);

    // Handle v1+ prefixed payloads explicitly. Unknown versions (e.g. v2) must
    // crash loudly so we never silently decode with the wrong algorithm.
    const prefixMatch = encryptedString.match(
      SecretEncryptionUtil.PREFIX_PATTERN,
    );
    if (prefixMatch) {
      const version = parseInt(prefixMatch[1] ?? '', 10);
      const body = prefixMatch[2] ?? '';
      if (version !== 1) {
        throw new Error(
          `Encrypted payload uses aes256gcm:v${version}: which is not supported by this build. ` +
            'Roll forward to a build that supports this format version before redeploying.',
        );
      }
      return SecretEncryptionUtil.decryptBody(body, key, 'aes256gcm:v1');
    }

    // No prefix: either legacy AES-256-GCM hex (3 colon-separated hex parts
    // with correct IV/authTag lengths) or the legacy MVP base64 placeholder.
    // We accept unprefixed AES rows only during the migration window so a
    // half-migrated database still decrypts.
    if (SecretEncryptionUtil.isAesGcmBody(encryptedString)) {
      return SecretEncryptionUtil.decryptBody(
        encryptedString,
        key,
        'unprefixed-aes',
      );
    }

    throw new Error(
      'Invalid encrypted format. Expected aes256gcm:v1:<iv>:<authTag>:<data> ' +
        '(or legacy unprefixed <iv>:<authTag>:<data>). ' +
        'This may be a legacy base64-encoded secret that has not been migrated. ' +
        'Run: npm run migrate:secrets -- --i-have-a-backup --execute',
    );
  }

  /**
   * Pure, side-effect-free classifier used by scripts/migrate-secrets.ts and
   * its spec tests. Returns the bucketed format of a stored ciphertext.
   */
  static classify(encryptedString: string): SecretFormat {
    if (typeof encryptedString !== 'string' || encryptedString.length === 0) {
      return 'corrupt';
    }
    const prefixMatch = encryptedString.match(
      SecretEncryptionUtil.PREFIX_PATTERN,
    );
    if (prefixMatch) {
      const version = parseInt(prefixMatch[1] ?? '', 10);
      if (
        version === 1 &&
        SecretEncryptionUtil.isAesGcmBody(prefixMatch[2] ?? '')
      ) {
        return 'prefixed-aes-v1';
      }
      return 'corrupt';
    }
    if (SecretEncryptionUtil.isAesGcmBody(encryptedString)) {
      return 'unprefixed-aes';
    }
    return 'legacy-base64';
  }

  private static decryptBody(
    body: string,
    key: Buffer,
    context: string,
  ): string {
    const parts = body.split(':');
    if (parts.length !== 3) {
      throw new Error(
        `Invalid encrypted format (${context}): expected 3 colon-separated parts (iv:authTag:data), got ${parts.length}.`,
      );
    }
    const [ivHex, authTagHex, dataHex] = parts;
    if (!ivHex || !authTagHex || !dataHex) {
      throw new Error(
        `Invalid encrypted format (${context}): one of iv / authTag / data is empty.`,
      );
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    if (iv.length !== SecretEncryptionUtil.IV_LENGTH) {
      throw new Error(
        `Invalid IV length (${context}): expected ${SecretEncryptionUtil.IV_LENGTH} bytes, got ${iv.length}.`,
      );
    }
    if (authTag.length !== SecretEncryptionUtil.AUTH_TAG_LENGTH) {
      throw new Error(
        `Invalid authTag length (${context}): expected ${SecretEncryptionUtil.AUTH_TAG_LENGTH} bytes, got ${authTag.length}.`,
      );
    }
    const decipher = crypto.createDecipheriv(
      SecretEncryptionUtil.ALGORITHM,
      key,
      iv,
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  private static isAesGcmBody(value: string): boolean {
    if (typeof value !== 'string' || value.length === 0) return false;
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    const ivHex = parts[0];
    const authTagHex = parts[1];
    const dataHex = parts[2];
    if (!ivHex || !authTagHex || !dataHex) return false;
    if (ivHex.length !== SecretEncryptionUtil.IV_LENGTH * 2) return false;
    if (authTagHex.length !== SecretEncryptionUtil.AUTH_TAG_LENGTH * 2)
      return false;
    if (ivHex.length === 0 || dataHex.length === 0) return false;
    if (
      !SecretEncryptionUtil.isHex(ivHex) ||
      !SecretEncryptionUtil.isHex(authTagHex) ||
      !SecretEncryptionUtil.isHex(dataHex)
    ) {
      return false;
    }
    return true;
  }

  private static isHex(s: string): boolean {
    return /^[0-9a-fA-F]+$/.test(s);
  }

  private static parseKey(hexKey: string): Buffer {
    if (typeof hexKey !== 'string' || hexKey.length === 0) {
      throw new Error(
        'Encryption key must be a non-empty 64-character hex string.',
      );
    }
    const key = Buffer.from(hexKey, 'hex');
    if (key.length !== 32) {
      throw new Error(
        `Encryption key must be 32 bytes (64 hex characters). Got ${key.length} bytes. ` +
          "Generate a valid key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    return key;
  }
}

export type SecretFormat =
  | 'prefixed-aes-v1'
  | 'unprefixed-aes'
  | 'legacy-base64'
  | 'corrupt';
