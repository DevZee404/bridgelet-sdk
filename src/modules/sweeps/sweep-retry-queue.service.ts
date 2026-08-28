import { Injectable, Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

/**
 * Represents a sweep attempt that failed and may be retried.
 */
export interface SweepRetryEntry {
  /** Unique identifier for the sweep (account + timestamp). */
  id: string;
  /** Account ID being swept. */
  accountId: string;
  /** Number of times this sweep has been attempted. */
  attempts: number;
  /** Maximum number of retry attempts allowed. */
  maxAttempts: number;
  /** Timestamp (ms) of the last failed attempt. */
  lastAttemptAt: number;
  /** Timestamp (ms) when the next retry should be scheduled. */
  nextRetryAt: number;
  /** The original error message from the last failure. */
  lastError: string;
  /** Whether this sweep is terminal (should not be retried). */
  terminal: boolean;
}

/**
 * Represents a sweep that has exhausted all retries and been moved to the dead-letter queue.
 */
export interface DeadLetterSweepEntry {
  /** Unique identifier for the dead-letter entry. */
  id: string;
  /** Original sweep ID from the retry queue. */
  originalSweepId: string;
  /** Account ID being swept. */
  accountId: string;
  /** Total number of attempts made before moving to DLQ. */
  totalAttempts: number;
  /** Timestamp (ms) when the sweep was moved to the dead-letter queue. */
  movedToDlqAt: number;
  /** The last error message that caused the final failure. */
  lastError: string;
  /** Whether this dead-letter entry has been resolved manually. */
  resolved: boolean;
  /** Timestamp (ms) when this entry was resolved (if applicable). */
  resolvedAt?: number;
  /** Notes added by the operator during resolution (if applicable). */
  resolutionNotes?: string;
}

/**
 * In-memory retry queue for failed sweep executions.
 *
 * Implements exponential backoff: delays double on each retry up to a maximum
 * of 5 minutes.  Terminal errors (AlreadySwept, AccountExpired) are not
 * retried.
 *
 * This is an MVP implementation — production deployments should use a
 * persistent queue (BullMQ, SQS, etc.) for durability across restarts.
 */
@Injectable()
export class SweepRetryQueueService {
  private readonly logger = new Logger(SweepRetryQueueService.name);

  /** Map of sweep ID → retry entry. */
  private readonly queue = new Map<string, SweepRetryEntry>();

  /** Interval ID for the periodic drain timer. */
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  /** Callback invoked when a retry is ready. */
  private onRetry: ((entry: SweepRetryEntry) => Promise<void>) | null = null;

  /** Base delay in milliseconds (doubles on each retry). */
  private static readonly BASE_DELAY_MS = 2_000;
  /** Maximum delay between retries (5 minutes). */
  private static readonly MAX_DELAY_MS = 300_000;
  /** How often the drain timer fires (10 seconds). */
  private static readonly DRAIN_INTERVAL_MS = 10_000;
  /** Default maximum retry attempts. */
  static readonly DEFAULT_MAX_ATTEMPTS = 5;

  /**
   * Terminal error substrings that should never be retried.
   */
  private static readonly TERMINAL_ERRORS = [
    'ALREADY_SWEPT',
    'ACCOUNT_EXPIRED',
    'AlreadySwept',
    'AccountExpired',
    'NotInitialized',
  ];

  /**
   * Start the retry drain timer.  Call `onRetry` for each entry whose
   * `nextRetryAt` has been reached.
   */
  startDrainTimer(callback: (entry: SweepRetryEntry) => Promise<void>): void {
    if (this.drainTimer) return;
    this.onRetry = callback;
    this.drainTimer = setInterval(() => {
      void this.drain();
    }, SweepRetryQueueService.DRAIN_INTERVAL_MS);
    this.logger.log('Sweep retry drain timer started');
  }

  /** Stop the drain timer (for graceful shutdown). */
  stopDrainTimer(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
      this.onRetry = null;
      this.logger.log('Sweep retry drain timer stopped');
    }
  }

  /**
   * Enqueue a failed sweep for retry.
   *
   * @param accountId  The account that failed to sweep.
   * @param error      The error message from the failed attempt.
   * @param maxAttempts  Maximum retries (default 5).
   * @returns The retry entry, or `null` if the error is terminal.
   */
  enqueue(
    accountId: string,
    error: string,
    maxAttempts = SweepRetryQueueService.DEFAULT_MAX_ATTEMPTS,
  ): SweepRetryEntry | null {
    // Check if the error is terminal — do not retry
    if (SweepRetryQueueService.isTerminalError(error)) {
      this.logger.warn(
        `Sweep for ${accountId} failed with terminal error — not retrying: ${error}`,
      );
      return null;
    }

    const id = `${accountId}-${Date.now()}`;
    const now = Date.now();
    const delay = SweepRetryQueueService.BASE_DELAY_MS;

    const entry: SweepRetryEntry = {
      id,
      accountId,
      attempts: 1,
      maxAttempts,
      lastAttemptAt: now,
      nextRetryAt: now + delay,
      lastError: error,
      terminal: false,
    };

    this.queue.set(id, entry);
    this.logger.log(
      `Enqueued sweep retry for ${accountId} (attempt 1/${maxAttempts}, next retry in ${delay}ms)`,
    );

    return entry;
  }

  /**
   * Mark a retry entry as having been attempted.  If the attempt succeeded,
   * remove it from the queue.  If it failed again, reschedule with exponential
   * backoff or mark as terminal.
   */
  markAttempted(
    entry: SweepRetryEntry,
    success: boolean,
    error?: string,
  ): void {
    if (success) {
      this.queue.delete(entry.id);
      this.logger.log(
        `Sweep retry succeeded for ${entry.accountId} — removing from queue`,
      );
      return;
    }

    entry.attempts++;
    entry.lastAttemptAt = Date.now();
    entry.lastError = error ?? entry.lastError;

    if (entry.attempts >= entry.maxAttempts) {
      entry.terminal = true;
      this.logger.warn(
        `Sweep for ${entry.accountId} exhausted ${entry.maxAttempts} retries — marking terminal`,
      );
      return;
    }

    // Exponential backoff, capped at MAX_DELAY_MS
    const delay = Math.min(
      SweepRetryQueueService.BASE_DELAY_MS * Math.pow(2, entry.attempts - 1),
      SweepRetryQueueService.MAX_DELAY_MS,
    );
    entry.nextRetryAt = Date.now() + delay;
    this.logger.log(
      `Sweep retry for ${entry.accountId} rescheduled (attempt ${entry.attempts}/${entry.maxAttempts}, next in ${delay}ms)`,
    );
  }

  /** Get the current queue size. */
  get pendingCount(): number {
    return this.queue.size;
  }

  /** Get all pending (non-terminal) entries. */
  getPendingEntries(): SweepRetryEntry[] {
    return Array.from(this.queue.values()).filter((e) => !e.terminal);
  }

  /** Remove an entry from the queue (e.g. if the account is cancelled). */
  remove(id: string): boolean {
    return this.queue.delete(id);
  }

  /** Clear the entire queue. */
  clear(): void {
    this.queue.clear();
  }

  /** Check if an error message is terminal. */
  static isTerminalError(error: string): boolean {
    return SweepRetryQueueService.TERMINAL_ERRORS.some((term) =>
      error.includes(term),
    );
  }

  /**
   * Drain the queue — invoke the callback for entries whose retry time has
   * arrived.
   */
  private async drain(): Promise<void> {
    if (!this.onRetry) return;

    const now = Date.now();
    const ready = Array.from(this.queue.values()).filter(
      (e) => !e.terminal && e.nextRetryAt <= now,
    );

    for (const entry of ready) {
      try {
        await this.onRetry(entry);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Retry callback failed for ${entry.accountId}: ${message}`,
        );
      }
    }
  }
}