# Secrets and Key Handling Checklist

## Secure Storage

- [ ] Are signing keys stored exclusively in encrypted environment variables or a secure KMS?
- [ ] Is there strict separation between development, staging, and production keys?
- [ ] Do any hardcoded keys exist in the codebase? (Must be strictly prohibited)

## In-Memory Handling

- [ ] Are keys cleared from memory as soon as they are used?
- [ ] Is the SDK immune to leaking keys in stack traces or logs?
- [ ] Are we using secure buffers for cryptographic operations?

## Transmission

- [ ] Are keys never transmitted over the network (only signatures)?
- [ ] If keys must be imported, is the channel TLS-secured?

## Auditing and Rotation

- [ ] Is there an established procedure for key rotation?
- [ ] Are there access logs for environments containing keys?
