import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Account } from '../../accounts/entities/account.entity.js';
import type { SweepExecutionRequest } from '../interfaces/execute-sweep.interface.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { StellarAddressValidator } from '../../../common/validators/stellar-address.validator.js';
import { SweepKind } from '../enums/sweep-kind.enum.js';
import { LogSanitizer } from '../../../common/utils/log-sanitizer.util.js';

export interface ValidatedSweepContext {
  account: Account;
  destinationAddress: string;
}

@Injectable()
export class ValidationProvider {
  private readonly logger = new Logger(ValidationProvider.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Validate all sweep parameters before execution and return the
   * authoritative destination address for the sweep transaction.
   */
  public async validateSweepParameters(
    sweepExecutionRequest: SweepExecutionRequest,
  ): Promise<ValidatedSweepContext> {
    const sweepKind = sweepExecutionRequest.sweepKind ?? SweepKind.CLAIM;

    this.logger.log(
      `Validating ${sweepKind} sweep parameters for account: ${sweepExecutionRequest.accountId}`,
    );

    const account = await this.accountRepository.findOne({
      where: { id: sweepExecutionRequest.accountId },
    });

    if (!account) {
      throw new NotFoundException(
        `Account ${sweepExecutionRequest.accountId} not found`,
      );
    }

    if (account.publicKey !== sweepExecutionRequest.ephemeralPublicKey) {
      throw new BadRequestException('Ephemeral public key mismatch');
    }

    const amount = parseFloat(sweepExecutionRequest.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    if (sweepExecutionRequest.amount !== account.amount) {
      throw new BadRequestException(
        `Amount mismatch: expected ${account.amount}, got ${sweepExecutionRequest.amount}`,
      );
    }

    if (!this.isValidAssetFormat(sweepExecutionRequest.asset)) {
      throw new BadRequestException('Invalid asset format');
    }

    if (sweepExecutionRequest.asset !== account.asset) {
      throw new BadRequestException(
        `Asset mismatch: expected ${account.asset}, got ${sweepExecutionRequest.asset}`,
      );
    }

    if (sweepKind === SweepKind.RECOVERY) {
      return this.validateRecoverySweep(account, sweepExecutionRequest);
    }

    return this.validateClaimSweep(account, sweepExecutionRequest);
  }

  private validateClaimSweep(
    account: Account,
    sweepExecutionRequest: SweepExecutionRequest,
  ): ValidatedSweepContext {
    if (account.status === AccountStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Account has not received payment yet');
    }

    if (
      account.status !== AccountStatus.PENDING_CLAIM &&
      account.status !== AccountStatus.CLAIMING &&
      account.status !== AccountStatus.PARTIAL_SWEEP
    ) {
      throw new BadRequestException(
        `Account cannot be swept. Status: ${account.status}`,
      );
    }

    if (new Date() > account.expiresAt) {
      throw new BadRequestException('Account has expired');
    }

    const authorizedDestination = account.destinationAddress?.trim();
    if (!authorizedDestination) {
      throw new BadRequestException(
        'No authorized destination on account — claim must be locked before sweep',
      );
    }

    StellarAddressValidator.assertValid(authorizedDestination);

    const attemptedDestination =
      sweepExecutionRequest.destinationAddress?.trim();
    if (
      attemptedDestination &&
      attemptedDestination !== authorizedDestination
    ) {
      this.logger.error(
        `SECURITY: sweep destination mismatch for account ${account.id}. ` +
          `Authorized=${LogSanitizer.redactAddress(authorizedDestination)}, ` +
          `Attempted=${LogSanitizer.redactAddress(attemptedDestination)}`,
      );
      throw new ForbiddenException('Sweep destination not authorized');
    }

    this.logger.log(
      `Validation passed for claim sweep on account: ${account.id}`,
    );

    return { account, destinationAddress: authorizedDestination };
  }

  private validateRecoverySweep(
    account: Account,
    sweepExecutionRequest: SweepExecutionRequest,
  ): ValidatedSweepContext {
    if (
      account.status !== AccountStatus.PENDING_PAYMENT &&
      account.status !== AccountStatus.PENDING_CLAIM
    ) {
      throw new BadRequestException(
        `Account cannot be recovery-swept. Status: ${account.status}`,
      );
    }

    if (new Date() <= account.expiresAt) {
      throw new BadRequestException('Account has not expired yet');
    }

    const recoveryPublic = this.configService.get<string>(
      'stellar.recoveryPublic',
    );
    if (!recoveryPublic) {
      throw new BadRequestException('Recovery account is not configured');
    }

    StellarAddressValidator.assertValid(recoveryPublic);

    const attemptedDestination =
      sweepExecutionRequest.destinationAddress?.trim();
    if (attemptedDestination && attemptedDestination !== recoveryPublic) {
      this.logger.error(
        `SECURITY: recovery sweep destination substitution blocked for account ` +
          `${account.id}. Expected recovery account, attempted ` +
          `${LogSanitizer.redactAddress(attemptedDestination)}`,
      );
      throw new ForbiddenException('Recovery sweep destination not authorized');
    }

    this.logger.log(
      `Validation passed for recovery sweep on account: ${account.id}`,
    );

    return { account, destinationAddress: recoveryPublic };
  }

  /**
   * Check if account can be swept
   */
  public async canSweep(
    accountId: string,
    destinationAddress: string,
  ): Promise<boolean> {
    try {
      const account = await this.accountRepository.findOne({
        where: { id: accountId },
      });

      if (!account) return false;
      if (account.status !== AccountStatus.PENDING_CLAIM) return false;
      if (new Date() > account.expiresAt) return false;
      if (account.destinationAddress !== destinationAddress) return false;

      StellarAddressValidator.assertValid(destinationAddress);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed sweep status
   */
  public async getSweepStatus(
    accountId: string,
  ): Promise<{ canSweep: boolean; reason?: string }> {
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
    });

    if (!account) {
      return { canSweep: false, reason: 'Account not found' };
    }

    if (!account.publicKey) {
      return {
        canSweep: false,
        reason: 'No public key associated with account',
      };
    }

    if (account.status === AccountStatus.CLAIMED) {
      return { canSweep: false, reason: 'Already swept' };
    }

    if (account.status === AccountStatus.EXPIRED) {
      return { canSweep: false, reason: 'Account expired' };
    }

    if (account.status === AccountStatus.PENDING_PAYMENT) {
      return { canSweep: false, reason: 'Payment not received' };
    }

    if (new Date() > account.expiresAt) {
      return { canSweep: false, reason: 'Account expired' };
    }

    if (!account.destinationAddress) {
      return { canSweep: false, reason: 'Claim not initiated' };
    }

    return { canSweep: true };
  }

  /**
   * Validate asset format (native, XLM, or CODE:ISSUER)
   */
  private isValidAssetFormat(asset: string): boolean {
    if (asset === 'native' || asset === 'XLM') {
      return true;
    }

    const parts = asset.split(':');
    if (parts.length !== 2) {
      return false;
    }

    const [code, issuer] = parts;
    if (!/^[a-zA-Z0-9]{1,12}$/.test(code)) {
      return false;
    }

    return StellarAddressValidator.isValid(issuer);
  }
}
