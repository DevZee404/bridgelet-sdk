import './tracing.js';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SanitizeInputPipe } from './common/utils/input-sanitize.pipe.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { PinoLoggerService } from './common/logger/pino-logger.service.js';

/**
 * Guards against accidentally deploying a production build against the Stellar
 * testnet.  If NODE_ENV is "production" and STELLAR_NETWORK is "testnet" the
 * process exits immediately with a non-zero code so the deployment fails fast
 * rather than silently running against the wrong network.
 *
 * The check runs before the NestJS application is created so it cannot be
 * bypassed by any module initialisation logic.
 */
function assertNetworkConfig(): void {
  const nodeEnv = process.env.NODE_ENV;
  const stellarNetwork = process.env.STELLAR_NETWORK;

  if (nodeEnv === 'production' && stellarNetwork === 'testnet') {
    // Use console.error here — the NestJS logger is not yet available.
    console.error(
      '[Bootstrap] FATAL: NODE_ENV=production with STELLAR_NETWORK=testnet is not allowed. ' +
        'Set STELLAR_NETWORK=mainnet for production deployments.',
    );
    process.exit(1);
  }
}

/**
 * Guards against booting a non-development deployment with a weak or
 * placeholder JWT_SECRET. Claim authentication is signed with JWT_SECRET, so a
 * guessable/copy-pasted value would let an attacker forge claim tokens and
 * redeem (sweep) ephemeral accounts without the legitimate claim flow.
 *
 * The check runs before the NestJS application is created and only acts in
 * non-development environments (e.g. production, staging), where a weak secret
 * is unacceptable. Development environments are not blocked so contributors can
 * run locally with the .env.example placeholder.
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
    console.error(
      '[Bootstrap] FATAL: JWT_SECRET is missing, too short (< 32 chars), or a ' +
        'known placeholder value. Refusing to start in NODE_ENV=' +
        (nodeEnv ?? 'unset') +
        '. Set a strong, random JWT_SECRET (>= 32 chars) before deploying.',
    );
    process.exit(1);
  }
}

/**
 * Decides whether the Swagger UI (/api/docs) should be exposed.
 *
 * The interactive Swagger UI reveals the full REST surface, request/response
 * schemas and internal field names — valuable reconnaissance for an attacker.
 * In production it is disabled by default; expose it explicitly only when
 * needed via ENABLE_SWAGGER=true (or mount it behind authentication).
 */
function isSwaggerEnabled(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  const enableSwagger = process.env.ENABLE_SWAGGER;

  if (nodeEnv === 'production' && enableSwagger !== 'true') {
    return false;
  }

  return true;
}

async function bootstrap() {
  assertNetworkConfig();
  assertSecretStrength();

  const isProduction = process.env.NODE_ENV === 'production';
  const logger = isProduction ? new PinoLoggerService() : undefined;
  const app = await NestFactory.create(AppModule, { logger });

  app.use(helmet());

  // Sanitise input first (strip injection vectors), then validate shape.
  // Order matters: SanitizeInputPipe runs on the raw body before
  // ValidationPipe applies class-validator decorators.
  app.useGlobalPipes(
    new SanitizeInputPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (isProduction && (!corsOrigins || corsOrigins.length === 0)) {
    const bootstrapLogger = new Logger('Bootstrap');
    bootstrapLogger.error(
      'CORS_ORIGINS must be set to a comma-separated list of allowed origins in production. ' +
        'Refusing to start with wildcard CORS to prevent unauthorized cross-origin access.',
    );
    process.exit(1);
  }

  app.enableCors({
    origin: corsOrigins && corsOrigins.length > 0 ? corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Request-Id',
    ],
    credentials: corsOrigins && corsOrigins.length > 0,
    maxAge: 86400,
  });

  const enableSwagger = isSwaggerEnabled();

  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('Bridgelet SDK API')
      .setDescription('Ephemeral account management API for Stellar')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        'X-API-Key',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  void app.listen(port);

  const bootstrapLogger = new Logger('Bootstrap');
  bootstrapLogger.log(`Bridgelet SDK running on http://localhost:${port}`);
  if (enableSwagger) {
    bootstrapLogger.log(`API Documentation: http://localhost:${port}/api/docs`);
  }
}

bootstrap().catch(console.error);
