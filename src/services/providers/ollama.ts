import type { FilePatch } from "../../core/types.js";
import type { ProviderSettings } from "../../core/providers.js";
import { CHECK_TIMEOUT_MS, REPAIR_TIMEOUT_MS } from "../prompt.js";
import { chatRepair, chatVerify } from "./chat.js";

function config(settings: ProviderSettings, model: string, timeoutMs: number) {
  const baseUrl = (settings.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
  return {
    url: `${baseUrl}/v1/chat/completions`,
    headers: {},
    model,
    label: "Ollama",
    timeoutMs,
    maxTokensField: "max_tokens" as const,
    jsonMode: false,
  };
}

export async function ollamaRepair(
  settings: ProviderSettings,
  model: string,
  context: string,
): Promise<{ summary: string; patches: FilePatch[] }> {
  return await chatRepair(config(settings, model, REPAIR_TIMEOUT_MS), context);
}

export async function ollamaVerify(settings: ProviderSettings, model: string): Promise<string> {
  return await chatVerify(config(settings, model, CHECK_TIMEOUT_MS));
}
