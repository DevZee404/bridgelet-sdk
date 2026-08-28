import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from '../webhooks.service.js';

/**
 * Internal visibility for sustained webhook delivery failures (issue #495).
 *
 * Periodically scans every active webhook subscription and logs an
 * `ALERT:` line (same convention as the stuck-INITIALIZING alert in
 * SchedulerService, issue #463) for any subscription whose most recent
 * deliveries have all failed past the configured threshold. This is the
 * "internal alerting or dashboard" side of #495 — see
 * WebhooksService.getHealth() for the integrator-facing counterpart.
 *
 * Follows the same setInterval/OnModuleInit/OnModuleDestroy pattern as
 * SchedulerService rather than @Cron, matching this module's existing
 * scheduling convention.
 */
@Injectable()
export class WebhookHealthMonitorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebhookHealthMonitorService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>(
      'app.webhookHealthCheckIntervalMs',
      300_000,
    );

    this.intervalHandle = setInterval(
      () => void this.runHealthCheck(),
      intervalMs,
    );

    this.logger.log(
      `Webhook health monitor started (interval: ${intervalMs}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.log('Webhook health monitor stopped');
  }

  /**
   * Scans all active webhooks and alerts on any in sustained failure.
   * Per-subscription failures are isolated by getHealthSnapshotsForActiveWebhooks()
   * itself; a failure of the scan as a whole is caught here so a bad run
   * never crashes the interval.
   */
  async runHealthCheck(): Promise<void> {
    let snapshots: Awaited<
      ReturnType<WebhooksService['getHealthSnapshotsForActiveWebhooks']>
    >;
    try {
      snapshots =
        await this.webhooksService.getHealthSnapshotsForActiveWebhooks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Webhook health check query failed: ${msg}`);
      return;
    }

    const failing = snapshots.filter((s) => s.isSustainedFailure);
    if (failing.length === 0) return;

    for (const snapshot of failing) {
      this.logger.error(
        `ALERT: webhook subscription ${snapshot.webhookId} has ` +
          `${snapshot.consecutiveFailures} consecutive failed deliveries ` +
          `(threshold: ${snapshot.sustainedFailureThreshold}). ` +
          `Recent failure rate: ${(snapshot.recentFailureRate * 100).toFixed(0)}% ` +
          `over the last ${snapshot.recentAttemptsChecked} attempt(s). (issue #495)`,
      );
    }
  }
}
