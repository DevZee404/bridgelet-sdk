# Webhook Delivery Load Test

Simulates a burst of webhook subscription creation and deletion to verify the
delivery worker does not block or degrade the main API under load.

## Prerequisites

- Server running locally: `npm run start:dev`
- Valid integrator API key (replace `REPLACE_WITH_VALID_API_KEY` in the yml)

## Run

```bash
npx artillery run load-tests/webhooks-delivery-burst.yml
```

## Expected result

- API remains responsive throughout the burst (p99 < 500 ms)
- No 5xx errors from the webhook delivery worker
- Results documented following the same format as `accounts-create-burst.yml`

# Webhook Delivery Load Test
