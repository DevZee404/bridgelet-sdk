/**
 * migration-cli.ts
 * ────────────────
 * Pure, side-effect-free CLI helpers used by scripts/migrate-secrets.ts and
 * its unit spec.
 *
 * This module deliberately imports ONLY:
 *   - node:fs (NDJSON audit file)
 *   - node:path (resolving --audit-file relative paths)
 *
 * No Nest, no TypeORM, no database config. Keeping the surface this small is
 * what lets the unit spec assert against these helpers without transitively
 * loading `database.config.ts`, which triggers a pre-existing
 * `__filename` redeclaration under ts-jest's CommonJS transform. The mate
 * runner script — `migrate-secrets.ts` — also imports from here so the
 * responsibilities split cleanly: this file owns the I/O plumbing, the
 * runner owns the data-source wiring and the per-row mutation.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface CliFlags {
  execute: boolean;
  hasBackup: boolean;
  batchSize: number;
  auditFile: string;
}

/**
 * Lightweight argv parser — no new dep. Recognises:
 *   --execute
 *   --i-have-a-backup
 *   --batch-size=N   (1 ≤ N ≤ 10_000, otherwise defaults to 500)
 *   --audit-file=PATH
 * Unknown flags are ignored; missing flags fall through to defaults.
 */
export function parseCli(argv: readonly string[]): CliFlags {
  const flags: CliFlags = {
    execute: false,
    hasBackup: false,
    batchSize: 500,
    auditFile: path.resolve(
      process.cwd(),
      `secret-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`,
    ),
  };
  for (const arg of argv) {
    if (arg === '--execute') flags.execute = true;
    else if (arg === '--i-have-a-backup') flags.hasBackup = true;
    else if (arg.startsWith('--batch-size=')) {
      const n = parseInt(arg.split('=')[1] ?? '', 10);
      if (Number.isFinite(n) && n > 0 && n <= 10_000) {
        flags.batchSize = n;
      }
    } else if (arg.startsWith('--audit-file=')) {
      const v = arg.split('=')[1];
      if (v) flags.auditFile = path.resolve(process.cwd(), v);
    }
  }
  return flags;
}

export interface AuditLogger {
  write(entry: Record<string, unknown>): void;
  closeSync(): void;
  closeAsync(): Promise<void>;
}

/**
 * Creates an NDJSON audit writer at `filePath`. The parent directory is
 * created if missing. Each `write()` prepends an ISO-8601 timestamp before
 * the caller's fields so consumers can re-construct the run timeline
 * without trusting caller-supplied `time` keys.
 *
 * Implementation note — sync on purpose
 * ──────────────────────────────────────
 * We use `fs.openSync`/`fs.writeSync`/`fs.closeSync` rather than the
 * `fs.createWriteStream` async stream. Reason: `createWriteStream` opens
 * via an async syscall, so callers that `write()` then `closeSync()` in
 * tight succession race against the open — manifest as ENOENT on the
 * write, or the file not yet existing on disk by the time the test
 * asserts. Synchronous ops remove that race entirely; performance is
 * ample for a single-writer NDJSON audit trail (short lines, low rate,
 * sequential calls from the migration's serial row loop).
 *
 * `closeAsync()` returns a resolved Promise so callers can `await` it
 * inside a `finally {}` block. Because the underlying close is already
 * synchronous, the promise resolves on the next microtask tick.
 */
export function createAuditLogger(filePath: string): AuditLogger {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = fs.openSync(filePath, 'a');
  let closed = false;

  const closeFd = (): void => {
    if (closed) return;
    closed = true;
    fs.closeSync(fd);
  };

  return {
    write(entry) {
      if (closed) {
        throw new Error(
          'AuditLogger: cannot write after close. ' +
            'Open a fresh logger for additional entries.',
        );
      }
      const line =
        JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
      fs.writeSync(fd, line);
    },
    closeSync() {
      closeFd();
    },
    closeAsync(): Promise<void> {
      closeFd();
      // Underlying I/O is already synchronous; return a resolved promise so
      // callers can `await` this inside a `finally {}` block for unified
      // shutdown sequencing regardless of whether the file was actually
      // written to. Resolves on the next microtask tick.
      return Promise.resolve();
    },
  };
}
