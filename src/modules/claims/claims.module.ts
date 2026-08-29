import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClaimsController } from './claims.controller.js';
import { ClaimsService } from './claims.service.js';
import { Claim } from './entities/claim.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import { ClaimAuditLog } from './entities/claim-audit-log.entity.js';

import { ClaimLookupProvider } from './providers/claim-lookup.provider.js';
import { TokenVerificationProvider } from './providers/token-verification.provider.js';
import { ClaimRedemptionProvider } from './providers/claim-redemption.provider.js';
import { ClaimAuditProvider } from './providers/claim-audit.provider.js';
import { ClaimInitiationProvider } from './providers/claim-initiation.provider.js';
import { SweepsModule } from '../sweeps/sweeps.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { CryptoModule } from '../../common/crypto/crypto.module.js';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';

const claimRedemptionCounter = makeCounterProvider({
  name: 'claim_redemption_total',
  help: 'Total number of claims redeemed',
});

@Module({
  imports: [
    TypeOrmModule.forFeature([Claim, Account, ClaimAuditLog]),
    SweepsModule,
    WebhooksModule,
    CryptoModule,
  ],
  controllers: [ClaimsController],
  providers: [
    ClaimsService,
    ClaimLookupProvider,
    ClaimRedemptionProvider,
    ClaimInitiationProvider,
    TokenVerificationProvider,
    claimRedemptionCounter,
    ClaimAuditProvider,
  ],
  exports: [ClaimsService],
})
export class ClaimsModule {}
