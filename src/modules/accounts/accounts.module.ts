import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { Account } from './entities/account.entity.js';
import { StellarModule } from '../stellar/stellar.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PaymentMonitorProvider } from '../stellar/providers/payment-monitor-provider.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('app.jwtSecret'),
        signOptions: {
          // To add default sign options here latter
        },
      }),
      inject: [ConfigService],
    }),
    StellarModule,
    WebhooksModule,
  ],
  controllers: [AccountsController],
  providers: [AccountsService, PaymentMonitorProvider],
  exports: [AccountsService, JwtModule],
})

// Note: seeing as PaymentMonitorPRovider is a sub provider in stellar service, this should be adjusted to fit that. Probably call stellatService.PaymentMonitorProvider in the constructor after wiring it up
export class AccountsModule implements OnApplicationBootstrap {
  constructor(private readonly paymentMonitor: PaymentMonitorProvider) {}

  /**
   * After all modules are initialized, restore payment monitoring for any
   * accounts that were in PENDING_PAYMENT status before the last restart.
   * This prevents orphaned accounts after a service restart.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.paymentMonitor.restoreActiveStreams();
  }
}
