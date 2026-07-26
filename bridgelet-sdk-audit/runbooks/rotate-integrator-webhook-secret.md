# Rotating an Integrator's Webhook Secret

## Pre-requisites

- Ensure you have production database access with write privileges.
- Coordinate a maintenance window with the integrator (they will need to update their side simultaneously).

## Procedure

1. **Generate New Secret**
   Generate a new cryptographically secure secret (e.g. `openssl rand -hex 32`).

2. **Update Database**
   Update the integrator's record in the database with the new secret. Ensure it is encrypted at rest if applicable.

3. **Provide Secret Securely**
   Transmit the new secret to the integrator through a secure channel (e.g. 1Password or Keybase). DO NOT send over email or Slack.

4. **Verify Webhook Signatures**
   Trigger a test webhook payload to the integrator. Have them confirm that their system correctly verifies the new `X-Bridgelet-Signature` header using the new secret.

5. **Rollback (if needed)**
   If the integrator cannot verify the new signature, revert the database record to the old secret immediately, and investigate.
