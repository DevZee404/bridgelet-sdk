import { Controller, Get, Param, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SweepsService } from './sweeps.service.js';
import { SweepStatusResponseDto } from './dto/sweep-status-response.dto.js';

@ApiTags('sweeps')
@Controller('sweeps')
export class SweepsController {
  constructor(private readonly sweepsService: SweepsService) {}

  @Get(':id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get sweep status by account ID',
    description:
      'Returns the transaction hash (if submitted), on-chain confirmation ' +
      'status, and any error details for the sweep associated with this account.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sweep status retrieved successfully',
    type: SweepStatusResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async getSweepStatus(
    @Param('id') id: string,
  ): Promise<SweepStatusResponseDto> {
    return this.sweepsService.getSweepById(id);
  }
}
