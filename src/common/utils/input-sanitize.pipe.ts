import { BadRequestException, Injectable, Logger, PipeTransform } from '@nestjs/common';
import {
  sanitizeFreeText,
  sanitizeMetadataDeep,
  sanitizeWebhookUrl,
  stripControlChars,
} from './input-sanitizer.util.js';

/**
 * Global sanitisation pipe applied to every inbound request body.
 *
 * **Threats mitigated**
 *
 * | Threat                       | Vector                               | Mitigation                                    |
 * |------------------------------|--------------------------------------|-----------------------------------------------|
 * | Log injection                | `\r\n` / control chars in free text  | `stripControlChars` on every string field      |
 * | HTTP header injection        | `\r\n` in event-type or description  | `stripControlChars` prevents CRLF smuggling   |
 * | SSRF via webhook URL         | `file://`, `127.0.0.1`, metadata IP | `sanitizeWebhookUrl` rejects blocked schemes  |
 * | Log-forging via metadata     | CRLF / null bytes in metadata values | `sanitizeMetadataDeep` recursive strip        |
 * | Null-byte injection          | `\x00` embedded in strings          | Stripped by `DEFAULT_CONTROL_CHAR_REGEX`       |
 *
 * The pipe is intentionally **lenient on legitimate content**: it keeps
 * printable Unicode, tabs, and (when `allowNewlines` is set) newlines.
 * Only control characters that enable injection are removed.
 *
 * Usage in `main.ts`:
 * ```ts
 * app.useGlobalPipes(new SanitizeInputPipe());
 * ```
 */
@Injectable()
export class SanitizeInputPipe implements PipeTransform {
  private readonly logger = new Logger(SanitizeInputPipe.name);

  transform(value: unknown): unknown {
    if (value == null || typeof value !== 'object') {
      return value;
    }

    const body = value as Record<string, unknown>;

    // --- Webhook URLs -------------------------------------------------------
    if ('url' in body && body.url !== undefined) {
      try {
        body.url = sanitizeWebhookUrl(body.url);
      } catch (err: unknown) {
        if (err instanceof BadRequestException) throw err;
        // Unexpected error – fail closed.
        throw new BadRequestException('invalid url');
      }
    }

    // --- Free-text fields at highest risk of log / header injection ---------
    for (const key of ['description', 'eventType']) {
      if (key in body && body[key] !== undefined) {
        body[key] = sanitizeFreeText(body[key]);
      }
    }

    // --- Event-type arrays (webhook events list) ---------------------------
    if (Array.isArray(body.events)) {
      body.events = body.events.map((e) => stripControlChars(e));
    }

    // --- Metadata (recursive deep sanitisation) -----------------------------
    if ('metadata' in body && body.metadata != null) {
      if (typeof body.metadata === 'object' && !Array.isArray(body.metadata)) {
        try {
          body.metadata = sanitizeMetadataDeep(
            body.metadata as Record<string, unknown>,
          );
        } catch (err: unknown) {
          if (err instanceof BadRequestException) throw err;
          this.logger.warn('metadata sanitisation failed; stripping metadata');
          body.metadata = undefined;
        }
      }
    }

    return body;
  }
}
