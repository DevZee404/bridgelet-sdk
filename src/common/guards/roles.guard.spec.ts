import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard.js';
import { IntegratorRole } from '../../modules/integrators/entities/integrator-role.enum.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

const mockExecutionContext = (
  role?: IntegratorRole,
  integratorId?: string,
): ExecutionContext => {
  const request = {
    headers: { 'x-api-key': 'bk_test' },
    ip: '127.0.0.1',
    method: 'GET',
    url: '/accounts',
    socket: { remoteAddress: '127.0.0.1' },
    integratorId,
    role,
  } as any;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as any);
  });

  it('allows request when no @Roles() metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);
    const context = mockExecutionContext(IntegratorRole.Integrator, 'int-1');

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows request when @Roles() metadata is empty', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([]);
    const context = mockExecutionContext(IntegratorRole.Integrator, 'int-1');

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows admin role for @Roles(IntegratorRole.Admin)', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([IntegratorRole.Admin]);
    const context = mockExecutionContext(IntegratorRole.Admin, 'admin-1');

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects integrator role for @Roles(IntegratorRole.Admin)', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([IntegratorRole.Admin]);
    const context = mockExecutionContext(IntegratorRole.Integrator, 'int-1');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when role is undefined (missing from request)', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([IntegratorRole.Admin]);
    const context = mockExecutionContext(undefined, 'int-1');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows a role that matches any entry in the required list', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([
      IntegratorRole.Admin,
      IntegratorRole.Integrator,
    ]);
    const context = mockExecutionContext(IntegratorRole.Integrator, 'int-1');

    expect(guard.canActivate(context)).toBe(true);
  });
});
