import { SetMetadata } from '@nestjs/common';
import { IntegratorRole } from '../../modules/integrators/entities/integrator-role.enum.js';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route handler to one or more integrator roles.
 *
 * Used in conjunction with `RolesGuard`.  Example:
 * ```ts
 * @Roles(IntegratorRole.Admin)
 * @Get('accounts')
 * findAll() { … }
 * ```
 */
export const Roles = (...roles: IntegratorRole[]) =>
  SetMetadata(ROLES_KEY, roles);
