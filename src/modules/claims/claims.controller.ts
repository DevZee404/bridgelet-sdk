import { Controller, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ClaimsService } from './claims.service.js';
import { ClaimDetailsDto } from './dto/claim-details.dto.js';
import { VerifyClaimDto } from './dto/verify-claim.dto.js';
import { RedeemClaimDto } from './dto/redeem-claim.dto.js';
import { ClaimRedemptionResponseDto } from './dto/claim-redemption-response.dto.js';
import { ClaimVerificationResponseDto } from './dto/claim-verification-response.dto.js';
import { JwtKeyRotationProvider } from '../../common/crypto/jwt-key-rotation.provider.js';

@ApiTags('claims')
@Controller('claims')
@UseGuards(ThrottlerGuard)
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly jwtKeyRotation: JwtKeyRotationProvider,
  ) {}

  @Get(':id')
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

  @Post('verify')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests/min per API key
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
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests/min per IP
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

  @Get('.well-known/jwks.json')
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
}
