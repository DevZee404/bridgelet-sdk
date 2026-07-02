import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseCli, createAuditLogger, type CliFlags } from './migration-cli.js';
import { SecretEncryptionUtil } from '../common/crypto/secret-encryption.util.js';

// ---------------------------------------------------------------------------
// parseCli
// ---------------------------------------------------------------------------

describe('parseCli', () => {
  it('defaults to dry-run with batchSize=500', () => {
    const flags = parseCli([]);
    expect(flags.execute).toBe(false);
    expect(flags.hasBackup).toBe(false);
    expect(flags.batchSize).toBe(500);
    expect(flags.auditFile).toMatch(/secret-migration-.*\.ndjson$/);
  });

  it('parses --execute and --i-have-a-backup', () => {
    const flags = parseCli(['--execute', '--i-have-a-backup']);
    expect(flags.execute).toBe(true);
    expect(flags.hasBackup).toBe(true);
  });

  it('parses --batch-size and clamps to [1, 10_000]', () => {
    expect(parseCli(['--batch-size=42']).batchSize).toBe(42);
    expect(parseCli(['--batch-size=0']).batchSize).toBe(500); // rejected, default
    expect(parseCli(['--batch-size=20000']).batchSize).toBe(500); // clamp rejected
    expect(parseCli(['--batch-size=-5']).batchSize).toBe(500); // negative rejected
  });

  it('parses --audit-file relative path', () => {
    const flags = parseCli(['--audit-file=audit.ndjson']);
    expect(flags.auditFile).toBe(path.resolve(process.cwd(), 'audit.ndjson'));
  });

  it('ignores unknown flags', () => {
    const flags = parseCli(['--definitely-not-a-flag', '--execute']);
    expect(flags.execute).toBe(true);
    expect(flags.batchSize).toBe(500);
  });

  it('returned object satisfies CliFlags at the type level', () => {
    const flags: CliFlags = parseCli([]);
    expect(flags).toEqual(
      expect.objectContaining({
        execute: expect.any(Boolean),
        hasBackup: expect.any(Boolean),
        batchSize: expect.any(Number),
        auditFile: expect.any(String),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// createAuditLogger (NDJSON writer)
// ---------------------------------------------------------------------------

describe('createAuditLogger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the parent directory and writes valid NDJSON lines', async () => {
    const nested = path.join(tmpDir, 'nested', 'sub');
    const file = path.join(nested, 'audit.ndjson');
    const audit = createAuditLogger(file);

    audit.write({ event: 'start', execute: false });
    audit.write({ event: 'a', id: 'row-1', format: 'legacy-base64' });
    await audit.closeAsync();

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    const second = JSON.parse(lines[1]) as Record<string, unknown>;
    expect(first.event).toBe('start');
    expect(first.execute).toBe(false);
    expect(typeof first.time).toBe('string');
    expect(second.id).toBe('row-1');
    expect(second.format).toBe('legacy-base64');
  });

  it('closeSync ends the stream and the file persists', () => {
    const file = path.join(tmpDir, 'audit.ndjson');
    const audit = createAuditLogger(file);
    audit.write({ event: 'tick' });
    audit.closeSync();
    expect(fs.existsSync(file)).toBe(true);
  });

  it('closeAsync awaits the stream drain', async () => {
    const file = path.join(tmpDir, 'audit.ndjson');
    const audit = createAuditLogger(file);
    for (let i = 0; i < 100; i += 1) {
      audit.write({ event: 'tick', i });
    }
    await audit.closeAsync();
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(100);
  });

  it('survives a nested parent directory that does not yet exist', () => {
    const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'audit.ndjson');
    const audit = createAuditLogger(deepPath);
    audit.write({ event: 'tick' });
    audit.closeSync();
    expect(fs.existsSync(deepPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Classifier invariants — what runMigration relies on
// ---------------------------------------------------------------------------

describe('classifier invariants used by runMigration', () => {
  const validKey = crypto.randomBytes(32).toString('hex');
  const plaintext = 'S-SECRET-FOR-MIGRATION-UNIT-TEST';

  function buildUnprefixedAes(): string {
    const key = Buffer.from(validKey, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [iv.toString('hex'), tag.toString('hex'), ct.toString('hex')].join(
      ':',
    );
  }

  function buildLegacyBase64(): string {
    return Buffer.from(plaintext).toString('base64');
  }

  it.each([
    ['v1-prefixed', () => SecretEncryptionUtil.encrypt(plaintext, validKey)],
    ['unprefixed-aes', buildUnprefixedAes],
    ['legacy-base64', buildLegacyBase64],
  ] as const)(
    'classifies %s into one of the four legal buckets',
    (_label, make) => {
      const stored = make();
      const fmt = SecretEncryptionUtil.classify(stored);
      expect([
        'prefixed-aes-v1',
        'unprefixed-aes',
        'legacy-base64',
        'corrupt',
      ]).toContain(fmt);
    },
  );

  it('round-trips a legacy base64 row through encrypt()', () => {
    const stored = Buffer.from(plaintext).toString('base64');
    const decoded = Buffer.from(stored, 'base64').toString('utf8');
    const reencrypted = SecretEncryptionUtil.encrypt(decoded, validKey);
    expect(SecretEncryptionUtil.decrypt(reencrypted, validKey)).toBe(plaintext);
    expect(reencrypted.startsWith('aes256gcm:v1:')).toBe(true);
  });

  it('round-trips an unprefixed-AES row through decrypt() then encrypt()', () => {
    const key = Buffer.from(validKey, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const legacy = [
      iv.toString('hex'),
      tag.toString('hex'),
      ct.toString('hex'),
    ].join(':');

    const decoded = SecretEncryptionUtil.decrypt(legacy, validKey);
    const reencrypted = SecretEncryptionUtil.encrypt(decoded, validKey);
    expect(SecretEncryptionUtil.decrypt(reencrypted, validKey)).toBe(plaintext);
    expect(reencrypted.startsWith('aes256gcm:v1:')).toBe(true);
  });
});
