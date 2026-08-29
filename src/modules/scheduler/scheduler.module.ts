import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity.js';
import { ClaimAuditLog } from '../claims/entities/claim-audit-log.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { SweepsModule } from '../sweeps/sweeps.module.js';
import { SchedulerService } from './scheduler.service.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account, ClaimAuditLog]),
    StellarModule,
    SweepsModule,
    WebhooksModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
