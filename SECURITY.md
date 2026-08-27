# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability.

If you discover a security vulnerability in the Bridgelet SDK, please report it responsibly. **Do not open a public GitHub issue for security vulnerabilities.**.

### How to Report

1. **Email**: Send a report to [aminubabafatima8@gmail.com](mailto:aminubabafatima8@gmail.com)
2. **Subject line**: Use the format `[SECURITY] Brief description of vulnerability`
3. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fix (if any)

### What to Include

- **Type of vulnerability**: e.g., injection, authentication bypass, information disclosure, denial of service
- **Affected component**: Contract, SDK, API, claim tokens, etc.
- **Attack vector**: How an attacker could exploit this
- **Severity assessment**: Your estimate of CVSS score or severity level (Critical/High/Medium/Low)

## Response SLA

| Severity | Initial Response | Fix Target |
| -------- | ---------------- | ---------- |
| Critical | 24 hours         | 72 hours   |
| High     | 48 hours         | 7 days     |
| Medium   | 5 business days  | 30 days    |
| Low      | 10 business days | 90 days    |

## Scope

The following components are in scope for security reports:

- **Smart contracts**: EphemeralAccount, SweepController (bridgelet-core)
- **SDK backend**: bridgelet-sdk (NestJS API, authentication, claim flow)
- **Claim tokens**: JWT generation, verification, and redemption
- **API key authentication**: Key hashing, validation, and rotation
- **Data handling**: Secret key encryption, database storage, webhook delivery

### Out of Scope

- Third-party dependencies (report these to the respective maintainers)
- Social engineering attacks
- Issues requiring physical access to production infrastructure

## Disclosure Policy

- We follow **coordinated disclosure**. Please give us reasonable time to fix the issue before any public disclosure.
- We will acknowledge receipt within the SLA timeframe.
- We will credit reporters in release notes (unless anonymity is requested).
- We will not pursue legal action against researchers who follow this policy.

## Security Best Practices for Contributors

- Never commit secrets, private keys, or API keys to the repository
- Use environment variables for all sensitive configuration
- All cryptographic operations must use established libraries (no hand-rolled crypto)
- Follow the principle of least privilege for API key scopes
- All authentication changes require security review before merge
