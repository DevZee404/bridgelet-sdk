import { Module } from '@nestjs/common';
import { StellarService } from './stellar.service.js';
import { PaymentMonitorProvider } from './providers/payment-monitor-provider.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { makeHistogramProvider } from '@willsoto/nestjs-prometheus';

const sorobanRpcLatencyHistogram = makeHistogramProvider({
  name: 'soroban_rpc_latency_seconds',
  help: 'Latency of Soroban RPC calls in seconds',
});

@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  providers: [
    StellarService,
    PaymentMonitorProvider,
    sorobanRpcLatencyHistogram,
  ],
  exports: [StellarService, PaymentMonitorProvider],
})
export class StellarModule {}
