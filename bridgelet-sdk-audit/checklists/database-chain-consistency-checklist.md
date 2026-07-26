# Database-vs-Chain Consistency Checklist

## Single Source of Truth

- [ ] Is the blockchain considered the ultimate source of truth in case of discrepancies?
- [ ] Are database records strictly derived from confirmed on-chain events?

## Reconciliation

- [ ] Is there an automated or manual script to audit database balances against on-chain contract state?
- [ ] Does the SDK detect missed events due to Horizon pagination errors?

## Event Logs

- [ ] Are all database mutations properly recorded with the triggering transaction hash?
- [ ] Is it possible to safely replay historical transactions to rebuild the database state?
