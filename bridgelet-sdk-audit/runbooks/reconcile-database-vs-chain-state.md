# Reconciling Database vs Chain State

## Overview

Due to transient network failures or SDK crashes, the internal database (e.g., recorded payments or account balances) might drift from the actual on-chain state on the Stellar network.

## Procedure

1. **Pause Ingestion**
   Temporarily pause the SDK's payment monitors/webhooks to ensure state doesn't mutate while reconciling.

2. **Run the Reconciliation Script**
   Execute the built-in reconciliation tool:

   ```bash
   npm run sdk:reconcile -- --ledger <LAST_KNOWN_GOOD_LEDGER>
   ```

3. **Analyze the Diff**
   The script will output a JSON file containing the discrepancies.
   - Look for missing payments (exist on chain, not in DB).
   - Look for false positives (exist in DB, but transaction actually failed on chain).

4. **Apply Fixes**
   For missing payments, use the script's backfill command:

   ```bash
   npm run sdk:reconcile:apply --file diff.json
   ```

   For false positives, manually reverse the downstream actions (e.g. deduct balances) and mark the DB record as `FAILED_ON_CHAIN`.

5. **Resume Ingestion**
   Once the state is verified, restart the payment monitors.
