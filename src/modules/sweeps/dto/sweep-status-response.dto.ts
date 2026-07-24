import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SweepStatusResponseDto {
  @ApiProperty({ description: 'Account ID (UUID)' })
  accountId: string;

  @ApiProperty({ description: 'Ephemeral Stellar public key (G...)' })
  publicKey: string;

  @ApiProperty({ description: 'Current account status' })
  status: string;

  @ApiProperty({ description: 'Sweep destination address (G...)' })
  destinationAddress: string | null;

  @ApiProperty({ description: 'Amount swept' })
  amount: string;

  @ApiProperty({ description: 'Asset code and issuer' })
  asset: string;

  @ApiPropertyOptional({
    description: 'Horizon transaction hash of the sweep payment (64-char hex)',
  })
  sweepTxHash?: string;

  @ApiPropertyOptional({
    description: 'Transaction hash of the account merge operation',
  })
  mergeTxHash?: string;

  @ApiPropertyOptional({
    description: 'On-chain confirmation status: confirmed, pending, or failed',
  })
  confirmationStatus?: string;

  @ApiPropertyOptional({
    description: 'Error details if sweep or merge failed',
  })
  error?: string;

  @ApiPropertyOptional({ description: 'Timestamp when the sweep was executed' })
  sweptAt?: Date;

  @ApiProperty({ description: 'When the account was originally created' })
  createdAt: Date;

  @ApiProperty({ description: 'Scheduled expiry time' })
  expiresAt: Date;
}
