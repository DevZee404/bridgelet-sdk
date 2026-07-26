import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator.js';

/**
 * Maximum milliseconds to wait for a pool connection before reporting the
 * pool as exhausted. Matches the acquireTimeoutMillis set in database.config.ts
 * so that the health endpoint reliably detects pool exhaustion without
 * introducing an independent, stale timeout value.
 */
const DB_HEALTH_TIMEOUT_MS = 3_000;
const HORIZON_HEALTH_TIMEOUT_MS = 5_000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Health check – includes database and Horizon status' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async check() {
    const dbStatus = await this.checkDatabasePool();
    const horizonStatus = await this.checkHorizon();
    return {
      status: dbStatus.healthy && horizonStatus.healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        horizon: horizonStatus,
        soroban: 'ok',
      },
    };
  }

  private async checkHorizon(): Promise<{
    healthy: boolean;
    url?: string;
    error?: string;
  }> {
    const horizonUrl = this.configService.get<string>('stellar.horizonUrl');
    if (!horizonUrl) return { healthy: false, error: 'No Horizon URL configured' };

    try {
      const resp = await fetch(`${horizonUrl}/ledgers?limit=1&order=desc`, {
        signal: AbortSignal.timeout(HORIZON_HEALTH_TIMEOUT_MS),
      });
      if (resp.ok) return { healthy: true, url: horizonUrl };
      return { healthy: false, url: horizonUrl, error: `HTTP ${resp.status}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, url: horizonUrl, error: message };
    }
  }

  private async checkDatabasePool(): Promise<{
    healthy: boolean;
    poolExhausted: boolean;
    error?: string;
  }> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('pool_acquire_timeout')),
        DB_HEALTH_TIMEOUT_MS,
      ),
    );

    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return { healthy: true, poolExhausted: false };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const poolExhausted = message === 'pool_acquire_timeout';
      return {
        healthy: false,
        poolExhausted,
        error: poolExhausted
          ? 'Connection pool exhausted: all connections in use'
          : `Database unreachable: ${message}`,
      };
    }
  }
}
