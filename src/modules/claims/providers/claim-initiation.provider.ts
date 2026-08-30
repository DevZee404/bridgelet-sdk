import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Account } from '../../accounts/entities/account.entity.js';
import { AccountStatus } from '../../accounts/enums/account-status.enum.js';
import { JwtKeyRotationProvider } from '../../../common/crypto/jwt-key-rotation.provider.js';
import { InitiateClaimResponseDto } from '../dto/initiate-claim-response.dto.js';

@Injectable()
export class ClaimInitiationProvider {
  private readonly logger = new Logger(ClaimInitiationProvider.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly configService: ConfigService,
    private readonly jwtKeyRotation: JwtKeyRotationProvider,
  ) {}

  /**
   * Issue (or re-issue) a claim token for an account. Restricted to the
   * integrator that created the account.
   */
  async initiateClaim(
    accountId: string,
    integratorId: string,
  ): Promise<InitiateClaimResponseDto> {
    const account = await this.accountsRepository
      .createQueryBuilder('account')
      .where('account.id = :accountId', { accountId })
      .andWhere('account.integratorId = :integratorId', { integratorId })
      .andWhere('account.deletedAt IS NULL')
      .getOne();

    if (!account) {
      // Non-leaking: same response whether the account is missing or owned by
      // another integrator.
      throw new NotFoundException(`Account ${accountId} not found`);
    }

    if (account.status !== AccountStatus.PENDING_CLAIM) {
      throw new BadRequestException(
        `Claim cannot be initiated. Account status: ${account.status}`,
      );
    }

    if (new Date() > account.expiresAt) {
      throw new BadRequestException('Account has expired');
    }

    const claimToken = this.generateClaimToken(account.publicKey);
    const claimTokenHash = crypto
      .createHash('sha256')
      .update(claimToken)
      .digest('hex');

    account.claimTokenHash = claimTokenHash;
    await this.accountsRepository.save(account);

    this.logger.log(
      `Claim token initiated for account ${account.id} by integrator ${integratorId}`,
    );

    return {
      accountId: account.id,
      claimUrl: this.generateClaimUrl(claimToken),
      expiresAt: account.expiresAt,
    };
  }

  private generateClaimToken(publicKey: string): string {
    const expiry =
      this.configService.get<number>('app.claimTokenExpiry') ?? 2592000;

    return this.jwtKeyRotation.sign(
      {
        publicKey,
        type: 'claim',
        jti: crypto.randomBytes(32).toString('hex'),
      },
      { expiresIn: `${expiry}s` },
    );
  }

  private generateClaimUrl(token: string): string {
    const baseUrl = process.env.CLAIM_BASE_URL || 'https://claim.bridgelet.io';
    return `${baseUrl}/c/${token}`;
  }
}
