import { afterEach, describe, expect, it, vi } from "vitest";
import entry, { buildUrl, requireConfig, requestCernion, scrubSecretValues } from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EXPECTED_TOOLS = [
  "cernion_sidecar_descriptor",
  "cernion_sidecar_tools",
  "cernion_sidecar_call",
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
});
