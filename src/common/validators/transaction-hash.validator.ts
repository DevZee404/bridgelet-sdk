export class TransactionHashValidator {
  private static readonly STELLAR_TX_HASH_REGEX = /^[a-f0-9]{64}$/i;

  static isValid(hash: string): boolean {
    if (!hash || typeof hash !== 'string') return false;
    return TransactionHashValidator.STELLAR_TX_HASH_REGEX.test(hash);
  }

  static assertValid(hash: string): void {
    if (!TransactionHashValidator.isValid(hash)) {
      throw new Error(
        `Invalid transaction hash: "${hash}". ` +
          'Expected a 64-character hex string. ' +
          'The sweep transaction may not have completed successfully.',
      );
    }
  }
}
