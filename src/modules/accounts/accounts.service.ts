import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from './entities/account.entity.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AccountResponseDto } from './dto/account-response.dto.js';
import { StellarService } from '../stellar/stellar.service.js';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AccountStatus } from './enums/account-status.enum.js';
import { SecretEncryptionUtil } from '../../common/crypto/secret-encryption.util.js';
import { KmsKeyProvider } from '../../common/crypto/kms-key.provider.js';
import { JwtKeyRotationProvider } from '../../common/crypto/jwt-key-rotation.provider.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { WebhookEvent } from '../webhooks/webhook-events.enum.js';
import { sanitizeMetadata } from '../../common/utils/metadata-sanitizer.util.js';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { AccountLatencyMetricsProvider } from './providers/account-latency-metrics.provider.js';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(Account)
    private accountsRepository: Repository<Account>,
    private configService: ConfigService,
    private stellarService: StellarService,
    private webhooksService: WebhooksService,
    @InjectMetric('account_creation_total')
    private readonly accountCreationCounter: Counter<string>,
    private latencyMetrics: AccountLatencyMetricsProvider,
    private kmsKeyProvider: KmsKeyProvider,
    private jwtKeyRotation: JwtKeyRotationProvider,
  ) {}

  public async create(
    createAccountDto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    this.accountCreationCounter.inc();
    const startMs = Date.now();
    // Generate ephemeral keypair
    const ephemeralKeypair = this.stellarService.generateKeypair();

    // Calculate expiry timestamp
    const expiresAt = new Date(Date.now() + createAccountDto.expiresIn * 1000);

    // Generate claim token
    const claimToken = this.generateClaimToken(ephemeralKeypair.publicKey());

    // Hash claim token for storage
    const claimTokenHash = crypto
      .createHash('sha256')
      .update(claimToken)
      .digest('hex');

    // Derive combined asset string from asset_code + asset_issuer when provided
    const asset =
      createAccountDto.asset_code && createAccountDto.asset_issuer
        ? `${createAccountDto.asset_code}:${createAccountDto.asset_issuer}`
        : (createAccountDto.asset_code ?? 'native');

    // Save with INITIALIZING status first so we have a DB record for cleanup
    // if the Stellar/contract steps fail
    const account = this.accountsRepository.create({
      publicKey: ephemeralKeypair.publicKey(),
      secretKeyEncrypted: SecretEncryptionUtil.encrypt(
        ephemeralKeypair.secret(),
        this.kmsKeyProvider.getEncryptionKey(),
      ),
      fundingSource: createAccountDto.fundingSource,
      amount: createAccountDto.amount,
      asset,
      status: AccountStatus.INITIALIZING,
      claimTokenHash,
      expiresAt,
      metadata: sanitizeMetadata(createAccountDto.metadata),
    });

    await this.accountsRepository.save(account);

    try {
      const txHash = await this.stellarService.createEphemeralAccount({
        publicKey: ephemeralKeypair.publicKey(),
        amount: createAccountDto.amount,
        asset,
        expiresIn: createAccountDto.expiresIn,
        recoveryAddress: createAccountDto.recovery_address,
        contractId: this.configService.getOrThrow<string>(
          'stellar.contracts.ephemeralAccount',
        ),
        sweepControllerContractId: this.configService.getOrThrow<string>(
          'stellar.contracts.sweepController',
        ),
      });

      // Both Horizon and contract succeeded — advance to real status
      account.status = AccountStatus.PENDING_PAYMENT;
      account.contractId = this.configService.getOrThrow<string>(
        'stellar.contracts.ephemeralAccount',
      );
      await this.accountsRepository.save(account);

      await this.webhooksService.triggerEvent(WebhookEvent.AccountCreated, {
        accountId: account.id,
        publicKey: account.publicKey,
        amount: account.amount,
        asset: account.asset,
        expiresAt: account.expiresAt,
      });

      this.latencyMetrics.record(Date.now() - startMs, true);
      return {
        accountId: account.id,
        publicKey: account.publicKey,
        claimUrl: this.generateClaimUrl(claimToken),
        txHash,
        amount: account.amount,
        asset: account.asset,
        status: account.status,
        expiresAt: account.expiresAt,
        createdAt: account.createdAt,
      };
    } catch (error: unknown) {
      this.latencyMetrics.record(Date.now() - startMs, false);

      // Mark as FAILED so the record is traceable but clearly broken
      account.status = AccountStatus.FAILED;
      await this.accountsRepository.save(account);

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Account creation failed for ${ephemeralKeypair.publicKey()}: ${message}`,
      );
      // preserve original error if it's an Error, otherwise wrap
      if (error instanceof Error) throw error;
      throw new Error(message);
    }
  }

  public async findOne(id: string): Promise<AccountResponseDto> {
    const account = await this.accountsRepository.findOne({ where: { id } });

    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }

    return this.mapToResponseDto(account);
  }

  public async findAll({
    status,
    limit,
    offset,
  }: {
    status?: AccountStatus;
    limit: number;
    offset: number;
  }): Promise<{ accounts: AccountResponseDto[]; total: number }> {
    const query = this.accountsRepository
      .createQueryBuilder('account')
      .where('account.deletedAt IS NULL');

    if (status) {
      query.andWhere('account.status = :status', { status });
    }

    query.skip(offset).take(Math.min(limit, 100));

    const [accounts, total] = await query.getManyAndCount();

    return {
      accounts: accounts.map((acc) => this.mapToResponseDto(acc)),
      total,
    };
  }

  private generateClaimToken(publicKey: string): string {
    /**
     * generateClaimToken
     * ------------------
     * Purpose: Sign a short-lived JWT that encodes the public key and a
     * 'claim' type. The resulting token is handed to callers and is the
     * secret used to claim the ephemeral account.
     *
     * Security notes / contributor guidance:
     * - The token expiry (`app.claimTokenExpiry`) is protocol-sensitive.
     *   Changing expiry semantics requires coordination with clients.
     * - The JWT signing secret is managed via JwtKeyRotationProvider which
     *   supports key rotation. New tokens include a `kid` header so
     *   verifiers can identify the correct signing key.
     */
    const expiry =
      this.configService.get<number>('app.claimTokenExpiry') ?? 2592000;

    return this.jwtKeyRotation.sign(
      { publicKey, type: 'claim' },
      { expiresIn: `${expiry}s` },
    );
  }

  private generateClaimUrl(token: string): string {
    // generateClaimUrl
    // ----------------
    // Purpose: Build the user-facing URL used to perform the claim flow.
    // Integration notes:
    // - `CLAIM_BASE_URL` is an environment-level integration point. External
    //   systems and email templates may rely on the shape of this URL.
    const baseUrl = process.env.CLAIM_BASE_URL || 'https://claim.bridgelet.io';
    return `${baseUrl}/c/${token}`;
  }

  private mapToResponseDto(account: Account): AccountResponseDto {
    return {
      accountId: account.id,
      publicKey: account.publicKey,
      // Mapping note: we intentionally never return raw tokens here.
      // When a token exists, we return a placeholder claim URL in list/endpoints
      // that shouldn't leak the real token. The single-response `create`
      // operation returns the real `claimUrl` containing the token.
      claimUrl: account.claimTokenHash ? this.generateClaimUrl('***') : null,
      amount: account.amount,
      asset: account.asset,
      status: account.status,
      expiresAt: account.expiresAt,
      createdAt: account.createdAt,
      claimedAt: account.claimedAt,
      destination: account.destinationAddress,
      metadata: account.metadata,
    };
  }
}
