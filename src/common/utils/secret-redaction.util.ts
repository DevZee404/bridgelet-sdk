/**
 * SecretRedactionUtil
 *
 * Provides safe logging utilities that prevent accidental exposure of
 * sensitive Stellar secret keys (S...) in logs, error messages, and
 * stack traces. All functions are pure and side-effect-free.
 */

const STELLAR_SECRET_REGEX = /S[A-Z2-7]{55}/g;

/**
 * Redact Stellar secret keys in any string.
 * Replaces full secrets with `S***REDACTED***`.
 *
 * @example
 * const safe = SecretRedactionUtil.redact('Created account with SABC...XYZ');
 * // → 'Created account with S***REDACTED***'
 */
export function redactSecrets(input: string): string {
  if (!input) return '';
  return input.replace(STELLAR_SECRET_REGEX, 'S***REDACTED***');
}

/**
 * Sanitize an error message so it can be safely logged without leaking
 * secret keys. Strips Stellar secrets and truncates to a reasonable length.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw).slice(0, 500);
}

/**
 * Sanitize an error stack trace. Removes Stellar secrets from any
 * location in the stack while preserving structure.
 */
export function sanitizeStackTrace(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  return redactSecrets(error.stack).slice(0, 2000);
}

/**
 * Mask a Stellar secret key for debugging purposes.
 * Shows only the first 5 and last 3 characters.
 *
 * @example
 * SecretRedactionUtil.mask('SABCDEF...XYZ');
 * // → 'SAB...XYZ'
 */
export function maskSecret(secret: string): string {
  if (secret.length < 12) return 'S***';
  return `${secret.slice(0, 5)}...${secret.slice(-3)}`;
}
