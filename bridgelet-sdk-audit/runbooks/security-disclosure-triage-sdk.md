# Triaging an Incoming Security Disclosure

## Initial Assessment

- Acknowledge receipt of the report within 24 hours.
- Verify the vulnerability against the currently supported SDK versions (`main` branch and active release branches).

## Severity Classification

- Use CVSS v3.1 to score the vulnerability.
- **Critical/High**: Immediate mobilization of the core engineering team. Out-of-band patch required.
- **Medium/Low**: Schedule for the next regular patch release.

## Remediation & Patching

- Develop the fix in a private fork of the SDK. Do NOT push fixes to public branches until the embargo lifts.
- Write tests that specifically reproduce the vulnerability and verify the fix.

## Disclosure & Release

- Draft a GitHub Security Advisory (GHSA) and request a CVE if applicable.
- Notify integrators privately if they are highly impacted prior to public release.
- Publish the patch release, merge the private fork, and publish the GHSA simultaneously.
