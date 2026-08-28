import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IntegratorRole } from '../../modules/integrators/entities/integrator-role.enum.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { AuthenticatedRequest } from './api-key-auth.guard.js';

/**
 * Role-based access control guard.
 *
 * Routes decorated with `@Roles(…)` require the caller's integrator role to
 * appear in the specified list.  If no `@Roles()` decorator is present the
 * guard allows the request through (i.e. it is purely additive).
 *
 * **All denied attempts are logged at WARN level** with the originating IP,
 * requested URL, integrator ID, and the role that was required.  This covers
 * the sensitive case where a regular integrator key attempts to reach an
 * admin-only endpoint.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<IntegratorRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator → no role requirement
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { role, integratorId } = request;

    if (!role || !requiredRoles.includes(role)) {
      const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
      this.logger.warn(
        `Admin access denied — integrator ${integratorId ?? 'unknown'} ` +
          `role="${role ?? 'undefined'}" required=[${requiredRoles.join(', ')}] ` +
          `from ${ip} ${request.method} ${request.url}`,
      );
      throw new ForbiddenException('Insufficient role — admin access required');
    }

    return true;
  }
}
