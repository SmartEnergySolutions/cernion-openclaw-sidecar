import { afterEach, describe, expect, it, vi } from "vitest";
import entry, { buildQueryPath, buildUrl, requireConfig, requestCernion, scrubSecretValues } from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EXPECTED_TOOLS = [
  "cernion_sidecar_descriptor",
  "cernion_sidecar_tools",
  "cernion_sidecar_call",
  "cernion_resolve_capabilities",
  "cernion_resolve_capability",
  "cernion_resolve_operations",
  "cernion_api_request",
];

describe("cernion-energy-sidecar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CERNION_BASE_URL;
    delete process.env.CERNION_READONLY_TOKEN;
    delete process.env.CERNION_READONLY_TOKEN_FILE;
  });

  it("declares tool metadata", () => {
    const metadata = getToolPluginMetadata(entry);
    expect(metadata?.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    expect(JSON.stringify(metadata)).not.toMatch(/ck_live|ck_readonly|Bearer\s+ck_/i);
  });

  it("resolves config from explicit plugin config or env fallback", () => {
    expect(
      requireConfig({
        baseUrl: "https://cernion.example/",
        bearerToken: "ck_test_token",
        timeoutMs: 2000,
      }),
    ).toEqual({
      baseUrl: "https://cernion.example",
      bearerToken: "ck_test_token",
      timeoutMs: 2000,
    });

    process.env.CERNION_BASE_URL = "https://dev.cernion.example";
    process.env.CERNION_READONLY_TOKEN = "ck_env_token";
    expect(requireConfig({})).toMatchObject({
      baseUrl: "https://dev.cernion.example",
      bearerToken: "ck_env_token",
    });
  });

  it("resolves the bearer token from a restricted local token file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cernion-sidecar-"));
    const tokenPath = join(dir, "token");
    try {
      writeFileSync(tokenPath, "ck_file_token\n", { mode: 0o600 });

      expect(
        requireConfig({
          baseUrl: "https://cernion.example/",
          bearerTokenFile: tokenPath,
        }),
      ).toEqual({
        baseUrl: "https://cernion.example",
        bearerToken: "ck_file_token",
        timeoutMs: 15000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds normalized URLs", () => {
    expect(buildUrl("https://cernion.example", "/api/agent-sidecar/mcp/tools")).toBe(
      "https://cernion.example/api/agent-sidecar/mcp/tools",
    );
    expect(buildUrl("https://cernion.example", "api/agent-sidecar/descriptor")).toBe(
      "https://cernion.example/api/agent-sidecar/descriptor",
    );
  });

  it("builds query paths with encoded optional parameters", () => {
    expect(buildQueryPath("/api/_agent/capabilities", { domain: "grid ops" })).toBe(
      "/api/_agent/capabilities?domain=grid+ops",
    );
    expect(buildQueryPath("/api/_agent/operations?domain=redispatch", { cursor: "next/page" })).toBe(
      "/api/_agent/operations?domain=redispatch&cursor=next%2Fpage",
    );
    expect(buildQueryPath("/api/_agent/operations", { domain: "", skip: null })).toBe("/api/_agent/operations");
  });

  it("scrubs configured bearer token from returned data", () => {
    const result = scrubSecretValues(
      {
        descriptor: {
          bearerTokenSecretRef: "CERNION_READONLY_TOKEN",
          accidental: "ck_live_secret",
        },
      },
      "ck_live_secret",
    );

    expect(result).toEqual({
      descriptor: {
        bearerTokenSecretRef: "CERNION_READONLY_TOKEN",
        accidental: "[redacted]",
      },
    });
  });

  it("sends authenticated requests without returning the token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          provider: { id: "cernion" },
          tools: [{ name: "cernion.list_readonly_capabilities" }],
        }),
    } as Response);

    const result = await requestCernion(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      "/api/agent-sidecar/mcp/tools",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/agent-sidecar/mcp/tools",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer ck_readonly_secret",
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("ck_readonly_secret");
  });

  it("scrubs bearer tokens resolved from environment variables", async () => {
    process.env.CERNION_BASE_URL = "https://cernion.example";
    process.env.CERNION_READONLY_TOKEN = "ck_env_secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          provider: { id: "cernion" },
          accidental: "ck_env_secret",
        }),
    } as Response);

    const result = await requestCernion({}, "/api/agent-sidecar/descriptor");

    expect(result).toEqual({
      provider: { id: "cernion" },
      accidental: "[redacted]",
    });
    expect(JSON.stringify(result)).not.toContain("ck_env_secret");
  });

  it("scrubs bearer tokens resolved from token files in error payloads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cernion-sidecar-"));
    const tokenPath = join(dir, "token");
    try {
      writeFileSync(tokenPath, "ck_file_secret\n", { mode: 0o600 });
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () =>
          JSON.stringify({
            message: "not allowed",
            echoed: "ck_file_secret",
          }),
      } as Response);

      const result = await requestCernion(
        {
          baseUrl: "https://cernion.example",
          bearerTokenFile: tokenPath,
        },
        "/api/_agent/capabilities",
      );

      expect(result).toEqual({
        isError: true,
        error: {
          code: "cernion_http_error",
          status: 403,
          statusText: "Forbidden",
        },
        structuredContent: {
          message: "not allowed",
          echoed: "[redacted]",
        },
      });
      expect(JSON.stringify(result)).not.toContain("ck_file_secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps tool calls to the Cernion MCP-like endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          isError: false,
          structuredContent: {
            success: true,
            tool: "cernion.list_readonly_capabilities",
          },
        }),
    } as Response);

    await requestCernion(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      "/api/agent-sidecar/mcp/tools/cernion.list_readonly_capabilities/call",
      {
        method: "POST",
        body: {
          arguments: {
            context: { tenantId: "public" },
          },
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/agent-sidecar/mcp/tools/cernion.list_readonly_capabilities/call",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          arguments: {
            context: { tenantId: "public" },
          },
        }),
      }),
    );
  });

  it("sends authenticated GET requests via requestCernion with params", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ success: true, data: [] }),
    } as Response);

    const result = await requestCernion(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      "/api/_agent/capabilities?domain=grid-ops",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/_agent/capabilities?domain=grid-ops",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer ck_readonly_secret",
        }),
      }),
    );
    expect(result).toEqual({ success: true, data: [] });
  });

  it("sends authenticated requests to the new manifest resolve endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ success: true, data: [{ operationId: "gridData", aliases: [] }] }),
    } as Response);

    await requestCernion(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      buildQueryPath("/api/_agent/operations", { domain: "grid-ops" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/_agent/operations?domain=grid-ops",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer ck_readonly_secret",
        }),
      }),
    );
  });
});
