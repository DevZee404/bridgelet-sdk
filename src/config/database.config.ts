import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { dirname } from 'path';
import { DataSource } from 'typeorm';
import { fileURLToPath } from 'url';
import 'dotenv/config';

/**
 * Connection pool rationale
 * ─────────────────────────
 * • min: 2  – Keeps two warm connections ready so the first request after an
 *             idle period avoids the TCP + TLS + PostgreSQL auth round-trips.
 * • max: 10 – Caps each NestJS instance to 10 connections. This leaves room
 *             for other services sharing the same PostgreSQL server and aligns
 *             with a conservative PgBouncer transaction-mode default.
 * • acquireTimeoutMillis: 3000 – Fail-fast policy: surface an error after 3 s
 *             rather than queuing requests silently, which would mask
 *             connection-leaks or an under-provisioned database.
 *
 * The `extra` key is passed verbatim to the underlying `pg` Pool constructor,
 * which is how TypeORM exposes driver-specific pool configuration for Postgres.
 */
const POOL_CONFIG = {
  min: 2,
  max: 10,
  acquireTimeoutMillis: 3000,
} as const;

export default registerAs(
  'database',
  (): { database: TypeOrmModuleOptions } => ({
    database: {
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      username: process.env.DATABASE_USER || 'bridgelet_user',
      password: process.env.DATABASE_PASSWORD || 'bridgelet_pass',
      database: process.env.DATABASE_NAME || 'bridgelet',
      entities: [__dirname + '/../**/*.entity{.ts,.js}'],
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      synchronize: process.env.DATABASE_SYNC === 'false',
      autoLoadEntities: true,
      logging: process.env.DATABASE_LOGGING === 'true',
      // ssl:
      //   process.env.DATABASE_SSL === 'true'
      //     ? { rejectUnauthorized: false }
      //     : false,
      // Connection pool (see rationale above)
      poolSize: POOL_CONFIG.max,
      extra: POOL_CONFIG,
    },
  }),
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER || 'bridgelet_user',
  password: process.env.DATABASE_PASSWORD || 'bridgelet_pass',
  database: process.env.DATABASE_NAME || 'bridgelet',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  // Connection pool settings (see rationale above)
  poolSize: POOL_CONFIG.max,
  extra: POOL_CONFIG,
});
