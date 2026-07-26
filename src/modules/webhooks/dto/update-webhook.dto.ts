import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, IsArray, IsString, IsOptional } from 'class-validator';
import { WebhookEvent } from '../webhook-events.enum.js';

export class UpdateWebhookDto {
  @ApiProperty({
    required: false,
    example: 'https://api.example.com/hooks',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @ApiProperty({
    required: false,
    example: [
      WebhookEvent.SweepCompleted,
      WebhookEvent.SweepFailed,
      WebhookEvent.AccountCreated,
      WebhookEvent.AccountExpired,
    ],
    description: 'Event types to subscribe to',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiProperty({
    required: false,
    example: 'Payroll completion hook',
    description: 'Optional description for the webhook subscription',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
