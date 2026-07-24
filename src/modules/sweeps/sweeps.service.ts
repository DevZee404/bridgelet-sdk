import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import type { SweepExecutionRequest } from './interfaces/execute-sweep.interface.js';
import type { SweepResult } from './interfaces/sweep-result.interface.js';

@Injectable()
export class SweepsService {
  private readonly logger = new Logger(SweepsService.name);

  constructor(
    private readonly validationProvider: ValidationProvider,
    private readonly contractProvider: ContractProvider,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Execute sweep: transfer funds from ephemeral account to permanent wallet
   */
  public async executeSweep(
    sweepExecutionRequest: SweepExecutionRequest,
  ): Promise<SweepResult> {
    const { dryRun = false } = sweepExecutionRequest;
    this.logger.log(
      `Executing sweep for account: ${sweepExecutionRequest.accountId}${dryRun ? ' (dry-run)' : ''}`,
    );

    try {
      // Step 1: Validate sweep parameters
      await this.validationProvider.validateSweepParameters(
        sweepExecutionRequest,
      );

      // Step 2: Authorize sweep via contract
      const authResult = await this.contractProvider.authorizeSweep({
        ephemeralPublicKey: sweepExecutionRequest.ephemeralPublicKey,
        destinationAddress: sweepExecutionRequest.destinationAddress,
      });

      if (dryRun) {
        this.logger.log('Dry-run sweep — simulation complete, no transaction submitted');
        const result: SweepResult = {
          success: true,
          txHash: 'dry-run',
          contractAuthHash: authResult.hash,
          amountSwept: sweepExecutionRequest.amount,
          destination: sweepExecutionRequest.destinationAddress,
          timestamp: new Date(),
        };
        this.eventEmitter.emit('sweep.completed', {
          txHash: result.txHash,
          amounts: result.amountSwept,
        });
        return result;
      }

      // TODO: Step 3 - Execute transaction (another issue)

      this.logger.log('Sweep authorization completed');

      const result: SweepResult = {
        success: true,
        txHash: 'pending',
        contractAuthHash: authResult.hash,
        amountSwept: sweepExecutionRequest.amount,
        destination: sweepExecutionRequest.destinationAddress,
        timestamp: new Date(),
      };

      this.eventEmitter.emit('sweep.completed', {
        txHash: result.txHash,
        amounts: result.amountSwept,
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Sweep failed for account ${sweepExecutionRequest.accountId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      this.eventEmitter.emit('sweep.failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        retryCount: 0,
      });
      throw error;
    }
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
}
