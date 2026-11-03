import type { FilePatch } from "../../core/types.js";
import { parseProposal } from "../gemini.js";
import { SYSTEM_INSTRUCTION } from "../prompt.js";
import { postJson } from "./http.js";

export interface ChatCompletionConfig {
  url: string;
  headers: Record<string, string>;
  model: string;
  label: string;
  timeoutMs: number;
  maxTokens?: number;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  jsonMode?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

function completionText(response: ChatCompletionResponse, label: string): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${label} returned an empty response.`);
  }
  return content.trim();
}

async function requestChat(
  config: ChatCompletionConfig,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: 0.15,
    [config.maxTokensField ?? "max_tokens"]: maxTokens,
  };
  if (config.jsonMode) body.response_format = { type: "json_object" };

  const response = await postJson<ChatCompletionResponse>({
    url: config.url,
    headers: {
      "content-type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify(body),
    label: config.label,
    timeoutMs: config.timeoutMs,
  });

  return completionText(response, config.label);
}

export async function chatRepair(
  config: ChatCompletionConfig,
  context: string,
): Promise<{ summary: string; patches: FilePatch[] }> {
  const text = await requestChat(
    config,
    [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: context },
    ],
    config.maxTokens ?? 16_384,
  );
  return parseProposal(text);
}

export async function chatVerify(config: ChatCompletionConfig): Promise<string> {
  return await requestChat(
    config,
    [
      { role: "system", content: "Reply only with valid JSON." },
      { role: "user", content: 'Output a JSON object with key status and value ok: {"status":"ok"}' },
    ],
    Math.max(config.maxTokens ?? 512, 512),
  );
}
