# Instance Storage TTL

This document explains how Soroban's `extendFootprintTTL` is used to keep ephemeral accounts alive.

## `extendFootprintTTL`

`extendFootprintTTL` is a Soroban host function that extends the lifetime of a contract's instance data. This function is the on-chain mechanism that allows an ephemeral account to remain active beyond its initial expiry.

This function is called by `EphemeralAccount.touch()`, which is invoked by the bridgelet to prevent the ephemeral account from expiring.

## Off-chain Expiry Handling

For details on how the off-chain side of expiry is handled, including how the initial expiry is calculated, please refer to the [expiry-ledger-conversion.md](expiry-ledger-conversion.md) glossary entry.
