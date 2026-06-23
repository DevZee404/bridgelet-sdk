import {
  Injectable,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import * as crypto from 'crypto';
import { Claim } from '../entities/claim.entity.js';
import { Account } from '../../accounts/entities/account.entity.js';
import { ClaimRedemptionResponseDto } from '../dto/claim-redemption-response.dto.js';
import { SweepsService } from '../../sweeps/sweeps.service.js';
import { TokenVerificationProvider } from './token-verification.provider.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { SecretEncryptionUtil } from '../../../common/crypto/secret-encryption.util.js';
import { ConfigService } from '@nestjs/config';
import { TransactionHashValidator } from '../../../common/validators/transaction-hash.validator.js';
import { StellarAddressValidator } from '../../../common/validators/stellar-address.validator.js';
import { WebhooksService } from '../../webhooks/webhooks.service.js';

@Injectable()
export class ClaimRedemptionProvider {
  private readonly logger = new Logger(ClaimRedemptionProvider.name);

  constructor(
    @InjectRepository(Claim)
    private claimsRepository: Repository<Claim>,
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    @InjectDataSource()
    private dataSource: DataSource,
    private tokenVerificationProvider: TokenVerificationProvider,
    private sweepsService: SweepsService,
    private configService: ConfigService,
    private webhooksService: WebhooksService,
  ) {}

  async redeemClaim(
    token: string,
    destinationAddress: string,
  ): Promise<ClaimRedemptionResponseDto> {
    this.logger.log(`Redeeming claim for destination: ${destinationAddress}`);

    const tokenHash = this.hashToken(token);

    try {
      await this.tokenVerificationProvider.verifyClaimToken(token);
    } catch (error) {
      if (error instanceof ConflictException) {
        const claimedAccount = await this.accountsRepository.findOne({
          where: { claimTokenHash: tokenHash },
        });
        if (claimedAccount) {
          const existingClaim = await this.claimsRepository.findOne({
            where: { accountId: claimedAccount.id },
          });
          if (existingClaim) {
            return {
              success: true,
              txHash: existingClaim.sweepTxHash,
              amountSwept: existingClaim.amountSwept,
              asset: existingClaim.asset,
              destination: existingClaim.destinationAddress,
              sweptAt: existingClaim.claimedAt,
              message: 'Claim was already redeemed',
            };
          }
        }
      }
      throw error;
    }

    StellarAddressValidator.assertValid(destinationAddress);

    // Atomically acquire the claim slot using SELECT FOR UPDATE.
    // This prevents concurrent requests from both passing the status check.
    const account = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        const locked = await manager
          .createQueryBuilder(Account, 'account')
          .setLock('pessimistic_write')
          .where('account.claimTokenHash = :tokenHash', { tokenHash })
          .getOne();

        if (!locked) {
          throw new BadRequestException('Invalid or expired claim token');
        }

        if (locked.status === AccountStatus.CLAIMED) {
          return locked;
        }

        if (locked.status === AccountStatus.CLAIMING) {
          throw new ConflictException('Claim is already being processed');
        }

        locked.status = AccountStatus.CLAIMING;
        locked.destinationAddress = destinationAddress;
        await manager.save(locked);
        return locked;
      },
    );

    // Idempotent response for already-claimed account
    if (account.status === AccountStatus.CLAIMED) {
      this.logger.log(`Claim already redeemed for account: ${account.id}`);
      const existingClaim = await this.claimsRepository.findOne({
        where: { accountId: account.id },
      });
      if (!existingClaim) {
        throw new BadRequestException(
          'Claim record not found for already redeemed account',
        );
      }
      return {
        success: true,
        txHash: existingClaim.sweepTxHash,
        amountSwept: existingClaim.amountSwept,
        asset: existingClaim.asset,
        destination: existingClaim.destinationAddress,
        sweptAt: existingClaim.claimedAt,
        message: 'Claim was already redeemed',
      };
    }

    try {
      const sweepResult = await this.sweepsService.executeSweep({
        accountId: account.id,
        ephemeralPublicKey: account.publicKey,
        ephemeralSecret: SecretEncryptionUtil.decrypt(
          account.secretKeyEncrypted,
          this.configService.getOrThrow<string>('app.encryptionKey'),
        ),
        destinationAddress,
        amount: account.amount,
        asset: account.asset,
      });

      TransactionHashValidator.assertValid(sweepResult.txHash);

      // Atomically record the claim and mark account as CLAIMED
      const claim = await this.dataSource.transaction(
        async (manager: EntityManager) => {
          account.status = AccountStatus.CLAIMED;
          account.claimedAt = new Date();
          await manager.save(account);

          const newClaim = manager.create(Claim, {
            accountId: account.id,
            destinationAddress,
            sweepTxHash: sweepResult.txHash,
            amountSwept: account.amount,
            asset: account.asset,
            claimedAt: account.claimedAt,
          });
          return manager.save(newClaim);
        },
      );

      this.logger.log(`Claim redeemed successfully: ${claim.id}`);

      await this.webhooksService.triggerEvent('sweep.completed', {
        accountId: account.id,
        amount: account.amount,
        asset: account.asset,
        destination: destinationAddress,
        txHash: sweepResult.txHash,
        sweptAt: claim.claimedAt,
        metadata: account.metadata,
      });

      return {
        success: true,
        txHash: sweepResult.txHash,
        amountSwept: account.amount,
        asset: account.asset,
        destination: destinationAddress,
        sweptAt: claim.claimedAt,
      };
    } catch (error) {
      // Revert from CLAIMING back to PENDING_CLAIM so the user can retry
      await this.accountsRepository.update(account.id, {
        status: AccountStatus.PENDING_CLAIM,
        destinationAddress: '',
      });

      const typedError = error as Error;
      this.logger.error(
        `Claim redemption failed: ${typedError.message}`,
        typedError.stack,
      );

      await this.webhooksService.triggerEvent('sweep.failed', {
        accountId: account.id,
        amount: account.amount,
        asset: account.asset,
        destination: destinationAddress,
        error: typedError.message,
        timestamp: new Date(),
      });

      throw error;
    }
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
