import type { FilePatch, ProviderId, RepairProposal } from "../core/types.js";
import type { ProviderSettings } from "../core/providers.js";
import { geminiRepair, verifyGemini } from "./gemini.js";
import { anthropicRepair, anthropicVerify } from "./providers/anthropic.js";
import { azureRepair, azureVerify } from "./providers/azure.js";
import { bedrockRepair, bedrockVerify } from "./providers/bedrock.js";
import { groqRepair, groqVerify } from "./providers/groq.js";
import { ollamaRepair, ollamaVerify } from "./providers/ollama.js";
import { openAiRepair, openAiVerify } from "./providers/openai.js";

export interface AiRepairInput {
  provider: ProviderId;
  settings: ProviderSettings;
  model: string;
  context: string;
}

async function repair(
  provider: ProviderId,
  settings: ProviderSettings,
  model: string,
  context: string,
): Promise<{ summary: string; patches: FilePatch[] }> {
  switch (provider) {
    case "gemini":
      return await geminiRepair({ apiKey: settings.apiKey ?? "", model, context });
    case "groq":
      return await groqRepair(settings, model, context);
    case "openai":
      return await openAiRepair(settings, model, context);
    case "anthropic":
      return await anthropicRepair(settings, model, context);
    case "azure":
      return await azureRepair(settings, model, context);
    case "bedrock":
      return await bedrockRepair(settings, model, context);
    case "ollama":
      return await ollamaRepair(settings, model, context);
  }
}

export async function aiRepair(input: AiRepairInput): Promise<RepairProposal> {
  const result = await repair(input.provider, input.settings, input.model, input.context);
  return {
    engine: "ai",
    provider: input.provider,
    model: input.model,
    summary: result.summary,
    patches: result.patches,
  };
}

const verify = new Map<ProviderId, (settings: ProviderSettings, model: string) => Promise<string>>([
  ["gemini", async (settings, model) => await verifyGemini(settings.apiKey ?? "", model)],
  ["groq", groqVerify],
  ["openai", openAiVerify],
  ["anthropic", anthropicVerify],
  ["azure", azureVerify],
  ["bedrock", bedrockVerify],
  ["ollama", ollamaVerify],
]);

export async function verifyAi(
  provider: ProviderId,
  settings: ProviderSettings,
  model: string,
): Promise<string> {
  const check = verify.get(provider);
  if (!check) throw new Error(`No live check is available for provider "${provider}".`);
  return await check(settings, model);
}
