import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webhook } from './entities/webhook.entity.js';
import { WebhookDelivery } from './entities/webhook-delivery.entity.js';
import { WebhooksService } from './webhooks.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhookDeliveryProvider } from './providers/webhook-delivery.provider.js';
import { WebhookHealthMonitorService } from './providers/webhook-health-monitor.service.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Webhook, WebhookDelivery]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('app.jwtSecret'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    WebhooksService,
    WebhookDeliveryProvider,
    WebhookHealthMonitorService,
  ],
  controllers: [WebhooksController],
  exports: [WebhooksService],
})
export class WebhooksModule {}
