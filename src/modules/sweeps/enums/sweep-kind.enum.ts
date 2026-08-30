/**
 * Distinguishes claim-triggered sweeps (recipient destination, set at
 * redemption lock) from recovery sweeps (funds returned to
 * RECOVERY_ACCOUNT_PUBLIC after expiry).
 */
export enum SweepKind {
  CLAIM = 'claim',
  RECOVERY = 'recovery',
}
