import { ApiProperty } from '@nestjs/swagger';

export class InitiateClaimResponseDto {
  @ApiProperty({ description: 'Account UUID' })
  accountId: string;

  @ApiProperty({
    description: 'Claim URL containing the JWT claim token',
  })
  claimUrl: string;

  @ApiProperty({
    description: 'When the claim token expires',
    type: String,
    format: 'date-time',
  })
  expiresAt: Date;
}
