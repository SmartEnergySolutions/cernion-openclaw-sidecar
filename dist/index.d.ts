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
declare function requireConfig(config: PluginConfig): {
    baseUrl: string;
    bearerToken: string;
    timeoutMs: number;
};
declare function requireProcessConfig(config: PluginConfig): {
    baseUrl: string;
    bearerToken: string;
    timeoutMs: number;
};
declare function buildUrl(baseUrl: string, path: string): string;
declare function buildQueryPath(path: string, params?: Record<string, unknown>): string;
declare function isRestProxyAllowed(config: PluginConfig): boolean;
declare function validateRestExecutionPlan(plan: RestExecutionPlan): {
    method: "GET";
    path: string;
    params: Record<string, unknown>;
};
declare function validateEvidenceEndpointPlan(plan: EvidenceEndpointPlan): {
    method: "GET" | "POST";
    path: string;
    params: Record<string, unknown>;
    body?: Record<string, unknown>;
};
declare function executeRestExecutionPlan(config: PluginConfig, plan: RestExecutionPlan, signal?: AbortSignal): Promise<unknown>;
declare function routeEvidence(config: PluginConfig, request: {
    question: string;
    context?: Record<string, unknown>;
}, signal?: AbortSignal): Promise<unknown>;
declare function normalizeDomainKnowledgeQuery(request: DomainKnowledgeQuery): Record<string, unknown>;
declare function assessDomainKnowledgeEvidence(query: unknown, result: unknown): DomainKnowledgeEvidenceAssessment;
declare function pollCernionJobResult(config: PluginConfig, jobId: string, maxWaitMs: number, signal?: AbortSignal): Promise<unknown>;
declare function queryDomainKnowledge(config: PluginConfig, request: DomainKnowledgeQuery, signal?: AbortSignal): Promise<unknown>;
declare function executeEvidenceEndpointPlan(config: PluginConfig, plan: EvidenceEndpointPlan, signal?: AbortSignal): Promise<unknown>;
declare function requestCernion(config: PluginConfig, path: string, options?: RequestOptions): Promise<unknown>;
declare function requestCernionProcess(config: PluginConfig, path: string, options?: RequestOptions): Promise<unknown>;
declare function scrubSecretValues(value: unknown, token?: string): unknown;
declare const _default: import("openclaw/plugin-sdk/tool-plugin").DefinedToolPluginEntry;
export default _default;
export { buildQueryPath, buildUrl, executeEvidenceEndpointPlan, executeRestExecutionPlan, isRestProxyAllowed, normalizeDomainKnowledgeQuery, assessDomainKnowledgeEvidence, pollCernionJobResult, queryDomainKnowledge, requireConfig, requireProcessConfig, requestCernion, requestCernionProcess, routeEvidence, scrubSecretValues, validateEvidenceEndpointPlan, validateRestExecutionPlan, };
