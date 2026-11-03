import type { FilePatch } from "../../core/types.js";
import type { ProviderSettings } from "../../core/providers.js";
import { parseProposal } from "../gemini.js";
import { CHECK_TIMEOUT_MS, REPAIR_TIMEOUT_MS, SYSTEM_INSTRUCTION } from "../prompt.js";
import { postJson } from "./http.js";

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

function textOf(response: AnthropicResponse): string {
  const text = (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("Anthropic returned an empty response.");
  return text;
}

async function request(
  settings: ProviderSettings,
  model: string,
  messages: Array<{ role: "user"; content: string }>,
  maxTokens: number,
  system?: string,
): Promise<string> {
  const response = await postJson<AnthropicResponse>({
    url: `${settings.baseUrl ?? "https://api.anthropic.com/v1"}/messages`,
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.15,
      ...(system ? { system } : {}),
      messages,
    }),
    label: "Anthropic",
    timeoutMs: maxTokens <= 128 ? CHECK_TIMEOUT_MS : REPAIR_TIMEOUT_MS,
  });
  return textOf(response);
}

export async function anthropicRepair(
  settings: ProviderSettings,
  model: string,
  context: string,
): Promise<{ summary: string; patches: FilePatch[] }> {
  const text = await request(
    settings,
    model,
    [{ role: "user", content: context }],
    16_384,
    SYSTEM_INSTRUCTION,
  );
  return parseProposal(text);
}

export async function anthropicVerify(settings: ProviderSettings, model: string): Promise<string> {
  return await request(
    settings,
    model,
    [{ role: "user", content: 'Reply with exactly this JSON: {"status":"ok"}' }],
    64,
  );
}
