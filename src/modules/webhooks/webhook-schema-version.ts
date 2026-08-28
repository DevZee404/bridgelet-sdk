/**
 * Webhook payload schema version.
 *
 * Included as the top-level `version` field on every outbound webhook
 * payload (see `WebhookDeliveryProvider.deliver()`). Integrators should
 * branch their payload-parsing logic on this field rather than assuming
 * the shape documented in docs/webhook-events.md is permanent.
 *
 * Bump this value only for a breaking change to the payload shape, and
 * follow the backward-compatibility policy documented in
 * docs/webhook-events.md#schema-versioning--backward-compatibility
 * (issue #494).
 */
export const WEBHOOK_PAYLOAD_SCHEMA_VERSION = 1;
