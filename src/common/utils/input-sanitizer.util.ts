import { BadRequestException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Control-character stripping
// ---------------------------------------------------------------------------

/**
 * Characters removed by default:
 *   \x00-\x08  – C0 controls (null, bell, backspace, etc.)
 *   \x0B-\x0C  – vertical tab, form feed
 *   \x0E-\x1F  – remaining C0 controls
 *   \x7F       – DEL
 *   \x80-\x9F  – C1 controls
 *
 * Kept:
 *   \x09  TAB  – needed in structured data (e.g. TSV)
 *   \x0A  LF   – legitimate multi-line text
 *   \x0D  CR   – legitimate multi-line text (stripped separately by
 *                `stripCrlf` when header / log-injection is the concern)
 */
// eslint-disable-next-line no-control-regex -- intentionally matches C0/C1 control characters
const DEFAULT_CONTROL_CHAR_REGEX = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g;

/** Always stripped regardless of options – CRLF sequences that enable
 *  log injection, HTTP header injection, and SMTP header injection. */
const CRLF_REGEX = /\r\n|\r|\n/g;

/**
 * Remove control characters from a string.
 *
 * @param input   - The string to sanitise.
 * @param options - `allowNewlines` keeps LF/CR (default: `false` because
 *                  most callers want injection-safe single-line values).
 *                  `allowTabs` keeps TAB (default: `true`).
 * @returns The sanitised string, or the original value if it isn't a string.
 */
export function stripControlChars(
  input: unknown,
  options?: { allowNewlines?: boolean; allowTabs?: boolean },
): unknown {
  if (typeof input !== 'string') return input;

  const allowNewlines = options?.allowNewlines ?? false;
  const allowTabs = options?.allowTabs ?? true;

  let result = input;

  // Always strip CRLF (CR alone, LF alone, and CR+LF pairs) unless newlines
  // are explicitly allowed.  Even when newlines are "allowed" we normalise
  // CRLF → LF so downstream consumers see a consistent line ending.
  if (allowNewlines) {
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  } else {
    result = result.replace(CRLF_REGEX, '');
  }

  if (!allowTabs) {
    result = result.replace(/\t/g, '');
  }

  // Strip remaining control characters.
  result = result.replace(DEFAULT_CONTROL_CHAR_REGEX, '');

  return result;
}

// ---------------------------------------------------------------------------
// Webhook URL validation (SSRF / protocol abuse)
// ---------------------------------------------------------------------------

/** Blocked URL schemes – `javascript:` enables XSS when the URL is rendered,
 *  `file:` / `data:` / `ftp:` enable local / data-source access. */
const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'file:',
  'data:',
  'ftp:',
  'ftps:',
]);

/**
 * Blocked hostnames for SSRF protection.  Requests to these addresses would
 * hit the local machine or the cloud metadata endpoint.
 */
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal', // GCP
  '169.254.169.254', // AWS / generic link-local metadata
]);

/**
 * Validate a webhook URL string and return a normalised version.
 *
 * Checks performed:
 *  1. Must be a non-empty string.
 *  2. Must begin with `http://` or `https://` (case-insensitive).
 *  3. Must not use a blocked protocol (javascript:, file:, data:, ftp:).
 *  4. Must not target localhost / loopback / cloud metadata endpoints.
 *
 * @throws `BadRequestException` when validation fails.
 * @returns The original URL (unchanged) when it passes all checks.
 */
export function sanitizeWebhookUrl(url: unknown): string {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new BadRequestException('webhook URL must be a non-empty string');
  }

  const trimmed = url.trim();

  // Must be http(s)
  const lowerUrl = trimmed.toLowerCase();
  if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://')) {
    throw new BadRequestException(
      'webhook URL must use http:// or https:// scheme',
    );
  }

  // Block dangerous schemes that could appear after the normal prefix
  // (e.g. a user-supplied "http://evil.com" is fine, but we still check
  // the full string for embedded blocked schemes just in case).
  for (const scheme of BLOCKED_SCHEMES) {
    if (lowerUrl.includes(scheme)) {
      throw new BadRequestException(
        `webhook URL must not use the ${scheme.replace(':', '')} scheme`,
      );
    }
  }

  // Extract hostname for SSRF check
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) {
      throw new BadRequestException(
        'webhook URL must not target localhost or internal network addresses',
      );
    }

    // Also block IPv4 loopback / link-local written without brackets
    // e.g. "http://127.0.0.1:8080/hook"
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
      throw new BadRequestException(
        'webhook URL must not target localhost or internal network addresses',
      );
    }

    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) {
      throw new BadRequestException(
        'webhook URL must not target link-local metadata endpoints',
      );
    }
  } catch (err: unknown) {
    // Re-throw BadRequestException from the checks above as-is.
    if (err instanceof BadRequestException) throw err;
    // Any other error from URL parsing means the URL is malformed.
    throw new BadRequestException('webhook URL is malformed');
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Free-text / description sanitisation
// ---------------------------------------------------------------------------

/**
 * Sanitise a free-text field (e.g. webhook `description`) for safe logging.
 *
 * Strips control characters (including CR/LF) so the value cannot be used
 * to forge log lines or inject headers.  Preserves all printable Unicode
 * including non-ASCII text.
 *
 * @param input - The string value to sanitise.
 * @returns The sanitised string, or `undefined` when the input is nullish.
 */
export function sanitizeFreeText(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input === 'object' || typeof input === 'function')
    return undefined;
  if (typeof input === 'string') return stripControlChars(input) as string;
  return typeof input === 'number' || typeof input === 'boolean'
    ? String(input)
    : undefined;
}

// ---------------------------------------------------------------------------
// Metadata sanitisation (injection + size limits)
// ---------------------------------------------------------------------------

/** Maximum allowed serialised size of metadata (4 KB). */
export const INPUT_METADATA_MAX_BYTES = 4096;

/**
 * Recursively sanitise all string values inside a plain-object / array tree,
 * stripping control characters from each string leaf.
 *
 * Non-string values (numbers, booleans, null, nested objects/arrays) are
 * kept as-is.  Circular references are **not** handled (the input comes
 * from JSON-deserialised request bodies and will never be circular).
 *
 * @returns A sanitised deep copy, or `undefined` for falsy input.
 */
export function sanitizeMetadataDeep(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;

  const serialised = JSON.stringify(input);
  if (Buffer.byteLength(serialised, 'utf8') > INPUT_METADATA_MAX_BYTES) {
    throw new BadRequestException(
      `metadata exceeds maximum allowed size of ${INPUT_METADATA_MAX_BYTES} bytes`,
    );
  }

  return sanitizeValue(input) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return stripControlChars(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitizeValue(val);
    }
    return result;
  }
  return value;
}
