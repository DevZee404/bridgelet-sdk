import './tracing.js';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
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

async function bootstrap() {
  assertNetworkConfig();

  const isProduction = process.env.NODE_ENV === 'production';
  const logger = isProduction ? new PinoLoggerService() : undefined;
  const app = await NestFactory.create(AppModule, { logger });

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || '*',
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Bridgelet SDK API')
    .setDescription('Ephemeral account management API for Stellar')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'X-API-Key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  void app.listen(port);

  const bootstrapLogger = new Logger('Bootstrap');
  bootstrapLogger.log(`Bridgelet SDK running on http://localhost:${port}`);
  bootstrapLogger.log(`API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap().catch(console.error);
