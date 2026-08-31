import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service.js';
import { SorobanEventsIndexerService } from './soroban-events-indexer.service.js';
import { PaymentMonitorProvider } from './providers/payment-monitor-provider.js';
import { FeeStrategyProvider } from './providers/fee-strategy.provider.js';
import { FundingAccountMonitorService } from './funding-account-monitor.service.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { ContractEvent } from './entities/contract-event.entity.js';
import { makeHistogramProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';

const sorobanRpcLatencyHistogram = makeHistogramProvider({
  name: 'soroban_rpc_latency_seconds',
  help: 'Latency of Soroban RPC calls in seconds',
});

const fundingAccountBalanceGauge = makeGaugeProvider({
  name: 'funding_account_balance_stroops',
  help: 'Current balance of the funding account in stroops',
});

@Module({
  imports: [TypeOrmModule.forFeature([Account, ContractEvent])],
  providers: [
    StellarService,
    SorobanEventsIndexerService,
    PaymentMonitorProvider,
    FeeStrategyProvider,
    FundingAccountMonitorService,
    sorobanRpcLatencyHistogram,
    fundingAccountBalanceGauge,
  ],
  exports: [
    StellarService,
    SorobanEventsIndexerService,
    PaymentMonitorProvider,
    FeeStrategyProvider,
    FundingAccountMonitorService,
  ],
})
export class StellarModule {}