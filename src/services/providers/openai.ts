import type { FilePatch } from "../../core/types.js";
import type { ProviderSettings } from "../../core/providers.js";
import { REPAIR_TIMEOUT_MS, CHECK_TIMEOUT_MS } from "../prompt.js";
import { chatRepair, chatVerify } from "./chat.js";

function config(settings: ProviderSettings, model: string, timeoutMs: number) {
  return {
    url: `${settings.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
    headers: { authorization: `Bearer ${settings.apiKey ?? ""}` },
    model,
    label: "OpenAI",
    timeoutMs,
    maxTokensField: "max_completion_tokens" as const,
    jsonMode: true,
  };
}

export async function openAiRepair(
  settings: ProviderSettings,
  model: string,
  context: string,
): Promise<{ summary: string; patches: FilePatch[] }> {
  return await chatRepair(config(settings, model, REPAIR_TIMEOUT_MS), context);
}

export async function openAiVerify(settings: ProviderSettings, model: string): Promise<string> {
  return await chatVerify(config(settings, model, CHECK_TIMEOUT_MS));
}
