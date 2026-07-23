import { DataSource } from 'typeorm';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * DataSource used by the TypeORM CLI (migration:run, migration:revert, …).
 *
 * Pool rationale
 * ──────────────
 * • min: 2  – Keeps two warm connections so the first request after an idle
 *             period does not pay the TCP + TLS + PostgreSQL auth round-trips.
 * • max: 10 – Caps the per-instance pool to a value that leaves headroom for
 *             other services sharing the same PostgreSQL server. 10 aligns with
 *             a conservative PgBouncer transaction-mode default.
 * • acquireTimeoutMillis: 3000 – Fail-fast: if all 10 connections are busy for
 *             more than 3 s we surface an error immediately rather than queuing
 *             requests silently, which would hide a connection-leak or an
 *             under-provisioned database.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER || 'bridgelet_user',
  password: process.env.DATABASE_PASSWORD || 'bridgelet_pass',
  database: process.env.DATABASE_NAME || 'bridgelet',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  migrationsTransactionMode: 'each',
  poolSize: 10,
  extra: {
    min: 2,
    max: 10,
    acquireTimeoutMillis: 3000,
  },
});
