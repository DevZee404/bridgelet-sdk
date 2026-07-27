import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Networks,
  Transaction,
} from '@stellar/stellar-sdk';
import {
  redactSecrets,
  sanitizeErrorMessage,
  sanitizeStackTrace,
} from '../../../common/utils/secret-redaction.util.js';
import type { ExecuteTransactionParams } from '../interfaces/execute-transaction-params.interface.js';
import type { TransactionResult } from '../interfaces/transaction-result.interface.js';
import type { MergeAccountParams } from '../interfaces/merge-account-params.interface.js';
import { LogSanitizer } from '../../../common/utils/log-sanitizer.util.js';

interface HorizonErrorResponse {
  response?: {
    data?: {
      extras?: unknown;
    };
  };
  message: string;
  stack?: string;
}

/**
 * The Horizon `FeeDistribution` SDK type does not include `p75` in its TypeScript
 * definition, but the Horizon REST API does return this field at runtime.
 * We extend the type locally to satisfy the compiler.
 */
interface FeeDistributionWithP75 {
  p75: string;
  [key: string]: string;
}

/** Cache entry for the p75 fee fetched from Horizon /fee_stats */
interface FeeCache {
  fee: string;
  fetchedAt: number;
}

/** Cache TTL: 60 seconds */
const FEE_CACHE_TTL_MS = 60_000;

@Injectable()
export class TransactionProvider {
  private readonly logger = new Logger(TransactionProvider.name);
  private readonly server: Horizon.Server;
  private readonly fallbackServer: Horizon.Server | null = null;
  private readonly networkPassphrase: string;

  /** In-memory cache for the dynamic p75 fee */
  private feeCache: FeeCache | null = null;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl =
      this.configService.getOrThrow<string>('stellar.horizonUrl');
    this.server = new Horizon.Server(horizonUrl);

    const horizonFallbackUrl = this.configService.get<string>(
      'stellar.horizonFallbackUrl',
    );
    if (horizonFallbackUrl) {
      this.fallbackServer = new Horizon.Server(horizonFallbackUrl);
    }

    const network = this.configService.getOrThrow<string>('stellar.network');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.logger.log('Initialized TransactionProvider');
  }

  private getActiveServer(): Horizon.Server {
    return this.fallbackServer ?? this.server;
  }

  /**
   * Fetch the p75 `fee_charged` value from Horizon `/fee_stats` and cache it
   * for 60 seconds to avoid excessive Horizon calls.
   *
   * Falls back to `BASE_FEE` if the fetch fails or returns an unusable value,
   * so the sweep pipeline is never blocked by a fee-stats outage.
   *
   * @returns Fee string (stroops) suitable for `TransactionBuilder.fee`
   */
  public async fetchDynamicFee(): Promise<string> {
    const now = Date.now();

    // Return cached value if still fresh
    if (this.feeCache && now - this.feeCache.fetchedAt < FEE_CACHE_TTL_MS) {
      this.logger.debug(
        `Using cached dynamic fee: ${this.feeCache.fee} stroops`,
      );
      return this.feeCache.fee;
    }

    try {
      const stats = await this.getActiveServer().feeStats();
      // The Horizon SDK types don't expose p75, but the REST API returns it.
      const feeCharged = stats.fee_charged as unknown as FeeDistributionWithP75;
      const p75 = feeCharged?.p75;

      if (!p75 || isNaN(Number(p75)) || Number(p75) <= 0) {
        this.logger.warn(
          `fee_stats p75 value invalid (${p75}), falling back to BASE_FEE`,
        );
        return String(BASE_FEE);
      }

      const fee = p75;
      this.feeCache = { fee, fetchedAt: now };
      this.logger.debug(`Fetched dynamic fee: ${fee} stroops (p75)`);
      return fee;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to fetch fee_stats from Horizon: ${message}. Falling back to BASE_FEE.`,
      );
      return String(BASE_FEE);
    }
  }

  /**
   * Execute sweep transaction: transfer all funds to destination.
   * Uses the p75 fee from Horizon fee_stats (60s cache) instead of BASE_FEE.
   */
  public async executeSweepTransaction(
    params: ExecuteTransactionParams,
  ): Promise<TransactionResult> {
    this.logger.log(
      `Executing sweep transaction to ${LogSanitizer.redactAddress(params.destinationAddress)}`,
    );

    try {
      // Create keypair from ephemeral secret
      const sourceKeypair = Keypair.fromSecret(params.ephemeralSecret);

      // Load source account
      const sourceAccount = await this.getActiveServer().loadAccount(
        sourceKeypair.publicKey(),
      );

      // Parse asset (format: "CODE:ISSUER" or "native")
      const asset = this.parseAsset(params.asset);

      // Fetch dynamic fee (p75 from fee_stats, 60s cache, fallback to BASE_FEE)
      const fee = await this.fetchDynamicFee();

      // Build payment transaction
      const transaction = new TransactionBuilder(sourceAccount, {
        fee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: params.destinationAddress,
            asset: asset,
            amount: params.amount,
          }),
        )
        .setTimeout(30)
        .build();

      // Sign with ephemeral account
      transaction.sign(sourceKeypair);

      // Submit transaction
      const result = await this.server.submitTransaction(transaction);

      this.logger.log(`Sweep transaction successful: ${result.hash}`);

      const ledger = Number(result.ledger);

      if (Number.isNaN(ledger)) {
        throw new Error(`Invalid ledger value: ${result.ledger}`);
      }
      return {
        hash: result.hash,
        ledger: ledger,
        successful: result.successful,
        timestamp: new Date(),
      };
    } catch (error) {
      const typedError = error as HorizonErrorResponse;
      const safeMessage = sanitizeErrorMessage(typedError.message);
      this.logger.error(
        `Sweep transaction failed: ${safeMessage}`,
        sanitizeStackTrace(typedError),
      );

      // Extract more details from Horizon error
      if (typedError.response?.data) {
        const extras = redactSecrets(
          JSON.stringify(typedError.response.data.extras) ?? '',
        );
        this.logger.error(`Transaction extras: ${extras}`);
      }

      throw new InternalServerErrorException(
        `Sweep transaction failed: ${safeMessage}`,
      );
    }
  }

  /**
   * Merge ephemeral account into destination to reclaim base reserve.
   * Uses the p75 fee from Horizon fee_stats (60s cache) instead of BASE_FEE.
   */
  public async mergeAccount(
    params: MergeAccountParams,
  ): Promise<TransactionResult> {
    this.logger.log(
      `Merging account to reclaim reserve: ${params.destinationAddress}`,
    );

    try {
      // Create keypair from ephemeral secret
      const sourceKeypair = Keypair.fromSecret(params.ephemeralSecret);

      // Load source account
      const sourceAccount = await this.getActiveServer().loadAccount(
        sourceKeypair.publicKey(),
      );

      // Fetch dynamic fee (p75 from fee_stats, 60s cache, fallback to BASE_FEE)
      const fee = await this.fetchDynamicFee();

      // Build account merge transaction
      const transaction = new TransactionBuilder(sourceAccount, {
        fee,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          Operation.accountMerge({
            destination: params.destinationAddress,
          }),
        )
        .setTimeout(30)
        .build();

      // Sign with ephemeral account
      transaction.sign(sourceKeypair);

      // Submit transaction
      const result = await this.server.submitTransaction(transaction);

      this.logger.log(`Account merge successful: ${result.hash}`);

      return {
        hash: result.hash,
        ledger: result.ledger,
        successful: result.successful,
        timestamp: new Date(),
      };
    } catch (error) {
      // Account merge can fail if account still has offers or trustlines
      // This is non-critical as the main sweep was successful
      const typedError = error as HorizonErrorResponse;
      this.logger.warn(
        `Account merge failed (non-critical): ${typedError.message}`,
      );

      throw error; // Re-throw so caller can handle
    }
  }

  /**
   * Parse asset string into Stellar Asset object
   */
  private parseAsset(assetString: string): Asset {
    if (assetString === 'native' || assetString === 'XLM') {
      return Asset.native();
    }

    // Format: "CODE:ISSUER"
    const parts = assetString.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid asset format: ${assetString}`);
    }

    const [code, issuer] = parts;
    return new Asset(code, issuer);
  }

  /**
   * Submit a transaction as a fee-bump to rescue a stuck (low-fee) sweep.
   *
   * Wraps the existing transaction in a fee-bump envelope that pays a higher
   * fee via a sponsor account.  This is useful when a sweep transaction was
   * submitted with BASE_FEE and got stuck because the network fee rose.
   *
   * @param innerTxHash       The hash of the original stuck transaction.
   * @param innerEnvelopeBase64  The base64-encoded XDR of the original transaction envelope.
   * @param feePayerSecret    Secret key of the account paying the bumped fee.
   * @param bumpFee           The fee to pay for the bump (must be > original fee).
   */
  public async submitFeeBumpTransaction(
    innerTxHash: string,
    innerEnvelopeBase64: string,
    feePayerSecret: string,
    bumpFee: string,
  ): Promise<TransactionResult> {
    this.logger.log(
      `Submitting fee-bump for stuck tx ${innerTxHash} with fee ${bumpFee}`,
    );

    try {
      const feePayerKeypair = Keypair.fromSecret(feePayerSecret);

      // Deserialize the inner transaction envelope
      const innerTx = new Transaction(
        innerEnvelopeBase64,
        this.networkPassphrase,
      );

      // Build fee-bump transaction
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        feePayerKeypair.publicKey(),
        bumpFee.toString(),
        innerTx,
        this.networkPassphrase,
      );

      feeBumpTx.sign(feePayerKeypair);

      // Submit fee-bump
      const result = await this.server.submitTransaction(feeBumpTx);

      this.logger.log(
        `Fee-bump successful for tx ${innerTxHash}: new hash=${result.hash}`,
      );

      return {
        hash: result.hash,
        ledger: result.ledger,
        successful: result.successful,
        timestamp: new Date(),
      };
    } catch (error) {
      const typedError = error as HorizonErrorResponse;
      this.logger.error(
        `Fee-bump failed for tx ${innerTxHash}: ${typedError.message}`,
        typedError.stack,
      );

      throw new InternalServerErrorException(
        `Fee-bump transaction failed: ${typedError.message}`,
      );
    }
  }

  /**
   * Get account balance for verification
   */
  public async getAccountBalance(
    publicKey: string,
    asset: string,
  ): Promise<string> {
    try {
      const account = await this.getActiveServer().loadAccount(publicKey);
      const parsedAsset = this.parseAsset(asset);
      const balance = account.balances.find((b) => {
        if (parsedAsset.isNative()) {
          return b.asset_type === 'native';
        }
        return (
          b.asset_type !== 'native' &&
          'asset_code' in b &&
          'asset_issuer' in b &&
          b.asset_code === parsedAsset.getCode() &&
          b.asset_issuer === parsedAsset.getIssuer()
        );
      });
      return balance?.balance || '0';
    } catch (error) {
      const typedError = error as HorizonErrorResponse;
      this.logger.error(`Failed to get account balance: ${typedError.message}`);
      throw error;
    }
  }

  /**
   * Query all non-zero balances for an ephemeral account.
   * Returns an array of { asset, amount } pairs for every balance > 0.
   * Used by multi-asset sweep (Issue #223) to discover additional assets
   * beyond the primary one specified in the sweep request.
   */
  public async getAllAccountBalances(
    publicKey: string,
  ): Promise<Array<{ asset: string; amount: string }>> {
    try {
      const account = await this.server.loadAccount(publicKey);
      const balances: Array<{ asset: string; amount: string }> = [];

      for (const b of account.balances) {
        if (Number(b.balance) <= 0) continue;

        if (b.asset_type === 'native') {
          balances.push({ asset: 'native', amount: b.balance });
        } else if ('asset_code' in b && 'asset_issuer' in b) {
          balances.push({
            asset: `${b.asset_code}:${b.asset_issuer}`,
            amount: b.balance,
          });
        }
      }

      this.logger.log(
        `Found ${balances.length} non-zero balance(s) on ${publicKey}`,
      );
      return balances;
    } catch (error) {
      const typedError = error as HorizonErrorResponse;
      this.logger.error(
        `Failed to get all account balances: ${typedError.message}`,
      );
      throw error;
    }
  }
}
