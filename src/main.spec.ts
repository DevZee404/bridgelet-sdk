/**
 * Tests for the network config startup guard introduced in main.ts (Issue #212).
 *
 * The guard prevents accidental production deployment with a testnet Stellar
 * config.  We test the core assertion logic directly by reproducing it here
 * and verifying that process.exit() is called (or not) under each combination
 * of NODE_ENV and STELLAR_NETWORK.
 *
 * Testing strategy:
 * - We stub process.exit so the test process itself doesn't terminate.
 * - We inline the guard function so the test does not require importing the
 *   full NestJS application (which needs a running database, decorators, etc.).
 *
 * A second inline helper, isSwaggerEnabled(), reproduces the Swagger UI gating
 * decision from bootstrap() so we can prove /api/docs is disabled in
 * production unless ENABLE_SWAGGER=true (Issue #437).
 */

/**
 * Inline reproduction of the assertNetworkConfig() function from main.ts.
 * Must be kept in sync with the implementation.
 */
function assertNetworkConfig(): void {
  const nodeEnv = process.env.NODE_ENV;
  const stellarNetwork = process.env.STELLAR_NETWORK;

  if (nodeEnv === 'production' && stellarNetwork === 'testnet') {
    console.error(
      '[Bootstrap] FATAL: NODE_ENV=production with STELLAR_NETWORK=testnet is not allowed. ' +
        'Set STELLAR_NETWORK=mainnet for production deployments.',
    );
    process.exit(1);
  }
}

describe('assertNetworkConfig (network startup guard)', () => {
  let exitSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    delete process.env.NODE_ENV;
    delete process.env.STELLAR_NETWORK;
  });

  it('calls process.exit(1) when NODE_ENV=production and STELLAR_NETWORK=testnet', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK = 'testnet';

    assertNetworkConfig();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs a descriptive FATAL message before exiting', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK = 'testnet';

    assertNetworkConfig();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('FATAL'),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('NODE_ENV=production'),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('STELLAR_NETWORK=testnet'),
    );
  });

  it('does NOT call process.exit when NODE_ENV=production and STELLAR_NETWORK=mainnet', () => {
    process.env.NODE_ENV = 'production';
    process.env.STELLAR_NETWORK = 'mainnet';

    assertNetworkConfig();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does NOT call process.exit when NODE_ENV=development and STELLAR_NETWORK=testnet', () => {
    process.env.NODE_ENV = 'development';
    process.env.STELLAR_NETWORK = 'testnet';

    assertNetworkConfig();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does NOT call process.exit when NODE_ENV is not set and STELLAR_NETWORK=testnet', () => {
    delete process.env.NODE_ENV;
    process.env.STELLAR_NETWORK = 'testnet';

    assertNetworkConfig();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does NOT call process.exit when NODE_ENV=test and STELLAR_NETWORK=testnet', () => {
    process.env.NODE_ENV = 'test';
    process.env.STELLAR_NETWORK = 'testnet';

    assertNetworkConfig();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does NOT call process.exit when neither env var is set', () => {
    delete process.env.NODE_ENV;
    delete process.env.STELLAR_NETWORK;

    assertNetworkConfig();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does NOT call process.exit when NODE_ENV=production and STELLAR_NETWORK is not set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.STELLAR_NETWORK;

    assertNetworkConfig();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

/**
 * Inline reproduction of the assertSecretStrength() function from main.ts.
 * Must be kept in sync with the implementation.
 */
function assertSecretStrength(): void {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return;
  }

  const secret = process.env.JWT_SECRET ?? '';
  const placeholders = [
    'your-secret-key',
    'your-super-secret-jwt-key-change-in-production',
    'change-me-in-production',
  ];
  const normalized = secret.trim();

  const isTooShort = normalized.length < 32;
  const isPlaceholder =
    placeholders.includes(normalized.toLowerCase()) ||
    /^your[-_]?secret/i.test(normalized);

  if (normalized.length === 0 || isTooShort || isPlaceholder) {
    console.error('[Bootstrap] FATAL');
    process.exit(1);
  }
}

describe('assertSecretStrength (JWT startup guard)', () => {
  let exitSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
  });

  it('exits with 1 in production for the .env.example placeholder secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'your-secret-key';

    assertSecretStrength();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('FATAL'),
    );
  });

  it('exits with 1 in production for an empty secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = '';

    assertSecretStrength();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with 1 in production for a too-short secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'too-short';

    assertSecretStrength();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts a strong secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(48);

    assertSecretStrength();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit for a placeholder-like secret in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'your-secret-key';

    assertSecretStrength();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not exit for a placeholder-like secret in test', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'your-secret-key';

    assertSecretStrength();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

/**
 * Inline reproduction of the isSwaggerEnabled() function from main.ts.
 * Must be kept in sync with the implementation.
 */
function isSwaggerEnabled(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  const enableSwagger = process.env.ENABLE_SWAGGER;

  if (nodeEnv === 'production' && enableSwagger !== 'true') {
    return false;
  }

  return true;
}

describe('isSwaggerEnabled (Swagger UI gating)', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.ENABLE_SWAGGER;
  });

  it('disables Swagger in production by default', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_SWAGGER;

    expect(isSwaggerEnabled()).toBe(false);
  });

  it('disables Swagger in production when ENABLE_SWAGGER=false', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_SWAGGER = 'false';

    expect(isSwaggerEnabled()).toBe(false);
  });

  it('enables Swagger in production when ENABLE_SWAGGER=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_SWAGGER = 'true';

    expect(isSwaggerEnabled()).toBe(true);
  });

  it('enables Swagger in development even without ENABLE_SWAGGER', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_SWAGGER;

    expect(isSwaggerEnabled()).toBe(true);
  });

  it('enables Swagger when NODE_ENV is not set', () => {
    delete process.env.NODE_ENV;
    delete process.env.ENABLE_SWAGGER;

    expect(isSwaggerEnabled()).toBe(true);
  });
});
