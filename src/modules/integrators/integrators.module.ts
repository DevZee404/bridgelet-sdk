import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Integrator } from './entities/integrator.entity.js';
import { IntegratorsService } from './integrators.service.js';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([Integrator])],
  providers: [IntegratorsService, ApiKeyAuthGuard],
  exports: [IntegratorsService, ApiKeyAuthGuard],
})
export class IntegratorsModule {}
