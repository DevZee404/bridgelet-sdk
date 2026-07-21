import './tracing.js';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { PinoLoggerService } from './common/logger/pino-logger.service.js';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const logger = isProduction ? new PinoLoggerService() : undefined;
  const app = await NestFactory.create(AppModule, { logger });

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
