import { ApiProperty } from '@nestjs/swagger';
import { WebhookDelivery } from '../entities/webhook-delivery.entity.js';

export class WebhookDeliveriesResponseDto {
  @ApiProperty({ type: [WebhookDelivery] })
  data: WebhookDelivery[];

  @ApiProperty({ type: String, nullable: true })
  cursor: string | null;
}
