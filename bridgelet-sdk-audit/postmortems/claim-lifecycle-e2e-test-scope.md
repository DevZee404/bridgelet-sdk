# Postmortem: Claim Lifecycle E2E Test Scope
**Path:** `bridgelet-sdk-audit/postmortems/claim-lifecycle-e2e-test-scope.md`

## Overview
The existing claim-lifecycle E2E test claimed to exercise the entire sweep process, but in reality, it only covered the relayer submission path, entirely missing the direct-user native auth claim flow.
## Fix
Expanded the E2E test suite to explicitly mock and assert both the relayer and the direct native-auth claim flows to ensure full coverage.
