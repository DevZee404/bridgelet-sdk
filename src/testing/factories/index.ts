/**
 * Central export barrel for all test data factories.
 *
 * Import from here to avoid relative-path churn if a factory moves:
 *
 *   import { makeAccount, makeClaim, makeWebhook } from '../testing/factories/index.js';
 */

export * from './account.factory.js';
export * from './claim.factory.js';
export * from './webhook.factory.js';
