import assert from "node:assert/strict";
import { executeRestExecutionPlan, queryDomainKnowledge, requestCernion } from "../dist/index.js";

const baseUrl = process.env.CERNION_BASE_URL || "http://10.0.0.8:3900";
const bearerTokenFile = process.env.CERNION_READONLY_TOKEN_FILE || "/run/secrets/cernion-readonly-token";
const timeoutMs = Number(process.env.CERNION_SIDECAR_TIMEOUT_MS || 15000);
const smokeAssetPath = process.env.CERNION_SMOKE_ASSET_PATH || "/api/assets/solar";
const smokeAssetLocation = process.env.CERNION_SMOKE_ASSET_LOCATION || "74909";
const smokeAssetLimit = Number(process.env.CERNION_SMOKE_ASSET_LIMIT || 3);

const config = {
  baseUrl,
  timeoutMs,
};

if (process.env.CERNION_READONLY_TOKEN || process.env.CERNION_TOKEN) {
  if (!process.env.CERNION_READONLY_TOKEN && process.env.CERNION_TOKEN) {
    process.env.CERNION_READONLY_TOKEN = process.env.CERNION_TOKEN;
  }
  config.bearerTokenEnv = "CERNION_READONLY_TOKEN";
} else {
  config.bearerTokenFile = bearerTokenFile;
}

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

const assetList = await executeRestExecutionPlan(config, {
  method: "GET",
  path: smokeAssetPath,
  query: {
    location: smokeAssetLocation,
    limit: smokeAssetLimit,
  },
});
assert.notEqual(assetList?.isError, true, "asset-list REST plan must not return a Cernion error");
assertNoSecretEcho(assetList);
if (assetList?._sidecar) {
  assert.equal(assetList._sidecar.assetListPagination?.requestedLimit, smokeAssetLimit);
  assert(Array.isArray(assetList._sidecar.exportOptions), "asset-list sidecar metadata must include exportOptions");
  assert(
    assetList._sidecar.exportOptions.some((option) => option.format === "csv") &&
      assetList._sidecar.exportOptions.some((option) => option.format === "xls"),
    "asset-list exportOptions must include csv and xls",
  );
}

const fachwissen = await queryDomainKnowledge(config, {
  query: "Welche Pflichten ergeben sich aus §14a EnWG für einen Verteilnetzbetreiber?",
  limit: 3,
  maxWaitMs: timeoutMs,
});
assert.equal(fachwissen?.kind, "domain_knowledge");
assert.equal(fachwissen?.source, "knowledge_rag");
assert.notEqual(fachwissen?.result?.isError, true, "Knowledge RAG query must not return a Cernion error");
assertNoSecretEcho(fachwissen);

const knowledgeRagReturned =
  fachwissen?.result?.data?.returned ||
  fachwissen?.result?.data?.results?.length ||
  fachwissen?.result?.results?.length ||
  0;

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: descriptor.provider.id,
      descriptorTools: descriptor.tools.length,
      mcpTools: tools.tools.length,
      capabilities: capabilities.data.length,
      operations: operations.data.length,
      assetSmoke: {
        path: smokeAssetPath,
        location: smokeAssetLocation,
        limit: smokeAssetLimit,
        sidecarGuidance: Boolean(assetList?._sidecar),
      },
      knowledgeRagReturned,
    },
    null,
    2,
  ),
);
