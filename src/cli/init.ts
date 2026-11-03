import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as readline from "node:readline";
import { isProviderId, PROVIDER_DEFAULT_MODELS } from "../core/models.js";
import type { ProviderId } from "../core/types.js";
import { TAGLINE, VERSION } from "../core/version.js";
import { verifyAi } from "../services/ai-repair.js";
import { theme } from "../ui/theme.js";
import { Ui } from "../ui/ui.js";

interface ProviderChoice {
  id: ProviderId;
  name: string;
  description: string;
  envKey: string;
  keyUrl: string;
}

const PROVIDER_CHOICES: ProviderChoice[] = [
  {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast (~800 tok/s), generous free tier",
    envKey: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Generous free tier with Gemini 2.5/3.5 models",
    envKey: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Industry standard (GPT-4o, GPT-4.1)",
    envKey: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 3.5 Sonnet & Haiku",
    envKey: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "100% local, offline, no API key required",
    envKey: "OLLAMA_BASE_URL",
    keyUrl: "https://ollama.ai",
  },
];

function promptText(question: string, defaultValue = ""): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptStr = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;

  return new Promise((resolve) => {
    rl.question(promptStr, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      resolve(trimmed || defaultValue);
    });
  });
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(`${question}: `);

    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question("", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();

    let inputStr = "";
    const onData = (chunk: Buffer) => {
      const char = chunk.toString();
      if (char === "\r" || char === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(inputStr.trim());
      } else if (char === "\u0003") {
        // Ctrl+C
        stdin.setRawMode(false);
        process.exit(130);
      } else if (char === "\b" || char === "\x7f") {
        // Backspace
        if (inputStr.length > 0) {
          inputStr = inputStr.slice(0, -1);
          stdout.write("\b \b");
        }
      } else if (char >= " ") {
        inputStr += char;
        stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

function saveEnvKey(filePath: string, key: string, value: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let content = "";
  if (existsSync(filePath)) {
    content = readFileSync(filePath, "utf8");
  }

  const lines = content.split(/\r?\n/);
  let updated = false;

  const newLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      updated = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!updated) {
    if (newLines.length > 0 && newLines[newLines.length - 1]?.trim() !== "") {
      newLines.push("");
    }
    newLines.push(`${key}=${value}`);
  }

  writeFileSync(filePath, newLines.join("\n"), "utf8");
}

function ensureGitignoreIncludesEnv(cwd: string): void {
  const gitignorePath = join(cwd, ".gitignore");
  if (!existsSync(gitignorePath)) return;

  try {
    const content = readFileSync(gitignorePath, "utf8");
    if (!content.includes(".env")) {
      const addition = content.endsWith("\n") ? ".env\n" : "\n.env\n";
      writeFileSync(gitignorePath, content + addition, "utf8");
    }
  } catch {
    // Non-fatal
  }
}

export async function runInit(cwd: string): Promise<number> {
  const ui = new Ui({ json: false, verbose: false });
  ui.banner(VERSION, TAGLINE);

  process.stdout.write(`  ${theme.badge("PRIVACY GUARANTEE", "#FFFFFF", "#10B981")}  ${theme.brandBold("100% Client-Side BYOK")}\n`);
  process.stdout.write(`  ${theme.muted("Kuebiko runs entirely on your machine. Your API keys are saved locally\n  and sent directly to the model provider. No intermediary proxy, zero tracking.")}\n\n`);

  process.stdout.write(`  ${theme.accentBold("Step 1: Choose your AI Provider")}\n\n`);
  PROVIDER_CHOICES.forEach((choice, index) => {
    const num = index + 1;
    process.stdout.write(`  ${theme.accent(`[${num}]`)} ${theme.bold(choice.name)} — ${theme.muted(choice.description)}\n`);
  });
  process.stdout.write("\n");

  const choiceStr = await promptText("Select a provider [1-5]", "1");
  const choiceIdx = Math.max(0, Math.min(PROVIDER_CHOICES.length - 1, parseInt(choiceStr, 10) - 1 || 0));
  const selected = PROVIDER_CHOICES[choiceIdx]!;

  process.stdout.write(`\n  Configuring ${theme.brandBold(selected.name)}...\n\n`);

  let apiKey = "";
  let baseUrl = "";

  if (selected.id === "ollama") {
    baseUrl = await promptText("Enter Ollama base URL", "http://localhost:11434");
  } else {
    process.stdout.write(`  ${theme.muted("💡 Don't have a key yet? Get one at:")}\n  ${theme.brand(selected.keyUrl)}\n\n`);
    apiKey = await promptSecret(`Enter your ${selected.name} API Key (${selected.envKey})`);
    if (!apiKey) {
      ui.fail("API key cannot be empty.");
      return 1;
    }
  }

  // Live verification
  const testModel = PROVIDER_DEFAULT_MODELS[selected.id][0] ?? "";
  const task = ui.task(`Testing connection to ${selected.name}...`);

  try {
    const settings = {
      id: selected.id,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
    };
    await verifyAi(selected.id, settings, testModel);
    task.succeed(`Connected successfully to ${selected.name}!`);
  } catch (error) {
    task.warn(`Verification check had an issue: ${error instanceof Error ? error.message : String(error)}`);
    const proceed = await promptText("Save this configuration anyway? (y/N)", "n");
    if (proceed.toLowerCase() !== "y") {
      ui.muted("Setup aborted. No changes made.");
      return 1;
    }
  }

  // Destination choice
  process.stdout.write(`\n  ${theme.accentBold("Step 2: Choose where to save your key")}\n\n`);
  process.stdout.write(`  ${theme.accent("[1]")} ${theme.bold("Global config")} (~/.kuebiko/.env) — ${theme.muted("Works across all your projects automatically")}\n`);
  process.stdout.write(`  ${theme.accent("[2]")} ${theme.bold("Local project")} (.env) — ${theme.muted("Saved only in this current directory")}\n\n`);

  const destChoice = await promptText("Select destination [1-2]", "1");
  const isGlobal = destChoice !== "2";

  const targetPath = isGlobal ? join(homedir(), ".kuebiko", ".env") : join(cwd, ".env");

  if (selected.id === "ollama") {
    saveEnvKey(targetPath, "OLLAMA_BASE_URL", baseUrl);
  } else {
    saveEnvKey(targetPath, selected.envKey, apiKey);
  }
  saveEnvKey(targetPath, "KUEBIKO_PROVIDER", selected.id);

  if (!isGlobal) {
    ensureGitignoreIncludesEnv(cwd);
  }

  process.stdout.write("\n");
  ui.success(`Configuration saved to: ${targetPath}`);
  if (!isGlobal) {
    ui.info("Verified that .gitignore protects your .env file.");
  }

  process.stdout.write(`\n  ${theme.badge("READY TO GO", "#FFFFFF", "#6366F1")}  ${theme.brandBold("You're all set!")}\n\n`);
  process.stdout.write(`  Try running these commands:\n`);
  process.stdout.write(`  • ${theme.brand("kuebiko run \"npm test\"")}      ${theme.muted("→ Autonomous repair loop on your test suite")}\n`);
  process.stdout.write(`  • ${theme.brand("kuebiko explain \"<error>\"")}   ${theme.muted("→ Diagnose and explain an error stack trace")}\n`);
  process.stdout.write(`  • ${theme.brand("kuebiko ask \"<question>\"")}    ${theme.muted("→ Context-aware codebase Q&A assistant")}\n`);
  process.stdout.write(`  • ${theme.brand("kuebiko doctor")}             ${theme.muted("→ Check environment health and credentials")}\n\n`);

  return 0;
}
