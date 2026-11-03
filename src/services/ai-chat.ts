import { GoogleGenAI } from "@google/genai";
import type { ProviderId } from "../core/types.js";
import type { ProviderSettings } from "../core/providers.js";
import { postJson } from "./providers/http.js";

export interface AiChatInput {
  provider: ProviderId;
  settings: ProviderSettings;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export async function aiChat(input: AiChatInput): Promise<string> {
  const { provider, settings, model, systemPrompt, userPrompt } = input;
  const tokenLimit = input.maxTokens ?? 800;

  switch (provider) {
    case "gemini": {
      const ai = new GoogleGenAI({ apiKey: settings.apiKey ?? "" });
      const response = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2,
          maxOutputTokens: tokenLimit,
        },
      });
      return response.text?.trim() ?? "No response generated.";
    }

    case "groq": {
      const response = await postJson<{ choices?: Array<{ message?: { content?: string } }> }>({
        url: `${settings.baseUrl ?? "https://api.groq.com/openai/v1"}/chat/completions`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: tokenLimit,
        }),
        label: "Groq",
        timeoutMs: 30_000,
      });
      return response.choices?.[0]?.message?.content?.trim() ?? "No response generated.";
    }

    case "openai": {
      const response = await postJson<{ choices?: Array<{ message?: { content?: string } }> }>({
        url: `${settings.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey ?? ""}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: tokenLimit,
        }),
        label: "OpenAI",
        timeoutMs: 30_000,
      });
      return response.choices?.[0]?.message?.content?.trim() ?? "No response generated.";
    }

    case "anthropic": {
      const response = await postJson<{ content?: Array<{ text?: string }> }>({
        url: `${settings.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          max_tokens: tokenLimit,
          temperature: 0.2,
        }),
        label: "Anthropic",
        timeoutMs: 30_000,
      });
      return response.content?.[0]?.text?.trim() ?? "No response generated.";
    }

    case "ollama": {
      const response = await postJson<{ message?: { content?: string } }>({
        url: `${settings.baseUrl ?? "http://localhost:11434"}/api/chat`,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          options: {
            num_predict: tokenLimit,
          },
          stream: false,
        }),
        label: "Ollama",
        timeoutMs: 30_000,
      });
      return response.message?.content?.trim() ?? "No response generated.";
    }

    default:
      throw new Error(`Provider "${provider}" is not supported for chat.`);
  }
}

