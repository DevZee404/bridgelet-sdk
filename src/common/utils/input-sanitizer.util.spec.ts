import { BadRequestException } from '@nestjs/common';
import {
  stripControlChars,
  sanitizeWebhookUrl,
  sanitizeFreeText,
  sanitizeMetadataDeep,
  INPUT_METADATA_MAX_BYTES,
} from './input-sanitizer.util.js';

// ---------------------------------------------------------------------------
// stripControlChars
// ---------------------------------------------------------------------------
describe('stripControlChars', () => {
  it('returns non-string inputs unchanged', () => {
    expect(stripControlChars(42)).toBe(42);
    expect(stripControlChars(null)).toBeNull();
    expect(stripControlChars(undefined)).toBeUndefined();
    expect(stripControlChars(true)).toBe(true);
  });

  it('passes through a clean string unchanged', () => {
    expect(stripControlChars('hello world')).toBe('hello world');
  });

  it('strips null bytes', () => {
    expect(stripControlChars('hello\x00world')).toBe('helloworld');
  });

  it('strips CR and LF by default (no allowNewlines)', () => {
    expect(stripControlChars('line1\r\nline2')).toBe('line1line2');
    expect(stripControlChars('line1\rline2')).toBe('line1line2');
    expect(stripControlChars('line1\nline2')).toBe('line1line2');
  });

  it('normalises CRLF → LF when allowNewlines is true', () => {
    const result = stripControlChars('a\r\nb\rc', { allowNewlines: true });
    expect(result).toBe('a\nb\nc');
  });

  it('keeps TAB by default', () => {
    expect(stripControlChars('a\tb')).toBe('a\tb');
  });

  it('strips TAB when allowTabs is false', () => {
    expect(stripControlChars('a\tb', { allowTabs: false })).toBe('ab');
  });

  it('strips backspace, bell, escape, and other C0 controls', () => {
    const input = 'a\x07b\x08c\x1Bd';
    expect(stripControlChars(input)).toBe('abcd');
  });

  it('strips DEL (0x7F)', () => {
    expect(stripControlChars('a\x7Fb')).toBe('ab');
  });

  it('strips C1 controls (0x80–0x9F)', () => {
    expect(stripControlChars('a\x80b\x9Fc')).toBe('abc');
  });

  it('preserves all printable ASCII', () => {
    const printable =
      ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    expect(stripControlChars(printable)).toBe(printable);
  });

  it('preserves non-ASCII Unicode (emoji, CJK, accented)', () => {
    expect(stripControlChars('日本語 émojis 🎉 café')).toBe(
      '日本語 émojis 🎉 café',
    );
  });

  it('handles log-injection payload', () => {
    const malicious =
      'INFO 2026-01-01 user=admin\r\nERROR fake admin took over';
    expect(stripControlChars(malicious)).toBe(
      'INFO 2026-01-01 user=adminERROR fake admin took over',
    );
  });

  it('handles header-injection payload', () => {
    const malicious = 'sweep.completed\r\nX-Injected: true';
    expect(stripControlChars(malicious)).toBe(
      'sweep.completedX-Injected: true',
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeWebhookUrl
// ---------------------------------------------------------------------------
describe('sanitizeWebhookUrl', () => {
  it('accepts valid https URLs', () => {
    expect(sanitizeWebhookUrl('https://example.com/hook')).toBe(
      'https://example.com/hook',
    );
  });

  it('accepts valid http URLs', () => {
    expect(sanitizeWebhookUrl('http://example.com/hook')).toBe(
      'http://example.com/hook',
    );
  });

  it('trims whitespace', () => {
    expect(sanitizeWebhookUrl('  https://example.com/hook  ')).toBe(
      'https://example.com/hook',
    );
  });

  it('accepts URLs with ports', () => {
    expect(sanitizeWebhookUrl('https://example.com:8080/hook')).toBe(
      'https://example.com:8080/hook',
    );
  });

  it('accepts URLs with query strings and fragments', () => {
    expect(
      sanitizeWebhookUrl('https://example.com/hook?token=abc#section'),
    ).toBe('https://example.com/hook?token=abc#section');
  });

  it('accepts URLs with IP addresses (non-loopback)', () => {
    expect(sanitizeWebhookUrl('https://10.0.0.1/hook')).toBe(
      'https://10.0.0.1/hook',
    );
  });

  it('rejects empty strings', () => {
    expect(() => sanitizeWebhookUrl('')).toThrow(BadRequestException);
  });

  it('rejects non-string inputs', () => {
    expect(() => sanitizeWebhookUrl(42)).toThrow(BadRequestException);
    expect(() => sanitizeWebhookUrl(null)).toThrow(BadRequestException);
    expect(() => sanitizeWebhookUrl(undefined)).toThrow(BadRequestException);
  });

  it('rejects javascript: scheme', () => {
    expect(() => sanitizeWebhookUrl('javascript:alert(1)')).toThrow(
      BadRequestException,
    );
  });

  it('rejects file: scheme', () => {
    expect(() => sanitizeWebhookUrl('file:///etc/passwd')).toThrow(
      BadRequestException,
    );
  });

  it('rejects data: scheme', () => {
    expect(() => sanitizeWebhookUrl('data:text/html,<script>')).toThrow(
      BadRequestException,
    );
  });

  it('rejects ftp: scheme', () => {
    expect(() => sanitizeWebhookUrl('ftp://example.com/hook')).toThrow(
      BadRequestException,
    );
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => sanitizeWebhookUrl('ws://example.com/hook')).toThrow(
      BadRequestException,
    );
  });

  it('rejects localhost', () => {
    expect(() => sanitizeWebhookUrl('http://localhost/hook')).toThrow(
      BadRequestException,
    );
    expect(() => sanitizeWebhookUrl('http://localhost:3000/hook')).toThrow(
      BadRequestException,
    );
  });

  it('rejects 127.0.0.1', () => {
    expect(() => sanitizeWebhookUrl('http://127.0.0.1/hook')).toThrow(
      BadRequestException,
    );
  });

  it('rejects IPv6 loopback', () => {
    expect(() => sanitizeWebhookUrl('http://[::1]/hook')).toThrow(
      BadRequestException,
    );
  });

  it('rejects 0.0.0.0', () => {
    expect(() => sanitizeWebhookUrl('http://0.0.0.0/hook')).toThrow(
      BadRequestException,
    );
  });

  it('rejects AWS/GCP metadata endpoint', () => {
    expect(() =>
      sanitizeWebhookUrl('http://169.254.169.254/latest/meta-data/'),
    ).toThrow(BadRequestException);
    expect(() =>
      sanitizeWebhookUrl('http://metadata.google.internal/computeMetadata/v1/'),
    ).toThrow(BadRequestException);
  });

  it('rejects 127.x.x.x loopback variants', () => {
    expect(() => sanitizeWebhookUrl('http://127.0.0.2/hook')).toThrow(
      BadRequestException,
    );
    expect(() => sanitizeWebhookUrl('http://127.255.255.255/hook')).toThrow(
      BadRequestException,
    );
  });

  it('rejects malformed URLs', () => {
    expect(() => sanitizeWebhookUrl('http://')).toThrow(BadRequestException);
  });

  it('rejects a URL with embedded javascript: after normal prefix', () => {
    // Edge case: "https://evil.com#javascript:alert(1)"
    // URL parsing will succeed but we still reject on scheme.
    expect(() =>
      sanitizeWebhookUrl('https://evil.com#javascript:alert(1)'),
    ).toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// sanitizeFreeText
// ---------------------------------------------------------------------------
describe('sanitizeFreeText', () => {
  it('returns undefined for null/undefined', () => {
    expect(sanitizeFreeText(null)).toBeUndefined();
    expect(sanitizeFreeText(undefined)).toBeUndefined();
  });

  it('converts non-string to string', () => {
    expect(sanitizeFreeText(123)).toBe('123');
  });

  it('strips control characters from free text', () => {
    expect(sanitizeFreeText('Payroll hook\x00')).toBe('Payroll hook');
  });

  it('strips CRLF from free text', () => {
    expect(sanitizeFreeText('description\r\nfake: injected')).toBe(
      'descriptionfake: injected',
    );
  });

  it('preserves printable Unicode', () => {
    expect(sanitizeFreeText('Café résumé 日本語')).toBe('Café résumé 日本語');
  });

  it('preserves normal newlines when passed as-is (caller opted in)', () => {
    // sanitizeFreeText always strips newlines. For allowNewlines, use
    // stripControlChars directly. This test documents that.
    const input = 'line1\nline2';
    expect(sanitizeFreeText(input)).toBe('line1line2');
  });
});

// ---------------------------------------------------------------------------
// sanitizeMetadataDeep
// ---------------------------------------------------------------------------
describe('sanitizeMetadataDeep', () => {
  it('returns undefined for falsy input', () => {
    expect(sanitizeMetadataDeep(null)).toBeUndefined();
    expect(sanitizeMetadataDeep(undefined)).toBeUndefined();
  });

  it('strips control characters from string values', () => {
    const result = sanitizeMetadataDeep({ note: 'hello\x00world' });
    expect(result).toEqual({ note: 'helloworld' });
  });

  it('strips CRLF from nested string values', () => {
    const result = sanitizeMetadataDeep({
      level1: { level2: 'value\r\ninjected' },
    });
    expect(result).toEqual({ level1: { level2: 'valueinjected' } });
  });

  it('preserves non-string values', () => {
    const result = sanitizeMetadataDeep({
      count: 42,
      active: true,
      nested: null,
    });
    expect(result).toEqual({ count: 42, active: true, nested: null });
  });

  it('sanitises string values inside arrays', () => {
    const result = sanitizeMetadataDeep({
      tags: ['safe', 'injected\r\nvalue'],
    });
    expect(result).toEqual({ tags: ['safe', 'injectedvalue'] });
  });

  it('throws BadRequestException when metadata exceeds size limit', () => {
    const large = { data: 'x'.repeat(INPUT_METADATA_MAX_BYTES + 1) };
    expect(() => sanitizeMetadataDeep(large)).toThrow(BadRequestException);
  });

  it('accepts metadata exactly at the byte limit', () => {
    const value = 'x'.repeat(INPUT_METADATA_MAX_BYTES - '{"data":""}'.length);
    const result = sanitizeMetadataDeep({ data: value });
    expect(result).toHaveProperty('data');
  });

  it('handles deeply nested structures', () => {
    const result = sanitizeMetadataDeep({
      a: { b: { c: 'test\x00value' } },
    });
    expect(result).toEqual({ a: { b: { c: 'testvalue' } } });
  });
});
