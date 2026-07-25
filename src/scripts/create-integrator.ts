/**
 * Admin-only bootstrap script: mints a new integrator row and prints its
 * raw API key exactly once. The raw key is not stored anywhere — only its
 * SHA-256 hash is persisted (see IntegratorsService.create) — so if you
 * lose the printed value, the only recovery is minting a new key.
 *
 * Usage:
 *   npm run create:integrator -- "Acme Corp"
 *
 * After `npm run build`:
 *   node dist/src/scripts/create-integrator.js "Acme Corp"
 */
import 'reflect-metadata';
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { NestFactory } from '@nestjs/core';

import databaseConfig from '../config/database.config.js';
import { IntegratorsModule } from '../modules/integrators/integrators.module.js';
import { IntegratorsService } from '../modules/integrators/integrators.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService): TypeOrmModuleOptions => {
        const cfg = cs.get<TypeOrmModuleOptions>('database.database');
        if (!cfg) {
          throw new Error('database.database config missing.');
        }
        return cfg;
      },
    }),
    IntegratorsModule,
  ],
})
class CreateIntegratorModule {}

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    process.stderr.write(
      'Usage: npm run create:integrator -- "<integrator name>"\n',
    );
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(
    CreateIntegratorModule,
    {
      logger: false,
    },
  );

  try {
    const integratorsService = app.get(IntegratorsService);
    const { integrator, rawApiKey } = await integratorsService.create(name);

    process.stdout.write(
      `\nIntegrator created.\n` +
        `  id      : ${integrator.id}\n` +
        `  name    : ${integrator.name}\n` +
        `  api key : ${rawApiKey}\n\n` +
        `Store this key now — it cannot be retrieved again. Send it to "${name}" ` +
        `to use as the X-API-Key header value.\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`FATAL: ${message}\n`);
  process.exit(1);
});
