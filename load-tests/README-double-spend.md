# Double-Spend Race Load Test

This test fires many concurrent redemption requests for the **same single claim token**.
Exactly one request should succeed (HTTP 200/201); all others must receive a clear
already-claimed rejection (HTTP 409 or 400). No double-sweep should occur.

## Setup

1. Start the server locally: `npm run start:dev`
2. Seed a single account in `PENDING_CLAIM` state and note its claim token.
3. Replace `claimToken` in `claims-double-spend-burst.yml` with the actual token.
4. Run: `npx artillery run load-tests/claims-double-spend-burst.yml`

## Expected result

- Exactly 1 response with HTTP 2xx
- All other responses: 4xx (already claimed)
- Zero duplicate sweep transactions on-chain

Results serve as part of the security audit trail for the double-spend race condition.
