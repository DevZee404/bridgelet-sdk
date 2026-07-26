import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a controller or route handler as publicly accessible.
 * When `ApiKeyAuthGuard` is registered as a global guard via `APP_GUARD`,
 * routes decorated with `@Public()` skip API key validation.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
