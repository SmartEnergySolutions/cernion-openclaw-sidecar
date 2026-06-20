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
declare function requireConfig(config: PluginConfig): {
    baseUrl: string;
    bearerToken: string;
    timeoutMs: number;
};
declare function buildUrl(baseUrl: string, path: string): string;
declare function requestCernion(config: PluginConfig, path: string, options?: RequestOptions): Promise<unknown>;
declare function scrubSecretValues(value: unknown, token?: string): unknown;
declare const _default: import("openclaw/plugin-sdk/tool-plugin").DefinedToolPluginEntry;
export default _default;
export { buildUrl, requireConfig, requestCernion, scrubSecretValues };
