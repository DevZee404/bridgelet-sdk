# What do the `MVP Note` comments in `stellar.service.ts` mean?

`MVP Note` comments are developer-authored flags for known limitations that are accepted for now in the MVP. They are not TODOs with an assigned owner, and they should not be read as promises that a particular code change is scheduled.

The two current instances are:

- **Account-creation atomicity:** Horizon account creation and Soroban initialization are separate transactions. A failure between them can leave an unrestricted funded account that needs manual recovery. See [Horizon-Soroban Non-Atomicity](../postmortems/horizon-soroban-non-atomicity.md).
- **Token-transfer completeness:** The current contract flow can update state and emit events without completing the expected token transfer. See [Stale Token Transfer Status](../postmortems/stale-token-transfer-mvp-note.md).

The practical takeaway is to treat these comments as living documentation. Re-verify them periodically with the [MVP Note Accuracy Checklist](../checklists/mvp-note-accuracy-checklist.md), especially after a `bridgelet-core` deployment or a refactor of the Stellar service layer.
