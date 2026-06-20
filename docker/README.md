# Docker Integration Harness

This container runs an isolated OpenClaw instance for Cernion Sidecar integration tests.

It uses:

- a dedicated OpenClaw profile, default `sidecar-it`
- an ephemeral container-local OpenClaw home under `/home/node`
- the Cernion Sidecar plugin from this repository
- a read-only bearer token mounted as `/run/secrets/cernion-readonly-token`
- the DevServer URL from `CERNION_BASE_URL`, default `http://10.0.0.8:3900`

It does not mount an operator workspace, OpenClaw memory, transcripts, or personal agent state.
Each `run --rm` smoke test starts from a clean OpenClaw home.

## Build

```bash
docker compose -f docker/compose.sidecar-it.yml build
```

## Smoke Test

Set `CERNION_READONLY_TOKEN_FILE` on the host to a local read-only token file:

```bash
CERNION_READONLY_TOKEN_FILE=/path/to/cernion-readonly-token \
docker compose -f docker/compose.sidecar-it.yml run --rm sidecar-it test
```

The smoke test validates:

- isolated OpenClaw config creation
- plugin installation and runtime inspection
- descriptor retrieval from the Cernion DevServer
- tool-list retrieval from the Cernion DevServer
- a read-only `cernion.list_readonly_capabilities` tool call

## Gateway

```bash
CERNION_READONLY_TOKEN_FILE=/path/to/cernion-readonly-token \
docker compose -f docker/compose.sidecar-it.yml up sidecar-it
```

The gateway listens on port `19101` by default.
