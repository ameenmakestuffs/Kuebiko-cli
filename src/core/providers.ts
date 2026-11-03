import type { EngineMode, ProviderId } from "./types.js";
import { buildProviderLadder, isProviderId, PRIMARY_MODEL, PROVIDER_LABELS } from "./models.js";

export interface ProviderSettings {
  id: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  endpoint?: string;
  deployment?: string;
  apiVersion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
}

export interface ProviderResolution {
  provider: ProviderId | null;
  settings?: ProviderSettings;
  models: string[];
  error?: string;
  reason?: string;
}

export interface ResolveProviderInput {
  requested?: string;
  engine?: EngineMode;
  model?: string;
  configModel?: string;
}

const MODEL_ENV: Record<ProviderId, string> = {
  gemini: "GEMINI_MODEL",
  openai: "OPENAI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
  azure: "AZURE_OPENAI_DEPLOYMENT",
  bedrock: "BEDROCK_MODEL",
  ollama: "OLLAMA_MODEL",
};

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = clean(process.env[name]);
    if (value) return value;
  }
  return "";
}

export function providerLabel(provider: ProviderId): string {
  return PROVIDER_LABELS[provider];
}

export function providerEnvHint(provider: ProviderId): string {
  switch (provider) {
    case "gemini":
      return "GEMINI_API_KEY or GOOGLE_API_KEY";
    case "openai":
      return "OPENAI_API_KEY (optional OPENAI_BASE_URL, OPENAI_MODEL)";
    case "anthropic":
      return "ANTHROPIC_API_KEY (optional ANTHROPIC_BASE_URL, ANTHROPIC_MODEL)";
    case "azure":
      return "AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT";
    case "bedrock":
      return "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, BEDROCK_MODEL";
    case "ollama":
      return "OLLAMA_BASE_URL (default http://localhost:11434)";
  }
}

function normalizeBaseUrl(value: string, fallback: string): string {
  const raw = value || fallback;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function settingsFor(provider: ProviderId): { settings?: ProviderSettings; error?: string } {
  switch (provider) {
    case "gemini": {
      const apiKey = firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY");
      return apiKey
        ? { settings: { id: provider, apiKey } }
        : { error: `Missing ${providerEnvHint(provider)}.` };
    }
    case "openai": {
      const apiKey = firstEnv("OPENAI_API_KEY");
      return apiKey
        ? {
            settings: {
              id: provider,
              apiKey,
              baseUrl: normalizeBaseUrl(clean(process.env.OPENAI_BASE_URL), "https://api.openai.com/v1"),
            },
          }
        : { error: `Missing ${providerEnvHint(provider)}.` };
    }
    case "anthropic": {
      const apiKey = firstEnv("ANTHROPIC_API_KEY");
      return apiKey
        ? {
            settings: {
              id: provider,
              apiKey,
              baseUrl: normalizeBaseUrl(clean(process.env.ANTHROPIC_BASE_URL), "https://api.anthropic.com/v1"),
            },
          }
        : { error: `Missing ${providerEnvHint(provider)}.` };
    }
    case "azure": {
      const apiKey = firstEnv("AZURE_OPENAI_API_KEY");
      const endpoint = normalizeBaseUrl(clean(process.env.AZURE_OPENAI_ENDPOINT), "");
      if (!apiKey || !endpoint) {
        return { error: `Missing ${providerEnvHint(provider)}.` };
      }
      return {
        settings: {
          id: provider,
          apiKey,
          endpoint,
          deployment: firstEnv("AZURE_OPENAI_DEPLOYMENT") || undefined,
          apiVersion: clean(process.env.AZURE_OPENAI_API_VERSION) || "2024-10-21",
        },
      };
    }
    case "bedrock": {
      const accessKeyId = firstEnv("AWS_ACCESS_KEY_ID");
      const secretAccessKey = firstEnv("AWS_SECRET_ACCESS_KEY");
      const region = firstEnv("AWS_REGION", "AWS_DEFAULT_REGION");
      if (!accessKeyId || !secretAccessKey || !region) {
        return { error: `Missing ${providerEnvHint(provider)}.` };
      }
      return {
        settings: {
          id: provider,
          accessKeyId,
          secretAccessKey,
          sessionToken: clean(process.env.AWS_SESSION_TOKEN) || undefined,
          region,
          baseUrl: clean(process.env.BEDROCK_ENDPOINT) || undefined,
        },
      };
    }
    case "ollama": {
      return {
        settings: {
          id: provider,
          baseUrl: normalizeBaseUrl(
            firstEnv("OLLAMA_BASE_URL", "OLLAMA_HOST"),
            "http://localhost:11434",
          ),
        },
      };
    }
  }
}

function detectProvider(): ProviderId | null {
  const configured = clean(process.env.AEGIS_PROVIDER).toLowerCase();
  if (configured && configured !== "auto") {
    return isProviderId(configured) ? configured : null;
  }
  if (firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY")) return "gemini";
  if (firstEnv("OPENAI_API_KEY")) return "openai";
  if (firstEnv("ANTHROPIC_API_KEY")) return "anthropic";
  if (firstEnv("AZURE_OPENAI_API_KEY") && firstEnv("AZURE_OPENAI_ENDPOINT")) {
    return "azure";
  }
  if (
    firstEnv("AWS_ACCESS_KEY_ID") &&
    firstEnv("AWS_SECRET_ACCESS_KEY") &&
    firstEnv("AWS_REGION", "AWS_DEFAULT_REGION") &&
    firstEnv("BEDROCK_MODEL")
  ) {
    return "bedrock";
  }
  if (firstEnv("OLLAMA_BASE_URL", "OLLAMA_HOST")) return "ollama";
  return null;
}

export function resolveProvider(input: ResolveProviderInput = {}): ProviderResolution {
  const engine = input.engine ?? "auto";
  if (engine === "local") {
    return { provider: null, models: [], reason: "Local engine requested." };
  }

  const requested = clean(input.requested).toLowerCase();
  const configured = clean(process.env.AEGIS_PROVIDER).toLowerCase();
  const invalid = requested && requested !== "auto" && !isProviderId(requested)
    ? requested
    : !requested && configured && configured !== "auto" && !isProviderId(configured)
      ? configured
      : "";
  if (invalid) {
    return {
      provider: null,
      models: [],
      error: `Unknown provider "${invalid}". Use gemini, openai, anthropic, azure, bedrock, or ollama.`,
    };
  }

  let provider: ProviderId | null =
    requested && requested !== "auto" && isProviderId(requested) ? requested : null;
  if (!provider && engine === "gemini") provider = "gemini";
  if (!provider) provider = detectProvider();

  if (!provider) {
    return {
      provider: null,
      models: [],
      reason: "No AI provider configured.",
    };
  }

  const resolved = settingsFor(provider);
  if (!resolved.settings) {
    return { provider, models: [], error: resolved.error ?? `Provider ${provider} is not configured.` };
  }

  const configModel = clean(input.configModel);
  const configuredModel =
    clean(input.model) ||
    firstEnv("AEGIS_MODEL", MODEL_ENV[provider]) ||
    (configModel && (provider === "gemini" || configModel !== PRIMARY_MODEL) ? configModel : "");

  const models = buildProviderLadder(provider, configuredModel);
  if (models.length === 0) {
    return {
      provider,
      settings: resolved.settings,
      models,
      error:
        provider === "azure"
          ? "Azure OpenAI requires AZURE_OPENAI_DEPLOYMENT or --model."
          : "Bedrock requires BEDROCK_MODEL or --model.",
    };
  }

  return { provider, settings: resolved.settings, models };
}
