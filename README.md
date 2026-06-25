# Cernion Energy Tools Sidecar for OpenClaw

Dedicated OpenClaw tool plugin for Cernion Energy Tools.

Cernion Energy Tools is a Swiss Army Knife for energy questions: it combines
asset inventories, MaStR evidence, grid context, regulatory/procedural
knowledge, process intake, and read-only operational APIs into one fachliche
evidence layer. The Sidecar makes that layer available inside OpenClaw so an
energy-domain assistant can answer with Cernion-backed facts instead of generic
model memory.

The plugin is the ideal fachliche companion for people working in the energy
sector: grid planning, asset-MDM, Redispatch, Zielnetzplanung, §14a/§14d,
market communication, storage/PV/load siting, and operational readiness checks.

The plugin consumes the Cernion Sidecar contract implemented by Cernion Energy Tools:

- `GET /api/agent-sidecar/descriptor`
- `GET /api/agent-sidecar/mcp/tools`
- `POST /api/agent-sidecar/mcp/tools/:name/call`
- `POST /api/agent-sidecar/mcp/tools/cernion.ask/call`
- `POST /api/knowledge-rag/query`
- `POST /api/evidence-router/route`
- `POST /api/copilot-process/intents`
- `GET /api/_agent/capabilities[?domain=]`
- `GET /api/_agent/capabilities/:name`
- `GET /api/_agent/operations[?domain=]`

The Cernion provider remains the policy owner. This plugin stores host-side configuration, discovers tools, and forwards calls through separated provider boundaries:

- read-only evidence lookup/execution, using the read-only Cernion token
- read-only regulatory and procedural knowledge lookup through Cernion Knowledge RAG
- process intake, using a separate process token and creating only `pending_confirmation` receipts

It does not implement Cernion domain logic and must not expose admin/token/HITL-resolve actions. Cernion Energy Tools remains the source of truth for capabilities, policies, evidence semantics, and executable read-only REST plans.

`cernion.ask` is the generic learning/compile boundary for OpenClaw. It may return a direct read-only REST execution plan that was selected by Cernion's Blueprint/Capability runtime. OpenClaw can then ask this plugin to proxy that plan against the configured Cernion `baseUrl` without learning tokens or hard-coding domain routing in the Sidecar.

## Tools

- `cernion_sidecar_descriptor` loads the Cernion Energy Tools Sidecar descriptor.
- `cernion_sidecar_tools` loads the MCP/OpenClaw-like tool list.
- `cernion_sidecar_call` calls one curated Cernion provider tool through the provider policy gate.
- `cernion_query_domain_knowledge` queries Cernion Knowledge RAG for regulatory, procedural, and fachliche evidence such as laws, BNetzA guidance, Verfahrensanweisungen, roles, obligations, definitions, and job-help context. It starts the async Knowledge RAG job, waits briefly for the result, and returns an `evidenceAssessment`. This assessment describes primary-source support for hard legal/procedural claims, not the value of Cernion domain knowledge itself. If `evidenceAdequacy` is `low`, OpenClaw should say that Cernion returned useful domain/strategy knowledge but not enough primary-source support for hard obligations.
- `cernion_query_grid_context` queries Cernion OSM Geo for visible grid infrastructure context such as substations, transformers, voltage-level hints, lines, and topology metrics. Use it for ZNP, Netzanschluss, data-center/PV/BESS/HPC siting, fNAV, and likely critical voltage-level hypotheses. For broad county or region searches, query substations first and enable full topology only for candidate-place drill-down. Treat the result as OSM-based hypothesis evidence, not as a capacity proof or complete grid-operator asset model. For data centers and other large loads, explicit grid-connection availability maps, published capacity, and operator-confirmed Anschlusskapazität outrank generic grid-expansion or OSM proximity evidence.
- `cernion_route_evidence` calls Cernion's backend Evidence Router and returns read-only endpoint recommendations plus result semantics.
- `cernion_execute_evidence_endpoint` executes one GET or POST read-only endpoint recommended by `cernion_route_evidence`, requiring `policy.readOnly=true` and `sideEffects=none`. For `/api/assets...` GETs, the Sidecar sets an explicit default `limit=500` when no limit is supplied and adds `_sidecar` pagination/export guidance when the returned rows exhaust the requested limit.
- `cernion_prepare_process_intent` calls Cernion's separate Process Intake boundary and creates only a `pending_confirmation` receipt. It uses a separate process token.
- `cernion_ask` calls the generic `cernion.ask` provider tool and returns structured answers, evidence, capability/blueprint hints, and optional read-only REST execution plans.
- `cernion_resolve_capabilities` resolves llm.txt capability cluster heads to full capability details, optionally filtered by `domain`.
- `cernion_resolve_capability` resolves a single capability id to full detail.
- `cernion_resolve_operations` resolves manifest operation clusters to deduplicated operation details, optionally filtered by `domain`.
- `cernion_execute_rest_plan` proxies one GET-only REST execution plan emitted by Cernion. It validates that the plan is a relative `/api/` path and blocks admin/auth/token/HITL-resolve/provider-tool recursion paths. Asset-list GETs receive explicit limit and pagination/export guidance.
- `cernion_api_request` performs an authenticated read-only GET against Cernion for fallback resolution or domain data queries. Asset-list GETs receive explicit limit and pagination/export guidance.

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
- `processBearerToken` or `CERNION_PROCESS_TOKEN`: separate Cernion token for `cernion_prepare_process_intent`.
- `processBearerTokenEnv`: optional alternate process-token environment variable name.
- `processBearerTokenFile` or `CERNION_PROCESS_TOKEN_FILE`: optional path to a local file containing the process token.
- `allowRestProxy` or `CERNION_ALLOW_REST_PROXY`: optional switch for `cernion_execute_rest_plan`, default enabled. Set to `false`, `0`, `no`, or `off` to disable.
- `timeoutMs`: optional HTTP timeout, default `15000`.

Store the token as an OpenClaw secret. The token is sent only as an `Authorization: Bearer ...` header and is scrubbed from returned payloads if a provider accidentally echoes it.

## Asset Lists, Pagination, and Exports

Cernion asset endpoints can return large MaStR-backed lists. The Sidecar does
not let those lists silently fall back to the provider default limit:

- for `/api/assets...` GET requests without `limit`, it sends `limit=500`;
- when returned rows exhaust the requested limit, it adds `_sidecar.assetListPagination`;
- the metadata includes `nextPage` parameters and CSV/XLS `exportOptions`;
- assistants must not present the returned rows as complete when
  `_sidecar.assetListPagination.limitExhausted=true` or `hasMore=true`.

Example guidance for a user-facing answer:

```text
Cernion returned 500 rows for the current asset query, which exhausts the requested limit. I can continue with the next page or retrieve the complete list as CSV/XLS.
```

## Local Development

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
```

## Docker Demo Container

The repository includes a Docker-based OpenClaw demo under `docker/`. It starts
OpenClaw with this plugin installed and exposes the browser Control UI on
`http://localhost:19101`.

```bash
cp docker/.env.example docker/.env
# edit docker/.env: CERNION_BASE_URL, CERNION_TOKEN, OPENCLAW_MODEL, OPENCLAW_THINKING, and a model-provider key
docker compose --env-file docker/.env -f docker/compose.yml up --build
```

The demo accepts `CERNION_BASE_URL`, `CERNION_TOKEN`,
`CERNION_READONLY_TOKEN`, and `CERNION_PROCESS_TOKEN` through environment
variables. No operator workspace, memory, transcripts, or personal OpenClaw
state are mounted.

See [docker/README.md](docker/README.md) for the full end-user walkthrough,
including the Cernion demo workspace profile and the Meckesheim self-supply
example prompt.

## Local Install

From this directory:

```bash
openclaw plugins install .
```

Or from GitHub:

```bash
openclaw plugins install https://github.com/SmartEnergySolutions/cernion-openclaw-sidecar
```

Or from npm after publication:

```bash
openclaw plugins install @cernion/openclaw-energy-tools-sidecar
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
- calls to curated Cernion Sidecar tools
- read-only Knowledge RAG queries for regulatory and procedural domain evidence
- read-only OSM Geo grid-context queries for ZNP and Netzanschluss hypotheses
- read-only Evidence Router calls and execution of router-recommended GET/POST evidence endpoints
- Process Intake creation of `pending_confirmation` receipts through a separate process-token boundary
- resolve calls to the Cernion agent manifest endpoints
- generic `cernion.ask` calls where Cernion decides capabilities, blueprints, routing, policies, and evidence
- GET-only proxy execution of Cernion-issued REST plans against the configured provider `baseUrl`
- structured propagation of `sidecar_policy_blocked`

Blocked:

- Full Cernion OpenAPI export
- admin/token/HITL-resolve actions
- process execution or HITL resolution after Process Intake
- Sidecar-owned domain routing such as hard-coded MaStR asset tools
- arbitrary external URLs or non-`/api/` REST proxy paths
- production mutation
- secrets in descriptors, logs, or tool responses
- OpenClaw workspace coupling inside Cernion

## Publishing

The package name is `@cernion/openclaw-energy-tools-sidecar`. Publishing under
that scope requires:

- access to the `@cernion` npm organization or user scope;
- an npm automation token stored as `NPM_TOKEN` for GitHub Actions;
- 2FA/provenance settings compatible with the selected npm release policy;
- a release tag such as `v0.1.0`.

Release checks should pass before publishing:

```bash
npm ci
npm run build
npm test
npm run plugin:validate
npm pack --dry-run
```
