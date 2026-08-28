import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon, BASE_FEE } from '@stellar/stellar-sdk';

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

/**
 * Configuration for the fee strategy
 */
export interface FeeStrategyConfig {
  /** Cache TTL for fee stats in milliseconds (default: 60_000) */
  feeCacheTtlMs?: number;
  /** Multiplier to apply to the base fee for congestion (default: 1.0) */
  feeMultiplier?: number;
  /** Maximum fee ceiling in stroops (configured via environment) */
  maxFeeCeiling: number;
}

/**
 * Result of calculating the appropriate fee for a transaction
 */
export interface CalculatedFee {
  fee: string;
  isDynamic: boolean;
  source: 'base_fee' | 'dynamic_fee' | 'max_fee';
}

@Injectable()
export class FeeStrategyProvider {
  private readonly logger = new Logger(FeeStrategyProvider.name);
  private readonly server: Horizon.Server;
  private readonly fallbackServer: Horizon.Server | null = null;
  private feeCache: FeeCache | null = null;
  private readonly config: Required<FeeStrategyConfig>;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl = this.configService.getOrThrow<string>('stellar.horizonUrl');
    this.server = new Horizon.Server(horizonUrl);

    const horizonFallbackUrl = this.configService.get<string>('stellar.horizonFallbackUrl');
    if (horizonFallbackUrl) {
      this.fallbackServer = new Horizon.Server(horizonFallbackUrl);
    }

    // Load configuration from environment or use defaults
    const maxFeeCeiling = parseInt(
      process.env.STELLAR_MAX_FEE_CEILING || '1000000', // Default: 10 XLM in stroops
      10
    );
    
    const feeCacheTtlMs = parseInt(
      process.env.STELLAR_FEE_CACHE_TTL_MS || '60000',
      10
    );
    
    const feeMultiplier = parseFloat(
      process.env.STELLAR_FEE_MULTIPLIER || '1.0'
    );

    this.config = {
      maxFeeCeiling,
      feeCacheTtlMs,
      feeMultiplier,
    };

    this.logger.log(`Initialized FeeStrategyProvider with max fee ceiling: ${this.config.maxFeeCeiling} stroops`);
  }

  private getActiveServer(): Horizon.Server {
    return this.fallbackServer ?? this.server;
  }

  /**
   * Fetches the p75 fee from Horizon's fee_stats endpoint, caches it,
   * and applies the configured fee multiplier.
   * 
   * @returns The calculated fee in stroops, capped at the max fee ceiling
   */
  public async calculateFee(): Promise<CalculatedFee> {
    const now = Date.now();

    // Return cached value if still fresh
    if (this.feeCache && now - this.feeCache.fetchedAt < this.config.feeCacheTtlMs) {
      this.logger.debug(`Using cached dynamic fee: ${this.feeCache.fee} stroops`);
      return {
        fee: this.feeCache.fee,
        isDynamic: true,
        source: 'dynamic_fee',
      };
    }

    try {
      const stats = await this.getActiveServer().feeStats();
      const feeCharged = stats.fee_charged as unknown as FeeDistributionWithP75;
      const p75 = feeCharged?.p75;

      if (!p75 || isNaN(Number(p75)) || Number(p75) <= 0) {
        this.logger.warn(`fee_stats p75 value invalid (${p75}), falling back to BASE_FEE`);
        return this.getBaseFee();
      }

      // Apply multiplier and cap at max fee ceiling
      let calculatedFee = Math.ceil(Number(p75) * this.config.feeMultiplier);
      const source: CalculatedFee['source'] = calculatedFee >= this.config.maxFeeCeiling ? 'max_fee' : 'dynamic_fee';
      calculatedFee = Math.min(calculatedFee, this.config.maxFeeCeiling);

      const feeStr = String(calculatedFee);
      this.feeCache = { fee: feeStr, fetchedAt: now };
      
      this.logger.debug(`Calculated dynamic fee: ${feeStr} stroops (p75: ${p75}, multiplier: ${this.config.feeMultiplier}, capped: ${source === 'max_fee'})`);
      
      return {
        fee: feeStr,
        isDynamic: true,
        source,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to fetch fee_stats from Horizon: ${message}. Falling back to BASE_FEE.`);
      return this.getBaseFee();
    }
  }

  /**
   * Returns the base fee, capped at the max fee ceiling
   */
  private getBaseFee(): CalculatedFee {
    const calculatedFee = Math.min(BASE_FEE, this.config.maxFeeCeiling);
    return {
      fee: String(calculatedFee),
      isDynamic: false,
      source: 'base_fee',
    };
  }

  /**
   * Invalidates the fee cache, forcing a fresh fetch on the next calculateFee() call
   */
  invalidateFeeCache(): void {
    this.feeCache = null;
    this.logger.debug('Fee cache invalidated');
  }

  /**
   * Updates the fee strategy configuration at runtime
   */
  updateConfig(partialConfig: Partial<FeeStrategyConfig>): void {
    Object.assign(this.config, partialConfig);
    this.invalidateFeeCache();
    this.logger.log(`Updated fee strategy config: ${JSON.stringify(this.config)}`);
  }

  /**
   * Gets the current fee strategy configuration
   */
  getConfig(): Readonly<FeeStrategyConfig> {
    return { ...this.config };
  }
}