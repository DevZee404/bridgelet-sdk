import { IsUrl, IsArray, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://api.example.com/hooks' })
  @IsUrl({ require_tld: false })
  url: string;

  @ApiProperty({
    example: [
      'sweep.completed',
      'sweep.failed',
      'account.created',
      'account.expired',
    ],
    description: 'Event types to subscribe to',
  })
  @IsArray()
  @IsString({ each: true })
  events: string[];

  @ApiProperty({
    required: false,
    example: 'my-webhook-secret',
    description:
      'Secret used to sign outbound payloads via X-Bridgelet-Signature header',
  })
  @IsOptional()
  @IsString()
  secret?: string;

  @ApiProperty({ required: false, example: 'Payroll completion hook' })
  @IsOptional()
  @IsString()
  description?: string;
}
