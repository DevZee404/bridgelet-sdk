# Webhooks System Documentation

## Overview

The `WebhooksService` (`src/modules/webhooks/webhooks.service.ts`) delivers real-time HTTP POST notifications to registered webhook endpoints for ephemeral account and sweep events.

## Supported Events

- `account.created`: Triggered when an ephemeral account is provisioned and funded.
- `account.expired`: Triggered when an ephemeral account expires.
- `sweep.completed`: Triggered when funds are successfully swept to a destination.
- `sweep.partial`: Triggered when smart contract authorization succeeds but Horizon transfer fails.
- `sweep.failed`: Triggered when sweep execution fails completely.

## Signature Verification

Payloads are signed using HMAC-SHA256. Every outgoing webhook request includes the following header:

```http
X-Bridgelet-Signature: sha256=<hex_digest>
X-Bridgelet-Event: <event_type>
X-Bridgelet-Delivery-Id: <delivery_uuid>
Content-Type: application/json
```

To verify the signature on your receiving server, compute the HMAC-SHA256 of the raw request body using your configured webhook secret key and compare it against the `X-Bridgelet-Signature` header.

## Idempotency

The `X-Bridgelet-Delivery-Id` header contains a unique UUID for each webhook delivery. If a webhook is retried, the delivery ID will remain the same. Subscribers can use this header to deduplicate events and ensure that they are only processed once.

## Pagination

The `GET /webhooks` and `GET /webhooks/:id/deliveries` endpoints support cursor-based pagination. Use the `limit` and `cursor` query parameters to paginate through the results.

- `limit`: The maximum number of results to return. Defaults to 25.
- `cursor`: The cursor to start from. This should be the `createdAt` timestamp of the last item in the previous response.

## Delivery Logs

The `GET /webhooks/:id/deliveries` endpoint allows you to list the delivery history for a specific webhook. In addition to pagination, you can also filter the results by the following query parameters:

- `eventType`: Filter by a specific event type.
- `success`: Filter by successful or failed deliveries.
- `fromDate`: Filter by a start date.
- `toDate`: Filter by an end date.

## Retry Policy & Delivery Logs

- **Retries**: Retries up to 3 times with exponential backoff on HTTP non-2xx responses or network errors.
- **Audit Logging**: Every delivery attempt is logged in the `webhook_deliveries` table with subscription ID, event type, payload hash, attempt count, last response code, last response body, and delivered timestamp.
