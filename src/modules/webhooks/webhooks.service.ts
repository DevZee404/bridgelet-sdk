import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindManyOptions,
  LessThan,
  MoreThan,
  Repository,
  IsNull,
} from 'typeorm';
import * as crypto from 'crypto';
import { Webhook } from './entities/webhook.entity.js';
import { WebhookDelivery } from './entities/webhook-delivery.entity.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { UpdateWebhookDto } from './dto/update-webhook.dto.js';
import { WebhookResponseDto } from './dto/webhook-response.dto.js';
import { WebhookDeliveriesResponseDto } from './dto/webhook-deliveries-response.dto.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
  ) {}

  async create(dto: CreateWebhookDto): Promise<WebhookResponseDto> {
    const webhook = this.webhookRepository.create({
      url: dto.url,
      events: dto.events,
      secret: dto.secret ?? null,
      description: dto.description ?? null,
      isActive: true,
    });
    const saved = await this.webhookRepository.save(webhook);
    return this.toResponseDto(saved);
  }

  async findAll(pagination: {
    limit?: number;
    cursor?: string;
  }): Promise<WebhookResponseDto[]> {
    const { limit = 25, cursor } = pagination;
    const query: FindManyOptions<Webhook> = {
      where: { isActive: true },
      take: limit,
      order: { createdAt: 'DESC' },
    };

    if (cursor) {
      query.where = { ...query.where, createdAt: LessThan(new Date(cursor)) };
    }

    const webhooks = await this.webhookRepository.find(query);
    return webhooks.map((w) => this.toResponseDto(w));
  }

  async getDeliveries(
    id: string,
    pagination: {
      limit?: number;
      cursor?: string;
      eventType?: string;
      success?: boolean;
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<WebhookDeliveriesResponseDto> {
    const {
      limit = 25,
      cursor,
      eventType,
      success,
      fromDate,
      toDate,
    } = pagination;
    const query: FindManyOptions<WebhookDelivery> = {
      where: { subscriptionId: id },
      take: limit,
      order: { createdAt: 'DESC' },
    };

    if (cursor) {
      query.where = { ...query.where, createdAt: LessThan(new Date(cursor)) };
    }

    if (eventType) {
      query.where = { ...query.where, eventType };
    }

    if (success !== undefined) {
      query.where = {
        ...query.where,
        deliveredAt: success ? MoreThan(new Date(0)) : IsNull(),
      };
    }

    if (fromDate) {
      query.where = { ...query.where, createdAt: MoreThan(fromDate) };
    }

    if (toDate) {
      query.where = { ...query.where, createdAt: LessThan(toDate) };
    }

    const deliveries = await this.deliveryRepository.find(query);
    const nextCursor =
      deliveries.length > 0
        ? deliveries[deliveries.length - 1].createdAt.toISOString()
        : null;

    return {
      data: deliveries,
      cursor: nextCursor,
    };
  }

  async update(id: string, dto: UpdateWebhookDto): Promise<WebhookResponseDto> {
    const webhook = await this.webhookRepository.findOne({
      where: { id },
    });

    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    if (dto.url !== undefined) {
      webhook.url = dto.url;
    }

    if (dto.events !== undefined) {
      webhook.events = dto.events;
    }

    if (dto.description !== undefined) {
      webhook.description = dto.description;
    }

    const updatedWebhook = await this.webhookRepository.save(webhook);

    return this.toResponseDto(updatedWebhook);
  }

  async remove(id: string): Promise<void> {
    const webhook = await this.webhookRepository.findOne({
      where: { id },
    });

    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    webhook.isActive = false;

    await this.webhookRepository.save(webhook);
  }

  /**
   * Fires an event to all active webhooks subscribed to that event type.
   * Never throws — delivery failures are logged but do not propagate.
   */
  async triggerEvent(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    let webhooks: Webhook[];
    try {
      webhooks = await this.webhookRepository
        .createQueryBuilder('webhook')
        .where('webhook.isActive = :isActive', { isActive: true })
        .andWhere('webhook.events @> :events::jsonb', {
          events: JSON.stringify([eventType]),
        })
        .getMany();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to query webhooks for event ${eventType}: ${msg}`,
      );
      return;
    }

    if (webhooks.length === 0) return;

    await Promise.allSettled(
      webhooks.map((webhook) => this.deliver(webhook, eventType, payload)),
    );
  }

  private async deliver(
    webhook: Webhook,
    eventType: string,
    payload: Record<string, unknown>,
    maxRetries = 3,
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
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

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

  private toResponseDto(webhook: Webhook): WebhookResponseDto {
    return {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      isActive: webhook.isActive,
      description: webhook.description,
      lastTriggeredAt: webhook.lastTriggeredAt,
      createdAt: webhook.createdAt,
    };
  }
}
