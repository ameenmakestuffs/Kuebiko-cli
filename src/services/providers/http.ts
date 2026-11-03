import { redactSecrets } from "../../util/text.js";

function errorDetail(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "empty response";
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) {
      return redactSecrets(message.trim()).slice(0, 300);
    }
  } catch {
    // Fall through to the raw body.
  }
  return redactSecrets(trimmed).slice(0, 300);
}

export interface PostJsonInput {
  url: string;
  headers: Record<string, string>;
  body: string;
  label: string;
  timeoutMs: number;
}

export async function postJson<T>(input: PostJsonInput): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(input.url, {
        method: "POST",
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${input.label} request timed out after ${Math.round(input.timeoutMs / 1000)}s.`);
      }
      throw new Error(`${input.label} request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${input.label} request failed (${response.status}): ${errorDetail(text)}`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${input.label} returned a response that was not valid JSON.`);
    }
  } finally {
    clearTimeout(timer);
  }
}
