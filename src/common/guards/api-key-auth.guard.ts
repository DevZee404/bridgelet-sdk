import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { IntegratorsService } from '../../modules/integrators/integrators.service.js';

/**
 * Request augmented with the resolved integrator identity, attached by
 * ApiKeyAuthGuard. Downstream controllers/services can filter by this to
 * keep integrators scoped to their own accounts.
 */
export interface AuthenticatedRequest extends Request {
  integratorId: string;
}

/**
 * Reads the X-API-Key header, hashes it, and looks up the matching
 * integrator. Rejects if the header is missing, unknown, or the
 * integrator has been disabled.
 *
 * See src/modules/accounts/FUTURE_AUTH_SCOPING.md for the design
 * rationale (Option B — per-integrator API keys).
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly integratorsService: IntegratorsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const integrator = await this.integratorsService.findActiveByApiKey(apiKey);
    if (!integrator) {
      throw new UnauthorizedException('Invalid or disabled API key');
    }

    request.integratorId = integrator.id;
    return true;
  }
}
