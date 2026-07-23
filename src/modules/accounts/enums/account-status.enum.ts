export enum AccountStatus {
  INITIALIZING = 'initializing',
  PENDING_PAYMENT = 'pending_payment',
  PENDING_CLAIM = 'pending_claim',
  CLAIMING = 'claiming',
  PARTIAL_SWEEP = 'partial_sweep',
  CLAIMED = 'claimed',
  EXPIRED = 'expired',
  FAILED = 'failed',
}
