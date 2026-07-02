import { Injectable, Logger } from '@nestjs/common';

const LOW_SUCCESS_RATE_THRESHOLD = 0.95;

@Injectable()
export class SweepMetricsProvider {
  private readonly logger = new Logger(SweepMetricsProvider.name);

  private sweepCompletedTotal = 0;
  private sweepFailedTotal = 0;

  recordCompleted(): void {
    this.sweepCompletedTotal++;
    this.checkSuccessRate();
  }

  recordFailed(): void {
    this.sweepFailedTotal++;
    this.checkSuccessRate();
  }

  getCompletedTotal(): number {
    return this.sweepCompletedTotal;
  }

  getFailedTotal(): number {
    return this.sweepFailedTotal;
  }

  getSuccessRate(): number {
    const total = this.sweepCompletedTotal + this.sweepFailedTotal;
    if (total === 0) return 1;
    return this.sweepCompletedTotal / total;
  }

  getSnapshot(): {
    sweep_completed_total: number;
    sweep_failed_total: number;
    sweep_success_rate: number;
  } {
    return {
      sweep_completed_total: this.sweepCompletedTotal,
      sweep_failed_total: this.sweepFailedTotal,
      sweep_success_rate: this.getSuccessRate(),
    };
  }

  private checkSuccessRate(): void {
    const total = this.sweepCompletedTotal + this.sweepFailedTotal;
    if (total === 0) return;
    const rate = this.getSuccessRate();
    if (rate < LOW_SUCCESS_RATE_THRESHOLD) {
      this.logger.warn(
        `ALERT: sweep_success_rate=${(rate * 100).toFixed(2)}% is below ` +
          `${LOW_SUCCESS_RATE_THRESHOLD * 100}% threshold ` +
          `(completed=${this.sweepCompletedTotal}, failed=${this.sweepFailedTotal})`,
      );
    }
  }
}
