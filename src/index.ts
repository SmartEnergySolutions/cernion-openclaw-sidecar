import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 15000;

const configSchema = Type.Object(
  {
    baseUrl: Type.Optional(Type.String({ description: "Cernion base URL, for example https://cernion.example" })),
    bearerToken: Type.Optional(Type.String({ description: "Read-only Cernion bearer token. Prefer the OpenClaw secret store." })),
    bearerTokenEnv: Type.Optional(Type.String({ description: "Environment variable name that contains the bearer token." })),
    bearerTokenFile: Type.Optional(Type.String({ description: "Path to a local 0600 file containing the read-only bearer token." })),
    timeoutMs: Type.Optional(Type.Number({ description: "HTTP request timeout in milliseconds." })),
  },
  { additionalProperties: false },
);

type PluginConfig = {
  baseUrl?: string;
  bearerToken?: string;
  bearerTokenEnv?: string;
  bearerTokenFile?: string;
  timeoutMs?: number;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readBearerTokenFile(path: string): string {
  const raw = readFileSync(path, "utf8").trim();
  const envMatch = raw.match(/^CERNION_READONLY_TOKEN=(.*)$/m);
  return (envMatch ? envMatch[1] : raw).trim().replace(/^['"]|['"]$/g, "");
}

function requireConfig(config: PluginConfig): { baseUrl: string; bearerToken: string; timeoutMs: number } {
  const baseUrl = (config.baseUrl || process.env.CERNION_BASE_URL || "").trim();
  const tokenEnv = (config.bearerTokenEnv || "CERNION_READONLY_TOKEN").trim();
  const tokenFile = (config.bearerTokenFile || process.env.CERNION_READONLY_TOKEN_FILE || "").trim();
  const bearerToken = (
    config.bearerToken ||
    process.env[tokenEnv] ||
    process.env.CERNION_SIDECAR_TOKEN ||
    (tokenFile ? readBearerTokenFile(tokenFile) : "")
  ).trim();

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

function buildUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function requestCernion(config: PluginConfig, path: string, options: RequestOptions = {}): Promise<unknown> {
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

    if (!response.ok) {
      return {
        isError: true,
        error: {
          code: "cernion_http_error",
          status: response.status,
          statusText: response.statusText,
        },
        structuredContent: parsed,
      };
    }

    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function scrubSecretValues(value: unknown, token?: string): unknown {
  const serialized = JSON.stringify(value);
  if (!serialized) return value;
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
  ],
});

export { buildUrl, requireConfig, requestCernion, scrubSecretValues };
