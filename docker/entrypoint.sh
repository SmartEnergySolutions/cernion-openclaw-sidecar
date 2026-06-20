#!/usr/bin/env bash
set -euo pipefail

PROFILE="${OPENCLAW_PROFILE:-sidecar-it}"
BASE_URL="${CERNION_BASE_URL:-http://10.0.0.8:3900}"
TOKEN_FILE="${CERNION_READONLY_TOKEN_FILE:-/run/secrets/cernion-readonly-token}"
TIMEOUT_MS="${CERNION_SIDECAR_TIMEOUT_MS:-15000}"
GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-19101}"
PLUGIN_DIR="/opt/cernion-openclaw-sidecar"

if [[ ! -r "${TOKEN_FILE}" ]]; then
  echo "Token file is not readable: ${TOKEN_FILE}" >&2
  exit 64
fi

openclaw --profile "${PROFILE}" plugins install "${PLUGIN_DIR}" --link >/dev/null

openclaw --profile "${PROFILE}" config patch --stdin >/dev/null <<JSON
{
  "plugins": {
    "entries": {
      "cernion-energy-sidecar": {
        "enabled": true,
        "config": {
          "baseUrl": "${BASE_URL}",
          "bearerTokenFile": "${TOKEN_FILE}",
          "timeoutMs": ${TIMEOUT_MS}
        }
      }
    }
  }
}
JSON

openclaw --profile "${PROFILE}" config validate >/dev/null

case "${1:-gateway}" in
  gateway)
    exec openclaw --profile "${PROFILE}" gateway run \
      --dev \
      --allow-unconfigured \
      --bind lan \
      --auth none \
      --port "${GATEWAY_PORT}" \
      --force
    ;;
  test)
    openclaw --profile "${PROFILE}" plugins inspect cernion-energy-sidecar --runtime --json \
      | jq -e '.plugin.status == "loaded" and (.plugin.toolNames | length == 3)' >/dev/null
    exec node scripts/sidecar-smoke.mjs
    ;;
  shell)
    exec /bin/bash
    ;;
  *)
    exec "$@"
    ;;
esac
