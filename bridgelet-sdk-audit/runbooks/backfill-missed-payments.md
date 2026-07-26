# Backfilling Missed Payments

## Context

If an ephemeral account received a payment in an asset other than the expected one (e.g., USDC instead of XLM), the primary payment monitor might miss it due to strict asset filtering, leaving the invoice in a pending state.

## Procedure

1. **Verify the Transaction on Chain**
   Ensure the user actually sent the payment to the correct ephemeral account, even if it was the wrong asset.

2. **Run the Backfill Script**
   Use the manual backfill tool, providing the specific transaction hash:

   ```bash
   npm run sdk:backfill -- --tx <TRANSACTION_HASH> --override-asset-check true
   ```

3. **Verify Downstream Processing**
   Check the database to ensure the payment is now recorded. If the amount in the wrong asset is insufficient, mark the invoice as `PARTIALLY_PAID` or `INVALID_ASSET` in the admin dashboard.
