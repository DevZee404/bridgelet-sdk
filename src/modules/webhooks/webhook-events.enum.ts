export enum WebhookEvent {
  AccountCreated = 'account.created',
  AccountClaimed = 'account.claimed',
  AccountExpired = 'account.expired',
  SweepCompleted = 'sweep.completed',
  SweepPartial = 'sweep.partial',
  SweepFailed = 'sweep.failed',
  PaymentReceived = 'payment.received',
  WebhookTest = 'webhook.test',
}
