import './tracing.js';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { PinoLoggerService } from './common/logger/pino-logger.service.js';

async function bootstrap() {
  const logger = new PinoLoggerService();
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
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  void app.listen(port);

  logger.log(`Bridgelet SDK running on http://localhost:${port}`, 'Bootstrap');
  logger.log(
    `API Documentation: http://localhost:${port}/api/docs`,
    'Bootstrap',
  );
}

bootstrap().catch(console.error);
