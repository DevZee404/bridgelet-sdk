# Postmortem: ConfigService getOrThrow Fail-Fast Pattern
**Path:** `bridgelet-sdk-audit/postmortems/config-getorthrow-fail-fast-pattern.md`

## Overview
The contract-consumption layer incorrectly caught configuration errors silently instead of failing fast using `ConfigService.getOrThrow`. This masked missing environment variables until deeply nested contract calls failed with opaque errors.
## Fix
Enforced the fail-fast pattern by utilizing `getOrThrow` uniformly across all provider initializations.
