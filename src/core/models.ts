import type { ProviderId } from "./types.js";

export const PRIMARY_MODEL = "gemini-3.8-flash";
export const LITE_MODEL = "gemini-3.5-flash-lite";

export const DEFAULT_MODEL_LADDER = [PRIMARY_MODEL, LITE_MODEL] as const;

export const PROVIDER_IDS: ProviderId[] = [
  "gemini",
  "groq",
  "openai",
  "anthropic",
  "azure",
  "bedrock",
  "ollama",
];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: "Gemini",
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Anthropic",
  azure: "Azure OpenAI",
  bedrock: "AWS Bedrock",
  ollama: "Ollama",
};

export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string[]> = {
  gemini: [PRIMARY_MODEL, LITE_MODEL],
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile"],
  openai: ["gpt-4.1", "gpt-4.1-mini"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"],
  azure: [],
  bedrock: [],
  ollama: ["llama3.1"],
};

export function isProviderId(value: string | undefined): value is ProviderId {
  return value !== undefined && (PROVIDER_IDS as string[]).includes(value);
}

export function buildModelLadder(primary?: string): string[] {
  const first = primary?.trim() || PRIMARY_MODEL;
  return [...new Set([first, ...DEFAULT_MODEL_LADDER])];
}

export function buildProviderLadder(provider: ProviderId, primary?: string): string[] {
  const defaults = PROVIDER_DEFAULT_MODELS[provider];
  const first = primary?.trim();
  return [...new Set(first ? [first, ...defaults] : defaults)];
}
