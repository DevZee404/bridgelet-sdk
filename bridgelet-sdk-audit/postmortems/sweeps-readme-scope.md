# Postmortem: Sweeps README Scope Mismatch

**Path:** `bridgelet-sdk-audit/postmortems/sweeps-readme-scope.md`

## Overview

The `src/modules/sweeps/README.md` file documented the sweeps module as a monolith, failing to explain the actual provider breakdown (e.g., NativeAuth vs. Relayer mechanisms). This caused confusion during integration.

## Fix

Updated the documentation to properly index the provider abstractions.
