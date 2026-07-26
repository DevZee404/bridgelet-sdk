/**
 * LogSanitizer — utility to redact sensitive data before logging.
 *
 * Redacts Stellar public keys (G...) and secret keys (S...) to show only
 * the last 6 characters, preserving enough for debugging without leaking
 * full addresses.
 */
export class LogSanitizer {
  /**
   * Redacts a Stellar address (public key or contract address).
   * "GABC...XYZ123" → "…YZ123"
   *
   * Returns the original string if it doesn't look like a Stellar address.
   */
  static redactAddress(address: string | undefined | null): string {
    if (!address || address.length < 12) return address ?? '<null>';
    return `…${address.slice(-6)}`;
  }

  /**
   * Redacts a Stellar secret key.
   * "SABC...XYZ123" → "…YZ123"
   */
  static redactSecret(secret: string | undefined | null): string {
    if (!secret || secret.length < 12) return secret ?? '<null>';
    return `…${secret.slice(-6)}`;
  }

  /**
   * Redacts a JWT or claim token.
   * Returns first 10 chars + "…" if long enough, otherwise "…***".
   */
  static redactToken(token: string | undefined | null): string {
    if (!token) return '<null>';
    if (token.length <= 10) return '…***';
    return `${token.slice(0, 10)}…`;
  }
}
