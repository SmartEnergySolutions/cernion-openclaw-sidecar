import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { readFileSync } from "node:fs";
const DEFAULT_TIMEOUT_MS = 15000;
const configSchema = Type.Object({
    baseUrl: Type.Optional(Type.String({ description: "Cernion base URL, for example https://cernion.example" })),
    bearerToken: Type.Optional(Type.String({ description: "Read-only Cernion bearer token. Prefer the OpenClaw secret store." })),
    bearerTokenEnv: Type.Optional(Type.String({ description: "Environment variable name that contains the bearer token." })),
    bearerTokenFile: Type.Optional(Type.String({ description: "Path to a local 0600 file containing the read-only bearer token." })),
    allowRestProxy: Type.Optional(Type.Boolean({ description: "Allow read-only REST execution plans emitted by Cernion to be proxied through this sidecar." })),
    timeoutMs: Type.Optional(Type.Number({ description: "HTTP request timeout in milliseconds." })),
}, { additionalProperties: false });
function stripTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function readBearerTokenFile(path) {
    const raw = readFileSync(path, "utf8").trim();
    const envMatch = raw.match(/^CERNION_READONLY_TOKEN=(.*)$/m);
    return (envMatch ? envMatch[1] : raw).trim().replace(/^['"]|['"]$/g, "");
}
function requireConfig(config) {
    const baseUrl = (config.baseUrl || process.env.CERNION_BASE_URL || "").trim();
    const tokenEnv = (config.bearerTokenEnv || "CERNION_READONLY_TOKEN").trim();
    const tokenFile = (config.bearerTokenFile || process.env.CERNION_READONLY_TOKEN_FILE || "").trim();
    const bearerToken = (config.bearerToken ||
        process.env[tokenEnv] ||
        process.env.CERNION_SIDECAR_TOKEN ||
        (tokenFile ? readBearerTokenFile(tokenFile) : "")).trim();
    if (!baseUrl) {
        throw new Error("Cernion baseUrl is required. Set plugin config baseUrl or CERNION_BASE_URL.");
    }
    if (!bearerToken) {
        throw new Error("Cernion read-only bearer token is required. Set plugin secret bearerToken or CERNION_READONLY_TOKEN.");
    }
    return {
        baseUrl: stripTrailingSlash(baseUrl),
        bearerToken,
        timeoutMs: Math.max(1000, Number(config.timeoutMs || process.env.CERNION_SIDECAR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)),
    };
}
function buildUrl(baseUrl, path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
}
function buildQueryPath(path, params = {}) {
    const queryParams = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null && val !== "") {
            queryParams.append(key, String(val));
        }
    }
    if (!queryParams.toString())
        return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}${queryParams.toString()}`;
}
function isRestProxyAllowed(config) {
    if (config.allowRestProxy !== undefined)
        return config.allowRestProxy;
    const value = (process.env.CERNION_ALLOW_REST_PROXY || "").trim().toLowerCase();
    if (!value)
        return true;
    return !["0", "false", "no", "off"].includes(value);
}
function validateRestExecutionPlan(plan) {
    const method = (plan.method || "GET").toUpperCase();
    if (method !== "GET") {
        throw new Error("Only read-only GET execution plans can be proxied by the Cernion Sidecar.");
    }
    if (!plan.path || typeof plan.path !== "string") {
        throw new Error("REST execution plan requires a relative Cernion API path.");
    }
    if (plan.path.includes("://") || plan.path.startsWith("//") || !plan.path.startsWith("/api/")) {
        throw new Error("REST execution plan path must be a relative /api/ path.");
    }
    const lowerPath = plan.path.toLowerCase();
    const blockedPathMarkers = [
        "/api/admin",
        "/api/auth",
        "/api/token",
        "/api/tokens",
        "/api/secret",
        "/api/secrets",
        "/api/hitl/resolve",
        "/api/agent-sidecar/mcp/tools/",
    ];
    if (blockedPathMarkers.some((marker) => lowerPath.startsWith(marker))) {
        throw new Error("REST execution plan path is outside the read-only Sidecar proxy boundary.");
    }
    return {
        method: "GET",
        path: plan.path,
        params: { ...(plan.params || {}), ...(plan.query || {}) },
    };
}
async function executeRestExecutionPlan(config, plan, signal) {
    if (!isRestProxyAllowed(config)) {
        throw new Error("Cernion read-only REST proxy is disabled by configuration.");
    }
    const validated = validateRestExecutionPlan(plan);
    return requestCernion(config, buildQueryPath(validated.path, validated.params), {
        method: validated.method,
        signal,
    });
}
async function requestCernion(config, path, options = {}) {
    const { baseUrl, bearerToken, timeoutMs } = requireConfig(config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const signal = options.signal || controller.signal;
    try {
        const response = await fetch(buildUrl(baseUrl, path), {
            method: options.method || "GET",
            headers: {
                authorization: `Bearer ${bearerToken}`,
                accept: "application/json",
                ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal,
        });
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : null;
        const safeParsed = scrubSecretValues(parsed, bearerToken);
        if (!response.ok) {
            return {
                isError: true,
                error: {
                    code: "cernion_http_error",
                    status: response.status,
                    statusText: response.statusText,
                },
                structuredContent: safeParsed,
            };
        }
        return safeParsed;
    }
    finally {
        clearTimeout(timeout);
    }
}
function scrubSecretValues(value, token) {
    const serialized = JSON.stringify(value);
    if (!serialized)
        return value;
    if (!token)
        return value;
    const scrubbed = token ? serialized.split(token).join("[redacted]") : serialized;
    return JSON.parse(scrubbed);
}
export default defineToolPlugin({
    id: "cernion-energy-sidecar",
    name: "Cernion Energy Sidecar",
    description: "Expose Cernion Energy Sidecar tools to OpenClaw through a read-only provider boundary.",
    configSchema,
    tools: (tool) => [
        tool({
            name: "cernion_ask",
            label: "Ask Cernion",
            description: "Ask Cernion through the generic provider gate. Cernion may answer directly or return structured capability, blueprint, evidence, and read-only REST execution-plan hints that OpenClaw can reuse.",
            parameters: Type.Object({
                query: Type.String({ description: "Natural-language request or task context to resolve inside Cernion." }),
                context: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Optional tenant, user, or session context." })),
                inputs: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Optional structured inputs already known to OpenClaw." })),
            }),
            execute: async ({ query, context: requestContext = {}, inputs = {} }, config, context) => {
                const result = await requestCernion(config, "/api/agent-sidecar/mcp/tools/cernion.ask/call", {
                    method: "POST",
                    body: { arguments: { question: query, query, context: requestContext, inputs } },
                    signal: context.signal,
                });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_sidecar_descriptor",
            label: "Cernion Sidecar Descriptor",
            description: "Load the generic Energy Sidecar descriptor from Cernion without exposing bearer tokens.",
            parameters: Type.Object({}),
            execute: async (_params, config, context) => {
                const result = await requestCernion(config, "/api/agent-sidecar/descriptor", { signal: context.signal });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_sidecar_tools",
            label: "Cernion Sidecar Tools",
            description: "List Cernion Sidecar tools in the MCP/OpenClaw-compatible tools/list shape.",
            parameters: Type.Object({}),
            execute: async (_params, config, context) => {
                const result = await requestCernion(config, "/api/agent-sidecar/mcp/tools", { signal: context.signal });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_sidecar_call",
            label: "Call Cernion Sidecar Tool",
            description: "Call one curated read-only/advisory Cernion Sidecar tool through the provider policy gate.",
            parameters: Type.Object({
                name: Type.String({ description: "Provider tool name, e.g. cernion.list_readonly_capabilities." }),
                arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Tool arguments forwarded to Cernion." })),
            }),
            execute: async ({ name, arguments: toolArguments = {} }, config, context) => {
                const result = await requestCernion(config, `/api/agent-sidecar/mcp/tools/${encodeURIComponent(name)}/call`, {
                    method: "POST",
                    body: { arguments: toolArguments },
                    signal: context.signal,
                });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_resolve_capabilities",
            label: "Resolve Cernion Capabilities",
            description: "Resolve capability cluster heads from the llm.txt manifest to full Cernion capability details via GET /api/_agent/capabilities. Optionally filter by canonical manifest domain.",
            parameters: Type.Object({
                domain: Type.Optional(Type.String({ description: "Optional canonical manifest domain, e.g. 'redispatch' or 'grid-ops'." })),
            }),
            execute: async ({ domain }, config, context) => {
                const result = await requestCernion(config, buildQueryPath("/api/_agent/capabilities", { domain }), {
                    method: "GET",
                    signal: context.signal,
                });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_resolve_capability",
            label: "Resolve Cernion Capability",
            description: "Resolve one Cernion capability id from the llm.txt manifest to its full capability detail via GET /api/_agent/capabilities/:name.",
            parameters: Type.Object({
                name: Type.String({ description: "Capability id, e.g. 'redispatch_asset_register'." }),
            }),
            execute: async ({ name }, config, context) => {
                const result = await requestCernion(config, `/api/_agent/capabilities/${encodeURIComponent(name)}`, {
                    method: "GET",
                    signal: context.signal,
                });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_resolve_operations",
            label: "Resolve Cernion Operations",
            description: "Resolve operation clusters from the llm.txt manifest to deduplicated Cernion OpenAPI operation details via GET /api/_agent/operations. Duplicate operationIds are returned as one canonical path with aliases.",
            parameters: Type.Object({
                domain: Type.Optional(Type.String({ description: "Optional canonical manifest domain, e.g. 'redispatch' or 'grid-ops'." })),
            }),
            execute: async ({ domain }, config, context) => {
                const result = await requestCernion(config, buildQueryPath("/api/_agent/operations", { domain }), {
                    method: "GET",
                    signal: context.signal,
                });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_execute_rest_plan",
            label: "Execute Cernion REST Plan",
            description: "Proxy one read-only Cernion REST execution plan emitted by cernion.ask or the Cernion blueprint/capability runtime. The Sidecar supplies the configured base URL and bearer token, validates the plan as GET-only, and returns scrubbed structured results.",
            parameters: Type.Object({
                method: Type.Optional(Type.String({ description: "HTTP method from the execution plan. Only GET is allowed." })),
                path: Type.String({ description: "Relative Cernion API path from the execution plan, e.g. /api/assets/solar." }),
                params: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Query parameters from the execution plan." })),
                query: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Alias for params, used by some Cernion plan envelopes." })),
                policy: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Optional policy metadata returned by Cernion." })),
            }),
            execute: async (plan, config, context) => {
                const result = await executeRestExecutionPlan(config, plan, context.signal);
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
        tool({
            name: "cernion_api_request",
            label: "Cernion API Request",
            description: "Perform an authenticated read-only GET request directly against Cernion Energy Tools (CET). Must be used to resolve capabilities, operations, or query specific domain data (like assets.solar) following the llm.txt RESOLUTION PROTOCOL.",
            parameters: Type.Object({
                path: Type.String({ description: "The API path to call, e.g. '/api/_agent/capabilities', '/api/_agent/operations', '/api/assets/solar'." }),
                params: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Query parameters to append to the GET request." })),
            }),
            execute: async ({ path, params = {} }, config, context) => {
                const result = await requestCernion(config, buildQueryPath(path, params), {
                    method: "GET",
                    signal: context.signal,
                });
                return scrubSecretValues(result, config.bearerToken);
            },
        }),
    ],
});
export { buildQueryPath, buildUrl, executeRestExecutionPlan, isRestProxyAllowed, requireConfig, requestCernion, scrubSecretValues, validateRestExecutionPlan, };
