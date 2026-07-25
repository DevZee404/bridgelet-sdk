import 'reflect-metadata';
import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { NestFactory } from '@nestjs/core';
import databaseConfig from '../src/config/database.config.js';
import { IntegratorsModule } from '../src/modules/integrators/integrators.module.js';
import { IntegratorsService } from '../src/modules/integrators/integrators.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => {
        const cfg =
          configService.get<TypeOrmModuleOptions>('database.database');
        if (!cfg) {
          throw new Error('database.database config missing.');
        }
        return cfg;
      },
    }),
    IntegratorsModule,
  ],
})
class SeedLoadTestIntegratorsModule {}

async function main(): Promise<void> {
  const count = parseInt(process.argv[2] ?? '50', 10);
  if (Number.isNaN(count) || count <= 0) {
    throw new Error('Usage: npm run load:accounts:seed -- <count>');
  }

  const outputPath = path.resolve('load-tests/accounts-api-keys.csv');
  const app = await NestFactory.createApplicationContext(
    SeedLoadTestIntegratorsModule,
    { logger: false },
  );

  try {
    const integratorsService = app.get(IntegratorsService);
    const lines = ['apiKey'];

    for (let index = 1; index <= count; index += 1) {
      const { rawApiKey } = await integratorsService.create(
        `loadtest-${index}`,
      );
      lines.push(rawApiKey);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, lines.join('\n'), { encoding: 'utf8' });
    process.stdout.write(`Wrote ${count} API keys to ${outputPath}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`FATAL: ${message}\n`);
  process.exit(1);
});
