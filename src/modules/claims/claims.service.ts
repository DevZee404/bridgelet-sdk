import { Injectable } from '@nestjs/common';
import { ClaimLookupProvider } from './providers/claim-lookup.provider.js';
import { TokenVerificationProvider } from './providers/token-verification.provider.js';
import { ClaimDetailsDto } from './dto/claim-details.dto.js';
import { ClaimVerificationResponseDto } from './dto/claim-verification-response.dto.js';
import { ClaimRedemptionProvider } from './providers/claim-redemption.provider.js';
import { ClaimRedemptionResponseDto } from './dto/claim-redemption-response.dto.js';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

@Injectable()
export class ClaimsService {
  constructor(
    private readonly claimLookupProvider: ClaimLookupProvider,
    private readonly tokenVerificationProvider: TokenVerificationProvider,
    private claimRedemptionProvider: ClaimRedemptionProvider,
    @InjectMetric('claim_redemption_total')
    private readonly claimRedemptionCounter: Counter<string>,
  ) {}

  public async findClaimById(id: string): Promise<ClaimDetailsDto> {
    return this.claimLookupProvider.findClaimById(id);
  }

  public async verifyClaimToken(
    token: string,
  ): Promise<ClaimVerificationResponseDto> {
    return this.tokenVerificationProvider.verifyClaimToken(token);
  }
  public async redeemClaim(
    token: string,
    destinationAddress: string,
  ): Promise<ClaimRedemptionResponseDto> {
    this.claimRedemptionCounter.inc();
    return this.claimRedemptionProvider.redeemClaim(token, destinationAddress);
  }
}
