# Contributing

This repository contains the dedicated Cernion Energy Tools Sidecar for OpenClaw.

## Development

```bash
npm ci
npm run build
npm test
npm run plugin:validate
```

## Design Rules

- Keep Cernion Energy Tools as the provider and policy owner.
- Do not hard-code new domain routing in the Sidecar when Cernion can expose it through `cernion.ask`, the Evidence Router, capabilities, or operation manifests.
- Keep read-only evidence and process-intake boundaries separate.
- Never add admin, auth, token, secret, HITL-resolve, provider-tool recursion, or mutation paths to read-only REST execution.
- Scrub bearer tokens from all returned payloads and errors.
- Update README, tests, and `dist/` for user-visible tool or package changes.

## Release Checklist

- `npm ci`
- `npm run build`
- `npm test`
- `npm run plugin:validate`
- `npm pack --dry-run`
- update `CHANGELOG.md`
- tag the release
