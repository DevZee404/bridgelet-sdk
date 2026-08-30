import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBody,
  ApiSecurity,
} from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ClaimsService } from './claims.service.js';
import { ClaimDetailsDto } from './dto/claim-details.dto.js';
import { VerifyClaimDto } from './dto/verify-claim.dto.js';
import { RedeemClaimDto } from './dto/redeem-claim.dto.js';
import { ClaimRedemptionResponseDto } from './dto/claim-redemption-response.dto.js';
import { ClaimVerificationResponseDto } from './dto/claim-verification-response.dto.js';
import { InitiateClaimDto } from './dto/initiate-claim.dto.js';
import { InitiateClaimResponseDto } from './dto/initiate-claim-response.dto.js';
import { JwtKeyRotationProvider } from '../../common/crypto/jwt-key-rotation.provider.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../../common/guards/api-key-auth.guard.js';

@ApiTags('claims')
@Controller('claims')
@UseGuards(ThrottlerGuard)
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly jwtKeyRotation: JwtKeyRotationProvider,
  ) {}

  @Get('.well-known/jwks.json')
  @Public()
  @ApiOperation({ summary: 'JWKS endpoint for JWT key discovery' })
  @ApiResponse({
    status: 200,
    description: 'JSON Web Key Set with available signing keys',
  })
  public getJwks(): {
    keys: Array<{ kid: string; kty: string; alg: string; use: string }>;
  } {
    return this.jwtKeyRotation.getJwks();
  }

  @Post('initiate')
  @ApiSecurity('X-API-Key')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Initiate (or re-issue) a claim token for an account',
    description:
      'Restricted to the integrator API key that created the account. ' +
      'Returns a fresh claim URL for accounts in pending_claim status.',
  })
  @ApiResponse({
    status: 201,
    description: 'Claim token issued',
    type: InitiateClaimResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 400, description: 'Account not eligible for claim' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiBody({ type: InitiateClaimDto })
  public async initiateClaim(
    @Body() initiateClaimDto: InitiateClaimDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<InitiateClaimResponseDto> {
    return this.claimsService.initiateClaim(
      initiateClaimDto.accountId,
      req.integratorId,
    );
  }

  @Post('verify')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify claim token validity' })
  @ApiResponse({
    status: 200,
    description: 'Token is valid and claim is available',
    type: ClaimVerificationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 409, description: 'Claim already redeemed' })
  @ApiResponse({
    status: 400,
    description: 'Account has not received payment or invalid request',
  })
  @ApiBody({ type: VerifyClaimDto })
  public async verifyClaim(
    @Body() verifyClaimDto: VerifyClaimDto,
  ): Promise<ClaimVerificationResponseDto> {
    return this.claimsService.verifyClaimToken(verifyClaimDto.claimToken);
  }

  @Post('redeem')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Redeem claim and sweep funds to destination wallet',
  })
  @ApiResponse({
    status: 200,
    description: 'Claim redeemed successfully',
    type: ClaimRedemptionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  @ApiResponse({ status: 400, description: 'Invalid destination address' })
  @ApiResponse({ status: 409, description: 'Claim already redeemed' })
  @ApiBody({ type: RedeemClaimDto })
  public async redeem(
    @Body() redeemClaimDto: RedeemClaimDto,
  ): Promise<ClaimRedemptionResponseDto> {
    return this.claimsService.redeemClaim(
      redeemClaimDto.claimToken,
      redeemClaimDto.destinationAddress,
    );
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get claim details by ID' })
  @ApiParam({
    name: 'id',
    description: 'Claim UUID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Claim details retrieved',
    type: ClaimDetailsDto,
  })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  public async findOne(@Param('id') id: string): Promise<ClaimDetailsDto> {
    return this.claimsService.findClaimById(id);
  }
}
