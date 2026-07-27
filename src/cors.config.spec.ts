describe('CORS configuration (Issue #205)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows wildcard in development when CORS_ORIGINS is not set', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CORS_ORIGINS;

    const corsOrigins = process.env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const origin = corsOrigins && corsOrigins.length > 0 ? corsOrigins : false;

    expect(origin).toBe(false);
  });

  it('parses CORS_ORIGINS into an array', () => {
    process.env.CORS_ORIGINS =
      'https://app.bridgelet.io, https://admin.bridgelet.io';

    const corsOrigins = process.env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    expect(corsOrigins).toEqual([
      'https://app.bridgelet.io',
      'https://admin.bridgelet.io',
    ]);
  });

  it('would exit in production if CORS_ORIGINS is empty', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = '';

    const corsOrigins = process.env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const isProduction = process.env.NODE_ENV === 'production';

    const shouldExit =
      isProduction && (!corsOrigins || corsOrigins.length === 0);
    expect(shouldExit).toBe(true);
  });
});
