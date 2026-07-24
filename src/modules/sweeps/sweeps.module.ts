import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SweepsService } from './sweeps.service.js';
import { ValidationProvider } from './providers/validation.provider.js';
import { ContractProvider } from './providers/contract.provider.js';
import { Account } from '../accounts/entities/account.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    EventEmitterModule.forRoot(),
  ],
  providers: [SweepsService, ValidationProvider, ContractProvider],
  exports: [SweepsService],
})
export class SweepsModule {}
