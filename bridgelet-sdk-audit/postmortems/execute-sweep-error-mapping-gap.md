# Postmortem: executeSweep() Error Mapping Gap

## Issue Summary

When `executeSweep()` failed due to an invalid signature or missing authorization, the SDK mapped the error to a generic `ContractExecutionError` instead of the specific `AuthorizationFailed` error type, breaking downstream error handling logic.

## Root Cause

The Soroban error codes for authorization failures (e.g., `Error(WasmVm, InvalidAction)`) were missing from the SDK's `ErrorMapper` utility. As a result, the default `catch-all` block consumed the error and threw the generic base class.

## Resolution

Updated the `ErrorMapper` dictionary to comprehensively map all Soroban authorization, signature, and host-function level error codes to the `AuthorizationFailed` error class. Added integration tests to enforce this mapping for simulated auth failures.
