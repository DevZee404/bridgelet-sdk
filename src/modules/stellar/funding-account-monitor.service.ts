import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarService } from './stellar.service.js';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { LogSanitizer } from '../../common/utils/log-sanitizer.util.js';

const STROOPS_PER_XLM = 10_000_000;

@Injectable()
export class FundingAccountMonitorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FundingAccountMonitorService.name);
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private configService: ConfigService,
    private stellarService: StellarService,
    @InjectMetric('funding_account_balance_stroops')
    private readonly fundingAccountBalance: Gauge<string>,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>(
      'stellar.fundingAccountBalanceCheckIntervalMs',
    );

    this.intervalId = setInterval(() => {
      this.checkBalance().catch((error) => {
        this.logger.error(
          `Funding account balance check failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, intervalMs);

    this.checkBalance().catch((error) => {
      this.logger.error(
        `Initial funding account balance check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkBalance(): Promise<void> {
    try {
      const secret = this.configService.getOrThrow<string>(
        'stellar.fundingSecret',
      );
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      const publicKey = keypair.publicKey();

      const balance = await this.stellarService.getAccountBalance(publicKey);
      const balanceStroops = Math.round(parseFloat(balance) * STROOPS_PER_XLM);

      this.fundingAccountBalance.set(balanceStroops);

      const lowThreshold = this.configService.get<number>(
        'stellar.fundingAccountLowBalanceThreshold',
      );
      const criticalThreshold = this.configService.get<number>(
        'stellar.fundingAccountCriticalBalanceThreshold',
      );

      const redacted = LogSanitizer.redactAddress(publicKey);

      if (balanceStroops < criticalThreshold) {
        this.logger.error(
          `CRITICAL: Funding account ${redacted} balance is critically low: ${balanceStroops} stroops (threshold: ${criticalThreshold}). Account creation will fail.`,
        );
      } else if (balanceStroops < lowThreshold) {
        this.logger.warn(
          `LOW BALANCE: Funding account ${redacted} balance is low: ${balanceStroops} stroops (threshold: ${lowThreshold}). Top up recommended.`,
        );
      } else {
        this.logger.log(
          `Funding account ${redacted} balance: ${balanceStroops} stroops`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to check funding account balance: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
