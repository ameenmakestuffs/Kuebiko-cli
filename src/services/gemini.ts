import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { FilePatch, RepairProposal } from "../core/types.js";
import { CHECK_TIMEOUT_MS, REPAIR_TIMEOUT_MS, SYSTEM_INSTRUCTION } from "./prompt.js";

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: "One sentence describing the root cause and the fix.",
    },
    patches: {
      type: Type.ARRAY,
      description: "Complete corrected file contents. Return an empty array if no safe fix is possible.",
      items: {
        type: Type.OBJECT,
        properties: {
          path: {
            type: Type.STRING,
            description: "File path relative to the project root, using forward slashes.",
          },
          reason: {
            type: Type.STRING,
            description: "Why this file must change.",
          },
          content: {
            type: Type.STRING,
            description: "The complete new contents of the file, not a diff.",
          },
        },
        required: ["path", "reason", "content"],
      },
    },
  },
  required: ["summary", "patches"],
};

const FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

function sanitizePath(raw: string): string {
  const normalized = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return "";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return "";
  if (segments.some((segment) => segment === ".." || segment === ".")) return "";
  if (segments.some((segment) => [".git", "node_modules", "dist", "build", ".aegis"].includes(segment.toLowerCase()))) {
    return "";
  }
  const baseName = (segments[segments.length - 1] ?? "").toLowerCase();
  if (
    [
      ".env", ".env.local", ".npmrc", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
      "bun.lock", "bun.lockb", "go.sum", "cargo.lock", "composer.lock", "pipfile.lock", "poetry.lock",
    ].includes(baseName)
  ) {
    return "";
  }
  return segments.join("/");
}

export async function verifyGemini(apiKey: string, model: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: 'Reply with exactly this JSON: {"status":"ok"}',
    config: {
      responseMimeType: "application/json",
      temperature: 0,
      maxOutputTokens: 64,
      httpOptions: { timeout: CHECK_TIMEOUT_MS },
    },
  });
  return (response.text ?? "").trim();
}

export function parseProposal(text: string): { summary: string; patches: FilePatch[] } {
  const trimmed = text.trim();
  const fenced = FENCE_PATTERN.exec(trimmed);
  const payload = fenced?.[1] ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("The model returned a response that was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The model returned an unexpected response shape.");
  }

  const record = parsed as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "AI-generated repair";
  const rawPatches = Array.isArray(record.patches) ? record.patches : [];

  const patches: FilePatch[] = [];
  const seen = new Set<string>();

  for (const item of rawPatches) {
    if (!item || typeof item !== "object") continue;
    const patch = item as Record<string, unknown>;
    if (typeof patch.path !== "string" || typeof patch.content !== "string") continue;

    const path = sanitizePath(patch.path);
    if (!path || seen.has(path)) continue;
    if (patch.content.length > 2_000_000 || patch.content.includes("\u0000")) continue;

    seen.add(path);
    patches.push({
      path,
      content: patch.content,
      reason: typeof patch.reason === "string" && patch.reason.trim() ? patch.reason.trim() : "Targeted repair",
    });
    if (patches.length >= 8) break;
  }

  return { summary, patches };
}

export interface GeminiRepairInput {
  apiKey: string;
  model: string;
  context: string;
}

export async function geminiRepair(input: GeminiRepairInput): Promise<RepairProposal> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });

  let response;
  try {
    response = await ai.models.generateContent({
      model: input.model,
      contents: input.context,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.15,
        maxOutputTokens: 16_384,
        httpOptions: { timeout: REPAIR_TIMEOUT_MS },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Gemini request failed: ${message}`);
  }

  const text = response.text;
  if (!text || !text.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  const { summary, patches } = parseProposal(text);
  return { engine: "ai", provider: "gemini", model: input.model, summary, patches };
}
