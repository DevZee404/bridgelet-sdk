import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PinoLoggerService } from './pino-logger.service.js';
import { requestContextStorage } from '../context/request-context.js';

describe('PinoLoggerService', () => {
  let service: PinoLoggerService;
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PinoLoggerService],
    }).compile();

    service = module.get<PinoLoggerService>(PinoLoggerService);

    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => jest.restoreAllMocks());

  function lastStdout(): Record<string, unknown> {
    const raw = (stdoutSpy.mock.calls.at(-1)![0] as string).trim();
    return JSON.parse(raw) as Record<string, unknown>;
  }

  function lastStderr(): Record<string, unknown> {
    const raw = (stderrSpy.mock.calls.at(-1)![0] as string).trim();
    return JSON.parse(raw) as Record<string, unknown>;
  }

  // ── JSON structure ──────────────────────────────────────────────────────────

  describe('log output structure', () => {
    it('writes valid JSON to stdout', () => {
      service.log('hello');
      expect(() => lastStdout()).not.toThrow();
    });

    it('includes required fields: level, time, service, env, traceId, msg', () => {
      service.log('test message');
      const entry = lastStdout();
      expect(entry).toHaveProperty('level', 'info');
      expect(entry).toHaveProperty('service', 'bridgelet-sdk');
      expect(entry).toHaveProperty('env');
      expect(entry).toHaveProperty('traceId');
      expect(entry).toHaveProperty('msg', 'test message');
      expect(entry).toHaveProperty('time');
    });

    it('includes context when provided', () => {
      service.log('msg', 'SomeContext');
      expect(lastStdout().context).toBe('SomeContext');
    });

    it('omits context key when not provided', () => {
      service.log('msg');
      expect(lastStdout()).not.toHaveProperty('context');
    });

    it('time field is ISO 8601', () => {
      service.log('ts test');
      expect(() => new Date(lastStdout().time as string)).not.toThrow();
    });
  });

  // ── Log levels ─────────────────────────────────────────────────────────────

  describe('log levels', () => {
    it('log() sets level to info', () => {
      service.log('x');
      expect(lastStdout().level).toBe('info');
    });

    it('warn() sets level to warn', () => {
      service.warn('x');
      expect(lastStdout().level).toBe('warn');
    });

    it('debug() sets level to debug', () => {
      service.debug('x');
      expect(lastStdout().level).toBe('debug');
    });

    it('verbose() sets level to trace', () => {
      service.verbose('x');
      expect(lastStdout().level).toBe('trace');
    });

    it('fatal() sets level to fatal', () => {
      service.fatal('x');
      expect(lastStdout().level).toBe('fatal');
    });
  });

  // ── Error writes to stderr ─────────────────────────────────────────────────

  describe('error()', () => {
    it('writes to stderr', () => {
      service.error('boom');
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('sets level to error', () => {
      service.error('boom');
      expect(lastStderr().level).toBe('error');
    });

    it('includes stack when provided', () => {
      service.error('boom', 'Error: boom\n  at X');
      expect(lastStderr().stack).toBe('Error: boom\n  at X');
    });

    it('omits stack key when not provided', () => {
      service.error('boom');
      expect(lastStderr()).not.toHaveProperty('stack');
    });
  });

  // ── Redaction ──────────────────────────────────────────────────────────────

  describe('secret redaction', () => {
    it('redacts a raw Stellar secret key from log messages', () => {
      // 56-char Stellar secret key (S + 55 base32 chars)
      const secret = 'SEPH47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
      service.log(`Using key: ${secret}`);
      const msg = lastStdout().msg as string;
      expect(msg).not.toContain(secret);
      expect(msg).toContain('[REDACTED]');
    });

    it('does not redact ordinary messages', () => {
      service.log('sweep completed successfully');
      expect(lastStdout().msg).toBe('sweep completed successfully');
    });
  });

  // ── Request context traceId ────────────────────────────────────────────────

  describe('traceId from request context', () => {
    it('uses requestId from AsyncLocalStorage when available', (done) => {
      requestContextStorage.run({ requestId: 'test-req-id-999' }, () => {
        service.log('traced message');
        expect(lastStdout().traceId).toBe('test-req-id-999');
        done();
      });
    });

    it('falls back to random UUID when no context is set', () => {
      service.log('no context');
      const traceId = lastStdout().traceId as string;
      expect(traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });
});
