import { BadRequestException } from '@nestjs/common';
import { SanitizeInputPipe } from './input-sanitize.pipe.js';

describe('SanitizeInputPipe', () => {
  let pipe: SanitizeInputPipe;

  beforeEach(() => {
    pipe = new SanitizeInputPipe();
  });

  // -------------------------------------------------------------------------
  // Passthrough for non-object values
  // -------------------------------------------------------------------------

  it('passes null through unchanged', () => {
    expect(pipe.transform(null)).toBeNull();
  });

  it('passes undefined through unchanged', () => {
    expect(pipe.transform(undefined)).toBeUndefined();
  });

  it('passes primitives through unchanged', () => {
    expect(pipe.transform('string')).toBe('string');
    expect(pipe.transform(42)).toBe(42);
    expect(pipe.transform(true)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Webhook URL sanitisation
  // -------------------------------------------------------------------------

  it('sanitises a valid webhook URL (passthrough)', () => {
    const result = pipe.transform({ url: 'https://example.com/hook' });
    expect(result).toEqual({ url: 'https://example.com/hook' });
  });

  it('rejects a javascript: webhook URL', () => {
    expect(() => pipe.transform({ url: 'javascript:alert(1)' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a file: webhook URL', () => {
    expect(() => pipe.transform({ url: 'file:///etc/passwd' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a localhost webhook URL', () => {
    expect(() => pipe.transform({ url: 'http://localhost:3000/hook' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a loopback IP webhook URL', () => {
    expect(() => pipe.transform({ url: 'http://127.0.0.1/hook' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a metadata endpoint webhook URL', () => {
    expect(() =>
      pipe.transform({ url: 'http://169.254.169.254/latest/meta-data/' }),
    ).toThrow(BadRequestException);
  });

  // -------------------------------------------------------------------------
  // Free-text field sanitisation
  // -------------------------------------------------------------------------

  it('strips CRLF from description field', () => {
    const result = pipe.transform({
      description: 'My webhook\r\nX-Injected: true',
    });
    expect(result.description).toBe('My webhookX-Injected: true');
  });

  it('strips control characters from description', () => {
    const result = pipe.transform({
      description: 'test\x00value',
    });
    expect(result.description).toBe('testvalue');
  });

  it('preserves clean description', () => {
    const result = pipe.transform({
      description: 'Payroll completion hook',
    });
    expect(result.description).toBe('Payroll completion hook');
  });

  it('preserves description with Unicode characters', () => {
    const result = pipe.transform({
      description: 'Café hook 日本語',
    });
    expect(result.description).toBe('Café hook 日本語');
  });

  it('handles undefined description gracefully', () => {
    const result = pipe.transform({ description: undefined });
    expect(result.description).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Event type sanitisation
  // -------------------------------------------------------------------------

  it('strips CRLF from eventType field', () => {
    const result = pipe.transform({
      eventType: 'sweep.completed\r\nX-Fake: header',
    });
    expect(result.eventType).toBe('sweep.completedX-Fake: header');
  });

  // -------------------------------------------------------------------------
  // Events array sanitisation
  // -------------------------------------------------------------------------

  it('sanitises each element in the events array', () => {
    const result = pipe.transform({
      events: ['sweep.completed', 'account.created\x00evil'],
    });
    expect(result.events).toEqual(['sweep.completed', 'account.createdevil']);
  });

  it('does not mutate a non-array events field', () => {
    const result = pipe.transform({ events: 'not-an-array' });
    expect(result.events).toBe('not-an-array');
  });

  // -------------------------------------------------------------------------
  // Metadata sanitisation
  // -------------------------------------------------------------------------

  it('recursively sanitises string values in metadata', () => {
    const result = pipe.transform({
      metadata: { key: 'value\x00here' },
    });
    expect(result.metadata).toEqual({ key: 'valuehere' });
  });

  it('strips CRLF in nested metadata values', () => {
    const result = pipe.transform({
      metadata: { inner: 'data\r\ninjected' },
    });
    expect(result.metadata).toEqual({ inner: 'datainjected' });
  });

  it('preserves non-string metadata values', () => {
    const result = pipe.transform({
      metadata: { count: 42, flag: true, nested: null },
    });
    expect(result.metadata).toEqual({
      count: 42,
      flag: true,
      nested: null,
    });
  });

  it('handles null metadata gracefully', () => {
    const result = pipe.transform({ metadata: null });
    expect(result.metadata).toBeNull();
  });

  it('handles undefined metadata gracefully', () => {
    const result = pipe.transform({ metadata: undefined });
    expect(result).toEqual({ metadata: undefined });
  });

  it('throws BadRequestException for oversized metadata', () => {
    const largeMetadata = { data: 'x'.repeat(5000) };
    expect(() => pipe.transform({ metadata: largeMetadata })).toThrow(
      BadRequestException,
    );
  });

  // -------------------------------------------------------------------------
  // Combined scenarios
  // -------------------------------------------------------------------------

  it('sanitises all fields in a realistic webhook creation payload', () => {
    const result = pipe.transform({
      url: 'https://example.com/hook',
      events: ['sweep.completed', 'account.created'],
      description: 'My hook',
      metadata: { integrationId: 'int-123' },
    });
    expect(result).toEqual({
      url: 'https://example.com/hook',
      events: ['sweep.completed', 'account.created'],
      description: 'My hook',
      metadata: { integrationId: 'int-123' },
    });
  });

  it('sanitises a payload with injection attempts in multiple fields', () => {
    const result = pipe.transform({
      description: 'hook\r\nX-Injected: true',
      eventType: 'sweep.completed\x00',
      events: ['account.created\nfake'],
      metadata: { note: 'test\x0D\x0Ainjected' },
    });
    expect(result.description).toBe('hookX-Injected: true');
    expect(result.eventType).toBe('sweep.completed');
    expect(result.events).toEqual(['account.createdfake']);
    expect(result.metadata).toEqual({ note: 'testinjected' });
  });

  it('passes through objects without known injection-sensitive fields', () => {
    const input = { someField: 'safe', anotherField: 42 };
    const result = pipe.transform(input);
    expect(result).toEqual(input);
  });

  it('handles a create-account payload (no url/description/events)', () => {
    const input = {
      fundingSource: 'GFUNDING...',
      recovery_address: 'GRECOVERY...',
      amount: '100',
      expiresIn: 3600,
      metadata: { userId: 'u123' },
    };
    const result = pipe.transform(input);
    expect(result).toEqual(input);
  });

  it('does not strip newlines from description when they are printable (default: stripped)', () => {
    // This documents that the pipe strips newlines from description by default.
    const result = pipe.transform({ description: 'line1\nline2' });
    expect(result.description).toBe('line1line2');
  });
});
