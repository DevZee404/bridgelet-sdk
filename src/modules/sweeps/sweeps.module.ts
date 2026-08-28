import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SweepsController } from './sweeps.controller.js';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { TransactionProvider } from './providers/transaction.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { SweepMetricsProvider } from './providers/sweep-metrics.provider.js';
import { Account } from '../accounts/entities/account.entity.js';
import { Claim } from '../claims/entities/claim.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { SweepRetryQueueService } from './sweep-retry-queue.service.js';
import { SweepMonitorService } from './sweep-monitor.service.js';

const sweepSuccessCounter = makeCounterProvider({
  name: 'sweep_success_total',
  help: 'Total number of successful sweeps',
});
const sweepFailureCounter = makeCounterProvider({
  name: 'sweep_failure_total',
  help: 'Total number of failed sweeps',
});
const sweepDeadletterCounter = makeCounterProvider({
  name: 'sweep_deadletter_total',
  help: 'Total number of sweeps moved to the dead-letter queue after exhausting all retries',
  labelNames: ['account_id'],
});
const sweepDeadletterResolvedCounter = makeCounterProvider({
  name: 'sweep_deadletter_resolved_total',
  help: 'Total number of dead-lettered sweeps that have been manually resolved by operators',
  labelNames: ['account_id'],
});

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, Claim]),
    StellarModule,
    EventEmitterModule,
  ],
  controllers: [SweepsController],
  providers: [
    SweepsService,
    ValidationProvider,
    ContractProvider,
    TransactionProvider,
    SweepMetricsProvider,
    SweepRetryQueueService,
    SweepMonitorService,
    sweepSuccessCounter,
    sweepFailureCounter,
    sweepDeadletterCounter,
    sweepDeadletterResolvedCounter,
  ],
  exports: [SweepsService],
})
export class SweepsModule {}