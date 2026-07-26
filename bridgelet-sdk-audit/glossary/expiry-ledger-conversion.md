# Wall-clock expiry to ledger-sequence conversion

This document explains how `StellarService.toExpiryLedger()` converts a wall-clock duration (in seconds) into a ledger sequence number. This conversion is used by `EphemeralAccount.initialize()` to set the expiry of an ephemeral account on the Stellar network.

## Conversion Logic

The conversion from a time-based duration to a ledger-based expiry relies on two key components:

1.  **5-second-per-ledger assumption:** The Stellar network aims for a new ledger every 5 seconds. `StellarService.toExpiryLedger()` uses this assumption to estimate the number of ledgers that will close during a given time duration.

2.  **`EXPIRY_BUFFER_LEDGERS`:** A constant buffer of 10 ledgers is added to the calculated ledger count. This buffer accounts for potential network latency and ensures that the ephemeral account does not expire prematurely.

The conversion happens only once, at the time of account creation, and the resulting ledger number is stored on-chain. It is not re-evaluated afterward.

## On-chain Expiry Handling

For details on how the on-chain side of expiry is handled, please refer to the `instance-storage-ttl.md` glossary entry in the `bridgelet-audit` repository.
