import { ApiProperty } from '@nestjs/swagger';

export class WebhookResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  events: string[];

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true })
  lastTriggeredAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}
