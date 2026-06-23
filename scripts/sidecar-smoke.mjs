import assert from "node:assert/strict";
import { requestCernion } from "../dist/index.js";

const baseUrl = process.env.CERNION_BASE_URL || "http://10.0.0.8:3900";
const bearerTokenFile = process.env.CERNION_READONLY_TOKEN_FILE || "/run/secrets/cernion-readonly-token";
const timeoutMs = Number(process.env.CERNION_SIDECAR_TIMEOUT_MS || 15000);

const config = {
  baseUrl,
  bearerTokenFile,
  timeoutMs,
};

function assertNoSecretEcho(value) {
  const serialized = JSON.stringify(value);
  assert(!/Bearer\s+[A-Za-z0-9._~+/=-]+/.test(serialized), "response must not echo an Authorization bearer header");
  assert(!/ck_(live|readonly|test)_[A-Za-z0-9._~+/=-]+/.test(serialized), "response must not echo token-shaped secrets");
}

const descriptor = await requestCernion(config, "/api/agent-sidecar/descriptor");
assert.equal(descriptor?.provider?.id, "cernion");
assert.equal(descriptor?.sideEffects, "none");
assert(Array.isArray(descriptor?.tools), "descriptor.tools must be an array");
assert(descriptor.tools.length >= 3, "descriptor must expose at least the MVP tools");
assertNoSecretEcho(descriptor);

const tools = await requestCernion(config, "/api/agent-sidecar/mcp/tools");
assert.equal(tools?.provider?.id, "cernion");
assert(Array.isArray(tools?.tools), "tools.tools must be an array");
assert(tools.tools.some((tool) => tool.name === "cernion.list_readonly_capabilities"));
assertNoSecretEcho(tools);

const call = await requestCernion(config, "/api/agent-sidecar/mcp/tools/cernion.list_readonly_capabilities/call", {
  method: "POST",
  body: {
    arguments: {
      context: {
        tenantId: "public",
      },
    },
  },
});
assertNoSecretEcho(call);
assert.notEqual(call?.error?.code, "sidecar_policy_blocked", "read-only capabilities call should not be policy-blocked");

const capabilities = await requestCernion(config, "/api/_agent/capabilities");
assert.equal(capabilities?.success, true);
assert(Array.isArray(capabilities?.data), "capabilities.data must be an array");
assertNoSecretEcho(capabilities);

const operations = await requestCernion(config, "/api/_agent/operations");
assert.equal(operations?.success, true);
assert(Array.isArray(operations?.data), "operations.data must be an array");
assert(
  operations.data.every((operation) => Array.isArray(operation.aliases)),
  "operations entries must include aliases arrays",
);
assertNoSecretEcho(operations);

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: descriptor.provider.id,
      descriptorTools: descriptor.tools.length,
      mcpTools: tools.tools.length,
      capabilities: capabilities.data.length,
      operations: operations.data.length,
    },
    null,
    2,
  ),
);
