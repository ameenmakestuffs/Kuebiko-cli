import { theme } from "../ui/theme.js";
import { Ui } from "../ui/ui.js";
import { resolveProvider } from "../core/providers.js";
import { aiChat } from "../services/ai-chat.js";

function offlineExplain(error: string): string | null {
  if (error.includes("ERR_ASSERTION") || error.includes("AssertionError")) {
    return (
      "**Assertion Mismatch**: A test assertion failed because an expected value differed from the actual computed result.\n\n" +
      "**Action**: Look at the reported expected vs. actual values in your test suite and verify if the calculation logic in the source file has an inverted operator or off-by-one bug."
    );
  }
  if (error.includes("MODULE_NOT_FOUND") || error.includes("Cannot find module")) {
    const match = /Cannot find module ['"]([^'"]+)['"]/.exec(error);
    const mod = match ? match[1] : "the required package";
    return (
      `**Missing Module Dependency**: Your runtime could not locate \`${mod}\`.\n\n` +
      `**Action**: Run \`npm install ${mod}\` or check your relative import path.`
    );
  }
  if (error.includes("Cannot read properties of undefined") || error.includes("is not a function")) {
    return (
      "**Null or Undefined Access**: Code attempted to access a property or invoke a method on an object that hasn't loaded yet.\n\n" +
      "**Action**: Use optional chaining (e.g. `obj?.property`) or provide a fallback default before calling the property."
    );
  }
  if (error.includes("ECONNREFUSED")) {
    return (
      "**Connection Refused**: The service or port you are trying to connect to is not accepting network traffic.\n\n" +
      "**Action**: Ensure your local server, Docker container, or database is running on the expected port."
    );
  }
  return null;
}

export async function runExplain(errorText: string, options: { provider?: string; model?: string } = {}): Promise<number> {
  const ui = new Ui({ json: false, verbose: false });
  const raw = errorText.trim();

  if (!raw) {
    ui.fail("Please provide an error message to explain, e.g.: kuebiko explain \"TypeError: Cannot read properties of undefined\"");
    return 1;
  }

  ui.blank();
  write(`  ${theme.badge("KUEBIKO EXPLAIN", "#FFFFFF", "#6366F1")}  ${theme.brandBold("Diagnostic Error Explainer")}`);
  ui.blank();

  const resolution = resolveProvider({
    requested: options.provider,
    model: options.model,
  });

  if (resolution.provider && resolution.settings && resolution.models.length > 0) {
    const task = ui.task("Analyzing error with Kuebiko AI Engine");
    try {
      const explanation = await aiChat({
        provider: resolution.provider,
        settings: resolution.settings,
        model: resolution.models[0] ?? "gemini-3.8-flash",
        maxTokens: 500,
        systemPrompt:
          "You are Kuebiko, an expert autonomous debugging engineer. Analyze the error provided by the user. " +
          "Explain in 2-3 concise paragraphs: 1) What caused the error in plain English, 2) The exact fix or code pattern, 3) How to prevent it. " +
          "Format with clean markdown.",
        userPrompt: `Here is the error to explain:\n\n${raw}`,
      });
      task.succeed("Diagnosis complete!");
      ui.blank();
      for (const line of explanation.split("\n")) {
        write(`  ${line}`);
      }
      ui.blank();
      return 0;
    } catch (err) {
      task.warn("AI engine busy — falling back to local diagnostic heuristics...");
    }
  }

  // Local fallback
  const local = offlineExplain(raw);
  if (local) {
    write(`  ${theme.accentBold("Local Diagnosis:")}`);
    ui.blank();
    for (const line of local.split("\n")) {
      write(`  ${line}`);
    }
    ui.blank();
    return 0;
  }

  write(`  ${theme.muted("Error received:")}`);
  write(`  ${theme.danger(raw)}`);
  ui.blank();
  ui.info("Tip: Set a GEMINI_API_KEY or OPENAI_API_KEY to get deep AI-powered error diagnostics for any custom error.");
  ui.blank();
  return 0;
}

function write(line = ""): void {
  process.stdout.write(`${line}\n`);
}

