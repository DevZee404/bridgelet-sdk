import { BadRequestException } from '@nestjs/common';

/** Maximum allowed serialised size of metadata (4 KB). */
export const METADATA_MAX_BYTES = 4096;

/**
 * Keys whose values may contain PII and should be stripped before storage.
 * All comparisons are case-insensitive.
 */
const PII_KEYS = new Set([
  'email',
  'phone',
  'phonenumber',
  'mobile',
  'ssn',
  'dob',
  'dateofbirth',
  'address',
  'fullname',
  'firstname',
  'lastname',
  'name',
  'nationalid',
  'passport',
  'taxid',
]);

/**
 * Validates that metadata does not exceed METADATA_MAX_BYTES when serialised,
 * then strips any top-level keys that look like PII.
 *
 * @throws BadRequestException when the serialised metadata exceeds the limit.
 * @returns A sanitised copy with PII keys removed (or undefined if input is falsy).
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const serialised = JSON.stringify(metadata);
  if (Buffer.byteLength(serialised, 'utf8') > METADATA_MAX_BYTES) {
    throw new BadRequestException(
      `metadata exceeds maximum allowed size of ${METADATA_MAX_BYTES} bytes`,
    );
  }

  const sanitised: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!PII_KEYS.has(key.toLowerCase())) {
      sanitised[key] = value;
    }
  }
  return sanitised;
}
