import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { StellarService } from '../stellar/stellar.service.js';
import { Account } from '../accounts/entities/account.entity.js';
import { AccountStatus } from '../accounts/enums/account-status.enum.js';
import { assertValidAccountStatusTransition } from '../accounts/enums/account-status-transitions.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { SweepsService } from '../sweeps/sweeps.service.js';
import { ClaimAuditLog } from '../claims/entities/claim-audit-log.entity.js';
import { SecretEncryptionUtil } from '../../common/crypto/secret-encryption.util.js';
import { KmsKeyProvider } from '../../common/crypto/kms-key.provider.js';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private expiryHandle: ReturnType<typeof setInterval> | null = null;
  private initializingHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    @InjectRepository(ClaimAuditLog)
    private readonly claimAuditRepository: Repository<ClaimAuditLog>,
    private readonly stellarService: StellarService,
    private readonly sweepsService: SweepsService,
    private readonly configService: ConfigService,
    private readonly webhooksService: WebhooksService,
    private readonly kmsKeyProvider: KmsKeyProvider,
  ) {}

  onModuleInit(): void {
    const expiryIntervalMs = parseInt(
      process.env.EXPIRY_CHECK_INTERVAL_MS ?? '300000',
      10,
    );
    const initializingIntervalMs = parseInt(
      process.env.INITIALIZING_CLEANUP_INTERVAL_MS ?? '900000',
      10,
    );

    this.expiryHandle = setInterval(
      () => void this.runExpiryJob(),
      expiryIntervalMs,
    );
    this.initializingHandle = setInterval(
      () => void this.runInitializingCleanup(),
      initializingIntervalMs,
    );

    this.logger.log(`Expiry job started (interval: ${expiryIntervalMs}ms)`);
    this.logger.log(
      `INITIALIZING cleanup started (interval: ${initializingIntervalMs}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.expiryHandle !== null) {
      clearInterval(this.expiryHandle);
      this.expiryHandle = null;
    }
    if (this.initializingHandle !== null) {
      clearInterval(this.initializingHandle);
      this.initializingHandle = null;
    }
    this.logger.log('Scheduler jobs stopped');
  }

  /**
   * Expires all PENDING_PAYMENT and PENDING_CLAIM accounts whose expiresAt
   * has passed. Calls StellarService.expireAccount(), triggers the recovery
   * sweep path, invalidates unredeemed claim tokens, and records expiredAt.
   * Per-account failures are isolated.
   */
  async runExpiryJob(): Promise<void> {
    const now = new Date();

    let accounts: Account[];
    try {
      accounts = await this.accountsRepository.find({
        where: [
          { status: AccountStatus.PENDING_PAYMENT, expiresAt: LessThan(now) },
          { status: AccountStatus.PENDING_CLAIM, expiresAt: LessThan(now) },
        ],
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Expiry job DB query failed: ${msg}`);
      return;
    }

    if (accounts.length === 0) {
      await this.purgeStaleClaimAuditLogs();
      await this.runExpiredClaimCleanup();
      return;
    }

    this.logger.debug(
      `Expiry job: processing ${accounts.length} expired account(s)`,
    );

    await Promise.allSettled(
      accounts.map((account) => this.expireAccount(account)),
    );

    await this.purgeStaleClaimAuditLogs();
    await this.runExpiredClaimCleanup();
  }

  private async expireAccount(account: Account): Promise<void> {
    const contractId = account.contractId;
    const signerSecret = this.configService.getOrThrow<string>(
      'stellar.fundingSecret',
    );

    if (!contractId) {
      this.logger.error(
        `expireAccount() skipped for account ${account.id}: contractId is null`,
      );
      return;
    }

    try {
      await this.stellarService.expireAccount({ contractId, signerSecret });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `expireAccount() failed for account ${account.id} (${account.publicKey}): ${msg}`,
      );
      return;
    }

    await this.runRecoverySweepForAccount(account);

    const expiredAt = new Date();
    assertValidAccountStatusTransition(account.status, AccountStatus.EXPIRED);
    await this.accountsRepository.update(account.id, {
      status: AccountStatus.EXPIRED,
      expiredAt,
      claimTokenHash: null,
      destinationAddress: '',
    });
    this.logger.log(
      `Account ${account.id} status → EXPIRED (claim token invalidated)`,
    );

    await this.webhooksService.triggerEvent('account.expired', {
      accountId: account.id,
      publicKey: account.publicKey,
      expiredAt,
    });
  }

  /**
   * Recovery sweep for expired, never-redeemed accounts. Distinct from the
   * claim redemption path — destination is always RECOVERY_ACCOUNT_PUBLIC.
   */
  private async runRecoverySweepForAccount(account: Account): Promise<void> {
    if (!account.publicKey || !account.secretKeyEncrypted) {
      this.logger.warn(
        `Recovery sweep skipped for account ${account.id}: missing keys`,
      );
      return;
    }

    try {
      const ephemeralSecret = SecretEncryptionUtil.decrypt(
        account.secretKeyEncrypted,
        this.kmsKeyProvider.getEncryptionKey(),
      );

      const result = await this.sweepsService.executeRecoverySweep(
        account.id,
        account.publicKey,
        ephemeralSecret,
        account.amount,
        account.asset,
      );

      if (result.success) {
        this.logger.log(
          `Recovery sweep completed for account ${account.id}: txHash=${result.txHash}`,
        );
      } else {
        this.logger.warn(
          `Recovery sweep partial/failed for account ${account.id}: ${result.error ?? 'unknown'}`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Recovery sweep failed for account ${account.id}: ${msg}`,
      );
    }
  }

  /**
   * Purges claim audit log rows older than the configured retention window.
   * Unredeemed claim tokens on already-expired accounts are cleared by
   * {@link expireAccount}; this handles audit-trail lifecycle separately.
   */
  async purgeStaleClaimAuditLogs(): Promise<void> {
    const retentionDays =
      this.configService.get<number>('app.claimAuditRetentionDays') ?? 90;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

    try {
      const result = await this.claimAuditRepository.delete({
        attemptedAt: LessThan(cutoff),
      });
      if (result.affected && result.affected > 0) {
        this.logger.log(
          `Purged ${result.affected} claim audit log row(s) older than ${retentionDays} days`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Claim audit log purge failed: ${msg}`);
    }
  }

  /**
   * Secondary pass: invalidate claim tokens on EXPIRED accounts that still
   * carry a hash (e.g. from a prior partial expiry run).
   */
  async runExpiredClaimCleanup(): Promise<void> {
    try {
      const result = await this.accountsRepository.update(
        {
          status: AccountStatus.EXPIRED,
          claimTokenHash: Not(IsNull()),
        },
        { claimTokenHash: null },
      );
      if (result.affected && result.affected > 0) {
        this.logger.log(
          `Invalidated claim tokens on ${result.affected} expired account(s)`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Expired claim cleanup failed: ${msg}`);
    }
  }

  /**
   * Marks accounts stuck in INITIALIZING status beyond the configured timeout
   * as FAILED. No contract call is made — the contract was never initialized
   * for these accounts.
   */
  async runInitializingCleanup(): Promise<void> {
    const timeoutMs = parseInt(
      process.env.INITIALIZING_TIMEOUT_MS ?? '600000',
      10,
    );
    const cutoff = new Date(Date.now() - timeoutMs);

    let accounts: Account[];
    try {
      accounts = await this.accountsRepository.find({
        where: {
          status: AccountStatus.INITIALIZING,
          createdAt: LessThan(cutoff),
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`INITIALIZING cleanup DB query failed: ${msg}`);
      return;
    }

    if (accounts.length === 0) return;

    this.logger.debug(
      `INITIALIZING cleanup: processing ${accounts.length} stale account(s)`,
    );

    await Promise.allSettled(
      accounts.map((account) => this.markInitializingFailed(account)),
    );

    this.logger.error(
      `ALERT: ${accounts.length} account(s) stuck in INITIALIZING past the ` +
        `timeout were marked FAILED (initialization_timeout). If this count is ` +
        `consistently non-zero, investigate the account-creation path. (issue #463)`,
    );
  }

  private async markInitializingFailed(account: Account): Promise<void> {
    try {
      const metadata: Record<string, any> = {
        ...(account.metadata ?? {}),
        failureReason: 'initialization_timeout',
        detectedAt: new Date().toISOString(),
      };
      assertValidAccountStatusTransition(account.status, AccountStatus.FAILED);
      await this.accountsRepository.update(account.id, {
        status: AccountStatus.FAILED,
        metadata,
      });
      this.logger.warn(
        `Account ${account.id} status → FAILED (initialization_timeout)`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to mark account ${account.id} as FAILED: ${msg}`,
      );
    }
  }
}
