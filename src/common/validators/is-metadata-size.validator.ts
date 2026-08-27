import { registerDecorator, ValidationOptions } from 'class-validator';
import { METADATA_MAX_BYTES } from '../utils/metadata-sanitizer.util.js';

/**
 * Rejects a metadata object that, when serialised, exceeds the shared
 * METADATA_MAX_BYTES limit defined in metadata-sanitizer.util.ts.
 *
 * This provides fail-fast, DTO-level validation with a clear error message so
 * oversized or abusive metadata never reaches the service or Stellar/Soroban
 * call layers.
 */
export function IsMetadataWithinSize(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMetadataWithinSize',
      target: object.constructor,
      propertyName,
      constraints: [METADATA_MAX_BYTES],
      options: {
        message: `metadata exceeds maximum allowed size of ${METADATA_MAX_BYTES} bytes`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (
            value === null ||
            value === undefined ||
            typeof value !== 'object'
          ) {
            // Non-object metadata is caught by @IsObject; treat as valid here.
            return true;
          }
          const serialised = JSON.stringify(value);
          return Buffer.byteLength(serialised, 'utf8') <= METADATA_MAX_BYTES;
        },
      },
    });
  };
}
