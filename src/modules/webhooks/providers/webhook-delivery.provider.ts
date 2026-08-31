import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Webhook } from '../entities/webhook.entity.js';
import { WebhookDelivery } from '../entities/webhook-delivery.entity.js';
import { WEBHOOK_PAYLOAD_SCHEMA_VERSION } from '../webhook-schema-version.js';

/**
 * Handles the transport side of webhook delivery: HMAC signing, the HTTP POST
 * itself, retry-with-backoff and persisting each delivery attempt to the
 * webhook_deliveries table.
 *
 * Extracted into a provider (matching the accounts/claims/sweeps module
 * conventions) so WebhooksService stays focused on subscription CRUD while the
 * delivery transport can be exercised and extended independently.
 *
 * Delivery failures never throw — they are logged and recorded in the
 * delivery log so callers don't fail because a subscriber endpoint is down.
 */
@Injectable()
export class WebhookDeliveryProvider {
  private readonly logger = new Logger(WebhookDeliveryProvider.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
  ) {}

  async deliver(
    webhook: Webhook,
    eventType: string,
    payload: Record<string, unknown>,
    maxRetries = 3,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deliveryId = crypto.randomUUID();
    const body = JSON.stringify({
      id: deliveryId,
      event: eventType,
      ...payload,
      // Placed last so a caller-supplied payload can never shadow it —
      // this field is reserved for the schema version (issue #494).
      version: WEBHOOK_PAYLOAD_SCHEMA_VERSION,
    });
    const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

    const delivery = this.deliveryRepository.create({
      id: deliveryId,
      subscriptionId: webhook.id,
      eventType,
      payloadHash,
    });

    const signature = this.computeSignature(body, webhook.secret);

    const rawAccountId = payload['accountId'];
    const accountId =
      typeof rawAccountId === 'string' ? rawAccountId : 'unknown';

    let attemptCount = 0;
    let success = false;
    let lastResponseCode: number | null = null;
    let lastResponseBody: string | null = null;

    while (attemptCount < maxRetries && !success) {
      attemptCount++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Bridgelet-Signature': `sha256=${signature}`,
            'X-Bridgelet-Event': eventType,
            'X-Bridgelet-Delivery-Id': delivery.id,
          },
          body,
          signal: controller.signal,
        });

        lastResponseCode = response.status;
        const text = await response.text();
        lastResponseBody = text ? text.substring(0, 2048) : null;

        if (response.ok) {
          success = true;
        } else {
          this.logger.error(
            `Webhook delivery failed (attempt ${attemptCount}/${maxRetries}): ` +
              `event=${eventType}, accountId=${accountId}, url=${webhook.url}, status=${response.status}`,
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        lastResponseBody = msg.substring(0, 2048);
        this.logger.error(
          `Webhook delivery error (attempt ${attemptCount}/${maxRetries}): ` +
            `event=${eventType}, accountId=${accountId}, url=${webhook.url}, error=${msg}`,
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!success && attemptCount < maxRetries) {
        const backoffMs = Math.min(100 * Math.pow(2, attemptCount - 1), 1000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    // Record delivery attempt log in DB
    try {
      delivery.attemptCount = attemptCount;
      delivery.lastResponseCode = lastResponseCode;
      delivery.lastResponseBody = lastResponseBody;
      delivery.deliveredAt = success ? new Date() : null;
      await this.deliveryRepository.save(delivery);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to record webhook delivery log for ${webhook.id}: ${msg}`,
      );
    }

    try {
      await this.webhookRepository.update(webhook.id, {
        lastTriggeredAt: new Date(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to update lastTriggeredAt for webhook ${webhook.id}: ${msg}`,
      );
    }
  }

  private computeSignature(payload: string, secret: string | null): string {
    return crypto
      .createHmac('sha256', secret ?? '')
      .update(payload)
      .digest('hex');
  }
}
