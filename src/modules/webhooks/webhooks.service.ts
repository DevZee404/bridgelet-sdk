import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  FindManyOptions,
  LessThan,
  MoreThan,
  Repository,
  IsNull,
} from 'typeorm';
import { Webhook } from './entities/webhook.entity.js';
import { WebhookDelivery } from './entities/webhook-delivery.entity.js';
import { CreateWebhookDto } from './dto/create-webhook.dto.js';
import { UpdateWebhookDto } from './dto/update-webhook.dto.js';
import { WebhookResponseDto } from './dto/webhook-response.dto.js';
import { WebhookDeliveriesResponseDto } from './dto/webhook-deliveries-response.dto.js';
import { WebhookDeliveryProvider } from './providers/webhook-delivery.provider.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepository: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
    private readonly deliveryProvider: WebhookDeliveryProvider,
    configService: ConfigService,
  ) {
    this.maxRetries = configService.get<number>('app.webhookRetryAttempts', 3);
    this.requestTimeoutMs = configService.get<number>(
      'app.webhookTimeout',
      10_000,
    );
  }

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

  async test(id: string): Promise<void> {
    const webhook = await this.webhookRepository.findOne({
      where: { id },
    });

    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    await this.deliveryProvider.deliver(
      webhook,
      'webhook.test',
      {},
      this.maxRetries,
      this.requestTimeoutMs,
    );
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
      webhooks.map((webhook) =>
        this.deliveryProvider.deliver(
          webhook,
          eventType,
          payload,
          this.maxRetries,
          this.requestTimeoutMs,
        ),
      ),
    );
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
