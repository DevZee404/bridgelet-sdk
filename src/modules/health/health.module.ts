import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller.js';
import { StellarModule } from '../stellar/stellar.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([])],
  controllers: [HealthController],
})
export class HealthModule {}
