/**
 * EXAMPLE — how StellarService methods should use the contract error mapper.
 *
 * This file is illustrative only. Adapt the real stellar.service.ts to follow
 * these patterns, replacing any inline string checks or raw throws.
 *
 * Key rule: every catch block that handles a Soroban transaction error must
 * call throwContractError() so the mapper is the single source of truth.
 */

import { Injectable, Logger } from '@nestjs/common';
import { throwContractError } from '../../common/errors/contract-error.mapper.js';

@Injectable()
export class StellarServiceExample {
  private readonly logger = new Logger(StellarServiceExample.name);

  /**
   * Sweeps an ephemeral account.
   *
   * ✅  Correct pattern: catch Soroban error → extract message → throwContractError.
   */
  sweepAccount(accountId: string): void {
    try {
      // await this.sorobanClient.sweep(accountId);
      //   this is an async method
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Contract error during sweep for ${accountId}: ${raw}`);
      throwContractError(raw); // ← always use the mapper, never throw raw
    }
  }

  /**
   * Records a payment asset on the account contract.
   *
   * ✅  Same pattern — any Soroban failure goes through the mapper.
   */
  recordAsset(accountId: string, assetCode: string): void {
    try {
      // await this.sorobanClient.recordAsset(accountId, assetCode);
      //   this is an async method
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Contract error recording asset ${assetCode} on ${accountId}: ${raw}`,
      );
      throwContractError(raw);
    }
  }

  /**
   * Expires an account by calling the contract expire() function.
   *
   * ✅  NotExpired (409 Conflict) will surface correctly — no ad-hoc string check needed.
   */
  expireAccount(accountId: string): void {
    try {
      // await this.sorobanClient.expire(accountId);
      //   this is an async method
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Contract error expiring account ${accountId}: ${raw}`);
      throwContractError(raw);
    }
  }

  /**
   * Updates the sweep destination via the SweepController contract.
   *
   * ✅  UnauthorizedDestination (403) and AccountAlreadySwept (410) are handled
   *     automatically — no ad-hoc conditionals required.
   */
  updateSweepDestination(
    accountId: string,
    // destination: string,
  ): void {
    try {
      // await this.sweepController.setDestination(accountId, destination);
      //   this is an async method
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Contract error updating destination for ${accountId}: ${raw}`,
      );
      throwContractError(raw);
    }
  }
}
