type PluginConfig = {
    baseUrl?: string;
    bearerToken?: string;
    bearerTokenEnv?: string;
    bearerTokenFile?: string;
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
declare function requireConfig(config: PluginConfig): {
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
declare function executeRestExecutionPlan(config: PluginConfig, plan: RestExecutionPlan, signal?: AbortSignal): Promise<unknown>;
declare function requestCernion(config: PluginConfig, path: string, options?: RequestOptions): Promise<unknown>;
declare function scrubSecretValues(value: unknown, token?: string): unknown;
declare const _default: import("openclaw/plugin-sdk/tool-plugin").DefinedToolPluginEntry;
export default _default;
export { buildQueryPath, buildUrl, executeRestExecutionPlan, isRestProxyAllowed, requireConfig, requestCernion, scrubSecretValues, validateRestExecutionPlan, };
