import { afterEach, describe, expect, it, vi } from "vitest";
import entry, {
  buildQueryPath,
  buildUrl,
  executeEvidenceEndpointPlan,
  executeRestExecutionPlan,
  requireConfig,
  requireProcessConfig,
  requestCernion,
  requestCernionProcess,
  routeEvidence,
  scrubSecretValues,
  validateEvidenceEndpointPlan,
  validateRestExecutionPlan,
} from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const EXPECTED_TOOLS = [
  "cernion_route_evidence",
  "cernion_execute_evidence_endpoint",
  "cernion_prepare_process_intent",
  "cernion_ask",
  "cernion_sidecar_descriptor",
  "cernion_sidecar_tools",
  "cernion_sidecar_call",
  "cernion_resolve_capabilities",
  "cernion_resolve_capability",
  "cernion_resolve_operations",
  "cernion_execute_rest_plan",
  "cernion_api_request",
];

describe("cernion-energy-sidecar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CERNION_BASE_URL;
    delete process.env.CERNION_READONLY_TOKEN;
    delete process.env.CERNION_READONLY_TOKEN_FILE;
    delete process.env.CERNION_PROCESS_TOKEN;
    delete process.env.CERNION_PROCESS_TOKEN_FILE;
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

  it("keeps process-intake credentials separate from read-only credentials", () => {
    process.env.CERNION_BASE_URL = "https://dev.cernion.example";
    process.env.CERNION_PROCESS_TOKEN = "ck_process_token";

    expect(requireProcessConfig({})).toMatchObject({
      baseUrl: "https://dev.cernion.example",
      bearerToken: "ck_process_token",
    });

    delete process.env.CERNION_PROCESS_TOKEN;
    expect(() =>
      requireProcessConfig({
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_token",
      }),
    ).toThrow(/process-intake bearer token/);
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

  it("resolves the process token from a restricted env-style token file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cernion-sidecar-"));
    const tokenPath = join(dir, "process-token");
    try {
      writeFileSync(tokenPath, "CERNION_PROCESS_TOKEN=ck_process_file_token\n", { mode: 0o600 });

      expect(
        requireProcessConfig({
          baseUrl: "https://cernion.example/",
          processBearerTokenFile: tokenPath,
        }),
      ).toEqual({
        baseUrl: "https://cernion.example",
        bearerToken: "ck_process_file_token",
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

  it("maps cernion.ask to the generic provider tool gate", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          isError: false,
          structuredContent: {
            answer: "resolved",
            executionPlan: {
              method: "GET",
              path: "/api/assets/solar",
              query: { location: "69168" },
            },
          },
        }),
    } as Response);

    const result = await requestCernion(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      "/api/agent-sidecar/mcp/tools/cernion.ask/call",
      {
        method: "POST",
        body: {
          arguments: {
            question: "Finde PV Anlagen in Wiesloch 2025 um 10 kWp",
            query: "Finde PV Anlagen in Wiesloch 2025 um 10 kWp",
            context: { tenantId: "public" },
            inputs: { location: "69168" },
          },
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/agent-sidecar/mcp/tools/cernion.ask/call",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          arguments: {
            question: "Finde PV Anlagen in Wiesloch 2025 um 10 kWp",
            query: "Finde PV Anlagen in Wiesloch 2025 um 10 kWp",
            context: { tenantId: "public" },
            inputs: { location: "69168" },
          },
        }),
      }),
    );
    expect(result).toMatchObject({
      isError: false,
      structuredContent: {
        executionPlan: {
          path: "/api/assets/solar",
        },
      },
    });
  });

  it("routes evidence through the backend Evidence Router contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          success: true,
          resolved: { kind: "evidence_plan", source: "evidence_router" },
          requiredEvidenceTypes: ["time_series"],
          recommendedEndpoints: [
            {
              purpose: "co2_intensity_time_series",
              method: "POST",
              path: "/api/energy-market/co2-intensity",
              query: { location: "69168", forecast: true },
              resultKind: "time_series",
              policy: { readOnly: true, sideEffects: "none" },
            },
          ],
        }),
    } as Response);

    const result = await routeEvidence(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      {
        question: "Wie hoch ist die CO2-Intensität in den nächsten 24 Stunden in 69168?",
        context: { location: "69168" },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/evidence-router/route",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          question: "Wie hoch ist die CO2-Intensität in den nächsten 24 Stunden in 69168?",
          context: { location: "69168" },
        }),
      }),
    );
    expect(result).toMatchObject({
      success: true,
      resolved: { kind: "evidence_plan" },
      recommendedEndpoints: [
        {
          path: "/api/energy-market/co2-intensity",
          resultKind: "time_series",
        },
      ],
    });
  });

  it("validates Evidence Router endpoint recommendations separately from GET-only ask plans", () => {
    expect(
      validateEvidenceEndpointPlan({
        method: "POST",
        path: "/api/energy-market/co2-intensity",
        query: { location: "69168", forecast: true },
        resultKind: "time_series",
        policy: { readOnly: true, sideEffects: "none" },
      }),
    ).toEqual({
      method: "POST",
      path: "/api/energy-market/co2-intensity",
      params: { location: "69168", forecast: true },
      body: { location: "69168", forecast: true },
    });

    expect(() =>
      validateEvidenceEndpointPlan({
        method: "POST",
        path: "/api/energy-market/co2-intensity",
        query: { location: "69168" },
        policy: { sideEffects: "none" },
      }),
    ).toThrow(/readOnly=true/);
    expect(() =>
      validateEvidenceEndpointPlan({
        method: "POST",
        path: "/api/copilot-process/intents",
        policy: { readOnly: true, sideEffects: "none" },
      }),
    ).toThrow(/Process Intake/);
    expect(() =>
      validateEvidenceEndpointPlan({
        method: "PUT",
        path: "/api/energy-market/co2-intensity",
        policy: { readOnly: true, sideEffects: "none" },
      }),
    ).toThrow(/GET or POST/);
  });

  it("executes POST evidence endpoints recommended by the Evidence Router", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          success: true,
          forecast_next_24h_gco2eq_kwh: [{ hour: "10:00", value: 310 }],
          echoed: "ck_readonly_secret",
        }),
    } as Response);

    const result = await executeEvidenceEndpointPlan(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      {
        method: "POST",
        path: "/api/energy-market/co2-intensity",
        query: { location: "69168", forecast: true },
        resultKind: "time_series",
        policy: { readOnly: true, sideEffects: "none" },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/energy-market/co2-intensity",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ location: "69168", forecast: true }),
        headers: expect.objectContaining({
          authorization: "Bearer ck_readonly_secret",
        }),
      }),
    );
    expect(result).toEqual({
      success: true,
      forecast_next_24h_gco2eq_kwh: [{ hour: "10:00", value: 310 }],
      echoed: "[redacted]",
    });
  });

  it("prepares process intake with a dedicated process token and only returns the receipt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          success: true,
          resolved: { kind: "process_intake", source: "process_intent_store" },
          receipt: {
            intentId: "intent-123",
            status: "pending_confirmation",
            requiresHumanConfirmation: true,
          },
          echoed: "ck_process_secret",
        }),
    } as Response);

    const result = await requestCernionProcess(
      {
        baseUrl: "https://cernion.example",
        processBearerToken: "ck_process_secret",
      },
      "/api/copilot-process/intents",
      {
        method: "POST",
        body: {
          operationFamily: "customer_master_data_correction",
          proposedAction: "correct_metering_point_address",
          payload: { targetId: "MP-12345" },
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/copilot-process/intents",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationFamily: "customer_master_data_correction",
          proposedAction: "correct_metering_point_address",
          payload: { targetId: "MP-12345" },
        }),
        headers: expect.objectContaining({
          authorization: "Bearer ck_process_secret",
        }),
      }),
    );
    expect(result).toEqual({
      success: true,
      resolved: { kind: "process_intake", source: "process_intent_store" },
      receipt: {
        intentId: "intent-123",
        status: "pending_confirmation",
        requiresHumanConfirmation: true,
      },
      echoed: "[redacted]",
    });
  });

  it("validates read-only REST execution plans from Cernion", () => {
    expect(
      validateRestExecutionPlan({
        method: "GET",
        path: "/api/assets/solar",
        params: { location: "69168" },
        query: { commissioningYear: 2025 },
      }),
    ).toEqual({
      method: "GET",
      path: "/api/assets/solar",
      params: { location: "69168", commissioningYear: 2025 },
    });

    expect(() => validateRestExecutionPlan({ method: "POST", path: "/api/assets/solar" })).toThrow(/GET/);
    expect(() => validateRestExecutionPlan({ method: "GET", path: "https://cernion.example/api/assets/solar" })).toThrow(
      /relative \/api\//,
    );
    expect(() => validateRestExecutionPlan({ method: "GET", path: "/api/admin/users" })).toThrow(/read-only/);
    expect(() => validateRestExecutionPlan({ method: "GET", path: "/api/agent-sidecar/mcp/tools/cernion.ask/call" })).toThrow(
      /read-only/,
    );
  });

  it("proxies Cernion-issued read-only REST execution plans without exposing base URL or token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          success: true,
          assets: [{ see: "SEE912915502954", echoed: "ck_readonly_secret" }],
        }),
    } as Response);

    const result = await executeRestExecutionPlan(
      {
        baseUrl: "https://cernion.example/",
        bearerToken: "ck_readonly_secret",
      },
      {
        method: "GET",
        path: "/api/assets/solar",
        query: {
          location: "69168",
          minCapacityKW: 10,
          maxCapacityKW: 13,
          commissioningYear: 2025,
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/assets/solar?location=69168&minCapacityKW=10&maxCapacityKW=13&commissioningYear=2025",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer ck_readonly_secret",
        }),
      }),
    );
    expect(result).toEqual({
      success: true,
      assets: [{ see: "SEE912915502954", echoed: "[redacted]" }],
    });
  });

  it("can disable the direct REST proxy by configuration", async () => {
    await expect(
      executeRestExecutionPlan(
        {
          baseUrl: "https://cernion.example/",
          bearerToken: "ck_readonly_secret",
          allowRestProxy: false,
        },
        { method: "GET", path: "/api/assets/solar" },
      ),
    ).rejects.toThrow(/disabled/);
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
