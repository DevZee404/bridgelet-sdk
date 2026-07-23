import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service.js';
import { SorobanEventsIndexerService } from './soroban-events-indexer.service.js';
import { PaymentMonitorProvider } from './providers/payment-monitor-provider.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { ContractEvent } from './entities/contract-event.entity.js';
import { makeHistogramProvider } from '@willsoto/nestjs-prometheus';

const sorobanRpcLatencyHistogram = makeHistogramProvider({
  name: 'soroban_rpc_latency_seconds',
  help: 'Latency of Soroban RPC calls in seconds',
});

@Module({
  imports: [TypeOrmModule.forFeature([Account, ContractEvent])],
  providers: [
    StellarService,
    SorobanEventsIndexerService,
    PaymentMonitorProvider,
    sorobanRpcLatencyHistogram,
  ],
  exports: [
    StellarService,
    SorobanEventsIndexerService,
    PaymentMonitorProvider,
  ],
})
export class StellarModule {}
