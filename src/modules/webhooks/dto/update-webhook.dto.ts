import { IsUrl, IsArray, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
      'sweep.completed',
      'sweep.failed',
      'account.created',
      'account.expired',
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
