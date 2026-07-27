import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyAuthGuard, AuthenticatedRequest } from './api-key-auth.guard.js';
import { IntegratorsService } from '../../modules/integrators/integrators.service.js';
import { Integrator } from '../../modules/integrators/entities/integrator.entity.js';

const mockExecutionContext = (apiKey?: string): ExecutionContext => {
  const request = {
    headers: { 'x-api-key': apiKey },
  } as unknown as AuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
};

const mockIntegrator = (): Integrator => ({
  id: 'integrator-1',
  name: 'Acme Corp',
  apiKeyHash: 'hash',
  createdAt: new Date(),
  disabledAt: null,
});

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;
  let integratorsService: jest.Mocked<IntegratorsService>;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    integratorsService = {
      findActiveByApiKey: jest.fn(),
    } as unknown as jest.Mocked<IntegratorsService>;
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new ApiKeyAuthGuard(integratorsService, reflector as any);
  });

  it('allows a request with a valid, active API key and attaches integratorId', async () => {
    integratorsService.findActiveByApiKey.mockResolvedValueOnce(
      mockIntegrator(),
    );
    const context = mockExecutionContext('bk_valid_key');

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    expect(request.integratorId).toBe('integrator-1');
  });

  it('throws 401 when X-API-Key header is missing', async () => {
    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws 401 when the API key does not match any integrator', async () => {
    integratorsService.findActiveByApiKey.mockResolvedValueOnce(null);
    await expect(
      guard.canActivate(mockExecutionContext('bk_unknown_key')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when the integrator has been disabled (findActiveByApiKey returns null)', async () => {
    // IntegratorsService.findActiveByApiKey filters out disabled rows at the
    // query level, so a disabled key surfaces to the guard the same way an
    // unknown key does.
    integratorsService.findActiveByApiKey.mockResolvedValueOnce(null);
    await expect(
      guard.canActivate(mockExecutionContext('bk_disabled_key')),
    ).rejects.toThrow(UnauthorizedException);
  });
});
