#!/usr/bin/env bash
set -euo pipefail

PROFILE="${OPENCLAW_PROFILE:-cernion-demo}"
BASE_URL="${CERNION_BASE_URL:-http://10.0.0.8:3900}"
TIMEOUT_MS="${CERNION_SIDECAR_TIMEOUT_MS:-15000}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-19101}"
CONTROLUI_PORT="${OPENCLAW_CONTROLUI_PORT:-${GATEWAY_PORT}}"
GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-cernion-local-demo}"
PLUGIN_DIR="/opt/cernion-openclaw-sidecar"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE:-/home/node/cernion-demo-workspace}"
PROFILE_DIR="${PLUGIN_DIR}/docker/profiles/${PROFILE}"

mkdir -p "${WORKSPACE_DIR}"

if [[ -d "${PROFILE_DIR}" && "${OPENCLAW_COPY_PROFILE_FILES:-true}" == "true" ]]; then
  cp -f "${PROFILE_DIR}"/*.md "${WORKSPACE_DIR}/"
fi

export OPENCLAW_WORKSPACE_DIR="${WORKSPACE_DIR}"

if [[ -z "${CERNION_READONLY_TOKEN:-}" && -n "${CERNION_TOKEN:-}" ]]; then
  export CERNION_READONLY_TOKEN="${CERNION_TOKEN}"
fi

if [[ -z "${CERNION_PROCESS_TOKEN:-}" && -n "${CERNION_TOKEN:-}" ]]; then
  export CERNION_PROCESS_TOKEN="${CERNION_TOKEN}"
fi

READONLY_TOKEN_FILE="${CERNION_READONLY_TOKEN_FILE:-}"
PROCESS_TOKEN_FILE="${CERNION_PROCESS_TOKEN_FILE:-}"

if [[ -z "${CERNION_READONLY_TOKEN:-}" && -z "${READONLY_TOKEN_FILE}" ]]; then
  echo "Set CERNION_TOKEN or CERNION_READONLY_TOKEN for Cernion evidence access." >&2
  exit 64
fi

if [[ -n "${READONLY_TOKEN_FILE}" && ! -r "${READONLY_TOKEN_FILE}" ]]; then
  echo "Read-only token file is not readable: ${READONLY_TOKEN_FILE}" >&2
  exit 64
fi

if [[ -n "${PROCESS_TOKEN_FILE}" && ! -r "${PROCESS_TOKEN_FILE}" ]]; then
  echo "Process token file is not readable: ${PROCESS_TOKEN_FILE}" >&2
  exit 64
fi

openclaw --profile "${PROFILE}" plugins install "${PLUGIN_DIR}" --link >/dev/null

node <<'NODE' >/tmp/cernion-openclaw-config.json
const config = {
  plugins: {
    entries: {
      "cernion-energy-tools-sidecar": {
        enabled: true,
        config: {
          baseUrl: process.env.CERNION_BASE_URL || "http://10.0.0.8:3900",
          timeoutMs: Number(process.env.CERNION_SIDECAR_TIMEOUT_MS || 15000),
          allowRestProxy: true,
        },
      },
    },
  },
};

const sidecarConfig = config.plugins.entries["cernion-energy-tools-sidecar"].config;
const envRef = (id) => ({ source: "env", provider: "default", id });
const providers = {};
const allowedThinkingLevels = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "adaptive",
  "max",
]);

const googleApiKeyEnv = process.env.GOOGLE_API_KEY
  ? "GOOGLE_API_KEY"
  : process.env.GEMINI_API_KEY
    ? "GEMINI_API_KEY"
    : null;

if (googleApiKeyEnv) {
  providers.google = {
    auth: "api-key",
    apiKey: envRef(googleApiKeyEnv),
  };
}

if (process.env.ANTHROPIC_API_KEY) {
  providers.anthropic = {
    auth: "api-key",
    apiKey: envRef("ANTHROPIC_API_KEY"),
  };
}

if (process.env.OPENAI_API_KEY) {
  providers.openai = {
    auth: "api-key",
    apiKey: envRef("OPENAI_API_KEY"),
  };
}

let primaryModel =
  process.env.OPENCLAW_MODEL || process.env.OPENCLAW_DEFAULT_MODEL || "";

if (!primaryModel) {
  if (googleApiKeyEnv) {
    primaryModel = "google/gemini-3.1-pro-preview";
  } else if (process.env.ANTHROPIC_API_KEY) {
    primaryModel = "anthropic/claude-sonnet-4-6";
  } else if (process.env.OPENAI_API_KEY) {
    primaryModel = "openai/gpt-5.5";
  }
}

if (Object.keys(providers).length > 0) {
  config.models = {
    mode: "merge",
    providers,
  };
}

if (primaryModel) {
  config.agents = {
    defaults: {
      workspace: process.env.OPENCLAW_WORKSPACE_DIR,
      model: {
        primary: primaryModel,
      },
    },
  };
}

if (!config.agents) {
  config.agents = {
    defaults: {
      workspace: process.env.OPENCLAW_WORKSPACE_DIR,
    },
  };
} else {
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.workspace = process.env.OPENCLAW_WORKSPACE_DIR;
}

const thinkingDefault =
  process.env.OPENCLAW_THINKING ||
  process.env.OPENCLAW_THINKING_LEVEL ||
  "";

if (thinkingDefault) {
  if (!allowedThinkingLevels.has(thinkingDefault)) {
    throw new Error(
      `Unsupported OPENCLAW_THINKING value: ${thinkingDefault}. Use one of: ${[
        ...allowedThinkingLevels,
      ].join(", ")}`,
    );
  }

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.thinkingDefault = thinkingDefault;
}

if (process.env.CERNION_READONLY_TOKEN) {
  sidecarConfig.bearerTokenEnv = "CERNION_READONLY_TOKEN";
} else if (process.env.CERNION_READONLY_TOKEN_FILE) {
  sidecarConfig.bearerTokenFile = process.env.CERNION_READONLY_TOKEN_FILE;
}

if (process.env.CERNION_PROCESS_TOKEN) {
  sidecarConfig.processBearerTokenEnv = "CERNION_PROCESS_TOKEN";
} else if (process.env.CERNION_PROCESS_TOKEN_FILE) {
  sidecarConfig.processBearerTokenFile = process.env.CERNION_PROCESS_TOKEN_FILE;
}

process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
NODE

openclaw --profile "${PROFILE}" config patch --stdin >/dev/null </tmp/cernion-openclaw-config.json

openclaw --profile "${PROFILE}" config patch --stdin >/dev/null <<JSON
{
  "gateway": {
    "mode": "local",
    "bind": "auto",
    "auth": {
      "mode": "token"
    },
    "remote": {
      "url": "ws://127.0.0.1:${GATEWAY_PORT}"
    },
    "controlUi": {
      "allowedOrigins": [
        "http://localhost:${CONTROLUI_PORT}",
        "http://127.0.0.1:${CONTROLUI_PORT}",
        "http://localhost:${GATEWAY_PORT}",
        "http://127.0.0.1:${GATEWAY_PORT}"
      ]
    }
  }
}
JSON

openclaw --profile "${PROFILE}" config validate >/dev/null

control_ui_url="http://localhost:${CONTROLUI_PORT}"

case "${1:-gateway}" in
  gateway)
    echo "Cernion OpenClaw demo gateway starting."
    echo "Control UI: ${control_ui_url}"
    echo "Gateway auth token: ${GATEWAY_TOKEN}"
    echo "Cernion base URL: ${BASE_URL}"
    echo "Workspace profile: ${WORKSPACE_DIR}"
    echo "First question: Mich würde interessieren, ob die Gemeinde Meckesheim bereits so viel Erzeugungskapazitäten hat, dass sie unter idealen Bedingungen sich selbst versorgen könnte. Wenn nicht, wie viel Erzeugung Solar müsste zugebaut werden?"
    exec openclaw --profile "${PROFILE}" gateway run \
      --dev \
      --allow-unconfigured \
      --bind auto \
      --auth token \
      --token "${GATEWAY_TOKEN}" \
      --port "${GATEWAY_PORT}" \
      --force
    ;;
  dashboard)
    exec openclaw --profile "${PROFILE}" dashboard --no-open --yes
    ;;
  test)
    openclaw --profile "${PROFILE}" plugins inspect cernion-energy-tools-sidecar --runtime --json \
      | jq -e '
          .plugin.status == "loaded"
          and (.plugin.toolNames | index("cernion_route_evidence"))
          and (.plugin.toolNames | index("cernion_execute_evidence_endpoint"))
          and (.plugin.toolNames | index("cernion_prepare_process_intent"))
          and (.plugin.toolNames | length >= 12)
        ' >/dev/null
    exec node scripts/sidecar-smoke.mjs
    ;;
  shell)
    exec /bin/bash
    ;;
  *)
    exec "$@"
    ;;
esac
