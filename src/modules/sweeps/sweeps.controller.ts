import { Controller, Get, Param, HttpCode, Patch, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SweepsService } from './sweeps.service.js';
import { SweepStatusResponseDto } from './dto/sweep-status-response.dto.js';
import { DeadLetterSweepEntry } from './sweep-retry-queue.service.js';

class ResolveDeadLetterDto {
  @ApiBody({ description: 'Optional notes added by the operator during resolution' })
  resolutionNotes?: string;
}

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

  @Get('dead-letter')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get all dead-lettered sweeps',
    description:
      'Returns all sweeps that have exhausted all retries and require manual operator intervention. ' +
      'Use includeResolved=true to include previously resolved entries.',
  })
  @ApiQuery({ name: 'includeResolved', required: false, type: Boolean, description: 'Include previously resolved dead-letter entries' })
  @ApiResponse({
    status: 200,
    description: 'Dead-letter entries retrieved successfully',
    type: [DeadLetterSweepEntry],
  })
  getDeadLetterSweeps(
    @Query('includeResolved') includeResolved?: boolean,
  ): DeadLetterSweepEntry[] {
    return this.sweepsService.getDeadLetterSweeps(includeResolved ?? false);
  }

  @Get('dead-letter/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a specific dead-letter entry by ID',
    description: 'Returns detailed information about a specific dead-lettered sweep.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dead-letter entry retrieved successfully',
    type: DeadLetterSweepEntry,
  })
  @ApiResponse({ status: 404, description: 'Dead-letter entry not found' })
  getDeadLetterSweepById(
    @Param('id') id: string,
  ): DeadLetterSweepEntry | undefined {
    return this.sweepsService.getDeadLetterSweepById(id);
  }

  @Get('dead-letter/account/:accountId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get all dead-letter entries for a specific account',
    description: 'Returns all dead-lettered sweeps associated with a given account ID.',
  })
  @ApiQuery({ name: 'includeResolved', required: false, type: Boolean, description: 'Include previously resolved dead-letter entries' })
  @ApiResponse({
    status: 200,
    description: 'Dead-letter entries for account retrieved successfully',
    type: [DeadLetterSweepEntry],
  })
  getDeadLetterSweepsForAccount(
    @Param('accountId') accountId: string,
    @Query('includeResolved') includeResolved?: boolean,
  ): DeadLetterSweepEntry[] {
    return this.sweepsService.getDeadLetterSweepsForAccount(accountId, includeResolved ?? false);
  }

  @Patch('dead-letter/:id/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a dead-lettered sweep as resolved',
    description:
      'This endpoint should only be called by operators after manually resolving the issue with a dead-lettered sweep. ' +
      'It marks the entry as resolved and allows adding optional resolution notes for audit purposes.',
  })
  @ApiBody({ type: ResolveDeadLetterDto })
  @ApiResponse({
    status: 200,
    description: 'Dead-letter entry marked as resolved successfully',
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  @ApiResponse({ status: 404, description: 'Dead-letter entry not found or already resolved' })
  resolveDeadLetterSweep(
    @Param('id') id: string,
    @Body() body: ResolveDeadLetterDto,
  ): { success: boolean } {
    const success = this.sweepsService.resolveDeadLetterSweep(id, body.resolutionNotes);
    return { success };
  }
}