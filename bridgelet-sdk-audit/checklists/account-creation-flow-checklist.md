# Ephemeral Account Creation Flow Review Checklist

## Security & Storage

- [ ] Are the seed/private keys for ephemeral accounts generated using a cryptographically secure random number generator?
- [ ] Are the keys securely temporarily stored and then wiped from memory/DB after their purpose is fulfilled?
- [ ] Are they correctly isolated per transaction/invoice?

## Network Interaction

- [ ] Is the account properly funded with the minimum reserve + transaction fee (e.g. `CreateAccount` operation)?
- [ ] Is there logic in place to handle network errors during the funding transaction?

## Cleanup

- [ ] Does the SDK properly initiate an `AccountMerge` operation after the ephemeral account's purpose is completed?
- [ ] Does the `AccountMerge` sweep all remaining XLM back to a cold/warm wallet?
