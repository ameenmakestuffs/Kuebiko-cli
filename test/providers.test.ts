import test from "node:test";
import assert from "node:assert/strict";
import { resolveProvider } from "../src/core/providers.ts";
import {
  buildProviderLadder,
  isProviderId,
  LITE_MODEL,
  PRIMARY_MODEL,
} from "../src/core/models.ts";

const ENV_KEYS = [
  "AEGIS_PROVIDER",
  "AEGIS_MODEL",
  "AEGIS_ENGINE",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "BEDROCK_MODEL",
  "BEDROCK_ENDPOINT",
  "OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "OLLAMA_MODEL",
];

function withCleanEnv(run: () => void): void {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("provider ladders preserve a custom primary and fall back to provider defaults", () => {
  assert.deepEqual(buildProviderLadder("gemini", "custom"), ["custom", PRIMARY_MODEL, LITE_MODEL]);
  assert.deepEqual(buildProviderLadder("openai", "custom"), ["custom", "gpt-4.1", "gpt-4.1-mini"]);
  assert.deepEqual(buildProviderLadder("azure"), []);
  assert.equal(isProviderId("ollama"), true);
  assert.equal(isProviderId("unknown"), false);
});

test("auto detection resolves a configured OpenAI provider", () => {
  withCleanEnv(() => {
    process.env.OPENAI_API_KEY = "test-key";
    const resolution = resolveProvider();
    assert.equal(resolution.provider, "openai");
    assert.deepEqual(resolution.models, ["gpt-4.1", "gpt-4.1-mini"]);
    assert.equal(resolution.settings?.baseUrl, "https://api.openai.com/v1");
  });
});

test("an explicit provider reports missing configuration without exposing secrets", () => {
  withCleanEnv(() => {
    const resolution = resolveProvider({ requested: "bedrock", engine: "auto" });
    assert.equal(resolution.provider, "bedrock");
    assert.match(resolution.error ?? "", /AWS_ACCESS_KEY_ID/);
    assert.equal(resolution.models.length, 0);
  });
});

test("an invalid AEGIS_PROVIDER is reported instead of silently ignored", () => {
  withCleanEnv(() => {
    process.env.AEGIS_PROVIDER = "not-a-provider";
    const resolution = resolveProvider();
    assert.equal(resolution.provider, null);
    assert.match(resolution.error ?? "", /Unknown provider/);
  });
});

test("Azure accepts a deployment supplied through --model", () => {
  withCleanEnv(() => {
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    const resolution = resolveProvider({ requested: "azure", engine: "auto", model: "my-deployment" });
    assert.equal(resolution.provider, "azure");
    assert.deepEqual(resolution.models, ["my-deployment"]);
    assert.equal(resolution.settings?.endpoint, "https://example.openai.azure.com");
    assert.equal(resolution.error, undefined);
  });
});

test("Ollama works without a key and uses the local default endpoint", () => {
  withCleanEnv(() => {
    const resolution = resolveProvider({ requested: "ollama", engine: "auto" });
    assert.equal(resolution.provider, "ollama");
    assert.equal(resolution.settings?.baseUrl, "http://localhost:11434");
    assert.deepEqual(resolution.models, ["llama3.1"]);
  });
});

test("engine local bypasses provider detection", () => {
  withCleanEnv(() => {
    process.env.OPENAI_API_KEY = "test-key";
    const resolution = resolveProvider({ engine: "local" });
    assert.equal(resolution.provider, null);
  });
});
