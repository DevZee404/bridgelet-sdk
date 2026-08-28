import { ApiProperty } from '@nestjs/swagger';

/**
 * Integrator-facing delivery health for a single webhook subscription
 * (issue #495). Computed from the trailing window of recent deliveries in
 * `webhook_deliveries` — no separate health table is maintained.
 */
export class WebhookHealthResponseDto {
  @ApiProperty({ description: 'The webhook subscription ID' })
  webhookId: string;

  @ApiProperty({
    description:
      'Number of most-recent delivery attempts considered in this health check',
  })
  recentAttemptsChecked: number;

  @ApiProperty({
    description:
      'Consecutive failed deliveries counting back from the most recent attempt',
  })
  consecutiveFailures: number;

  @ApiProperty({
    description: 'Failure rate across recentAttemptsChecked, from 0 to 1',
  })
  recentFailureRate: number;

  @ApiProperty({
    description:
      'True once consecutiveFailures reaches the configured sustained-failure threshold',
  })
  isSustainedFailure: boolean;

  @ApiProperty({
    description:
      'The consecutive-failure threshold that defines "sustained failure"',
  })
  sustainedFailureThreshold: number;

  @ApiProperty({
    nullable: true,
    description: 'Timestamp of the last delivery attempt, if any',
  })
  lastAttemptAt: Date | null;

  @ApiProperty({
    nullable: true,
    description:
      'Timestamp of the last successful delivery, if any within the checked window',
  })
  lastSuccessAt: Date | null;
}
