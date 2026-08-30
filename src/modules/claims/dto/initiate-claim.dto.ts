import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class InitiateClaimDto {
  @ApiProperty({
    description: 'UUID of the ephemeral account to initiate a claim for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'accountId must be a valid UUID' })
  @IsNotEmpty({ message: 'accountId is required' })
  accountId: string;
}
