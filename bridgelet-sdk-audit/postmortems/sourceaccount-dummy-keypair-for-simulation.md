# Postmortem: Dummy Keypair for Simulation
**Path:** `bridgelet-sdk-audit/postmortems/sourceaccount-dummy-keypair-for-simulation.md`

## Overview
Using a random dummy keypair as the source account for read-only simulation calls works well on testnets, but causes issues when simulating large transactions due to sequence number mismatches or minimum balance constraints on the dummy account.
## Fix
Adopted a static simulation account with high balance exclusively for read-only state checks.
