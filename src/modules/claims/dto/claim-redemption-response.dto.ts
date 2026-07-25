import { ApiProperty } from '@nestjs/swagger';

export class ClaimRedemptionResponseDto {
  @ApiProperty({
    example: true,
    description: 'Whether the claim redemption was successful',
  })
  success: boolean;

  @ApiProperty({
    example: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    required: false,
    description:
      'The Stellar transaction hash of the redemption; populated when the sweep completed successfully, omitted when isPartial is true.',
  })
  txHash?: string;

  @ApiProperty({
    example: '100.0000000',
    description: 'The amount that was transferred to the destination address',
  })
  amountSwept: string;

  @ApiProperty({
    example: 'native',
    description: 'The asset identifier that was transferred',
  })
  asset: string;

  @ApiProperty({
    example: 'GBBD47UZQ5YLQYYTWTCB7X3DUEEVZMDVGFBRNZPMZDWQWKCFN3EOZQKQ',
    description:
      'The destination Stellar wallet address that received the funds',
  })
  destination: string;

  @ApiProperty({
    example: '2026-01-21T15:45:30Z',
    required: false,
    description:
      'The timestamp when the claim was redeemed and funds were swept; omitted when isPartial is true (no funds moved yet).',
  })
  sweptAt?: Date;

  @ApiProperty({
    example: 'Claim successfully redeemed and funds transferred',
    required: false,
    description: 'Optional additional message about the redemption',
  })
  message?: string;

  /**
   * True when contract authorization succeeded but the Horizon payment
   * failed. The account is left in PARTIAL_SWEEP state; subsequent
   * redemption attempts with the same token retry the payment with
   * skipContractAuth: true. Distinct from success: false (a hard error).
   */
  @ApiProperty({
    required: false,
    description:
      'Set when the sweep completed the contract authorization but the Horizon payment failed and the account is in PARTIAL_SWEEP.',
  })
  isPartial?: boolean;

  /**
   * Authorization hash from the SweepController contract. Returns the
   * synthesized hash on retry (skipContractAuth: true) so the audit trail
   * can correlate the partial event with the original contract entry.
   */
  @ApiProperty({
    required: false,
    description:
      'Hash identifying the contract authorization event for this sweep attempt.',
  })
  contractAuthHash?: string;

  /**
   * Populated only when isPartial is true. Surface of the underlying
   * Horizon error so callers can decide to retry, escalate, or surface
   * a user-facing message.
   */
  @ApiProperty({
    required: false,
    description:
      'Error message from the failed Horizon payment submission; populated only when isPartial is true.',
  })
  error?: string;
}
