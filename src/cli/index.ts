#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveProjectCwd } from "../core/config.js";
import { loadEnvironment } from "../core/env.js";
import { isProviderId, PRIMARY_MODEL } from "../core/models.js";
import { runSession } from "../core/session.js";
import type { EngineMode, ProviderId, RunOptions, SessionReport } from "../core/types.js";
import { TAGLINE, VERSION } from "../core/version.js";
import { runCleanups } from "../services/patcher.js";
import { Ui } from "../ui/ui.js";
import { runBench } from "./bench.js";
import { runDoctor } from "./doctor.js";
import { seedDemo } from "./demo.js";
import { runExplain } from "./explain.js";
import { runAsk } from "./ask.js";

interface RunCliOptions {
  cwd?: string;
  maxIterations?: string;
  offline?: boolean;
  engine?: string;
  provider?: string;
  model?: string;
  timeout?: string;
  maxCandidates?: string;
  dryRun?: boolean;
  json?: boolean;
  verbose?: boolean;
}

function parseInteger(value: string | undefined, label: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.round(parsed) !== parsed || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function resolveEngine(value: string | undefined): EngineMode | undefined {
  if (value === undefined) return undefined;
  if (value === "auto" || value === "ai" || value === "gemini" || value === "local") return value;
  throw new Error('--engine must be one of: auto, ai, gemini, local.');
}

function resolveProviderOption(value: string | undefined): ProviderId | undefined {
  if (value === undefined || value.trim() === "" || value === "auto") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!isProviderId(normalized)) {
    throw new Error('--provider must be one of: gemini, openai, anthropic, azure, bedrock, ollama.');
  }
  return normalized;
}

async function executeRun(commandParts: string[], cli: RunCliOptions): Promise<number> {
  const command = commandParts.join(" ").trim();
  if (!command) throw new Error("Provide a command to run, e.g. kuebiko run \"npm test\"");

  const cwd = resolveProjectCwd(cli.cwd);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`Project directory does not exist: ${cwd}`);
  }

  loadEnvironment(cwd);
  const config = loadConfig(cwd);

  const maxIterations = parseInteger(cli.maxIterations, "--max-iterations", 1, 10) ?? config.maxIterations;
  const timeoutSeconds = parseInteger(cli.timeout, "--timeout", 10, 3600);
  const maxCandidates = parseInteger(cli.maxCandidates, "--max-candidates", 4, 200) ?? config.maxCandidates;
  const engine = resolveEngine(cli.engine) ?? config.engine;
  const provider = resolveProviderOption(cli.provider) ?? resolveProviderOption(config.provider);

  const options: RunOptions = {
    command,
    cwd,
    maxIterations,
    timeoutMs: timeoutSeconds === undefined ? config.timeoutMs : timeoutSeconds * 1000,
    offline: Boolean(cli.offline),
    dryRun: Boolean(cli.dryRun),
    verbose: Boolean(cli.verbose),
    json: Boolean(cli.json),
    ...(cli.model?.trim() ? { model: cli.model.trim() } : {}),
    configModel: config.model,
    ...(provider ? { provider } : {}),
    engine,
    maxCandidates,
    ignore: config.ignore,
  };

  const ui = new Ui({ json: options.json, verbose: options.verbose });
  let report: SessionReport;
  try {
    report = await runSession(options, ui);
  } catch (error) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
      );
    } else {
      ui.fail(error instanceof Error ? error.message : String(error));
    }
    return 1;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }

  if (report.success) return 0;
  return report.finalExitCode > 0 ? report.finalExitCode : 1;
}

const program = new Command();

program
  .name("kuebiko")
  .description("Kuebiko — the autonomous on-call engineer for your terminal.")
  .version(VERSION, "-V, --version", "print the Kuebiko version")
  .helpOption("-h, --help", "show help");

program
  .command("run")
  .description("Run a command, diagnose any failure, patch the code, and re-run until green.")
  .argument("<command...>", 'command to run, e.g. "npm test"')
  .option("-C, --cwd <dir>", "project directory to operate on (default: current directory)")
  .option("-i, --max-iterations <n>", "maximum self-healing attempts (default: 3)")
  .option("--offline", "skip AI and use only the local mutation engine")
  .option("--engine <mode>", "repair engine: auto, ai, gemini, or local")
  .option("--provider <name>", "AI provider: gemini, openai, anthropic, azure, bedrock, or ollama")
  .option("--model <model>", `model to use (Gemini default: ${PRIMARY_MODEL})`)
  .option("--timeout <seconds>", "timeout for each command run (default: 300)")
  .option("--max-candidates <n>", "maximum local repair candidates to test (default: 48)")
  .option("--dry-run", "diagnose and propose patches without writing files")
  .option("--json", "emit a machine-readable report and suppress terminal UI")
  .option("-v, --verbose", "show full command output and stack traces")
  .action(async (commandParts: string[], options: RunCliOptions) => {
    try {
      process.exitCode = await executeRun(commandParts, options);
    } catch (error) {
      const ui = new Ui({ json: Boolean(options.json), verbose: false });
      ui.fail(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

program
  .command("doctor")
  .description("Check Node, project access, and AI provider configuration.")
  .option("--live", "make a real AI provider call to verify the key and model")
  .option("--provider <name>", "check a specific provider")
  .option("--model <model>", "check a specific model")
  .action(async (options: { live?: boolean; provider?: string; model?: string }) => {
    loadEnvironment(process.cwd());
    process.exitCode = await runDoctor(process.cwd(), {
      live: Boolean(options.live),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
    });
  });

program
  .command("demo")
  .description("Reseed the bundled demo bug, then let Kuebiko diagnose and heal it.")
  .option("--offline", "force the local repair engine")
  .option("--dry-run", "show the proposed fix without writing it")
  .option("--seed-only", "restore the seeded demo bug and exit")
  .action(async (options: { offline?: boolean; dryRun?: boolean; seedOnly?: boolean }) => {
    const sandbox = fileURLToPath(new URL("../../demo-sandbox", import.meta.url));
    if (!existsSync(sandbox)) {
      process.stderr.write(`Demo sandbox not found at ${sandbox}\n`);
      process.exitCode = 1;
      return;
    }

    const seeded = seedDemo(sandbox);
    if (!seeded.ok) {
      process.stderr.write(`${seeded.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`  ↺ ${seeded.message}\n`);

    if (options.seedOnly) {
      process.exitCode = 0;
      return;
    }

    const parts = ["npm test"];
    const args: RunCliOptions = { cwd: sandbox };
    if (options.offline) args.offline = true;
    if (options.dryRun) args.dryRun = true;
    process.exitCode = await executeRun(parts, args);
  });

  program
    .command("bench")
    .description("Run the deterministic repair benchmark suite.")
    .option("--suite <path>", "suite file or directory (default: bundled starter suite)")
    .option("--live", "use the configured AI provider instead of the local engine")
    .option("--provider <name>", "AI provider for live benchmarks")
    .option("--model <model>", "model override for live benchmarks")
    .option("--timeout <seconds>", "timeout for each benchmark command (default: 60)")
    .option("--max-candidates <n>", "maximum local repair candidates to test (default: 48)")
    .option("--output <file>", "write the JSON results to a file")
    .option("--json", "emit the benchmark report as JSON")
    .action(async (options: {
      suite?: string;
      live?: boolean;
      provider?: string;
      model?: string;
      timeout?: string;
      maxCandidates?: string;
      output?: string;
      json?: boolean;
    }) => {
      loadEnvironment(process.cwd());
      try {
        process.exitCode = await runBench(options);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command("explain [error...]")
    .description("Translate and diagnose an error trace with proposed fixes.")
    .option("--provider <name>", "AI provider to diagnose with")
    .option("--model <model>", "model override")
    .action(async (parts: string[], options: { provider?: string; model?: string }) => {
      loadEnvironment(process.cwd());
      const text = parts.join(" ");
      process.exitCode = await runExplain(text, options);
    });

  program
    .command("ask <question...>")
    .description("Ask a question about the current codebase.")
    .option("-C, --cwd <dir>", "project directory (default: current directory)")
    .option("--provider <name>", "AI provider to answer with")
    .option("--model <model>", "model override")
    .action(async (questionParts: string[], options: { cwd?: string; provider?: string; model?: string }) => {
      const cwd = resolveProjectCwd(options.cwd);
      loadEnvironment(cwd);
      process.exitCode = await runAsk(questionParts, cwd, options);
    });

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      process.exit(130);
      return;
    }
    shuttingDown = true;
    const ui = new Ui({ json: false, verbose: false });
    ui.warn("Interrupted — restoring any partially applied patch.");
    void runCleanups().finally(() => {
      process.exit(130);
    });
  });
}

loadEnvironment(process.cwd());
await program.parseAsync(process.argv);
