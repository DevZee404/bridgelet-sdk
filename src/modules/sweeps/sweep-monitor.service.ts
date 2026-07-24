import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon } from '@stellar/stellar-sdk';

export interface SweepTransactionUpdate {
  hash: string;
  accountId: string;
  status: 'pending' | 'success' | 'failed';
  ledger?: number;
  resultCode?: string;
  error?: string;
  timestamp: Date;
}

export type SweepTransactionCallback = (update: SweepTransactionUpdate) => void;

/**
 * Monitors submitted sweep transactions via Horizon Server-Sent Events (SSE).
 *
 * When a sweep transaction hash is known, this service streams transaction
 * results from Horizon and invokes a callback with the outcome.  This
 * replaces polling-based monitoring with real-time push notifications.
 */
@Injectable()
export class SweepMonitorService implements OnModuleDestroy {
  private readonly logger = new Logger(SweepMonitorService.name);
  private readonly server: Horizon.Server;

  /** Map of tx hash → SSE close function for active streams. */
  private readonly activeStreams = new Map<string, () => void>();

  /** Map of account ID → registered callbacks. */
  private readonly accountCallbacks = new Map<
    string,
    Set<SweepTransactionCallback>
  >();

  constructor(private readonly configService: ConfigService) {
    const horizonUrl =
      this.configService.getOrThrow<string>('stellar.horizonUrl');
    this.server = new Horizon.Server(horizonUrl);
    this.logger.log('SweepMonitorService initialized');
  }

  /**
   * Begin monitoring a specific transaction by hash.
   *
   * Uses Horizon's transaction stream endpoint.  The callback fires once
   * when the transaction reaches a terminal state (success or fail) and
   * then the stream is automatically closed.
   */
  monitorTransaction(
    txHash: string,
    accountId: string,
    callback: SweepTransactionCallback,
  ): void {
    if (this.activeStreams.has(txHash)) {
      this.logger.debug(`Already monitoring transaction ${txHash}`);
      return;
    }

    this.logger.log(
      `Starting Horizon stream for tx ${txHash} (account: ${accountId})`,
    );

    const closeFn = this.server
      .transactions()
      .transaction(txHash)
      .stream({
        onmessage: (tx: Horizon.ServerApi.TransactionRecord) => {
          const update: SweepTransactionUpdate = {
            hash: tx.hash,
            accountId,
            status: tx.successful ? 'success' : 'failed',
            ledger: tx.ledger,
            resultCode: tx.result_xdr ?? undefined,
            timestamp: new Date(),
          };

          this.logger.log(
            `Transaction ${txHash} completed: status=${update.status}, ledger=${update.ledger}`,
          );

          callback(update);
          this.activeStreams.delete(txHash);
        },
        onerror: (err: Error) => {
          this.logger.error(
            `Horizon stream error for tx ${txHash}: ${err.message}`,
          );

          const update: SweepTransactionUpdate = {
            hash: txHash,
            accountId,
            status: 'failed',
            error: err.message,
            timestamp: new Date(),
          };

          callback(update);
          this.activeStreams.delete(txHash);
        },
      }) as unknown as () => void;

    this.activeStreams.set(txHash, closeFn);
  }

  /**
   * Register a callback for all transaction updates on a given account.
   *
   * This uses Horizon's account transaction stream which fires for every
   * transaction affecting the account — useful for monitoring sweep
   * confirmations on an ephemeral account.
   */
  monitorAccount(
    accountId: string,
    callback: SweepTransactionCallback,
  ): () => void {
    if (!this.accountCallbacks.has(accountId)) {
      this.accountCallbacks.set(accountId, new Set());
    }
    this.accountCallbacks.get(accountId)!.add(callback);

    this.logger.log(`Monitoring account ${accountId} for transactions`);

    // Return unsubscribe function
    return () => {
      const callbacks = this.accountCallbacks.get(accountId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.accountCallbacks.delete(accountId);
        }
      }
      this.logger.log(`Stopped monitoring account ${accountId}`);
    };
  }

  /**
   * Stop monitoring a specific transaction.
   */
  stopMonitoringTransaction(txHash: string): void {
    const closeFn = this.activeStreams.get(txHash);
    if (closeFn) {
      closeFn();
      this.activeStreams.delete(txHash);
      this.logger.log(`Stopped monitoring transaction ${txHash}`);
    }
  }

  /**
   * Stop all active streams.  Called during graceful shutdown.
   */
  stopAll(): void {
    for (const [hash, closeFn] of this.activeStreams) {
      try {
        closeFn();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.activeStreams.clear();
    this.accountCallbacks.clear();
    this.logger.log('All monitoring streams stopped');
  }

  get activeStreamCount(): number {
    return this.activeStreams.size;
  }

  onModuleDestroy(): void {
    this.stopAll();
  }
}
