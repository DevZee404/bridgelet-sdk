import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SweepsController } from './sweeps.controller.js';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import { SweepMetricsProvider } from './providers/sweep-metrics.provider.js';
import { Account } from '../accounts/entities/account.entity.js';
import { Claim } from '../claims/entities/claim.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

const sweepSuccessCounter = makeCounterProvider({
  name: 'sweep_success_total',
  help: 'Total number of successful sweeps',
});
const sweepFailureCounter = makeCounterProvider({
  name: 'sweep_failure_total',
  help: 'Total number of failed sweeps',
});

@Module({
  imports: [TypeOrmModule.forFeature([Account, Claim]), StellarModule],
  controllers: [SweepsController],
  providers: [
    SweepsService,
    ValidationProvider,
    ContractProvider,
    TransactionProvider,
    SweepMetricsProvider,
    sweepSuccessCounter,
    sweepFailureCounter,
  ],
  exports: [SweepsService],
})
export class SweepsModule {}
