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
} from '@stellar/stellar-sdk';
import type { ExecuteTransactionParams } from '../interfaces/execute-transaction-params.interface.js';
import type { TransactionResult } from '../interfaces/transaction-result.interface.js';
import type { MergeAccountParams } from '../interfaces/merge-account-params.interface.js';

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
  private readonly networkPassphrase: string;

  /** In-memory cache for the dynamic p75 fee */
  private feeCache: FeeCache | null = null;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl =
      this.configService.getOrThrow<string>('stellar.horizonUrl');
    this.server = new Horizon.Server(horizonUrl);

    const network = this.configService.getOrThrow<string>('stellar.network');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.logger.log('Initialized TransactionProvider');
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
      const stats = await this.server.feeStats();
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
      `Executing sweep transaction to ${params.destinationAddress}`,
    );

    try {
      // Create keypair from ephemeral secret
      const sourceKeypair = Keypair.fromSecret(params.ephemeralSecret);

      // Load source account
      const sourceAccount = await this.server.loadAccount(
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
      this.logger.error(
        `Sweep transaction failed: ${typedError.message}`,
        typedError.stack,
      );

      // Extract more details from Horizon error
      if (typedError.response?.data) {
        const extras = typedError.response.data.extras;
        this.logger.error(`Transaction extras: ${JSON.stringify(extras)}`);
      }

      throw new InternalServerErrorException(
        `Sweep transaction failed: ${typedError.message}`,
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
      const sourceAccount = await this.server.loadAccount(
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
   * Get account balance for verification
   */
  public async getAccountBalance(
    publicKey: string,
    asset: string,
  ): Promise<string> {
    try {
      const account = await this.server.loadAccount(publicKey);
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
}
