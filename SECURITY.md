# Security Policy

## Supported Versions

Security fixes are currently prepared on `main` until the first public release is tagged.

## Reporting a Vulnerability

Do not open public issues for secrets, token exposure, authentication bypasses, policy-boundary bypasses, or unintended write/process execution.

Report security concerns privately to the Cernion maintainers through the configured project security channel or by contacting the repository owner directly. Include:

- affected Sidecar version or commit;
- OpenClaw version;
- Cernion Energy Tools base version if known;
- minimal reproduction steps;
- whether any token, tenant data, or process action was exposed.

## Security Boundaries

The Sidecar must preserve these boundaries:

- read-only evidence calls use the read-only Cernion token;
- process intake uses a separate process token and creates only pending-confirmation receipts;
- admin, auth, token, secret, HITL-resolve, and provider-tool recursion paths are blocked from read-only REST execution;
- bearer tokens must not be returned in tool payloads, logs, descriptors, or error envelopes;
- Cernion Energy Tools remains the policy owner for capabilities, evidence semantics, and process execution.
