# Getting Started

This guide walks through setting up the Bridgelet SDK locally, from cloning the
repository to running the API and its test suite.

## Prerequisites

- **Node.js** (current LTS recommended — see `devDependencies` in `package.json`)
- **PostgreSQL** — the SDK persists accounts, claims and webhook deliveries to a
  local database
- **npm** (bundled with Node.js)

## 1. Clone and install

```bash
git clone https://github.com/bridgelet-org/bridgelet-sdk.git
cd bridgelet-sdk

npm install
```

## 2. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`:

- `NODE_ENV=development`
- `PORT=3000`
- `DATABASE_*` — point these at your local PostgreSQL instance
- `JWT_SECRET` — set a strong secret (never ship the placeholder value to
  production)

See [Environment Variables](../README.md#environment-variables) in the README
for the full list.

## 3. Run database migrations

The project uses scripted TypeORM migrations:

```bash
npm run migration:run
```

Migrations live in `src/database/migrations/` and are regenerated from
[`scripts/generate-migrations.sh`](../README.md#regenerating-the-migrations-folder).

## 4. Start the development server

```bash
npm run start:dev
```

The API will be available at `http://localhost:3000`. In development the
Swagger UI is served at `http://localhost:3000/api/docs` (it is disabled by
default in production — see [API Documentation](../README.md#api-documentation)).

## 5. Run the checks

```bash
# Unit tests
npm test

# Lint
npm run lint

# Format check
npm run format:check

# TypeScript build
npm run build

# Coverage (enforces project thresholds)
npm run test:cov
```

## Contributing

Before opening a pull request, read [CONTRIBUTING.md](../CONTRIBUTING.md),
which covers branch naming, PR title conventions and the development workflow.

## Further reading

- [API Reference](./api-reference.md)
- [Database Schema](./database-schema.md)
- [Webhook Events](./webhook-events.md)
- [Webhooks System](./webhooks.md)
