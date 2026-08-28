import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { Webhook } from '../entities/webhook.entity.js';
import { WebhookDelivery } from '../entities/webhook-delivery.entity.js';

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
  
  // Exponential backoff configuration - standard for webhooks:
  // 1min, 5min, 30min, 2h, 5h, 24h (max 6 retries, total ~30h of retries)
  private readonly defaultBackoffIntervalsMs = [
    60 * 1000,          // 1 minute
    5 * 60 * 1000,      // 5 minutes
    30 * 60 * 1000,     // 30 minutes
    2 * 60 * 60 * 1000, // 2 hours
    5 * 60 * 60 * 1000, // 5 hours
    24 * 60 * 60 * 1000 // 24 hours
  ];

  // Threshold to flag a subscription as having sustained failures
  private readonly consecutiveFailureThreshold = 5;

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
    maxRetries = 5,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deliveryId = crypto.randomUUID();
    const body = JSON.stringify({
      id: deliveryId,
      event: eventType,
      ...payload,
    });
    const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

    const delivery = this.deliveryRepository.create({
      id: deliveryId,
      subscriptionId: webhook.id,
      eventType,
      payloadHash,
      attempts: [],
    });

    const signature = this.computeSignature(body, webhook.secret);

    const rawAccountId = payload['accountId'];
    const accountId =
      typeof rawAccountId === 'string' ? rawAccountId : 'unknown';

    let attemptCount = 0;
    let success = false;
    let lastResponseCode: number | null = null;
    let lastResponseBody: string | null = null;

    // Save initial delivery record
    await this.deliveryRepository.save(delivery);

    while (attemptCount < maxRetries && !success) {
      attemptCount++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const startTime = Date.now();

      try {
        this.logger.log(
          `Attempting webhook delivery (attempt ${attemptCount}/${maxRetries}): ` +
          `event=${eventType}, accountId=${accountId}, url=${webhook.url}`
        );

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
        const durationMs = Date.now() - startTime;

        // Record this detailed attempt for debugging
        delivery.attempts.push({
          attemptNumber: attemptCount,
          timestamp: new Date(),
          responseCode: lastResponseCode,
          responseBody: lastResponseBody,
          durationMs,
        });

        if (response.ok) {
          success = true;
          this.logger.log(
            `Webhook delivery succeeded (attempt ${attemptCount}/${maxRetries}): ` +
            `event=${eventType}, accountId=${accountId}, url=${webhook.url}`
          );
          // Reset failure counters on success
          await this.webhookRepository.update(webhook.id, {
            consecutiveFailures: 0,
            hasFailedDeliveries: false,
            lastFailedAt: null,
          });
        } else {
          this.logger.error(
            `Webhook delivery failed (attempt ${attemptCount}/${maxRetries}): ` +
              `event=${eventType}, accountId=${accountId}, url=${webhook.url}, status=${response.status}`,
          );
        }
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const msg = err instanceof Error ? err.message : String(err);
        lastResponseBody = msg.substring(0, 2048);
        
        // Record failed attempt with error details
        delivery.attempts.push({
          attemptNumber: attemptCount,
          timestamp: new Date(),
          error: msg,
          durationMs,
        });

        this.logger.error(
          `Webhook delivery error (attempt ${attemptCount}/${maxRetries}): ` +
            `event=${eventType}, accountId=${accountId}, url=${webhook.url}, error=${msg}`,
        );
      } finally {
        clearTimeout(timeoutId);
      }

      // Update delivery record after each attempt
      delivery.attemptCount = attemptCount;
      delivery.lastResponseCode = lastResponseCode;
      delivery.lastResponseBody = lastResponseBody;
      if (success) {
        delivery.deliveredAt = new Date();
      }
      await this.deliveryRepository.save(delivery);

      if (!success && attemptCount < maxRetries) {
        // Get the appropriate backoff interval for this attempt, fall back to last interval if we exceed the array length
        const backoffIndex = Math.min(attemptCount - 1, this.defaultBackoffIntervalsMs.length - 1);
        const backoffMs = this.defaultBackoffIntervalsMs[backoffIndex];
        this.logger.log(
          `Waiting ${backoffMs}ms before next retry for webhook ${webhook.id}, event=${eventType}`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    // If all retries failed, update the subscription's failure status
    if (!success) {
      const newConsecutiveFailures = webhook.consecutiveFailures + 1;
      const shouldFlag = newConsecutiveFailures >= this.consecutiveFailureThreshold;
      
      this.logger.warn(
        `All webhook delivery attempts failed for ${webhook.id}, event=${eventType}. ` +
        `Consecutive failures: ${newConsecutiveFailures}. Flagged: ${shouldFlag}`
      );

      await this.webhookRepository.update(webhook.id, {
        consecutiveFailures: newConsecutiveFailures,
        hasFailedDeliveries: shouldFlag,
        lastFailedAt: new Date(),
      });
    }

    // Always update lastTriggeredAt
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