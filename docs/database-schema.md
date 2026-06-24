# Database Schema

The current schema is created entirely through the migrations in `src/database/migrations/`.

## Tables

- `accounts`: stores ephemeral account lifecycle data, including encrypted secret material, funding metadata, expiry timestamps, and optional claim metadata.
- `claims`: stores completed claim records and references `accounts.id` through a cascading foreign key on `accountId`.
- `webhooks`: stores outbound webhook subscriptions and delivery metadata.

## Account Status Enum

`account_status_enum` currently contains these values, in order:

`initializing`, `pending_payment`, `pending_claim`, `claiming`, `claimed`, `expired`, `failed`

## Migration Verification

`src/database/migrations.integration.spec.ts` provisions a fresh embedded PostgreSQL database, applies every migration, verifies the resulting schema matches the TypeORM entity metadata, and checks that the `claims.accountId` foreign key is enforced.
