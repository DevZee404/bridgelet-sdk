import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { APP_GUARD } from '@nestjs/core';

import { AccountsModule } from './modules/accounts/accounts.module.js';
import databaseConfig from './config/database.config.js';
import stellarConfig from './config/stellar.config.js';
import appConfig from './config/app.config.js';
import { StellarModule } from './modules/stellar/stellar.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SweepsModule } from './modules/sweeps/sweeps.module.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { PaymentMonitorModule } from './modules/payment-monitor/payment-monitor.module.js';
import { ClaimsModule } from './modules/claims/claims.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { IntegratorsModule } from './modules/integrators/integrators.module.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { ApiKeyAuthGuard } from './common/guards/api-key-auth.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stellarConfig, appConfig],
    }),
    PrometheusModule.register({
      path: '/metrics',
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => databaseConfig().database,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: parseInt(process.env.API_RATE_LIMIT || '100'),
      },
    ]),
    AccountsModule,
    ClaimsModule,
    SweepsModule,
    PaymentMonitorModule,
    WebhooksModule,
    IntegratorsModule,
    StellarModule,
    HealthModule,
    SchedulerModule,
    CryptoModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyAuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
