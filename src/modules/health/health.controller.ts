import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StellarService } from '../stellar/stellar.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly stellarService: StellarService) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'ok',
        stellar: 'ok',
        soroban: 'ok',
      },
    };
  }

  @Get('soroban')
  @ApiOperation({ summary: 'Soroban RPC connectivity check' })
  async checkSoroban() {
    const start = Date.now();
    try {
      const ledger = await this.stellarService.getSorobanLatestLedger();
      const latencyMs = Date.now() - start;
      return {
        status: 'ok',
        latencyMs,
        currentLedger: ledger.sequence,
        ledgerHash: ledger.hash,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      return {
        status: 'error',
        latencyMs,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
