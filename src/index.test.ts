import { afterEach, describe, expect, it, vi } from "vitest";
import entry, {
  assessDomainKnowledgeEvidence,
  buildQueryPath,
  buildUrl,
  executeEvidenceEndpointPlan,
  executeRestExecutionPlan,
  normalizeDomainKnowledgeQuery,
  normalizeGridContextQuery,
  queryGridContext,
  queryDomainKnowledge,
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
  "cernion_query_domain_knowledge",
  "cernion_query_grid_context",
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
    vi.useRealTimers();
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

  it("normalizes Knowledge RAG requests for consulting-style fachwissen lookup", () => {
    expect(
      normalizeDomainKnowledgeQuery({
        query: "Welche Pflichten ergeben sich aus §14a EnWG für den Netzbetreiber?",
        limit: 200,
      }),
    ).toEqual({
      queryType: "semantic",
      query: "Welche Pflichten ergeben sich aus §14a EnWG für den Netzbetreiber?",
      limit: 100,
      withPayload: true,
      withVectors: false,
    });

    expect(() => normalizeDomainKnowledgeQuery({ queryType: "semantic" })).toThrow(/query is required/);
    expect(() => normalizeDomainKnowledgeQuery({ queryType: "fetch" })).toThrow(/ids is required/);
  });

  it("queries Cernion Knowledge RAG and auto-polls async job results", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        statusText: "Accepted",
        text: async () =>
          JSON.stringify({
            success: true,
            jobId: "job-123",
            status: "queued",
            statusUrl: "/api/jobs/job-123/status",
            resultUrl: "/api/jobs/job-123/result",
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            jobId: "job-123",
            status: "completed",
            resultUrl: "/api/jobs/job-123/result",
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              queryType: "semantic",
              returned: 1,
              results: [
                {
                  pointId: "doc-14a",
                  score: 0.91,
                  referenceText_L0: "Netzbetreiber müssen steuerbare Verbrauchseinrichtungen netzorientiert steuern.",
                  metadata: { title: "§14a EnWG Prozesswissen", authority: "BNetzA" },
                  echoed: "ck_readonly_secret",
                },
              ],
            },
          }),
      } as Response);

    const result = await queryDomainKnowledge(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      {
        query: "Welche Pflichten ergeben sich aus §14a EnWG?",
        limit: 5,
        maxWaitMs: 1000,
      },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://cernion.example/api/knowledge-rag/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          queryType: "semantic",
          query: "Welche Pflichten ergeben sich aus §14a EnWG?",
          limit: 5,
          withPayload: true,
          withVectors: false,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://cernion.example/api/jobs/job-123/status",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://cernion.example/api/jobs/job-123/result",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toEqual({
      kind: "domain_knowledge",
      source: "knowledge_rag",
      query: {
        queryType: "semantic",
        query: "Welche Pflichten ergeben sich aus §14a EnWG?",
        limit: 5,
        withPayload: true,
        withVectors: false,
      },
      job: {
        success: true,
        jobId: "job-123",
        status: "queued",
        statusUrl: "/api/jobs/job-123/status",
        resultUrl: "/api/jobs/job-123/result",
      },
      evidenceAssessment: {
        assessmentScope: "primary_source_support",
        evidenceAdequacy: "medium",
        strongEvidenceCount: 1,
        routingCardCount: 0,
        weakOrOffTopicCount: 0,
        topScore: 0.91,
        reasons: [],
        answerGuidance:
          "The assistant may answer only the points directly supported by the sourced Cernion evidence and should state remaining evidence gaps.",
      },
      result: {
        success: true,
        data: {
          queryType: "semantic",
          returned: 1,
          results: [
            {
              pointId: "doc-14a",
              score: 0.91,
              referenceText_L0: "Netzbetreiber müssen steuerbare Verbrauchseinrichtungen netzorientiert steuern.",
              metadata: { title: "§14a EnWG Prozesswissen", authority: "BNetzA" },
              echoed: "[redacted]",
            },
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("ck_readonly_secret");
  });

  it("marks routing cards and weak hits as insufficient domain evidence", () => {
    expect(
      assessDomainKnowledgeEvidence("Welche Pflichten ergeben sich aus §14a EnWG?", {
        success: true,
        data: {
          returned: 2,
          results: [
            {
              pointId: "strategy-14a",
              score: 0.6,
              referenceText_L0: "Regulatorische Synonymkarte fuer §14a-EnWG-Flexibilitaet.",
              payload: {
                documentId: "strategy:regulatory-14a-flexibility",
                metadata: { source: "manual_strategy_cards", kind: "strategy_pattern_card" },
              },
            },
            {
              pointId: "agnes",
              score: 0.59,
              referenceText_L0: "Vertrauensschutz und Art. 14 GG im Kontext von AgNes.",
              metadata: { title: "AgNes Stellungnahme", authority: "BNetzA", status: "in_kraft" },
            },
          ],
        },
      }),
    ).toEqual({
      assessmentScope: "primary_source_support",
      evidenceAdequacy: "low",
      strongEvidenceCount: 0,
      routingCardCount: 1,
      weakOrOffTopicCount: 1,
      topScore: 0.6,
      reasons: [
        "One or more hits are Cernion routing/synonym strategy cards, not primary-source support for hard obligations.",
        "One or more hits lack source metadata, query match, or semantic score for primary-source support.",
        "No strong primary/source-backed evidence chunk was found for a hard legal or procedural claim.",
      ],
      answerGuidance:
        "The assistant must not present a legal or procedural answer as fully evidenced by Cernion primary sources. State that Cernion returned useful domain or strategy knowledge, but primary-source support for hard obligations is insufficient. Use routing-card content as orientation and avoid filling gaps from model memory or web search unless explicitly requested.",
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

  it("normalizes OSM grid context queries and requires a scope", () => {
    expect(normalizeGridContextQuery({ location: "Rhein-Neckar-Kreis" })).toMatchObject({
      location: "Rhein-Neckar-Kreis",
      includeSubstations: true,
      includeTopology: false,
    });

    expect(
      normalizeGridContextQuery({
        location: " Sinsheim ",
        voltageLevel: "MS",
        includeGraphData: true,
        includeTopology: true,
        maxResults: 5000,
      }),
    ).toEqual({
      location: "Sinsheim",
      voltageLevel: "MS",
      includeSubstations: true,
      includeTopology: true,
      includeGeometry: false,
      includeGraphData: true,
      maxResults: 1000,
    });

    expect(() => normalizeGridContextQuery({})).toThrow(/location, boundingBox, or gridOperator/);
    expect(() => normalizeGridContextQuery({ location: "Sinsheim", voltageLevel: "MV" as never })).toThrow(/voltageLevel/);
    expect(() =>
      normalizeGridContextQuery({ location: "Sinsheim", includeSubstations: false, includeTopology: false }),
    ).toThrow(/At least one/);
  });

  it("queries Cernion OSM grid context as hypothesis evidence", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              summary: {
                totalSubstations: 8,
                byVoltageLevel: { MS_HS: 2, NS_MS: 6 },
              },
              dataQuality: { coverageLabel: "MEDIUM" },
              echoed: "ck_readonly_secret",
            },
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              topologyMetrics: {
                nodes: 12,
                edges: 9,
                topologyType: "MIXED",
                voltageBreakdown: { MS: { nodes: 10, edges: 8 }, HS: { nodes: 2, edges: 1 } },
              },
              dataQuality: { coverageLabel: "MEDIUM", osmEdgeCoverageEstimate: 0.47 },
              echoed: "ck_readonly_secret",
            },
          }),
      } as Response);

    const result = await queryGridContext(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      {
        location: "Sinsheim",
        voltageLevel: "MS",
        includeTopology: true,
        maxResults: 50,
      },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://cernion.example/api/osm-geo/substation-finder",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          location: "Sinsheim",
          voltageLevel: "MS",
          maxResults: 50,
          include_geometry: false,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://cernion.example/api/osm-geo/grid-topology",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          location: "Sinsheim",
          voltageLevel: "MS",
          includeGraphData: false,
        }),
      }),
    );
    expect(result).toMatchObject({
      kind: "grid_context",
      source: "osm_geo",
      evidenceAssessment: {
        evidenceType: "osm_visible_grid_context",
        hypothesisStrength: "medium",
        coverageLabel: "MEDIUM",
        totalSubstations: 8,
        topologyNodes: 12,
        topologyEdges: 9,
      },
      results: {
        substations: { success: true, data: { echoed: "[redacted]" } },
        topology: { success: true, data: { echoed: "[redacted]" } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("ck_readonly_secret");
  });

  it("degrades OSM grid context lookup failures into evidence gaps", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Overpass timeout"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            success: true,
            data: {
              topologyMetrics: { nodes: 0, edges: 0 },
              dataQuality: { coverageLabel: "LOW" },
            },
          }),
      } as Response);

    const result = await queryGridContext(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
      },
      {
        location: "Sinsheim",
        includeTopology: true,
      },
    );

    expect(result).toMatchObject({
      kind: "grid_context",
      source: "osm_geo",
      evidenceAssessment: {
        hypothesisStrength: "low",
        topologyNodes: 0,
        topologyEdges: 0,
      },
      results: {
        substations: {
          isError: true,
          error: { code: "cernion_request_failed", message: "Overpass timeout" },
        },
      },
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
      "https://cernion.example/api/assets/solar?location=69168&minCapacityKW=10&maxCapacityKW=13&commissioningYear=2025&limit=500",
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

  it("adds asset-list pagination and export guidance when a REST plan exhausts its limit", async () => {
    const assets = Array.from({ length: 3 }, (_value, index) => ({ see: `SEE-${index + 1}` }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          success: true,
          totalCount: 570,
          assets,
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
          location: "74909",
          limit: 3,
        },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cernion.example/api/assets/solar?location=74909&limit=3",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result).toMatchObject({
      success: true,
      totalCount: 570,
      assets,
      _sidecar: {
        assetListPagination: {
          requestedLimit: 3,
          returnedCount: 3,
          totalCount: 570,
          limitExhausted: true,
          hasMore: true,
          nextPage: {
            path: "/api/assets/solar",
            params: {
              location: "74909",
              limit: 3,
              offset: 3,
            },
          },
        },
        exportOptions: [
          {
            format: "csv",
            path: "/api/assets/solar",
            params: {
              location: "74909",
              limit: 570,
              format: "csv",
            },
          },
          {
            format: "xls",
            path: "/api/assets/solar",
            params: {
              location: "74909",
              limit: 570,
              format: "xls",
            },
          },
        ],
      },
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

  it("honors the Sidecar timeout even when OpenClaw supplies an abort signal", async () => {
    const externalController = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")), {
            once: true,
          });
        }) as Promise<Response>,
    );

    const request = requestCernion(
      {
        baseUrl: "https://cernion.example",
        bearerToken: "ck_readonly_secret",
        timeoutMs: 10,
      },
      "/api/osm-geo/substation-finder",
      { method: "POST", body: { location: "Rhein-Neckar-Kreis" }, signal: externalController.signal },
    );

    await expect(request).rejects.toThrow(/aborted/i);
    expect(externalController.signal.aborted).toBe(false);
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
