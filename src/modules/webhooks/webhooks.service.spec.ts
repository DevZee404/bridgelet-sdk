import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { WebhooksService } from './webhooks.service.js';
import { Webhook } from './entities/webhook.entity.js';
import { WebhookDelivery } from './entities/webhook-delivery.entity.js';
import {
  makeWebhook,
  DEFAULT_WEBHOOK_URL as WEBHOOK_URL,
  DEFAULT_WEBHOOK_SECRET as WEBHOOK_SECRET,
} from '../../testing/factories/webhook.factory.js';

function expectedSignature(body: string, secret: string | null): string {
  return crypto
    .createHmac('sha256', secret ?? '')
    .update(body)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhooksService', () => {
  let service: WebhooksService;
  let loggerErrorSpy: jest.SpyInstance;

  const mockQb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const mockWebhookRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  const mockWebhookDeliveryRepository = {
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest
      .fn()
      .mockImplementation((delivery) =>
        Promise.resolve({ id: 'delivery-uuid', ...delivery }),
      ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: getRepositoryToken(Webhook),
          useValue: mockWebhookRepository,
        },
        {
          provide: getRepositoryToken(WebhookDelivery),
          useValue: mockWebhookDeliveryRepository,
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);

    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create()', () => {
    it('persists webhook and returns response DTO without the secret', async () => {
      const webhook = makeWebhook();
      mockWebhookRepository.create.mockReturnValue(webhook);
      mockWebhookRepository.save.mockResolvedValue(webhook);

      const result = await service.create({
        url: WEBHOOK_URL,
        events: ['sweep.completed'],
        secret: WEBHOOK_SECRET,
      });

      expect(mockWebhookRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ url: WEBHOOK_URL, isActive: true }),
      );
      expect(result).toMatchObject({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        isActive: true,
      });
      expect(result).not.toHaveProperty('secret');
    });
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe('findAll()', () => {
    it('returns only active webhooks mapped to response DTOs', async () => {
      const webhook = makeWebhook();
      mockWebhookRepository.find.mockResolvedValue([webhook]);

      const result = await service.findAll({});

      expect(mockWebhookRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        take: 25,
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: webhook.id, url: webhook.url });
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update()', () => {
    it('updates an existing webhook', async () => {
      const webhook = makeWebhook();
      mockWebhookRepository.findOne.mockResolvedValue(webhook);
      mockWebhookRepository.save.mockResolvedValue({
        ...webhook,
        url: 'https://updated.example.com/hook',
        events: ['account.created'],
        description: 'Updated webhook',
      });

      const result = await service.update(webhook.id, {
        url: 'https://updated.example.com/hook',
        events: ['account.created'],
        description: 'Updated webhook',
      });

      expect(mockWebhookRepository.findOne).toHaveBeenCalledWith({
        where: { id: webhook.id },
      });
      expect(result).toMatchObject({
        id: webhook.id,
        url: 'https://updated.example.com/hook',
        events: ['account.created'],
        description: 'Updated webhook',
      });
    });

    it('throws NotFoundException when the webhook does not exist', async () => {
      mockWebhookRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { url: 'https://example.com' }),
      ).rejects.toThrow('Webhook with ID missing-id not found');
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove()', () => {
    it('deactivates an existing webhook', async () => {
      const webhook = makeWebhook();
      mockWebhookRepository.findOne.mockResolvedValue(webhook);
      mockWebhookRepository.save.mockResolvedValue({
        ...webhook,
        isActive: false,
      });

      await service.remove(webhook.id);

      expect(mockWebhookRepository.findOne).toHaveBeenCalledWith({
        where: { id: webhook.id },
      });
      expect(webhook.isActive).toBe(false);
    });

    it('throws NotFoundException when the webhook does not exist', async () => {
      mockWebhookRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        'Webhook with ID missing-id not found',
      );
    });
  });

  // -------------------------------------------------------------------------
  // triggerEvent — successful delivery
  // -------------------------------------------------------------------------

  describe('triggerEvent() — successful delivery', () => {
    it('delivers event payload to registered webhook via HTTP POST and logs delivery', async () => {
      const webhook = makeWebhook({ events: ['sweep.completed'] });
      mockQb.getMany.mockResolvedValue([webhook]);

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"status":"ok"}'),
      } as Response);

      await service.triggerEvent('sweep.completed', {
        accountId: 'acc-123',
        amount: '100',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        WEBHOOK_URL,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockWebhookDeliveryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: webhook.id,
          eventType: 'sweep.completed',
          attemptCount: 1,
          lastResponseCode: 200,
        }),
      );
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it('includes Content-Type and X-Bridgelet-Event headers', async () => {
      const webhook = makeWebhook({ events: ['account.created'] });
      mockQb.getMany.mockResolvedValue([webhook]);

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      } as Response);

      await service.triggerEvent('account.created', { accountId: 'acc-456' });

      const [, init] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['X-Bridgelet-Event']).toBe('account.created');
    });

    it('does not throw when no webhooks are subscribed to the event', async () => {
      mockQb.getMany.mockResolvedValue([]);

      await expect(
        service.triggerEvent('sweep.completed', { accountId: 'acc-789' }),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // triggerEvent — HMAC signature
  // -------------------------------------------------------------------------

  describe('triggerEvent() — HMAC signature', () => {
    it('includes X-Bridgelet-Signature header with correct sha256 HMAC', async () => {
      const webhook = makeWebhook({ secret: WEBHOOK_SECRET });
      mockQb.getMany.mockResolvedValue([webhook]);

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      } as Response);

      const payload = { accountId: 'acc-sig-test', amount: '50' };
      await service.triggerEvent('sweep.completed', payload);

      const [, init] = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ];

      const sentBody = init.body;
      const expected = `sha256=${expectedSignature(sentBody, WEBHOOK_SECRET)}`;
      expect(init.headers['X-Bridgelet-Signature']).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // triggerEvent — retries and delivery status logging
  // -------------------------------------------------------------------------

  describe('triggerEvent() — retries and delivery status logging', () => {
    it('retries up to maxRetries on HTTP failure and records final delivery log', async () => {
      const webhook = makeWebhook();
      mockQb.getMany.mockResolvedValue([webhook]);

      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      } as Response);

      await service.triggerEvent('sweep.failed', {
        accountId: 'acc-retry-test',
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(mockWebhookDeliveryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: webhook.id,
          eventType: 'sweep.failed',
          attemptCount: 3,
          lastResponseCode: 503,
          lastResponseBody: 'Service Unavailable',
        }),
      );
    });

    it('stops retrying as soon as request succeeds', async () => {
      const webhook = makeWebhook();
      mockQb.getMany.mockResolvedValue([webhook]);

      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Error'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve('Success'),
        } as Response);

      await service.triggerEvent('sweep.completed', {
        accountId: 'acc-retry-success',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockWebhookDeliveryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptCount: 2,
          lastResponseCode: 200,
        }),
      );
    });

    it('handles queryBuilder error in triggerEvent gracefully', async () => {
      mockQb.getMany.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.triggerEvent('sweep.completed', { accountId: 'acc-err' }),
      ).resolves.not.toThrow();
    });

    it('handles errors when saving delivery log or updating lastTriggeredAt', async () => {
      const webhook = makeWebhook();
      mockQb.getMany.mockResolvedValue([webhook]);
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      } as Response);

      mockWebhookDeliveryRepository.save.mockRejectedValueOnce(
        new Error('Save failed'),
      );
      mockWebhookRepository.update.mockRejectedValueOnce(
        new Error('Update failed'),
      );

      await expect(
        service.triggerEvent('sweep.completed', { accountId: 'acc-err-logs' }),
      ).resolves.not.toThrow();
    });
  });
});
