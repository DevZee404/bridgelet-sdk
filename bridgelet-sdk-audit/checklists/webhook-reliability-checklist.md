# Webhook Delivery Reliability Checklist

## Dead Letter Queue (DLQ)

- [ ] Are failed webhook deliveries automatically pushed to a DLQ?
- [ ] Is there an automated or manual retry mechanism for the DLQ?
- [ ] Are exponential backoff strategies implemented for retries?

## Timeout and Responses

- [ ] Is there a strict timeout on webhook delivery HTTP requests (e.g., 5 seconds)?
- [ ] Are non-2xx responses handled as failures?

## Security

- [ ] Are webhook payloads signed with a shared secret?
- [ ] Is the signature header properly documented for integrators?
