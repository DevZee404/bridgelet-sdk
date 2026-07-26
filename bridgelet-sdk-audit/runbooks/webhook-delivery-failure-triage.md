# Triaging Webhook Delivery Failures

## Overview

When the SDK fails to deliver a webhook to an integrator multiple times (triggering Dead Letter Queue or PagerDuty alerts), follow this process to diagnose and resolve.

## Steps

1. **Verify Integrator Endpoint**
   Use curl to send an empty `POST` to the integrator's registered webhook URL.
   - If HTTP 4xx/5xx: The integrator's server is down or misconfigured. Reach out to them.
   - If Timeout: Check if their firewall is blocking our NAT Gateway IP.

2. **Check Signature Mismatches**
   If the integrator returns HTTP 401/403:
   - Ask them to verify their secret matches the one registered in our database.
   - Verify that they are parsing the raw body correctly before signature calculation (frameworks like Express sometimes alter the raw body buffer).

3. **Re-queue Dead Letters**
   Once the issue is resolved on the integrator's end, manually trigger a redelivery of the failed webhooks from the DLQ.
