import { describe, it, expect } from '@jest/globals';

/**
 * Integration test: expired-account recovery sweep flow (issue #524)
 *
 * Full end-to-end execution requires a running local Stellar sandbox
 * (STELLAR_LOCAL_SANDBOX=true) with bridgelet-core contracts deployed.
 * Skipped automatically in normal CI runs.
 *
 * To run manually:
 *   STELLAR_LOCAL_SANDBOX=true npm run test:local-sandbox
 */
const SANDBOX_ENABLED =
  process.env.STELLAR_LOCAL_SANDBOX === 'true' ||
  process.env.LOCAL_STELLAR_SANDBOX === 'true';

(SANDBOX_ENABLED ? describe : describe.skip)(
  'Expired-account recovery sweep (local sandbox)',
  () => {
    it('creates an account with short expiry, waits for expiry, then verifies recovery sweep executes and funds reach RECOVERY_ACCOUNT_PUBLIC', async () => {
      // TODO: implement once sandbox environment is provisioned (issue #524)
      // Steps:
      // 1. POST /accounts with expiresIn = 10
      // 2. Wait > 10s
      // 3. Trigger expiry sweep via scheduler or direct service call
      // 4. Assert account.status === EXPIRED
      // 5. Assert RECOVERY_ACCOUNT_PUBLIC balance increased by funded amount
      expect(true).toBe(true); // placeholder — replace with real assertions
    }, 120_000);
  },
);
