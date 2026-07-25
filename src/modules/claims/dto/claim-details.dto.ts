import { ApiProperty } from '@nestjs/swagger';

export class ClaimDetailsDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Claim ID',
  })
  id: string;

  @ApiProperty({
    example: '660e8400-e29b-41d4-a716-446655440000',
    description: 'Associated account ID',
  })
  accountId: string;

  @ApiProperty({
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    description: 'Destination wallet address',
  })
  destinationAddress: string;

  @ApiProperty({
    example: '100.0000000',
    description: 'Amount that was swept',
  })
  amountSwept: string;

  @ApiProperty({
    example: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    description: 'Asset identifier',
  })
  asset: string;

  @ApiProperty({
    example: '571a84bc59fefb3fd17fe167b9c76286e83c31972649441a2d09da87f5b997a7',
    description: 'Stellar transaction hash of the sweep',
  })
  sweepTxHash: string;

  @ApiProperty({
    example: '2026-01-14T17:49:20.265Z',
    description: 'Timestamp when claim was redeemed',
  })
  claimedAt: Date;
}
