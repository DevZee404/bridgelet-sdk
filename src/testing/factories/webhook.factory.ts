/**
 * Test data factories for the Webhook entity, WebhookDelivery entity, and
 * the WebhookResponseDto.
 *
 * Usage:
 *   import { makeWebhook, makeWebhookDelivery, makeWebhookResponse } from '../../testing/factories/webhook.factory.js';
 *
 *   const hook     = makeWebhook();
 *   const hook     = makeWebhook({ events: ['sweep.completed'], secret: 'my-secret' });
 *   const delivery = makeWebhookDelivery({ attemptCount: 3, lastResponseCode: 503 });
 *   const dto      = makeWebhookResponse({ isActive: false });
 */

import { Webhook } from '../../modules/webhooks/entities/webhook.entity.js';
import { WebhookDelivery } from '../../modules/webhooks/entities/webhook-delivery.entity.js';
import { WebhookResponseDto } from '../../modules/webhooks/dto/webhook-response.dto.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const DEFAULT_WEBHOOK_ID = 'wwwwwwww-xxxx-yyyy-zzzz-000000000001';
export const DEFAULT_WEBHOOK_URL = 'https://example.com/hook';
export const DEFAULT_WEBHOOK_SECRET = 'test-secret-key';
export const DEFAULT_WEBHOOK_EVENTS = ['sweep.completed', 'account.created'];

const BASE_DATE = new Date('2026-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Webhook entity factory
// ---------------------------------------------------------------------------

/**
 * Creates a Webhook entity with production-representative defaults.
 *
 * Column constraints honoured:
 *  - url: varchar(2048)
 *  - secret: varchar(256), nullable
 *  - events: jsonb (array of strings)
 *  - description: varchar(255), nullable
 */
export function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: DEFAULT_WEBHOOK_ID,
    url: DEFAULT_WEBHOOK_URL,
    secret: DEFAULT_WEBHOOK_SECRET,
    events: [...DEFAULT_WEBHOOK_EVENTS],
    isActive: true,
    description: null,
    lastTriggeredAt: null,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WebhookDelivery entity factory
// ---------------------------------------------------------------------------

/**
 * Creates a WebhookDelivery entity with sensible defaults.
 *
 * Column constraints honoured:
 *  - eventType: varchar(255)
 *  - payloadHash: varchar(128)
 *  - attemptCount: integer, default 1
 *  - lastResponseCode / lastResponseBody / deliveredAt: nullable
 */
export function makeWebhookDelivery(
  overrides: Partial<WebhookDelivery> = {},
): WebhookDelivery {
  return {
    id: 'dddddddd-eeee-ffff-0000-000000000002',
    subscriptionId: DEFAULT_WEBHOOK_ID,
    subscription: undefined as unknown as WebhookDelivery['subscription'],
    eventType: 'sweep.completed',
    payloadHash: 'a'.repeat(64),
    attemptCount: 1,
    lastResponseCode: 200,
    lastResponseBody: '{"status":"ok"}',
    deliveredAt: BASE_DATE,
    createdAt: BASE_DATE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// WebhookResponseDto factory
// ---------------------------------------------------------------------------

/**
 * Creates a WebhookResponseDto with sensible defaults.
 * Mirrors the shape returned by WebhooksService CRUD methods.
 * Note: the secret field is intentionally absent — the service never
 * returns it in the response DTO.
 */
export function makeWebhookResponse(
  overrides: Partial<WebhookResponseDto> = {},
): WebhookResponseDto {
  return {
    id: DEFAULT_WEBHOOK_ID,
    url: DEFAULT_WEBHOOK_URL,
    events: [...DEFAULT_WEBHOOK_EVENTS],
    isActive: true,
    description: null,
    lastTriggeredAt: null,
    createdAt: BASE_DATE,
    ...overrides,
  };
}
