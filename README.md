# Cernion Energy Sidecar OpenClaw Plugin

OpenClaw tool plugin for generic Energy Sidecar providers, with Cernion as the first provider.

The plugin consumes the Cernion Sidecar contract implemented by Cernion Energy Tools:

- `GET /api/agent-sidecar/descriptor`
- `GET /api/agent-sidecar/mcp/tools`
- `POST /api/agent-sidecar/mcp/tools/:name/call`
- `POST /api/agent-sidecar/mcp/tools/cernion.ask/call`
- `GET /api/_agent/capabilities[?domain=]`
- `GET /api/_agent/capabilities/:name`
- `GET /api/_agent/operations[?domain=]`

The Cernion provider remains the policy owner. This plugin stores host-side configuration, discovers tools, and forwards calls through the read-only/advisory provider boundary. It does not implement Cernion domain logic and must not expose write/admin/token/HITL-resolve actions.

`cernion.ask` is the generic learning/compile boundary for OpenClaw. It may return a direct read-only REST execution plan that was selected by Cernion's Blueprint/Capability runtime. OpenClaw can then ask this plugin to proxy that plan against the configured Cernion `baseUrl` without learning tokens or hard-coding domain routing in the Sidecar.

## Tools

- `cernion_sidecar_descriptor` loads the generic Energy Sidecar descriptor.
- `cernion_sidecar_tools` loads the MCP/OpenClaw-like tool list.
- `cernion_sidecar_call` calls one curated Cernion provider tool through the provider policy gate.
- `cernion_ask` calls the generic `cernion.ask` provider tool and returns structured answers, evidence, capability/blueprint hints, and optional read-only REST execution plans.
- `cernion_resolve_capabilities` resolves llm.txt capability cluster heads to full capability details, optionally filtered by `domain`.
- `cernion_resolve_capability` resolves a single capability id to full detail.
- `cernion_resolve_operations` resolves manifest operation clusters to deduplicated operation details, optionally filtered by `domain`.
- `cernion_execute_rest_plan` proxies one GET-only REST execution plan emitted by Cernion. It validates that the plan is a relative `/api/` path and blocks admin/auth/token/HITL-resolve/provider-tool recursion paths.
- `cernion_api_request` performs an authenticated read-only GET against Cernion for fallback resolution or domain data queries.

`cernion_resolve_operations` uses the provider's canonicalized operation list: duplicate `operationId` entries that appear under trailing-slash or service-prefix aliases are returned once with a canonical path and an `aliases` list.

The provider tool names currently exposed by Cernion are:

- `cernion.ask`
- `cernion.answer_dossier`
- `cernion.recommend_capability`
- `cernion.list_readonly_capabilities`
- `cernion.get_evidence_status`

## Configuration

Configure through OpenClaw plugin settings or environment variables:

- `baseUrl` or `CERNION_BASE_URL`: Cernion base URL, for example `https://cernion.example`.
- `bearerToken` or `CERNION_READONLY_TOKEN`: read-only Cernion Sidecar token.
- `bearerTokenEnv`: optional alternate token environment variable name.
- `bearerTokenFile` or `CERNION_READONLY_TOKEN_FILE`: optional path to a local file containing the read-only token.
- `allowRestProxy` or `CERNION_ALLOW_REST_PROXY`: optional switch for `cernion_execute_rest_plan`, default enabled. Set to `false`, `0`, `no`, or `off` to disable.
- `timeoutMs`: optional HTTP timeout, default `15000`.

Store the token as an OpenClaw secret. The token is sent only as an `Authorization: Bearer ...` header and is scrubbed from returned payloads if a provider accidentally echoes it.

## Local Development

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```

## Integration Test Container

The repository includes a Docker-based OpenClaw integration harness under `docker/`.
It runs with an isolated OpenClaw home and profile, installs this plugin, and points
only at the configured Cernion Sidecar provider.

```bash
CERNION_READONLY_TOKEN_FILE=/path/to/cernion-readonly-token \
docker compose -f docker/compose.sidecar-it.yml run --rm sidecar-it test
```

The token file is mounted read-only as `/run/secrets/cernion-readonly-token`.
No operator workspace, memory, transcripts, or personal OpenClaw state are mounted.

## Local Install

From this directory:

```bash
openclaw plugins install .
```

Or from GitHub:

```bash
openclaw plugins install https://github.com/SmartEnergySolutions/cernion-openclaw-sidecar
```

Then configure:

```bash
export CERNION_BASE_URL="https://cernion.example"
export CERNION_READONLY_TOKEN_FILE="$HOME/.config/cernion/readonly-token"
```

The token file should contain only the bearer token and should be readable only by the OpenClaw runtime user, for example mode `0600`.

## Boundaries

Allowed:

- read-only/advisory tool discovery
- calls to the five curated Cernion Sidecar tools
- resolve calls to the Cernion agent manifest endpoints
- generic `cernion.ask` calls where Cernion decides capabilities, blueprints, routing, policies, and evidence
- GET-only proxy execution of Cernion-issued REST plans against the configured provider `baseUrl`
- structured propagation of `sidecar_policy_blocked`

Blocked:

- Full Cernion OpenAPI export
- write/admin/token/HITL-resolve actions
- Sidecar-owned domain routing such as hard-coded MaStR asset tools
- arbitrary external URLs or non-`/api/` REST proxy paths
- production mutation
- secrets in descriptors, logs, or tool responses
- OpenClaw workspace coupling inside Cernion
