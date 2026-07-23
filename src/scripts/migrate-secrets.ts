/**
 * migrate-secrets.ts
 * ──────────────────
 * One-shot data-migration tool for issue #193.
 *
 * What it does
 * ────────────
 * Reclassifies every `accounts.secretKeyEncrypted` row and rewrites each row
 * so it ends up carrying the `aes256gcm:v1:` prefix. Three legal source formats:
 *
 *   ─ prefixed-aes-v1  ─ already current, SKIP
 *   ─ unprefixed-aes   ─ legacy AES-256-GCM without prefix; rewrite with prefix
 *   ─ legacy-base64    ─ pre-AES MVP placeholder; decode + re-encrypt with prefix
 *   ─ corrupt          ─ undecodable row; HALT and require operator intervention
 *
 * Safety
 * ──────
 *   1. Default mode is DRY-RUN. Nothing is written.
 *   2. To write, you must pass BOTH `--execute` AND `--i-have-a-backup`.
 *   3. Every UPDATE routes through TypeORM Repository.update() so the
 *      optimistic `WHERE id = :id AND secretKeyEncrypted = :old` clause is
 *      quoted-correctly AND returns a typed UpdateResult. Rows where the
 *      optimistic check fails (`affected === 0`) are reported and skipped,
 *      not retried — the live service has the up-to-date value.
 *   4. Any `corrupt` row halts the run with a clear message so operators do
 *      not silently skip past permanently-locked Stellar funds.
 *   5. Every action is appended to an NDJSON audit file (written via the
 *      helpers in `./migration-cli.ts`). The audit stream is awaited-drained
 *      before process exit so trailing lines cannot be lost on shutdown.
 *
 * CLI parsing and audit logging live in `./migration-cli.ts` so the unit
 * spec can test them WITHOUT this module's NestFactory / DataSource wiring.
 *
 * Usage
 * ─────
 *   Dry run (counts + sample IDs only):
 *     npm run migrate:secrets
 *
 *   Production run with confirmation:
 *     npm run migrate:secrets -- --i-have-a-backup --execute
 *
 *   After `npm run build`:
 *     node dist/src/scripts/migrate-secrets.js --i-have-a-backup --execute
 *
 *   Options:
 *     --i-have-a-backup         required with --execute
 *     --execute                 actually write (default is dry-run)
 *     --batch-size=N            rows scanned per query (default 500, max 10_000)
 *     --audit-file=PATH         NDJSON audit destination
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { NestFactory } from '@nestjs/core';
import { DataSource, UpdateResult } from 'typeorm';

import { parseCli, createAuditLogger, type CliFlags } from './migration-cli.js';
import databaseConfig from '../config/database.config.js';
import stellarConfig from '../config/stellar.config.js';
import { Account } from '../modules/accounts/entities/account.entity.js';
import { SecretEncryptionUtil } from '../common/crypto/secret-encryption.util.js';

// ---------------------------------------------------------------------------
// Migration module — minimal application context. Deliberately does NOT import
// AppModule, because AppModule pulls in ScheduleModule.forRoot() which fires
// cron jobs during the migration.
// ---------------------------------------------------------------------------

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, stellarConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService): TypeOrmModuleOptions => {
        const cfg = cs.get<TypeOrmModuleOptions>('database.database');
        if (!cfg) {
          throw new Error(
            'database.database config missing — check ConfigModule.forRoot loaders.',
          );
        }
        return cfg;
      },
    }),
  ],
})
class MigrationModule {}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export interface MigrationReport {
  totalScanned: number;
  prefixed: number; // already-current, skipped
  reencrypted: number; // writes actually committed
  skippedConcurrent: number; // optimistic-concurrency lost
  corrupt: number; // halted on a bad row
  legacyBase64: number;
  unprefixedAes: number;
}

export async function runMigration(flags: CliFlags): Promise<MigrationReport> {
  const app = await NestFactory.createApplicationContext(MigrationModule, {
    logger: false,
  });

  const dataSource = app.get(DataSource);
  const encryptionKey = app
    .get(ConfigService)
    .getOrThrow<string>('stellar.encryptionKey');

  const audit = createAuditLogger(flags.auditFile);

  audit.write({
    event: 'start',
    execute: flags.execute,
    batchSize: flags.batchSize,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  });

  const report: MigrationReport = {
    totalScanned: 0,
    prefixed: 0,
    reencrypted: 0,
    skippedConcurrent: 0,
    corrupt: 0,
    legacyBase64: 0,
    unprefixedAes: 0,
  };

  try {
    let offset = 0;
    while (true) {
      const batch: Account[] = await dataSource
        .getRepository(Account)
        .createQueryBuilder('a')
        .select(['a.id', 'a.secretKeyEncrypted'])
        .orderBy('a.id', 'ASC')
        .offset(offset)
        .limit(flags.batchSize)
        .getMany();

      if (batch.length === 0) break;

      for (const row of batch) {
        report.totalScanned += 1;
        const stored = row.secretKeyEncrypted;
        const format = SecretEncryptionUtil.classify(stored);

        if (format === 'prefixed-aes-v1') {
          report.prefixed += 1;
          continue;
        }

        if (format === 'corrupt') {
          report.corrupt += 1;
          audit.write({ event: 'corrupt-halt', id: row.id, stored });
          throw new Error(
            `Migration halted: accounts.id=${row.id} has an un-decodable ` +
              `secretKeyEncrypted payload. Inspect the row manually; do NOT ` +
              `continue without remediation.`,
          );
        }

        // Decode the legacy value and re-encrypt with the v1 prefix.
        let plaintext: string;
        try {
          if (format === 'legacy-base64') {
            plaintext = Buffer.from(stored, 'base64').toString('utf8');
            report.legacyBase64 += 1;
          } else if (format === 'unprefixed-aes') {
            plaintext = SecretEncryptionUtil.decrypt(stored, encryptionKey);
            report.unprefixedAes += 1;
          } else {
            // Exhaustiveness guard — classify() returns exactly one of the
            // four buckets above; if a new bucket is added without handling
            // it here, TS raises on the `never` assignment.
            const _exhaustive: never = format;
            throw new Error(`Unhandled format: ${String(_exhaustive)}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          report.corrupt += 1;
          audit.write({
            event: 'decode-error',
            id: row.id,
            format,
            error: message,
          });
          throw new Error(
            `Migration halted: failed to decode accounts.id=${row.id} ` +
              `(format=${format}): ${message}`,
          );
        }

        const newEncrypted = SecretEncryptionUtil.encrypt(
          plaintext,
          encryptionKey,
        );

        if (!flags.execute) {
          // Dry-run: just record what we WOULD do.
          audit.write({
            event: 'would-reencrypt',
            id: row.id,
            format,
            hasPrefix: newEncrypted.startsWith('aes256gcm:v1:'),
          });
          // Drop the reference so GC can reclaim the prior plaintext.
          plaintext = '';
          continue;
        }

        // Optimistic concurrency: only rewrite if the row still holds the
        // exact ciphertext we read. A concurrent claim will have re-encrypted
        // it; if so, we skip rather than overwrite.
        const updateResult: UpdateResult = await dataSource
          .getRepository(Account)
          .update(
            { id: row.id, secretKeyEncrypted: stored },
            { secretKeyEncrypted: newEncrypted },
          );
        const affected = updateResult.affected ?? 0;
        if (affected === 1) {
          report.reencrypted += 1;
          audit.write({ event: 'reencrypted', id: row.id, format });
        } else {
          report.skippedConcurrent += 1;
          audit.write({
            event: 'skipped-concurrent',
            id: row.id,
            format,
            reason: 'optimistic-concurrency-lost',
          });
        }
        // Drop the reference so GC can reclaim the decrypted plaintext.
        plaintext = '';
      }

      offset += batch.length;
      if (batch.length < flags.batchSize) break;
    }

    audit.write({ event: 'complete', report });
    return report;
  } finally {
    // Drain audit stream BEFORE closing Nest context so the file is
    // fully flushed even if app.close() errors.
    await audit.closeAsync();
    await app.close();
  }
}

// ---------------------------------------------------------------------------
// Entry point — invoked when this file is the process entry, regardless of
// whether it was reached as .ts (ts-node) or .js (compiled).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = parseCli(process.argv.slice(2));

  if (flags.execute && !flags.hasBackup) {
    process.stderr.write(
      'FATAL: --execute requires --i-have-a-backup. Refusing to write.\n',
    );
    process.exit(2);
  }

  process.stdout.write(
    `[migrate-secrets] mode=${flags.execute ? 'EXECUTE' : 'DRY-RUN'}\n` +
      `[migrate-secrets] batch-size=${flags.batchSize}\n` +
      `[migrate-secrets] audit-file=${flags.auditFile}\n`,
  );

  const report = await runMigration(flags);

  process.stdout.write(
    `\n[migrate-secrets] Report (${flags.execute ? 'EXECUTE' : 'DRY-RUN'}):\n` +
      `  total-scanned       : ${report.totalScanned}\n` +
      `  already-prefixed-v1 : ${report.prefixed}\n` +
      `  unprefixed-aes      : ${report.unprefixedAes}\n` +
      `  legacy-base64       : ${report.legacyBase64}\n` +
      `  corrupt (halted)    : ${report.corrupt}\n` +
      `  reencrypted         : ${report.reencrypted}\n` +
      `  skipped-concurrent  : ${report.skippedConcurrent}\n` +
      `  audit-file          : ${flags.auditFile}\n`,
  );

  // Dry-run hint; in execute mode, zero corrupt means a clean run.
  if (!flags.execute) {
    const wouldChange =
      report.unprefixedAes + report.legacyBase64 - report.skippedConcurrent;
    if (wouldChange > 0) {
      process.stdout.write(
        `\n[migrate-secrets] ${wouldChange} rows would be rewritten on --execute.\n`,
      );
    } else {
      process.stdout.write(
        `\n[migrate-secrets] No rows require rewriting. Database is current.\n`,
      );
    }
  }
}

const ENTRY_RE = /migrate-secrets\.(ts|js)$/;
const argv1 = process.argv[1];
const isEntry = typeof argv1 === 'string' && ENTRY_RE.test(argv1);
if (isEntry) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`FATAL: ${message}\n`);
    if (err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    process.exit(1);
  });
}
