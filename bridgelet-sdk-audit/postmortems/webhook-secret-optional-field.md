# Postmortem: Webhook Secret as an Optional Field with No Entropy Enforcement

**Path:** `bridgelet-sdk-audit/postmortems/webhook-secret-optional-field.md`
**Component:** SDK Webhook Module

---

## 1. Incident Overview
During a routine security audit of the SDK's webhook handling utilities, it was discovered that the `webhookSecret` configuration parameter was set as an optional field. Furthermore, when a secret was provided, the SDK did not enforce any minimum length or entropy checks. 

This oversight could allow integrators to deploy webhooks with easily guessable secrets (or no secrets at all), leaving their backend systems vulnerable to spoofed webhook payloads mimicking legitimate Bridgelet sweeping events.

## 2. Root Cause Analysis
- **Missing Validation Schema:** The TypeScript interface `WebhookConfig` marked `webhookSecret?: string`. 
- **Graceful Degradation Fallback:** If the secret was omitted, the SDK's payload verification middleware automatically bypassed signature validation, assuming it was running in a "development" or "unauthenticated" mode. There was no explicit flag (e.g., `unsafeDevMode`) required to trigger this bypass.
- **Lack of Entropy Checks:** The validation logic simply checked `if (webhookSecret) { ... }`, meaning secrets like `"test"`, `"123"`, or `"secret"` were accepted as valid cryptographic keys for HMAC generation.

## 3. Impact Assessment
- **Spoofing Risk (High):** Without a verified HMAC signature, an attacker could send arbitrary JSON payloads to an integrator's webhook endpoint.
- **Data Integrity:** The backend might process spoofed `SweepCompleted` events, crediting users with tokens that were never actually swept on the Soroban network.
- **Scope:** This vulnerability did not affect the core smart contracts, but it put all backend integrations relying on the SDK's default webhook middleware at significant risk.

## 4. Remediation & Action Items

### Immediate Fixes
1. **Mandatory Field:** Updated `WebhookConfig` to make `webhookSecret` a required string (`webhookSecret: string`).
2. **Entropy Enforcement:** Introduced a minimum length requirement of 32 characters for the `webhookSecret` during SDK initialization. If the secret fails this check, the SDK throws an `InvalidConfigurationError`.

### Code Example (Mitigated)
```typescript
if (!config.webhookSecret || config.webhookSecret.length < 32) {
    throw new InvalidConfigurationError(
        "Webhook secret must be provided and contain at least 32 characters for cryptographic security."
    );
}
```

### Process Improvements
- **Strict Mode Defaults:** All SDK components that interface with external networks or cryptographic operations will default to strict security enforcement. "Dev mode" bypasses must be explicitly enabled via distinct configuration flags that log aggressive warnings.
- **Security Checklists:** Added webhook security to the mandatory integration checklist provided in the official documentation.
