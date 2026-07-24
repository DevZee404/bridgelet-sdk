import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IntegratorsService } from '../../modules/integrators/integrators.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

export interface AuthenticatedRequest extends Request {
  integratorId: string;
}

/**
 * Global API key authentication guard.
 *
 * Reads the `X-API-Key` header, hashes it, and looks up the matching
 * integrator. Rejects if the header is missing, unknown, or the
 * integrator has been disabled.
 *
 * Applied globally in `main.ts` via `APP_GUARD`. Routes that must
 * remain public (health, metrics, Swagger docs) opt out with the
 * `@Public()` decorator.
 *
 * All rejected attempts are logged at WARN level with the originating
 * IP for audit purposes.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly integratorsService: IntegratorsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
      this.logger.warn(`Rejected request with missing API key from ${ip} ${request.method} ${request.url}`);
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const integrator = await this.integratorsService.findActiveByApiKey(apiKey);
    if (!integrator) {
      const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
      this.logger.warn(`Rejected request with invalid API key from ${ip} ${request.method} ${request.url}`);
      throw new UnauthorizedException('Invalid or disabled API key');
    }

    request.integratorId = integrator.id;
    return true;
  }
}
