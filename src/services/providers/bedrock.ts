import { createHash, createHmac } from "node:crypto";
import type { FilePatch } from "../../core/types.js";
import type { ProviderSettings } from "../../core/providers.js";
import { redactSecrets } from "../../util/text.js";
import { parseProposal } from "../gemini.js";
import { CHECK_TIMEOUT_MS, REPAIR_TIMEOUT_MS, SYSTEM_INSTRUCTION } from "../prompt.js";

const SERVICE = "bedrock";

interface BedrockResponse {
  output?: {
    message?: {
      content?: Array<{ text?: string }>;
    };
  };
  message?: string;
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function timestamp(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function bedrockUrl(settings: ProviderSettings, model: string): string {
  const base = (settings.baseUrl ?? `https://bedrock-runtime.${settings.region ?? "us-east-1"}.amazonaws.com`).replace(
    /\/+$/,
    "",
  );
  return `${base}/model/${encodeURIComponent(model)}/converse`;
}

function sign(settings: ProviderSettings, url: string, body: string): SignedRequest {
  const parsed = new URL(url);
  const { amzDate, dateStamp } = timestamp(new Date());
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (settings.sessionToken) headers["x-amz-security-token"] = settings.sessionToken;

  const sorted = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = sorted.map(([key, value]) => `${key}:${value}\n`).join("");
  const signedHeaders = sorted.map(([key]) => key).join(";");
  const canonicalRequest = ["POST", parsed.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const region = settings.region ?? "us-east-1";
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(settings.secretAccessKey ?? "", dateStamp, region), stringToSign).toString("hex");

  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${settings.accessKeyId ?? ""}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (settings.sessionToken) requestHeaders["x-amz-security-token"] = settings.sessionToken;

  return { url, headers: requestHeaders, body };
}

async function post(settings: ProviderSettings, model: string, body: string, timeoutMs: number): Promise<string> {
  const signed = sign(settings, bedrockUrl(settings, model), body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`AWS Bedrock request timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }
      throw new Error(`AWS Bedrock request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const text = await response.text();
    if (!response.ok) {
      let detail = text.trim().slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === "string") detail = parsed.message.slice(0, 300);
      } catch {
        // Keep the raw body.
      }
      throw new Error(`AWS Bedrock request failed (${response.status}): ${redactSecrets(detail)}`);
    }

    let parsed: BedrockResponse;
    try {
      parsed = JSON.parse(text) as BedrockResponse;
    } catch {
      throw new Error("AWS Bedrock returned a response that was not valid JSON.");
    }

    const output = (parsed.output?.message?.content ?? [])
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();
    if (!output) throw new Error("AWS Bedrock returned an empty response.");
    return output;
  } finally {
    clearTimeout(timer);
  }
}

function bodyFor(context: string, maxTokens: number, withSystem: boolean): string {
  return JSON.stringify({
    ...(withSystem ? { system: [{ text: SYSTEM_INSTRUCTION }] } : {}),
    messages: [{ role: "user", content: [{ text: context }] }],
    inferenceConfig: { maxTokens, temperature: 0.15 },
  });
}

export async function bedrockRepair(
  settings: ProviderSettings,
  model: string,
  context: string,
): Promise<{ summary: string; patches: FilePatch[] }> {
  const text = await post(settings, model, bodyFor(context, 16_384, true), REPAIR_TIMEOUT_MS);
  return parseProposal(text);
}

export async function bedrockVerify(settings: ProviderSettings, model: string): Promise<string> {
  const text = await post(
    settings,
    model,
    bodyFor('Reply with exactly this JSON: {"status":"ok"}', 64, false),
    CHECK_TIMEOUT_MS,
  );
  return text;
}
