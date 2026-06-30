import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { readFileSync } from "node:fs";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_ASSET_LIST_LIMIT = 500;

const configSchema = Type.Object(
  {
    baseUrl: Type.Optional(Type.String({ description: "Cernion base URL, for example https://cernion.example" })),
    bearerToken: Type.Optional(Type.String({ description: "Read-only Cernion bearer token. Prefer the OpenClaw secret store." })),
    bearerTokenEnv: Type.Optional(Type.String({ description: "Environment variable name that contains the bearer token." })),
    bearerTokenFile: Type.Optional(Type.String({ description: "Path to a local 0600 file containing the read-only bearer token." })),
    processBearerToken: Type.Optional(
      Type.String({ description: "Cernion process-intake bearer token. Keep separate from the read-only token." }),
    ),
    processBearerTokenEnv: Type.Optional(
      Type.String({ description: "Environment variable name that contains the process-intake bearer token." }),
    ),
    processBearerTokenFile: Type.Optional(
      Type.String({ description: "Path to a local 0600 file containing the process-intake bearer token." }),
    ),
    allowRestProxy: Type.Optional(
      Type.Boolean({ description: "Allow read-only REST execution plans emitted by Cernion to be proxied through this sidecar." }),
    ),
    timeoutMs: Type.Optional(Type.Number({ description: "HTTP request timeout in milliseconds." })),
  },
  { additionalProperties: false },
);

type PluginConfig = {
  baseUrl?: string;
  bearerToken?: string;
  bearerTokenEnv?: string;
  bearerTokenFile?: string;
  processBearerToken?: string;
  processBearerTokenEnv?: string;
  processBearerTokenFile?: string;
  allowRestProxy?: boolean;
  timeoutMs?: number;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

type RestExecutionPlan = {
  method?: string;
  path: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  policy?: Record<string, unknown>;
};

type EvidenceEndpointPlan = RestExecutionPlan & {
  body?: Record<string, unknown>;
  resultKind?: string;
  purpose?: string;
};

type KnowledgeQueryType = "semantic" | "scroll" | "fetch" | "collection_info";

type DomainKnowledgeQuery = {
  queryType?: KnowledgeQueryType;
  query?: string;
  limit?: number;
  scoreThreshold?: number;
  ids?: Array<string | number>;
  offset?: unknown;
  filter?: Record<string, unknown>;
  withPayload?: boolean;
  withVectors?: boolean;
  waitForResult?: boolean;
  maxWaitMs?: number;
};

type DomainKnowledgeEvidenceAssessment = {
  assessmentScope: "primary_source_support";
  evidenceAdequacy: "low" | "medium" | "high";
  strongEvidenceCount: number;
  routingCardCount: number;
  weakOrOffTopicCount: number;
  topScore?: number;
  reasons: string[];
  answerGuidance: string;
};

type GridContextQuery = {
  location?: string;
  boundingBox?: Record<string, unknown>;
  gridOperator?: string;
  gridOperatorId?: string;
  voltageLevel?: "NS" | "MS" | "HS" | "EHS";
  includeSubstations?: boolean;
  includeTopology?: boolean;
  includeGeometry?: boolean;
  includeGraphData?: boolean;
  maxResults?: number;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readBearerTokenFile(path: string): string {
  const raw = readFileSync(path, "utf8").trim();
  const envMatch = raw.match(/^[A-Z0-9_]*TOKEN=(.*)$/m);
  return (envMatch ? envMatch[1] : raw).trim().replace(/^['"]|['"]$/g, "");
}

function resolveReadOnlyBearerToken(config: PluginConfig): string {
  const tokenEnv = (config.bearerTokenEnv || "CERNION_READONLY_TOKEN").trim();
  const tokenFile = (config.bearerTokenFile || process.env.CERNION_READONLY_TOKEN_FILE || "").trim();
  return (
    config.bearerToken ||
    process.env[tokenEnv] ||
    process.env.CERNION_SIDECAR_TOKEN ||
    (tokenFile ? readBearerTokenFile(tokenFile) : "")
  )
    .trim()
    .replace(/^Bearer\s+/i, "");
}

function requireConfig(config: PluginConfig): { baseUrl: string; bearerToken: string; timeoutMs: number } {
  const baseUrl = (config.baseUrl || process.env.CERNION_BASE_URL || "").trim();
  const bearerToken = resolveReadOnlyBearerToken(config);

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

function requireProcessConfig(config: PluginConfig): { baseUrl: string; bearerToken: string; timeoutMs: number } {
  const baseUrl = (config.baseUrl || process.env.CERNION_BASE_URL || "").trim();
  const tokenEnv = (config.processBearerTokenEnv || "CERNION_PROCESS_TOKEN").trim();
  const tokenFile = (config.processBearerTokenFile || process.env.CERNION_PROCESS_TOKEN_FILE || "").trim();
  const bearerToken = (
    config.processBearerToken ||
    process.env[tokenEnv] ||
    (tokenFile ? readBearerTokenFile(tokenFile) : "")
  )
    .trim()
    .replace(/^Bearer\s+/i, "");

  if (!baseUrl) {
    throw new Error("Cernion baseUrl is required. Set plugin config baseUrl or CERNION_BASE_URL.");
  }
  if (!bearerToken) {
    throw new Error(
      "Cernion process-intake bearer token is required. Set processBearerToken, processBearerTokenFile, or CERNION_PROCESS_TOKEN.",
    );
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

function buildQueryPath(path: string, params: Record<string, unknown> = {}): string {
  const queryParams = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "") {
      queryParams.append(key, String(val));
    }
  }
  if (!queryParams.toString()) return path;

  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${queryParams.toString()}`;
}

function parseQueryPath(path: string): { pathname: string; params: Record<string, unknown> } {
  const [pathname, rawQuery = ""] = path.split("?", 2);
  const params: Record<string, unknown> = {};
  const searchParams = new URLSearchParams(rawQuery);
  for (const [key, value] of searchParams.entries()) {
    params[key] = value;
  }
  return { pathname, params };
}

function isAssetListPath(path: string): boolean {
  const { pathname } = parseQueryPath(path);
  const normalizedPath = pathname.toLowerCase();
  return normalizedPath === "/api/assets" || normalizedPath.startsWith("/api/assets/");
}

function normalizeReadOnlyGetParams(path: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  const mergedParams = { ...parseQueryPath(path).params, ...params };
  if (!isAssetListPath(path)) return mergedParams;
  if (mergedParams.limit !== undefined && mergedParams.limit !== null && mergedParams.limit !== "") return mergedParams;
  return {
    ...mergedParams,
    limit: DEFAULT_ASSET_LIST_LIMIT,
  };
}

function buildReadOnlyGetPath(path: string, params: Record<string, unknown> = {}): string {
  const { pathname } = parseQueryPath(path);
  return buildQueryPath(pathname, normalizeReadOnlyGetParams(path, params));
}

function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 1) return activeSignals[0];
  const alreadyAborted = activeSignals.find((signal) => signal.aborted);
  if (alreadyAborted) return alreadyAborted;

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function isRestProxyAllowed(config: PluginConfig): boolean {
  if (config.allowRestProxy !== undefined) return config.allowRestProxy;
  const value = (process.env.CERNION_ALLOW_REST_PROXY || "").trim().toLowerCase();
  if (!value) return true;
  return !["0", "false", "no", "off"].includes(value);
}

function validateRestExecutionPlan(plan: RestExecutionPlan): { method: "GET"; path: string; params: Record<string, unknown> } {
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

function assertRelativeApiPath(path: string): void {
  if (!path || typeof path !== "string") {
    throw new Error("Cernion API plan requires a relative Cernion API path.");
  }

  if (path.includes("://") || path.startsWith("//") || !path.startsWith("/api/")) {
    throw new Error("Cernion API plan path must be a relative /api/ path.");
  }
}

function assertNotBlockedPath(path: string): void {
  const lowerPath = path.toLowerCase();
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
    throw new Error("Cernion API plan path is outside the Sidecar proxy boundary.");
  }
}

function validateEvidenceEndpointPlan(plan: EvidenceEndpointPlan): {
  method: "GET" | "POST";
  path: string;
  params: Record<string, unknown>;
  body?: Record<string, unknown>;
} {
  const method = (plan.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    throw new Error("Only read-only GET or POST evidence endpoint plans can be proxied by the Cernion Sidecar.");
  }

  assertRelativeApiPath(plan.path);
  assertNotBlockedPath(plan.path);

  const lowerPath = plan.path.toLowerCase();
  if (lowerPath.startsWith("/api/copilot-process")) {
    throw new Error("Process Intake paths must not be executed through the Evidence Endpoint proxy.");
  }

  if (plan.policy?.readOnly !== true) {
    throw new Error("Evidence endpoint plan requires policy.readOnly=true from Cernion.");
  }
  if (plan.policy?.sideEffects !== undefined && plan.policy.sideEffects !== "none") {
    throw new Error("Evidence endpoint plan requires sideEffects=none.");
  }

  const params = { ...(plan.params || {}), ...(plan.query || {}) };
  return {
    method: method as "GET" | "POST",
    path: plan.path,
    params,
    body: plan.body || params,
  };
}

async function executeRestExecutionPlan(
  config: PluginConfig,
  plan: RestExecutionPlan,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!isRestProxyAllowed(config)) {
    throw new Error("Cernion read-only REST proxy is disabled by configuration.");
  }

  const validated = validateRestExecutionPlan(plan);
  const params = normalizeReadOnlyGetParams(validated.path, validated.params);
  const result = await requestCernion(config, buildReadOnlyGetPath(validated.path, validated.params), {
    method: validated.method,
    signal,
  });
  return annotateAssetListResult(result, validated.path, params);
}

async function routeEvidence(
  config: PluginConfig,
  request: { question: string; context?: Record<string, unknown> },
  signal?: AbortSignal,
): Promise<unknown> {
  return requestCernion(config, "/api/evidence-router/route", {
    method: "POST",
    body: {
      question: request.question,
      context: request.context || {},
    },
    signal,
  });
}

function normalizeDomainKnowledgeQuery(request: DomainKnowledgeQuery): Record<string, unknown> {
  const queryType = request.queryType || "semantic";
  if (!["semantic", "scroll", "fetch", "collection_info"].includes(queryType)) {
    throw new Error("queryType must be one of semantic, scroll, fetch, collection_info.");
  }

  if (queryType === "semantic" && !String(request.query || "").trim()) {
    throw new Error("query is required for semantic domain knowledge lookup.");
  }

  if (queryType === "fetch" && (!Array.isArray(request.ids) || request.ids.length === 0)) {
    throw new Error("ids is required for fetch domain knowledge lookup.");
  }

  const limit =
    request.limit === undefined || request.limit === null
      ? 10
      : Math.max(1, Math.min(100, Number(request.limit)));

  return {
    queryType,
    ...(request.query === undefined ? {} : { query: request.query }),
    limit,
    ...(request.scoreThreshold === undefined ? {} : { scoreThreshold: request.scoreThreshold }),
    ...(request.ids === undefined ? {} : { ids: request.ids }),
    ...(request.offset === undefined ? {} : { offset: request.offset }),
    ...(request.filter === undefined ? {} : { filter: request.filter }),
    withPayload: request.withPayload === undefined ? true : request.withPayload,
    withVectors: request.withVectors === true,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPositiveInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined;
  return Math.floor(numberValue);
}

function countListItems(result: Record<string, unknown>): number | undefined {
  const candidates = [
    result.assets,
    result.items,
    result.results,
    result.installations,
    result.data,
    getNestedObject(result, ["data"]).assets,
    getNestedObject(result, ["data"]).items,
    getNestedObject(result, ["data"]).results,
    getNestedObject(result, ["structuredContent"]).assets,
    getNestedObject(result, ["structuredContent"]).items,
    getNestedObject(result, ["structuredContent"]).results,
  ];
  const list = candidates.find(Array.isArray);
  return Array.isArray(list) ? list.length : undefined;
}

function extractTotalCount(result: Record<string, unknown>): number | undefined {
  const candidates = [
    result.total,
    result.totalCount,
    result.totalResults,
    result.totalMatchingAssetsCount,
    result.countTotal,
    getNestedObject(result, ["data"]).total,
    getNestedObject(result, ["data"]).totalCount,
    getNestedObject(result, ["data"]).totalMatchingAssetsCount,
    getNestedObject(result, ["structuredContent"]).total,
    getNestedObject(result, ["structuredContent"]).totalCount,
    getNestedObject(result, ["structuredContent"]).totalMatchingAssetsCount,
  ];
  return candidates.map(toPositiveInteger).find((value) => value !== undefined);
}

function annotateAssetListResult(result: unknown, path: string, params: Record<string, unknown>): unknown {
  if (!isAssetListPath(path) || !isObject(result) || result.isError === true) return result;

  const { pathname } = parseQueryPath(path);
  const requestedLimit = toPositiveInteger(params.limit);
  if (!requestedLimit) return result;

  const returnedCount = countListItems(result);
  const totalCount = extractTotalCount(result);
  const limitExhausted = returnedCount !== undefined && returnedCount >= requestedLimit;
  const hasMore = totalCount !== undefined ? totalCount > (returnedCount || 0) : limitExhausted;
  if (!limitExhausted && !hasMore) return result;

  const nextOffset = toPositiveInteger(params.offset) || 0;
  const nextPageParams = {
    ...params,
    offset: nextOffset + requestedLimit,
    limit: requestedLimit,
  };
  const exportBaseParams = { ...params, limit: totalCount || requestedLimit };

  return {
    ...result,
    _sidecar: {
      assetListPagination: {
        requestedLimit,
        returnedCount,
        ...(totalCount === undefined ? {} : { totalCount }),
        limitExhausted,
        hasMore,
        nextPage: {
          path: pathname,
          params: nextPageParams,
        },
      },
      exportOptions: [
        {
          format: "csv",
          path: pathname,
          params: { ...exportBaseParams, format: "csv" },
        },
        {
          format: "xls",
          path: pathname,
          params: { ...exportBaseParams, format: "xls" },
        },
      ],
      answerGuidance:
        "Do not present the current rows as a complete asset inventory when limitExhausted=true or hasMore=true. Tell the user how many rows were returned, mention the requested limit, and offer CSV/XLS export or the next page.",
    },
  };
}

function getNestedObject(value: unknown, path: string[]): Record<string, unknown> {
  let current: unknown = value;
  for (const segment of path) {
    if (!isObject(current)) return {};
    current = current[segment];
  }
  return isObject(current) ? current : {};
}

function getNestedString(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const segment of path) {
    if (!isObject(current)) return "";
    current = current[segment];
  }
  return typeof current === "string" ? current : "";
}

function collectDomainKnowledgeResults(result: unknown): Record<string, unknown>[] {
  if (!isObject(result)) return [];
  const directResults = Array.isArray(result.results) ? result.results : undefined;
  const dataResults = isObject(result.data) && Array.isArray(result.data.results) ? result.data.results : undefined;
  return (dataResults || directResults || []).filter(isObject);
}

function normalizedText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value).toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return "";
  }
}

function queryMarkers(query: unknown): string[] {
  const text = normalizedText(query);
  const explicitRefs = Array.from(text.matchAll(/§\s*\d+[a-z]?|\b\d+[a-z]?\s*enwg\b|\benwg\b|\bbnetza\b/g)).map(
    (match) => match[0].replace(/\s+/g, " ").trim(),
  );
  const words = text
    .replace(/[^\p{L}\p{N}§]+/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !["welche", "ergeben", "sich", "aus", "eine", "einer", "einem"].includes(word));
  return Array.from(new Set([...explicitRefs, ...words])).slice(0, 12);
}

function isRoutingCard(hit: Record<string, unknown>): boolean {
  const metadata = getNestedObject(hit, ["metadata"]);
  const payloadMetadata = getNestedObject(hit, ["payload", "metadata"]);
  const source = String(payloadMetadata.source || metadata.source || "").toLowerCase();
  const kind = String(payloadMetadata.kind || metadata.kind || hit.type || "").toLowerCase();
  const documentId = String(getNestedString(hit, ["payload", "documentId"]) || hit.documentId || "").toLowerCase();

  return (
    source === "manual_strategy_cards" ||
    kind === "strategy_pattern_card" ||
    kind.includes("synonym") ||
    documentId.startsWith("strategy:")
  );
}

function hasSourceMetadata(hit: Record<string, unknown>): boolean {
  const metadata = getNestedObject(hit, ["metadata"]);
  const payloadMetadata = getNestedObject(hit, ["payload", "metadata"]);
  return Boolean(
    metadata.title ||
      metadata.authority ||
      metadata.docType ||
      metadata.status ||
      payloadMetadata.sourceUrl ||
      payloadMetadata.title ||
      payloadMetadata.authority ||
      payloadMetadata.docType ||
      payloadMetadata.status,
  );
}

function matchesQuery(hit: Record<string, unknown>, markers: string[]): boolean {
  if (markers.length === 0) return true;
  const text = normalizedText({
    referenceText_L0: hit.referenceText_L0,
    vectorText: hit.vectorText,
    metadata: hit.metadata,
    oeoTags: hit.oeoTags,
    payload: hit.payload,
  });
  return markers.some((marker) => text.includes(marker));
}

function assessDomainKnowledgeEvidence(query: unknown, result: unknown): DomainKnowledgeEvidenceAssessment {
  const hits = collectDomainKnowledgeResults(result);
  const markers = queryMarkers(query);
  let strongEvidenceCount = 0;
  let routingCardCount = 0;
  let weakOrOffTopicCount = 0;
  let topScore: number | undefined;

  for (const hit of hits) {
    const score = typeof hit.score === "number" ? hit.score : undefined;
    if (topScore === undefined && score !== undefined) topScore = score;

    const routingCard = isRoutingCard(hit);
    if (routingCard) {
      routingCardCount += 1;
    }

    const strong =
      !routingCard &&
      hasSourceMetadata(hit) &&
      matchesQuery(hit, markers) &&
      (score === undefined || score >= 0.65);

    if (strong) {
      strongEvidenceCount += 1;
    } else if (!routingCard) {
      weakOrOffTopicCount += 1;
    }
  }

  const reasons: string[] = [];
  if (hits.length === 0) reasons.push("Knowledge RAG returned no result chunks.");
  if (routingCardCount > 0) {
    reasons.push("One or more hits are Cernion routing/synonym strategy cards, not primary-source support for hard obligations.");
  }
  if (weakOrOffTopicCount > 0) {
    reasons.push("One or more hits lack source metadata, query match, or semantic score for primary-source support.");
  }
  if (strongEvidenceCount === 0) {
    reasons.push("No strong primary/source-backed evidence chunk was found for a hard legal or procedural claim.");
  }

  let evidenceAdequacy: DomainKnowledgeEvidenceAssessment["evidenceAdequacy"] = "low";
  if (strongEvidenceCount >= 2) evidenceAdequacy = "high";
  else if (strongEvidenceCount === 1) evidenceAdequacy = "medium";

  const answerGuidance =
    evidenceAdequacy === "high"
      ? "The assistant may synthesize a fachliche answer, but should cite or name the Cernion evidence used and keep operational status separate."
      : evidenceAdequacy === "medium"
        ? "The assistant may answer only the points directly supported by the sourced Cernion evidence and should state remaining evidence gaps."
        : "The assistant must not present a legal or procedural answer as fully evidenced by Cernion primary sources. State that Cernion returned useful domain or strategy knowledge, but primary-source support for hard obligations is insufficient. Use routing-card content as orientation and avoid filling gaps from model memory or web search unless explicitly requested.";

  return {
    assessmentScope: "primary_source_support",
    evidenceAdequacy,
    strongEvidenceCount,
    routingCardCount,
    weakOrOffTopicCount,
    ...(topScore === undefined ? {} : { topScore }),
    reasons,
    answerGuidance,
  };
}

function normalizeGridContextQuery(request: GridContextQuery): Record<string, unknown> {
  const location = String(request.location || "").trim();
  const gridOperator = String(request.gridOperator || "").trim();
  const gridOperatorId = String(request.gridOperatorId || "").trim();
  const boundingBox = isObject(request.boundingBox) ? request.boundingBox : undefined;

  if (!location && !boundingBox && !gridOperator) {
    throw new Error("location, boundingBox, or gridOperator is required for OSM grid context lookup.");
  }

  const voltageLevel = request.voltageLevel;
  if (voltageLevel !== undefined && !["NS", "MS", "HS", "EHS"].includes(voltageLevel)) {
    throw new Error("voltageLevel must be one of NS, MS, HS, EHS.");
  }

  const includeSubstations = request.includeSubstations !== false;
  const includeTopology = request.includeTopology === true;
  if (!includeSubstations && !includeTopology) {
    throw new Error("At least one of includeSubstations or includeTopology must be true.");
  }

  return {
    ...(location ? { location } : {}),
    ...(boundingBox ? { boundingBox } : {}),
    ...(gridOperator ? { gridOperator } : {}),
    ...(gridOperatorId ? { gridOperatorId } : {}),
    ...(voltageLevel ? { voltageLevel } : {}),
    includeSubstations,
    includeTopology,
    includeGeometry: request.includeGeometry === true,
    includeGraphData: request.includeGraphData === true,
    maxResults:
      request.maxResults === undefined || request.maxResults === null
        ? 200
        : Math.max(1, Math.min(1000, Number(request.maxResults))),
  };
}

function assessGridContextEvidence(substations: unknown, topology: unknown): Record<string, unknown> {
  const substationData = getNestedObject(substations, ["data"]);
  const topologyData = getNestedObject(topology, ["data"]);
  const substationSummary = getNestedObject(substationData, ["summary"]);
  const topologyMetrics = getNestedObject(topologyData, ["topologyMetrics"]);
  const topologyQuality = getNestedObject(topologyData, ["dataQuality"]);
  const substationQuality = getNestedObject(substationData, ["dataQuality"]);

  const totalSubstations = Number(substationSummary.totalSubstations || 0);
  const nodes = Number(topologyMetrics.nodes || 0);
  const edges = Number(topologyMetrics.edges || 0);
  const coverageLabel = String(topologyQuality.coverageLabel || substationQuality.coverageLabel || "UNKNOWN");

  let hypothesisStrength = "low";
  if ((totalSubstations > 0 && nodes > 0) || edges > 0) hypothesisStrength = "medium";
  if (totalSubstations >= 5 && edges >= 5 && ["MEDIUM", "HIGH"].includes(coverageLabel)) hypothesisStrength = "medium";

  const warnings = [
    "OSM grid context is public visible-infrastructure evidence and must be treated as a planning hypothesis, not as a Netzverträglichkeitsprüfung or capacity proof.",
    "OSM coverage for German distribution grids is incomplete; missing substations, lines, or voltage tags do not prove absence.",
  ];

  if (totalSubstations === 0 && nodes === 0 && edges === 0) {
    warnings.push("No visible grid objects were found in the requested OSM scope.");
  }

  return {
    evidenceType: "osm_visible_grid_context",
    hypothesisStrength,
    coverageLabel,
    totalSubstations,
    topologyNodes: nodes,
    topologyEdges: edges,
    answerGuidance:
      "Use this evidence to make ZNP, voltage-level, and siting hypotheses more concrete. Do not claim actual remaining capacity, protection settings, switching state, or asset ownership unless separate Cernion/operator evidence supports it.",
    warnings,
  };
}

async function queryGridContext(
  config: PluginConfig,
  request: GridContextQuery,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const query = normalizeGridContextQuery(request);
  const common = {
    ...(query.location ? { location: query.location } : {}),
    ...(query.boundingBox ? { boundingBox: query.boundingBox } : {}),
    ...(query.gridOperator ? { gridOperator: query.gridOperator } : {}),
    ...(query.gridOperatorId ? { gridOperatorId: query.gridOperatorId } : {}),
    ...(query.voltageLevel ? { voltageLevel: query.voltageLevel } : {}),
  };

  const substations =
    query.includeSubstations === true
      ? await requestCernionDegraded(config, "/api/osm-geo/substation-finder", {
          method: "POST",
          body: {
            ...common,
            maxResults: query.maxResults,
            include_geometry: query.includeGeometry,
          },
          signal,
        })
      : null;

  const topology =
    query.includeTopology === true
      ? await requestCernionDegraded(config, "/api/osm-geo/grid-topology", {
          method: "POST",
          body: {
            ...common,
            includeGraphData: query.includeGraphData,
          },
          signal,
        })
      : null;

  return {
    kind: "grid_context",
    source: "osm_geo",
    query,
    evidenceAssessment: assessGridContextEvidence(substations, topology),
    results: {
      substations,
      topology,
    },
  };
}

async function requestCernionDegraded(
  config: PluginConfig,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  try {
    return await requestCernion(config, path, options);
  } catch (error) {
    return {
      isError: true,
      error: {
        code: "cernion_request_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      structuredContent: {
        path,
        degraded: true,
      },
    };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Cernion Knowledge RAG polling aborted."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Cernion Knowledge RAG polling aborted."));
      },
      { once: true },
    );
  });
}

async function pollCernionJobResult(
  config: PluginConfig,
  jobId: string,
  maxWaitMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const deadline = Date.now() + Math.max(1000, maxWaitMs);
  let lastStatus: unknown = null;

  while (Date.now() < deadline) {
    const status = await requestCernion(config, `/api/jobs/${encodeURIComponent(jobId)}/status`, {
      method: "GET",
      signal,
    });
    lastStatus = status;

    if (isObject(status) && status.status === "completed") {
      const resultUrl =
        typeof status.resultUrl === "string" && status.resultUrl.startsWith("/api/")
          ? status.resultUrl
          : `/api/jobs/${encodeURIComponent(jobId)}/result`;
      return requestCernion(config, resultUrl, { method: "GET", signal });
    }

    if (isObject(status) && status.status === "error") {
      return {
        isError: true,
        error: {
          code: "cernion_knowledge_rag_job_error",
          status: "error",
        },
        structuredContent: status,
      };
    }

    await sleep(500, signal);
  }

  return {
    kind: "domain_knowledge_job",
    source: "knowledge_rag",
    status: "pending",
    message: "Cernion Knowledge RAG job is still running. Poll resultUrl later if needed.",
    jobId,
    statusUrl: `/api/jobs/${encodeURIComponent(jobId)}/status`,
    resultUrl: `/api/jobs/${encodeURIComponent(jobId)}/result`,
    lastStatus,
  };
}

async function queryDomainKnowledge(
  config: PluginConfig,
  request: DomainKnowledgeQuery,
  signal?: AbortSignal,
): Promise<unknown> {
  const body = normalizeDomainKnowledgeQuery(request);
  const initial = await requestCernion(config, "/api/knowledge-rag/query", {
    method: "POST",
    body,
    signal,
  });

  if (!isObject(initial) || initial.isError === true || !initial.jobId || request.waitForResult === false) {
    return {
      kind: "domain_knowledge",
      source: "knowledge_rag",
      query: body,
      evidenceAssessment: assessDomainKnowledgeEvidence(body.query, initial),
      result: initial,
    };
  }

  const maxWaitMs =
    request.maxWaitMs === undefined
      ? Math.min(requireConfig(config).timeoutMs, 30000)
      : Math.max(1000, Math.min(60000, Number(request.maxWaitMs)));
  const result = await pollCernionJobResult(config, String(initial.jobId), maxWaitMs, signal);

  return {
    kind: "domain_knowledge",
    source: "knowledge_rag",
    query: body,
    job: initial,
    evidenceAssessment: assessDomainKnowledgeEvidence(body.query, result),
    result,
  };
}

async function executeEvidenceEndpointPlan(
  config: PluginConfig,
  plan: EvidenceEndpointPlan,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!isRestProxyAllowed(config)) {
    throw new Error("Cernion read-only REST proxy is disabled by configuration.");
  }

  const validated = validateEvidenceEndpointPlan(plan);
  if (validated.method === "GET") {
    const params = normalizeReadOnlyGetParams(validated.path, validated.params);
    const result = await requestCernion(config, buildReadOnlyGetPath(validated.path, validated.params), {
      method: "GET",
      signal,
    });
    return annotateAssetListResult(result, validated.path, params);
  }

  return requestCernion(config, validated.path, {
    method: "POST",
    body: validated.body,
    signal,
  });
}

async function requestCernion(config: PluginConfig, path: string, options: RequestOptions = {}): Promise<unknown> {
  const { baseUrl, bearerToken, timeoutMs } = requireConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = combineAbortSignals(options.signal ? [options.signal, controller.signal] : [controller.signal]);

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
  } finally {
    clearTimeout(timeout);
  }
}

async function requestCernionProcess(config: PluginConfig, path: string, options: RequestOptions = {}): Promise<unknown> {
  const { baseUrl, bearerToken, timeoutMs } = requireProcessConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = combineAbortSignals(options.signal ? [options.signal, controller.signal] : [controller.signal]);

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
  } finally {
    clearTimeout(timeout);
  }
}

function scrubSecretValues(value: unknown, token?: string): unknown {
  const serialized = JSON.stringify(value);
  if (!serialized) return value;
  if (!token) return value;
  const scrubbed = token ? serialized.split(token).join("[redacted]") : serialized;
  return JSON.parse(scrubbed);
}

export default defineToolPlugin({
  id: "cernion-energy-tools-sidecar",
  name: "Cernion Energy Tools Sidecar",
  description:
    "Give OpenClaw agents Cernion-backed energy evidence for MaStR assets, grid context, Redispatch, ZNP, §14a/§14d, Knowledge RAG, process intake, and read-only operational APIs.",
  configSchema,
  tools: (tool) => [
    tool({
      name: "cernion_query_domain_knowledge",
      label: "Query Cernion Fachwissen",
      description:
        "Query Cernion Knowledge RAG for read-only regulatory, procedural, and fachliche domain knowledge before using web search or operative backend hydration. Use this for laws, BNetzA guidance, Verfahrensanweisungen, roles, obligations, definitions, and consulting-at-the-job context. Treat the returned evidenceAssessment as binding primary-source support, not as a judgment on Cernion's domain knowledge quality: if evidenceAdequacy is low, do not answer legal/procedural duties as settled from Cernion primary sources; say Cernion returned useful domain/strategy knowledge but not enough primary-source support for hard obligations, and avoid filling gaps from model memory or web search unless the user explicitly asks.",
      parameters: Type.Object({
        queryType: Type.Optional(Type.String({ description: "Knowledge RAG mode: semantic, scroll, fetch, or collection_info. Defaults to semantic." })),
        query: Type.Optional(Type.String({ description: "Natural-language fachliche/regulatory knowledge question. Required for semantic lookup." })),
        limit: Type.Optional(Type.Number({ description: "Maximum results, 1..100. Defaults to 10." })),
        scoreThreshold: Type.Optional(Type.Number({ description: "Optional semantic score threshold." })),
        ids: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number()]), { description: "Point ids for fetch mode." })),
        offset: Type.Optional(Type.Any({ description: "Optional offset for scroll mode." })),
        filter: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Optional Qdrant-style metadata filter, for example authority/docType/status." })),
        withPayload: Type.Optional(Type.Boolean({ description: "Return document payload/metadata when available. Defaults to true for consulting evidence." })),
        withVectors: Type.Optional(Type.Boolean({ description: "Return vectors. Defaults to false and should usually stay false." })),
        waitForResult: Type.Optional(Type.Boolean({ description: "Wait briefly for async Knowledge RAG job completion. Defaults to true." })),
        maxWaitMs: Type.Optional(Type.Number({ description: "Maximum wait time for async job result, bounded to 1..60 seconds." })),
      }),
      execute: async (params, config, context) => {
        const result = await queryDomainKnowledge(config, params as DomainKnowledgeQuery, context.signal);
        return scrubSecretValues(result, config.bearerToken);
      },
    }),
    tool({
      name: "cernion_query_grid_context",
      label: "Query Cernion OSM Grid Context",
      description:
        "Query Cernion OSM Geo endpoints for read-only visible grid infrastructure context such as substations, transformers, voltage levels, lines, and topology metrics. Use this for ZNP, Netzanschluss, siting, fNAV, charging-hub, data-center, storage, PV, or voltage-level hypotheses before making concrete statements about likely critical network areas. Treat the result as OSM-based hypothesis evidence only: it can make planning assumptions more concrete, but it is not a capacity proof, Netzverträglichkeitsprüfung, switching-state model, or complete operator asset inventory. For data centers and other large loads, do not rank sites from OSM or grid-expansion proximity alone; explicit grid-connection availability maps, published connection capacity, and operator-confirmed Anschlusskapazität outrank generic Ausbau or proximity evidence.",
      parameters: Type.Object({
        location: Type.Optional(Type.String({ description: "Area name, municipality, city, or district, e.g. 'Sinsheim'." })),
        boundingBox: Type.Optional(
          Type.Record(Type.String(), Type.Any(), {
            description: "Optional geographic bounding box with north/south/east/west values.",
          }),
        ),
        gridOperator: Type.Optional(Type.String({ description: "Optional grid operator name to scope/fallback OSM area lookup." })),
        gridOperatorId: Type.Optional(Type.String({ description: "Optional MaStR/VNB grid operator id if already known." })),
        voltageLevel: Type.Optional(Type.String({ description: "Optional voltage-level filter: NS, MS, HS, or EHS." })),
        includeSubstations: Type.Optional(Type.Boolean({ description: "Call /api/osm-geo/substation-finder. Defaults to true." })),
        includeTopology: Type.Optional(
          Type.Boolean({
            description:
              "Call /api/osm-geo/grid-topology. Defaults to false; enable for candidate-area drill-down rather than broad county searches.",
          }),
        ),
        includeGeometry: Type.Optional(Type.Boolean({ description: "Include substation polygon geometry when available. Defaults to false." })),
        includeGraphData: Type.Optional(Type.Boolean({ description: "Include raw topology graph data. Defaults to false." })),
        maxResults: Type.Optional(Type.Number({ description: "Maximum returned substation records, 1..1000. Defaults to 200." })),
      }),
      execute: async (params, config, context) => {
        const result = await queryGridContext(config, params as GridContextQuery, context.signal);
        return scrubSecretValues(result, config.bearerToken);
      },
    }),
    tool({
      name: "cernion_route_evidence",
      label: "Route Cernion Evidence",
      description:
        "Ask Cernion's backend Evidence Router for read-only endpoint recommendations and fachliche result semantics. Cernion does not execute these endpoints or synthesize the final answer.",
      parameters: Type.Object({
        question: Type.String({ description: "Natural-language request describing the evidence needed." }),
        context: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Optional canonical input values such as location, dateFrom, dateTo, assetType, or region." })),
      }),
      execute: async ({ question, context: requestContext = {} }, config, context) => {
        const result = await routeEvidence(config, { question, context: requestContext }, context.signal);
        return scrubSecretValues(result, config.bearerToken);
      },
    }),
    tool({
      name: "cernion_execute_evidence_endpoint",
      label: "Execute Cernion Evidence Endpoint",
      description:
        "Execute one read-only GET or POST evidence endpoint recommended by cernion_route_evidence. Requires Cernion policy.readOnly=true and sideEffects=none, blocks process/admin/token/HITL/provider-tool paths, and returns scrubbed structured results for OpenClaw-side transformation. For Cernion asset-list GET endpoints, the Sidecar sets an explicit default limit when none is provided and adds _sidecar pagination/export guidance when the returned rows exhaust the limit.",
      parameters: Type.Object({
        method: Type.Optional(Type.String({ description: "HTTP method from the recommended endpoint. Only GET or POST is allowed." })),
        path: Type.String({ description: "Relative Cernion API path from the recommended endpoint, e.g. /api/energy-market/co2-intensity." }),
        params: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Query parameters from the recommended endpoint." })),
        query: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Alias for params, used by Evidence Router recommendation envelopes." })),
        body: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Optional POST body. Defaults to query/params for POST evidence endpoints." })),
        resultKind: Type.Optional(Type.String({ description: "Evidence result kind, e.g. time_series, asset_table, market_signal." })),
        purpose: Type.Optional(Type.String({ description: "Purpose/id from the Evidence Router recommendation." })),
        policy: Type.Record(Type.String(), Type.Any(), { description: "Policy metadata from Cernion; must include readOnly=true." }),
      }),
      execute: async (plan, config, context) => {
        const result = await executeEvidenceEndpointPlan(config, plan, context.signal);
        return scrubSecretValues(result, config.bearerToken);
      },
    }),
    tool({
      name: "cernion_prepare_process_intent",
      label: "Prepare Cernion Process Intent",
      description:
        "Send user-provided process data or a write/process intent to Cernion's separate Process Intake boundary. Creates only a pending_confirmation receipt; it does not execute the process intent.",
      parameters: Type.Object({
        operationFamily: Type.String({ description: "Generic process family, excluding Cernion-reserved families that have dedicated prepare actions." }),
        proposedAction: Type.String({ description: "Requested process action. Cernion rejects registered read-only actions here." }),
        targetType: Type.Optional(Type.String({ description: "Optional process target type." })),
        targetId: Type.Optional(Type.String({ description: "Optional process target id." })),
        inputSummary: Type.Optional(Type.String({ description: "Optional concise summary of user-provided process data." })),
        payload: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Structured process data supplied by the user." })),
        risk: Type.Optional(Type.String({ description: "Risk classification hint: low, medium, or high." })),
        reason: Type.Optional(Type.String({ description: "Reason or user instruction behind this intake." })),
        correlationId: Type.Optional(Type.String({ description: "Optional correlation id." })),
        decisionFrameId: Type.Optional(Type.String({ description: "Optional decision frame id." })),
      }),
      execute: async (params, config, context) => {
        const result = await requestCernionProcess(config, "/api/copilot-process/intents", {
          method: "POST",
          body: params,
          signal: context.signal,
        });
        const processToken = requireProcessConfig(config).bearerToken;
        return scrubSecretValues(result, processToken);
      },
    }),
    tool({
      name: "cernion_ask",
      label: "Ask Cernion",
      description:
        "Ask Cernion through the generic provider gate. Cernion may answer directly or return structured capability, blueprint, evidence, and read-only REST execution-plan hints that OpenClaw can reuse.",
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
      description: "Load the Cernion Energy Tools Sidecar descriptor from Cernion without exposing bearer tokens.",
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
      description:
        "Resolve capability cluster heads from the llm.txt manifest to full Cernion capability details via GET /api/_agent/capabilities. Optionally filter by canonical manifest domain.",
      parameters: Type.Object({
        domain: Type.Optional(
          Type.String({ description: "Optional canonical manifest domain, e.g. 'redispatch' or 'grid-ops'." }),
        ),
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
      description:
        "Resolve one Cernion capability id from the llm.txt manifest to its full capability detail via GET /api/_agent/capabilities/:name.",
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
      description:
        "Resolve operation clusters from the llm.txt manifest to deduplicated Cernion OpenAPI operation details via GET /api/_agent/operations. Duplicate operationIds are returned as one canonical path with aliases.",
      parameters: Type.Object({
        domain: Type.Optional(
          Type.String({ description: "Optional canonical manifest domain, e.g. 'redispatch' or 'grid-ops'." }),
        ),
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
      description:
        "Proxy one read-only Cernion REST execution plan emitted by cernion.ask or the Cernion blueprint/capability runtime. The Sidecar supplies the configured base URL and bearer token, validates the plan as GET-only, and returns scrubbed structured results. For Cernion asset-list endpoints, it sets an explicit default limit when none is provided and adds _sidecar pagination/export guidance when the returned rows exhaust the limit.",
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
      description: "Perform an authenticated read-only GET request directly against Cernion Energy Tools (CET). Must be used to resolve capabilities, operations, or query specific domain data (like assets.solar) following the llm.txt RESOLUTION PROTOCOL. For Cernion asset-list endpoints, the Sidecar sets an explicit default limit when none is provided and adds _sidecar pagination/export guidance when the returned rows exhaust the limit.",
      parameters: Type.Object({
        path: Type.String({ description: "The API path to call, e.g. '/api/_agent/capabilities', '/api/_agent/operations', '/api/assets/solar'." }),
        params: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Query parameters to append to the GET request." })),
      }),
      execute: async ({ path, params = {} }, config, context) => {
        const normalizedParams = normalizeReadOnlyGetParams(path, params);
        const result = await requestCernion(config, buildReadOnlyGetPath(path, params), {
          method: "GET",
          signal: context.signal,
        });
        return scrubSecretValues(annotateAssetListResult(result, path, normalizedParams), config.bearerToken);
      },
    }),
  ],
});

export {
  buildQueryPath,
  buildUrl,
  executeEvidenceEndpointPlan,
  executeRestExecutionPlan,
  isRestProxyAllowed,
  normalizeDomainKnowledgeQuery,
  normalizeGridContextQuery,
  assessDomainKnowledgeEvidence,
  assessGridContextEvidence,
  pollCernionJobResult,
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
};
