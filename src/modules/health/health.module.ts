import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { StellarModule } from '../stellar/stellar.module.js';

@Module({
  imports: [StellarModule],
  controllers: [HealthController],
})
export class HealthModule {}
