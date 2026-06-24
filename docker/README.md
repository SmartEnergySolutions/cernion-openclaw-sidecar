# OpenClaw + Cernion Sidecar Docker Demo

This directory contains a self-contained OpenClaw container with the Cernion
Energy Sidecar plugin preinstalled. It is meant for interested users who have
access to a Cernion Energy Tools instance and want to try the OpenClaw/Cernion
interaction from a browser.

The container starts an OpenClaw Gateway and Control UI. Cernion connection
settings are supplied through environment variables.

## What Runs

- OpenClaw Gateway and browser Control UI
- this repository's `cernion-energy-sidecar` plugin
- an isolated OpenClaw profile, default `cernion-demo`
- an isolated container home mounted in the Docker volume
  `openclaw-cernion-home`

The container does not mount your personal OpenClaw workspace, memory,
transcripts, or host secrets.

## Requirements

- Docker with Docker Compose
- a reachable Cernion Energy Tools base URL, for example
  `https://cernion.example`
- a Cernion bearer token
- model credentials for any OpenClaw-supported provider, or model
  configuration added later in the Control UI

For a quick demo, set one token:

- `CERNION_TOKEN`: used for read-only evidence lookup and process-intake demos

For a stricter setup, set two tokens:

- `CERNION_READONLY_TOKEN`: read-only/evidence token
- `CERNION_PROCESS_TOKEN`: process-intake token

If your Cernion instance currently requires full-access for
`POST /api/evidence-router/route`, use a full token as `CERNION_TOKEN` for the
demo. Cernion still owns the server-side policy checks.

## Configure

From the repository root:

```bash
cp docker/.env.example docker/.env
```

Edit `docker/.env`:

```dotenv
CERNION_BASE_URL=https://cernion.example
CERNION_TOKEN=ck_your_cernion_token_here
OPENCLAW_MODEL=google/gemini-3.1-pro-preview
OPENCLAW_THINKING=adaptive
OPENCLAW_CONTROLUI_PORT=19101
OPENCLAW_GATEWAY_TOKEN=cernion-local-demo
```

Add model provider credentials for your OpenClaw setup as needed. The Compose
file forwards `docker/.env` into the container, so provider variables such as
`GOOGLE_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
other OpenClaw-supported provider settings can live in the same file.

`OPENCLAW_MODEL` selects the model for the demo agent. If it is omitted, the
container auto-selects a matching default for common provider keys:

- `GOOGLE_API_KEY` or `GEMINI_API_KEY` -> `google/gemini-3.1-pro-preview`
- `ANTHROPIC_API_KEY` -> `anthropic/claude-sonnet-4-6`
- `OPENAI_API_KEY` -> `openai/gpt-5.5`

`OPENCLAW_THINKING` controls the demo agent's thinking level. For the
Meckesheim example, keep `adaptive` or use a stronger level if your selected
model supports it. Smaller flash models and low/adaptive reasoning can be fine
for connection smoke tests, but they may answer from generic web-like priors
instead of doing enough tool-backed aggregation.

The Sidecar itself does not depend on a specific model provider.

## Start

```bash
docker compose --env-file docker/.env -f docker/compose.yml up --build
```

Open the Control UI in your browser:

```text
http://localhost:19101
```

If you changed `OPENCLAW_CONTROLUI_PORT`, use that port instead.
When prompted for Gateway authentication, use the value of
`OPENCLAW_GATEWAY_TOKEN` from `docker/.env`.

The Compose file binds the Control UI to `127.0.0.1` on the host. Keep it that
way for local demos. If you intentionally expose it beyond your own machine,
set a strong `OPENCLAW_GATEWAY_TOKEN` first.

## First Question

Use this question as the first demo prompt in the Control UI:

```text
Mich würde interessieren, ob die Gemeinde Meckesheim bereits so viel Erzeugungskapazitäten hat, dass sie unter idealen Bedingungen sich selbst versorgen könnte. Wenn nicht, wie viel Erzeugung Solar müsste zugebaut werden?
```

Expected behaviour:

1. OpenClaw asks Cernion for relevant evidence endpoints and/or calls Cernion
   evidence APIs through the sidecar plugin.
2. Cernion returns structured evidence such as MaStR installation counts,
   installed capacity by technology, and residual-load forecast values.
3. OpenClaw performs the user-facing reasoning: it separates storage from
   generation, checks the load model, explains assumptions, and synthesizes the
   final answer.

The important architecture boundary is:

```text
Cernion supplies evidence and policy.
OpenClaw turns that evidence into the final user answer.
```

Model choice matters for this example. With a fast flash model, the agent may
produce a plausible but shallow answer from partial public facts, for example by
using old annual consumption estimates and a few named PV examples instead of
aggregating the full local installation register. A stronger model with
`OPENCLAW_THINKING=adaptive`, such as `google/gemini-3.1-pro-preview`, is a
better first-run setting because it is more likely to:

- ask the Cernion Sidecar for complete local evidence,
- distinguish installed generation from storage,
- compare momentary, daily, and annual self-supply separately,
- explain remaining uncertainty instead of treating partial evidence as final.

## Smoke Test

To verify the container and sidecar connection without using the browser:

```bash
docker compose --env-file docker/.env -f docker/compose.yml run --rm openclaw-cernion test
```

The smoke test checks:

- OpenClaw plugin installation and runtime loading
- Cernion Sidecar descriptor retrieval
- Cernion tool-list retrieval
- a read-only capability-list call
- capability and operation resolution through `/api/_agent`
- that token-shaped values are not echoed in returned payloads

## Useful Commands

Start in the background:

```bash
docker compose --env-file docker/.env -f docker/compose.yml up -d --build
```

Show logs:

```bash
docker compose --env-file docker/.env -f docker/compose.yml logs -f openclaw-cernion
```

Stop:

```bash
docker compose --env-file docker/.env -f docker/compose.yml down
```

Reset the demo state:

```bash
docker compose --env-file docker/.env -f docker/compose.yml down -v
```

Open a shell inside the configured container:

```bash
docker compose --env-file docker/.env -f docker/compose.yml run --rm openclaw-cernion shell
```

## Environment Reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `CERNION_BASE_URL` | yes | Base URL of the Cernion Energy Tools instance. |
| `CERNION_TOKEN` | quick demo | Single token used as read-only and process token. |
| `CERNION_READONLY_TOKEN` | strict setup | Token used for read-only evidence calls. |
| `CERNION_PROCESS_TOKEN` | optional | Token used only for `cernion_prepare_process_intent`. |
| `CERNION_SIDECAR_TIMEOUT_MS` | no | HTTP timeout for Cernion calls, default `15000`. |
| `OPENCLAW_MODEL` | recommended | Demo-agent model id, for example `google/gemini-3.1-pro-preview`. |
| `OPENCLAW_THINKING` | recommended | Demo-agent thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `adaptive`, or `max`; recommended `adaptive`. |
| `OPENCLAW_CONTROLUI_PORT` | no | Host port for Control UI, default `19101`. |
| `OPENCLAW_GATEWAY_TOKEN` | no | Local Gateway token for Control UI login, default `cernion-local-demo`. |
| provider env vars | recommended | Any model-provider environment variables supported by OpenClaw, for example `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`. |

## Notes

- The demo intentionally accepts environment variables so users do not need to
  create token files.
- The plugin still keeps evidence and process boundaries separate internally.
- Process Intake creates `pending_confirmation` receipts only; it does not
  execute processes or resolve HITL approvals.
- The Control UI is protected with the local Gateway token and bound to
  `127.0.0.1` on the host.
