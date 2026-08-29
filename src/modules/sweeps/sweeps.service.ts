import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import { StellarService } from '../stellar/stellar.service.js';
import { SweepRetryQueueService } from './sweep-retry-queue.service.js';
import type { SweepExecutionRequest } from './interfaces/execute-sweep.interface.js';
import type { SweepResult } from './interfaces/sweep-result.interface.js';
import { TransactionResult } from './interfaces/transaction-result.interface.js';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { SweepMetricsProvider } from './providers/sweep-metrics.provider.js';
import { Account } from '../accounts/entities/account.entity.js';
import { AccountStatus } from '../accounts/enums/account-status.enum.js';
import { Claim } from '../claims/entities/claim.entity.js';
import type { SweepStatusResponseDto } from './dto/sweep-status-response.dto.js';
import { SweepKind } from './enums/sweep-kind.enum.js';

@Injectable()
export class SweepsService {
  private readonly logger = new Logger(SweepsService.name);

  constructor(
    private readonly validationProvider: ValidationProvider,
    private readonly contractProvider: ContractProvider,
    private readonly transactionProvider: TransactionProvider,
    private readonly stellarService: StellarService,
    private readonly configService: ConfigService,
    private readonly retryQueue: SweepRetryQueueService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Claim)
    private readonly claimRepository: Repository<Claim>,
    @InjectMetric('sweep_success_total')
    private readonly sweepSuccessCounter: Counter<string>,
    @InjectMetric('sweep_failure_total')
    private readonly sweepFailureCounter: Counter<string>,
    private readonly sweepMetrics: SweepMetricsProvider,
  ) {}

  /**
   * Execute sweep: authorize on-chain via SweepController contract, then
   * transfer funds via a classic Horizon payment, and finally merge the
   * ephemeral account into the destination to reclaim the minimum reserve.
   *
   * Flow:
   * Order of operations is strict and intentional:
   *   1. Validate sweep parameters
   *   2. Generate auth signature (MVP stub — see ContractProvider)
   *   3. Submit SweepController.execute_sweep() on Soroban
   *   4. Execute the Horizon payment to move funds
   *   5. AccountMerge: merge ephemeral → destination to reclaim minimum reserve
   *
   * ⚠️ If Step 3 succeeds but Step 4 fails, the contract will be in Swept
   * state but no funds will have moved. This is logged as a critical error
   * for manual recovery. Do not retry automatically.
   *
   * ⚠️ If Step 4 succeeds but Step 5 fails, the sweep is still considered
   * successful. The merge is a best-effort reserve recovery operation;
   * failure is logged as a warning and the result carries no mergeHash.
   */
  public async executeSweep(
    sweepExecutionRequest: SweepExecutionRequest,
  ): Promise<SweepResult> {
    const { dryRun = false } = sweepExecutionRequest;
    this.logger.log(
      `Executing sweep for account: ${sweepExecutionRequest.accountId}${dryRun ? ' (dry-run)' : ''}`,
    );

    try {
      // Step 1: Validate sweep parameters and resolve the authoritative
      // destination (from the locked claim record or recovery config).
      const { destinationAddress } =
        await this.validationProvider.validateSweepParameters(
          sweepExecutionRequest,
        );

      const sweepKind = sweepExecutionRequest.sweepKind ?? SweepKind.CLAIM;
      const skipContractAuth =
        sweepExecutionRequest.skipContractAuth ??
        sweepKind === SweepKind.RECOVERY;

      // Steps 2 & 3: Smart-contract authorization.
      // On a retry into PARTIAL_SWEEP the contract is already in Swept state
      // and re-invoking execute_sweep would revert on-chain. The orchestrator
      // (ClaimRedemptionProvider) signals this via skipContractAuth: true and
      // we synthesise the auth hash deterministically from the same inputs
      // for audit-trail purposes.
      let contractAuthHash: string;
      if (skipContractAuth) {
        this.logger.log(
          `Skip-contract-auth for account ${sweepExecutionRequest.accountId}` +
            (sweepKind === SweepKind.RECOVERY
              ? ' (recovery sweep after expiry).'
              : ': contract already in Swept state from prior partial failure.'),
        );
        contractAuthHash = this.contractProvider.generateAuthHash(
          sweepExecutionRequest.ephemeralPublicKey,
          destinationAddress,
        );
      } else {
        // Step 2: Generate authorization signature for the contract call
        const authSignature = this.contractProvider.generateAuthSignature({
          ephemeralPublicKey: sweepExecutionRequest.ephemeralPublicKey,
          destinationAddress,
        });

        // Step 3: Submit execute_sweep() on the SweepController Soroban contract
        const sweepControllerContractId = this.configService.getOrThrow<string>(
          'stellar.contracts.sweepController',
        );
        const ephemeralAccountContractId =
          this.configService.getOrThrow<string>(
            'stellar.contracts.ephemeralAccount',
          );

        await this.stellarService.executeSweep({
          sweepControllerContractId,
          ephemeralAccountContractId,
          destination: destinationAddress,
          authSignature,
          signerSecret: sweepExecutionRequest.ephemeralSecret,
        });

        this.logger.log(
          `Contract sweep authorized for account ${sweepExecutionRequest.accountId}`,
        );

        contractAuthHash = this.contractProvider.generateAuthHash(
          sweepExecutionRequest.ephemeralPublicKey,
          destinationAddress,
        );
      }

      // Step 4: Execute the classic Horizon payment to move funds.
      let transactionResult: TransactionResult;
      try {
        transactionResult =
          await this.transactionProvider.executeSweepTransaction({
            ephemeralSecret: sweepExecutionRequest.ephemeralSecret,
            destinationAddress,
            amount: sweepExecutionRequest.amount,
            asset: sweepExecutionRequest.asset,
          });
        this.sweepSuccessCounter.inc();
      } catch (error) {
        this.sweepFailureCounter.inc();
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        this.logger.error(
          `PARTIAL sweep: contract authorized but Horizon payment failed for ` +
            `account ${sweepExecutionRequest.accountId}. Contract auth hash: ` +
            `${contractAuthHash}. Error: ${message}`,
          stack,
        );
        this.sweepMetrics.recordFailed();

        // Enqueue for retry (returns null for terminal errors)
        const retryEntry = this.retryQueue.enqueue(
          sweepExecutionRequest.accountId,
          message,
        );
        if (retryEntry) {
          this.logger.log(
            `Sweep failed, enqueued for retry (${retryEntry.attempts}/${retryEntry.maxAttempts})`,
          );
        }

        return {
          success: false,
          isPartial: true,
          contractAuthHash,
          amountSwept: sweepExecutionRequest.amount,
          destination: destinationAddress,
          error: message,
        };
      }

      // Step 4b: Multi-asset sweep — sweep additional non-zero balances.
      if (sweepExecutionRequest.sweepAllAssets) {
        await this.sweepAdditionalAssets(
          sweepExecutionRequest.ephemeralPublicKey,
          sweepExecutionRequest.ephemeralSecret,
          destinationAddress,
          sweepExecutionRequest.asset,
        );
      }

      // Step 5: AccountMerge — merge the ephemeral account into the destination
      // to reclaim the minimum XLM reserve (currently 1 XLM). This is a
      // best-effort operation.
      let mergeHash: string | undefined;
      try {
        const mergeResult = await this.transactionProvider.mergeAccount({
          ephemeralSecret: sweepExecutionRequest.ephemeralSecret,
          destinationAddress,
        });
        mergeHash = mergeResult.hash;
        this.logger.log(
          `AccountMerge successful for account ${sweepExecutionRequest.accountId}: ` +
            `mergeHash=${mergeHash}`,
        );
      } catch (mergeError) {
        const mergeMessage =
          mergeError instanceof Error ? mergeError.message : String(mergeError);
        this.logger.warn(
          `AccountMerge failed (non-critical) for account ` +
            `${sweepExecutionRequest.accountId}: ${mergeMessage}. ` +
            `Main sweep txHash=${transactionResult.hash} was successful.`,
        );
      }

      this.logger.log(`Sweep complete: txHash=${transactionResult.hash}`);
      this.sweepMetrics.recordCompleted();

      return {
        success: true,
        txHash: transactionResult.hash,
        contractAuthHash,
        amountSwept: sweepExecutionRequest.amount,
        destination: destinationAddress,
        timestamp: transactionResult.timestamp,
        ...(mergeHash !== undefined && { mergeHash }),
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const retryEntry = this.retryQueue.enqueue(
        sweepExecutionRequest.accountId,
        errorMsg,
      );
      if (retryEntry) {
        this.logger.log(
          `Sweep failed, enqueued for retry (${retryEntry.attempts}/${retryEntry.maxAttempts})`,
        );
      }
      throw error;
    }
  }

  /**
   * Sweep expired account funds to the configured recovery address.
   * Uses a distinct authorization path from claim-triggered sweeps: the
   * destination is always derived from `stellar.recoveryPublic` and
   * contract auth is skipped because on-chain expiry was already processed.
   */
  public async executeRecoverySweep(
    accountId: string,
    ephemeralPublicKey: string,
    ephemeralSecret: string,
    amount: string,
    asset: string,
  ): Promise<SweepResult> {
    this.logger.log(
      `Executing recovery sweep for expired account: ${accountId}`,
    );

    return this.executeSweep({
      accountId,
      ephemeralPublicKey,
      ephemeralSecret,
      amount,
      asset,
      sweepKind: SweepKind.RECOVERY,
    });
  }

  /**
   * Check if account can be swept (validation only, no execution)
   */
  public async canSweep(
    accountId: string,
    destinationAddress: string,
  ): Promise<boolean> {
    return this.validationProvider.canSweep(accountId, destinationAddress);
  }

  /**
   * Get sweep status for an account
   */
  public async getSweepStatus(accountId: string): Promise<{
    canSweep: boolean;
    reason?: string;
  }> {
    return this.validationProvider.getSweepStatus(accountId);
  }

  /**
   * Get detailed sweep status for an account by its UUID.
   * Returns transaction hash, confirmation status, and error details
   * suitable for the admin dashboard and sender notifications.
   */
  public async getSweepById(
    accountId: string,
  ): Promise<SweepStatusResponseDto> {
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }

    const claim = await this.claimRepository.findOne({
      where: { accountId: account.id },
      order: { createdAt: 'DESC' },
    });

    const dto: SweepStatusResponseDto = {
      accountId: account.id,
      publicKey: account.publicKey,
      status: account.status,
      destinationAddress: account.destinationAddress,
      amount: account.amount,
      asset: account.asset,
      createdAt: account.createdAt,
      expiresAt: account.expiresAt,
    };

    if (claim) {
      dto.sweepTxHash = claim.sweepTxHash;
      dto.sweptAt = claim.claimedAt;

      if (account.status === AccountStatus.CLAIMED) {
        dto.confirmationStatus = 'confirmed';
      } else if (account.status === AccountStatus.PARTIAL_SWEEP) {
        dto.confirmationStatus = 'partial';
        dto.error = 'Contract authorized but Horizon payment failed';
      } else if (account.status === AccountStatus.CLAIMING) {
        dto.confirmationStatus = 'pending';
      }
    } else if (account.status === AccountStatus.FAILED) {
      dto.confirmationStatus = 'failed';
      dto.error = 'Account creation or initialization failed';
    } else if (account.status === AccountStatus.EXPIRED) {
      dto.confirmationStatus = 'expired';
    }

    return dto;
  }

  /**
   * Sweep additional non-zero balances on the ephemeral account.
   * Called after the primary asset sweep when `sweepAllAssets` is true.
   * Each additional balance is sent as a separate Horizon payment.
   * Failures on individual assets are logged but do not fail the overall sweep.
   */
  private async sweepAdditionalAssets(
    ephemeralPublicKey: string,
    ephemeralSecret: string,
    destinationAddress: string,
    primaryAsset: string,
  ): Promise<void> {
    let balances: Array<{ asset: string; amount: string }>;
    try {
      balances =
        await this.transactionProvider.getAllAccountBalances(
          ephemeralPublicKey,
        );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to query additional balances for multi-asset sweep on ` +
          `${ephemeralPublicKey}: ${message}. Skipping additional assets.`,
      );
      return;
    }

    // Filter out the primary asset already swept and native (XLM) which is
    // handled by the AccountMerge in step 5
    const additionalAssets = balances.filter(
      (b) => b.asset !== primaryAsset && b.asset !== 'native',
    );

    if (additionalAssets.length === 0) {
      this.logger.log('No additional non-zero assets to sweep');
      return;
    }

    this.logger.log(
      `Sweeping ${additionalAssets.length} additional asset(s): ` +
        additionalAssets.map((b) => b.asset).join(', '),
    );

    for (const balance of additionalAssets) {
      try {
        await this.transactionProvider.executeSweepTransaction({
          ephemeralSecret,
          destinationAddress,
          amount: balance.amount,
          asset: balance.asset,
        });
        this.logger.log(
          `Additional asset swept: ${balance.asset} ${balance.amount}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Failed to sweep additional asset ${balance.asset}: ${message}`,
        );
      }
    }
  }
}
