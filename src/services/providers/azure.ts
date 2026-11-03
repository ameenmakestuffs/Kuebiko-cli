import type { FilePatch } from "../../core/types.js";
import type { ProviderSettings } from "../../core/providers.js";
import { CHECK_TIMEOUT_MS, REPAIR_TIMEOUT_MS } from "../prompt.js";
import { chatRepair, chatVerify } from "./chat.js";

function config(settings: ProviderSettings, model: string, timeoutMs: number) {
  const endpoint = (settings.endpoint ?? "").replace(/\/+$/, "");
  const deployment = model || settings.deployment || "";
  const apiVersion = settings.apiVersion || "2024-10-21";
  return {
    url: `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    headers: { "api-key": settings.apiKey ?? "" },
    model: deployment,
    label: "Azure OpenAI",
    timeoutMs,
    maxTokensField: "max_tokens" as const,
    jsonMode: true,
  };
}

export async function azureRepair(
  settings: ProviderSettings,
  model: string,
  context: string,
): Promise<{ summary: string; patches: FilePatch[] }> {
  return await chatRepair(config(settings, model, REPAIR_TIMEOUT_MS), context);
}

export async function azureVerify(settings: ProviderSettings, model: string): Promise<string> {
  return await chatVerify(config(settings, model, CHECK_TIMEOUT_MS));
}
