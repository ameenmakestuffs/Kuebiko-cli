import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { theme } from "../ui/theme.js";
import { Ui } from "../ui/ui.js";
import { resolveProvider } from "../core/providers.js";
import { aiChat } from "../services/ai-chat.js";

function getProjectSummary(cwd: string): string {
  const summary: string[] = [`Project Root: ${cwd}`];

  const pkgJsonPath = join(cwd, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      summary.push(`Package: ${pkg.name ?? "unnamed"} v${pkg.version ?? "0.0.0"}`);
      if (pkg.dependencies) summary.push(`Dependencies: ${Object.keys(pkg.dependencies).join(", ")}`);
    } catch {
      // ignore
    }
  }

  // Find top files in src/ or root
  const scanDirs = ["src", "."];
  const files: string[] = [];
  for (const dir of scanDirs) {
    const full = join(cwd, dir);
    if (!existsSync(full)) continue;
    try {
      for (const entry of readdirSync(full, { withFileTypes: true })) {
        if (entry.isFile() && /\.(js|ts|py|go|json|md)$/.test(entry.name)) {
          files.push(join(dir, entry.name).replace(/\\/g, "/"));
        }
      }
    } catch {
      // ignore
    }
  }
  summary.push(`Key files: ${files.slice(0, 25).join(", ")}`);
  return summary.join("\n");
}

export async function runAsk(
  questionParts: string[],
  cwd: string,
  options: { provider?: string; model?: string } = {},
): Promise<number> {
  const ui = new Ui({ json: false, verbose: false });
  const question = questionParts.join(" ").trim();

  if (!question) {
    ui.fail("Please provide a question, e.g.: kuebiko ask \"How is tax calculated in this project?\"");
    return 1;
  }

  ui.blank();
  write(`  ${theme.badge("KUEBIKO ASK", "#FFFFFF", "#6366F1")}  ${theme.brandBold("Codebase Assistant")}`);
  write(`  ${theme.muted(`Question: "${question}"`)}`);
  ui.blank();

  const resolution = resolveProvider({
    requested: options.provider,
    model: options.model,
  });

  if (!resolution.provider || !resolution.settings || resolution.models.length === 0) {
    ui.warn("No AI provider configured. Set GEMINI_API_KEY, OPENAI_API_KEY, or run Ollama to ask questions.");
    return 1;
  }

  const projectContext = getProjectSummary(cwd);
  const task = ui.task("Thinking & searching codebase context...");

  try {
    const answer = await aiChat({
      provider: resolution.provider,
      settings: resolution.settings,
      model: resolution.models[0] ?? "gemini-3.8-flash",
      maxTokens: 400,
      systemPrompt:
        "You are Kuebiko, an ultra-fast, minimal terminal assistant.\n" +
        "CRITICAL RULES:\n" +
        "1. Be extremely concise. Answer directly in 1 to 3 sentences or brief bullet points.\n" +
        "2. ZERO FLUFF. NEVER write entire tutorials, long walkthroughs, or unsolicited project skeletons unless the user explicitly asks for full code or tutorial.\n" +
        "3. For casual greetings, remarks, or statements, reply naturally with a short, witty 1-line response.\n" +
        "4. Save tokens and terminal real estate at all costs.\n" +
        (projectContext ? `\nCodebase Reference:\n${projectContext}` : ""),
      userPrompt: question,
    });

    task.succeed("Answer ready!");
    ui.blank();
    for (const line of answer.split("\n")) {
      write(`  ${line}`);
    }
    ui.blank();
    return 0;
  } catch (error) {
    task.fail(`Failed to generate answer: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function write(line = ""): void {
  process.stdout.write(`${line}\n`);
}

