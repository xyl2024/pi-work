export type ModelsConfigPage =
  | { kind: "root" }
  | { kind: "provider"; name: string }
  | { kind: "model"; providerName: string; index: number }
  | { kind: "oauth"; providerId: string }
  | { kind: "apikey"; providerId: string }
  | { kind: "catalog" }
  | { kind: "addProvider" }
  | { kind: "addModelName"; providerName: string }
  | { kind: "fillModel"; providerName: string; index: number };

export type ModelsConfigFormPage = Exclude<ModelsConfigPage, { kind: "root" }>;

export function isModelsConfigFormPage(page: ModelsConfigPage): page is ModelsConfigFormPage {
  return page.kind !== "root";
}

export function modelsConfigPageTitleKey(page: ModelsConfigFormPage): string {
  switch (page.kind) {
    case "provider":
      return "Edit provider";
    case "model":
      return "Edit model";
    case "oauth":
      return "Sign in";
    case "apikey":
      return "API Key";
    case "catalog":
      return "All model data";
    case "addProvider":
      return "Add provider";
    case "addModelName":
      return "Add model";
    case "fillModel":
      return "Fill from model catalog";
  }
}

export interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
}

export interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
}

export type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

export interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: unknown[] };
  promptCache?: { short?: number; long?: number };
  inputLimits?: {
    maxRequestBytes?: number;
    images?: {
      resize?: { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number };
      maxPerMessage?: number;
      maxPerRequest?: number;
    };
  };
  samplingParams?: Record<string, unknown>;
  compat?: Record<string, unknown>;
  icon?: string;
}

export interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
  icon?: string;
}

export interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

export interface RuntimeModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; tiers?: unknown[] };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export interface RuntimeCatalogProvider {
  id: string;
  name: string;
  baseUrl?: string;
  headers?: Record<string, string | null>;
  dynamic: boolean;
  auth: { configured: boolean; source?: string; label?: string };
  models: RuntimeModelInfo[];
}

export interface RuntimeCatalog {
  providers: RuntimeCatalogProvider[];
  modelCount: number;
}
