# Contract Error-Mapping Completeness Checklist

## Standard Stellar Errors

- [ ] Are standard Stellar error codes (e.g. `tx_failed`, `op_no_destination`) mapped to standard SDK errors?
- [ ] Do mapped errors retain the original context for debugging?

## Custom Contract Errors

- [ ] Have we mapped all defined custom contract errors from the soroban contract ABI?
- [ ] Is there a fallback generic error handler for unknown contract errors?
- [ ] Do error messages clearly instruct developers on how to resolve the issue?

## Error Types and Hierarchy

- [ ] Do all custom errors extend a base `BridgeletError` class?
- [ ] Are error types easily distinguishable programmatically (e.g., using `code` or `type` properties)?
