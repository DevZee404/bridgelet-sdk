/**
 * Unit tests for the test data factories.
 *
 * Goals:
 *  1. Verify that each factory returns a correctly-typed object with the
 *     expected default field values.
 *  2. Verify that override parameters are applied and do not mutate other
 *     fields.
 *  3. Verify that each call returns a new object (no shared-reference bugs).
 *  4. Verify that the returned values satisfy the database column constraints
 *     documented in the migration files (field lengths, non-null invariants,
 *     enum membership, etc.).
 *
 * Coverage note:
 *  Because entity / DTO / enum files are excluded from coverage collection
 *  (see jest.config in package.json), the factories themselves are the
 *  coverage-relevant files here.  All exported functions and branches are
 *  exercised below.
 */

import { AccountStatus } from '../../modules/accounts/enums/account-status.enum.js';

import {
  makeAccount,
  makeAccountResponse,
  DEFAULT_PUBLIC_KEY,
  DEFAULT_FUNDING_SOURCE,
} from './account.factory.js';

import {
  makeClaim,
  makeClaimAuditLog,
  makeClaimDetails,
  DEFAULT_DESTINATION_ADDRESS,
  DEFAULT_SWEEP_TX_HASH,
  DEFAULT_CLAIM_ACCOUNT_ID,
  DEFAULT_CLAIM_ID,
} from './claim.factory.js';

import {
  makeWebhook,
  makeWebhookDelivery,
  makeWebhookResponse,
  DEFAULT_WEBHOOK_ID,
  DEFAULT_WEBHOOK_URL,
  DEFAULT_WEBHOOK_SECRET,
  DEFAULT_WEBHOOK_EVENTS,
} from './webhook.factory.js';

// ============================================================================
// Account factory
// ============================================================================

describe('makeAccount', () => {
  it('returns an object with all required Account fields', () => {
    const account = makeAccount();

    expect(account).toBeDefined();
    expect(typeof account.id).toBe('string');
    expect(account.publicKey).toBe(DEFAULT_PUBLIC_KEY);
    expect(account.fundingSource).toBe(DEFAULT_FUNDING_SOURCE);
    expect(account.secretKeyEncrypted).toBeTruthy();
    expect(account.amount).toBe('100.0000000');
    expect(account.asset).toBe('native');
    expect(account.status).toBe(AccountStatus.PENDING_PAYMENT);
    expect(account.expiresAt).toBeInstanceOf(Date);
    expect(account.createdAt).toBeInstanceOf(Date);
    expect(account.updatedAt).toBeInstanceOf(Date);
    expect(account.claimedAt).toBeNull();
    expect(account.expiredAt).toBeNull();
    expect(account.deletedAt).toBeNull();
    expect(account.metadata).toBeNull();
    expect(account.contractId).toBeNull();
    expect(account.destinationAddress).toBeNull();
  });

  it('publicKey satisfies the 56-char G-address constraint', () => {
    const { publicKey } = makeAccount();
    expect(publicKey).toMatch(/^G[A-Z0-9]{55}$/);
    expect(publicKey.length).toBe(56);
  });

  it('fundingSource satisfies the 56-char G-address constraint', () => {
    const { fundingSource } = makeAccount();
    expect(fundingSource).toMatch(/^G[A-Z0-9]{55}$/);
    expect(fundingSource.length).toBe(56);
  });

  it('claimTokenHash satisfies the 64-char hex constraint when set', () => {
    const { claimTokenHash } = makeAccount();
    expect(claimTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('status is a valid AccountStatus enum value', () => {
    const { status } = makeAccount();
    expect(Object.values(AccountStatus)).toContain(status);
  });

  it('applies a single override without changing other fields', () => {
    const account = makeAccount({ status: AccountStatus.CLAIMED });

    expect(account.status).toBe(AccountStatus.CLAIMED);
    expect(account.publicKey).toBe(DEFAULT_PUBLIC_KEY); // unchanged
    expect(account.amount).toBe('100.0000000'); // unchanged
  });

  it('applies multiple overrides independently', () => {
    const account = makeAccount({
      status: AccountStatus.EXPIRED,
      amount: '50.0000000',
      asset: 'USDC',
      metadata: { userId: 'u1' },
    });

    expect(account.status).toBe(AccountStatus.EXPIRED);
    expect(account.amount).toBe('50.0000000');
    expect(account.asset).toBe('USDC');
    expect(account.metadata).toEqual({ userId: 'u1' });
    expect(account.publicKey).toBe(DEFAULT_PUBLIC_KEY);
  });

  it('each call returns a distinct object (no shared reference)', () => {
    const a1 = makeAccount();
    const a2 = makeAccount();

    expect(a1).not.toBe(a2);
  });

  it('mutations on one instance do not affect another', () => {
    const a1 = makeAccount();
    const a2 = makeAccount();

    a1.status = AccountStatus.FAILED;

    expect(a2.status).toBe(AccountStatus.PENDING_PAYMENT);
  });

  it('override can set nullable fields to non-null values', () => {
    const claimedAt = new Date('2026-06-01T00:00:00.000Z');
    const account = makeAccount({
      claimedAt,
      destinationAddress: DEFAULT_DESTINATION_ADDRESS,
    });

    expect(account.claimedAt).toBe(claimedAt);
    expect(account.destinationAddress).toBe(DEFAULT_DESTINATION_ADDRESS);
  });

  it('override can nullify claimTokenHash (nullable column)', () => {
    const account = makeAccount({ claimTokenHash: null });
    expect(account.claimTokenHash).toBeNull();
  });
});

// ============================================================================
// AccountResponseDto factory
// ============================================================================

describe('makeAccountResponse', () => {
  it('returns a complete AccountResponseDto with all required fields', () => {
    const dto = makeAccountResponse();

    expect(dto.accountId).toBeTruthy();
    expect(dto.publicKey).toBe(DEFAULT_PUBLIC_KEY);
    expect(typeof dto.claimUrl).toBe('string');
    expect(dto.amount).toBe('100.0000000');
    expect(dto.asset).toBe('native');
    expect(dto.status).toBe(AccountStatus.PENDING_PAYMENT);
    expect(dto.expiresAt).toBeInstanceOf(Date);
    expect(dto.createdAt).toBeInstanceOf(Date);
    expect(dto.claimedAt).toBeNull();
  });

  it('txHash is present and 64 chars by default', () => {
    const { txHash } = makeAccountResponse({});
    expect(txHash).toBeDefined();
    expect(txHash!.length).toBe(64);
  });

  it('applies overrides correctly', () => {
    const dto = makeAccountResponse({
      status: AccountStatus.CLAIMED,
      claimUrl: null,
    });

    expect(dto.status).toBe(AccountStatus.CLAIMED);
    expect(dto.claimUrl).toBeNull();
    expect(dto.publicKey).toBe(DEFAULT_PUBLIC_KEY);
  });

  it('each call returns a distinct object', () => {
    const d1 = makeAccountResponse({});
    const d2 = makeAccountResponse({});
    expect(d1).not.toBe(d2);
  });
});

// ============================================================================
// Claim factory
// ============================================================================

describe('makeClaim', () => {
  it('returns an object with all required Claim fields', () => {
    const claim = makeClaim();

    expect(claim.id).toBe(DEFAULT_CLAIM_ID);
    expect(claim.accountId).toBe(DEFAULT_CLAIM_ACCOUNT_ID);
    expect(claim.destinationAddress).toBe(DEFAULT_DESTINATION_ADDRESS);
    expect(claim.sweepTxHash).toBe(DEFAULT_SWEEP_TX_HASH);
    expect(claim.amountSwept).toBe('100.0000000');
    expect(claim.asset).toBe('native');
    expect(claim.claimedAt).toBeInstanceOf(Date);
    expect(claim.createdAt).toBeInstanceOf(Date);
    expect(claim.updatedAt).toBeInstanceOf(Date);
  });

  it('destinationAddress satisfies the 56-char G-address constraint', () => {
    const { destinationAddress } = makeClaim();
    expect(destinationAddress).toMatch(/^G[A-Z2-7]{55}$/);
    expect(destinationAddress.length).toBe(56);
  });

  it('sweepTxHash satisfies the 64-char hex constraint', () => {
    const { sweepTxHash } = makeClaim();
    expect(sweepTxHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sweepTxHash.length).toBe(64);
  });

  it('applies a single override without changing other fields', () => {
    const claim = makeClaim({ amountSwept: '0.0000001' });

    expect(claim.amountSwept).toBe('0.0000001');
    expect(claim.destinationAddress).toBe(DEFAULT_DESTINATION_ADDRESS);
    expect(claim.sweepTxHash).toBe(DEFAULT_SWEEP_TX_HASH);
  });

  it('applies multiple overrides independently', () => {
    const txHash = 'b'.repeat(64);
    const claim = makeClaim({
      amountSwept: '50.0000000',
      asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      sweepTxHash: txHash,
    });

    expect(claim.amountSwept).toBe('50.0000000');
    expect(claim.asset).toContain('USDC');
    expect(claim.sweepTxHash).toBe(txHash);
    expect(claim.destinationAddress).toBe(DEFAULT_DESTINATION_ADDRESS);
  });

  it('each call returns a distinct object', () => {
    const c1 = makeClaim();
    const c2 = makeClaim();
    expect(c1).not.toBe(c2);
  });
});

// ============================================================================
// ClaimAuditLog factory
// ============================================================================

describe('makeClaimAuditLog', () => {
  it('returns an object with all required fields', () => {
    const log = makeClaimAuditLog();

    expect(log.id).toBeTruthy();
    expect(log.accountId).toBe(DEFAULT_CLAIM_ACCOUNT_ID);
    expect(log.destinationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(log.ipHash).toBeNull();
    expect(log.outcome).toBe('success');
    expect(log.failureReason).toBeNull();
    expect(log.attemptedAt).toBeInstanceOf(Date);
  });

  it('destinationHash is exactly 64 chars (SHA-256 placeholder)', () => {
    const { destinationHash } = makeClaimAuditLog();
    expect(destinationHash.length).toBe(64);
  });

  it('applies failure outcome override', () => {
    const log = makeClaimAuditLog({
      outcome: 'failure',
      failureReason: 'Token expired',
    });

    expect(log.outcome).toBe('failure');
    expect(log.failureReason).toBe('Token expired');
    expect(log.accountId).toBe(DEFAULT_CLAIM_ACCOUNT_ID);
  });

  it('applies partial outcome override', () => {
    const log = makeClaimAuditLog({ outcome: 'partial' });
    expect(log.outcome).toBe('partial');
  });

  it('can set ipHash to a non-null value', () => {
    const ipHash = 'e'.repeat(64);
    const log = makeClaimAuditLog({ ipHash });
    expect(log.ipHash).toBe(ipHash);
  });

  it('each call returns a distinct object', () => {
    const l1 = makeClaimAuditLog();
    const l2 = makeClaimAuditLog();
    expect(l1).not.toBe(l2);
  });
});

// ============================================================================
// ClaimDetailsDto factory
// ============================================================================

describe('makeClaimDetails', () => {
  it('returns a complete ClaimDetailsDto with all required fields', () => {
    const dto = makeClaimDetails();

    expect(dto.id).toBe(DEFAULT_CLAIM_ID);
    expect(dto.accountId).toBe(DEFAULT_CLAIM_ACCOUNT_ID);
    expect(dto.destinationAddress).toBe(DEFAULT_DESTINATION_ADDRESS);
    expect(dto.amountSwept).toBe('100.0000000');
    expect(dto.asset).toBe('native');
    expect(dto.sweepTxHash).toBe(DEFAULT_SWEEP_TX_HASH);
    expect(dto.claimedAt).toBeInstanceOf(Date);
  });

  it('applies overrides correctly', () => {
    const dto = makeClaimDetails({
      asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      amountSwept: '1000000000.0000000',
    });

    expect(dto.asset).toContain('USDC');
    expect(dto.amountSwept).toBe('1000000000.0000000');
    expect(dto.id).toBe(DEFAULT_CLAIM_ID);
  });

  it('each call returns a distinct object', () => {
    const d1 = makeClaimDetails();
    const d2 = makeClaimDetails();
    expect(d1).not.toBe(d2);
  });
});

// ============================================================================
// Webhook factory
// ============================================================================

describe('makeWebhook', () => {
  it('returns an object with all required Webhook fields', () => {
    const webhook = makeWebhook();

    expect(webhook.id).toBe(DEFAULT_WEBHOOK_ID);
    expect(webhook.url).toBe(DEFAULT_WEBHOOK_URL);
    expect(webhook.secret).toBe(DEFAULT_WEBHOOK_SECRET);
    expect(webhook.events).toEqual(DEFAULT_WEBHOOK_EVENTS);
    expect(webhook.isActive).toBe(true);
    expect(webhook.description).toBeNull();
    expect(webhook.lastTriggeredAt).toBeNull();
    expect(webhook.createdAt).toBeInstanceOf(Date);
    expect(webhook.updatedAt).toBeInstanceOf(Date);
  });

  it('url satisfies the varchar(2048) constraint', () => {
    const { url } = makeWebhook();
    expect(url.length).toBeLessThanOrEqual(2048);
    expect(url).toMatch(/^https?:\/\//);
  });

  it('secret satisfies the varchar(256) constraint when set', () => {
    const { secret } = makeWebhook();
    expect(secret).not.toBeNull();
    expect(secret!.length).toBeLessThanOrEqual(256);
  });

  it('events is a non-empty array by default', () => {
    const { events } = makeWebhook();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it('applies a single override without changing other fields', () => {
    const webhook = makeWebhook({ isActive: false });

    expect(webhook.isActive).toBe(false);
    expect(webhook.url).toBe(DEFAULT_WEBHOOK_URL);
    expect(webhook.events).toEqual(DEFAULT_WEBHOOK_EVENTS);
  });

  it('applies multiple overrides independently', () => {
    const webhook = makeWebhook({
      events: ['account.expired'],
      secret: null,
      description: 'Payroll hook',
    });

    expect(webhook.events).toEqual(['account.expired']);
    expect(webhook.secret).toBeNull();
    expect(webhook.description).toBe('Payroll hook');
    expect(webhook.url).toBe(DEFAULT_WEBHOOK_URL);
  });

  it('each call returns a distinct object with independent events arrays', () => {
    const w1 = makeWebhook();
    const w2 = makeWebhook();

    expect(w1).not.toBe(w2);
    w1.events.push('sweep.failed');
    expect(w2.events).not.toContain('sweep.failed');
  });

  it('can override secret to null (nullable column)', () => {
    const webhook = makeWebhook({ secret: null });
    expect(webhook.secret).toBeNull();
  });
});

// ============================================================================
// WebhookDelivery factory
// ============================================================================

describe('makeWebhookDelivery', () => {
  it('returns an object with all required WebhookDelivery fields', () => {
    const delivery = makeWebhookDelivery();

    expect(delivery.id).toBeTruthy();
    expect(delivery.subscriptionId).toBe(DEFAULT_WEBHOOK_ID);
    expect(delivery.eventType).toBe('sweep.completed');
    expect(delivery.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(delivery.attemptCount).toBe(1);
    expect(delivery.lastResponseCode).toBe(200);
    expect(delivery.lastResponseBody).toBe('{"status":"ok"}');
    expect(delivery.deliveredAt).toBeInstanceOf(Date);
    expect(delivery.createdAt).toBeInstanceOf(Date);
  });

  it('payloadHash satisfies the varchar(128) constraint', () => {
    const { payloadHash } = makeWebhookDelivery();
    expect(payloadHash.length).toBeLessThanOrEqual(128);
  });

  it('eventType satisfies the varchar(255) constraint', () => {
    const { eventType } = makeWebhookDelivery();
    expect(eventType.length).toBeLessThanOrEqual(255);
  });

  it('applies retry-scenario overrides', () => {
    const delivery = makeWebhookDelivery({
      attemptCount: 3,
      lastResponseCode: 503,
      lastResponseBody: 'Service Unavailable',
      deliveredAt: null,
    });

    expect(delivery.attemptCount).toBe(3);
    expect(delivery.lastResponseCode).toBe(503);
    expect(delivery.lastResponseBody).toBe('Service Unavailable');
    expect(delivery.deliveredAt).toBeNull();
    expect(delivery.subscriptionId).toBe(DEFAULT_WEBHOOK_ID);
  });

  it('lastResponseCode and lastResponseBody are nullable by default contract', () => {
    const delivery = makeWebhookDelivery({
      lastResponseCode: null,
      lastResponseBody: null,
    });

    expect(delivery.lastResponseCode).toBeNull();
    expect(delivery.lastResponseBody).toBeNull();
  });

  it('each call returns a distinct object', () => {
    const d1 = makeWebhookDelivery();
    const d2 = makeWebhookDelivery();
    expect(d1).not.toBe(d2);
  });
});

// ============================================================================
// WebhookResponseDto factory
// ============================================================================

describe('makeWebhookResponse', () => {
  it('returns a complete WebhookResponseDto with all required fields', () => {
    const dto = makeWebhookResponse({});

    expect(dto.id).toBe(DEFAULT_WEBHOOK_ID);
    expect(dto.url).toBe(DEFAULT_WEBHOOK_URL);
    expect(dto.events).toEqual(DEFAULT_WEBHOOK_EVENTS);
    expect(dto.isActive).toBe(true);
    expect(dto.description).toBeNull();
    expect(dto.lastTriggeredAt).toBeNull();
    expect(dto.createdAt).toBeInstanceOf(Date);
  });

  it('does not contain a secret field (security invariant)', () => {
    const dto = makeWebhookResponse({});
    expect(dto).not.toHaveProperty('secret');
  });

  it('applies overrides correctly', () => {
    const dto = makeWebhookResponse({
      id: 'custom-id',
      isActive: false,
      description: 'Updated hook',
    });

    expect(dto.id).toBe('custom-id');
    expect(dto.isActive).toBe(false);
    expect(dto.description).toBe('Updated hook');
    expect(dto.url).toBe(DEFAULT_WEBHOOK_URL);
  });

  it('each call returns a distinct object with independent events arrays', () => {
    const d1 = makeWebhookResponse({});
    const d2 = makeWebhookResponse({});

    expect(d1).not.toBe(d2);
    d1.events.push('sweep.failed');
    expect(d2.events).not.toContain('sweep.failed');
  });
});

// ============================================================================
// Cross-factory integration: factories compose without errors
// ============================================================================

describe('factory composition', () => {
  it('makeClaim can reference an account from makeAccount', () => {
    const account = makeAccount();
    const claim = makeClaim({ accountId: account.id });

    expect(claim.accountId).toBe(account.id);
  });

  it('makeWebhookDelivery can reference a webhook from makeWebhook', () => {
    const webhook = makeWebhook({ id: 'custom-webhook-id' });
    const delivery = makeWebhookDelivery({ subscriptionId: webhook.id });

    expect(delivery.subscriptionId).toBe('custom-webhook-id');
  });

  it('makeClaimAuditLog can reference an account from makeAccount', () => {
    const account = makeAccount();
    const log = makeClaimAuditLog({ accountId: account.id });

    expect(log.accountId).toBe(account.id);
  });
});
