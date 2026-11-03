import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../core/config.js";
import { loadEnvironment } from "../core/env.js";
import { isProviderId } from "../core/models.js";
import { runSession } from "../core/session.js";
import type { ProviderId, RunOptions } from "../core/types.js";
import { execute } from "../services/executor.js";
import { atomicWriteFile } from "../util/fs.js";
import { formatDuration } from "../util/text.js";
import { Ui } from "../ui/ui.js";

interface BenchCase {
  name: string;
  language: string;
  path: string;
  commands: string[];
}

interface BenchSuite {
  name: string;
  version: number;
  cases: BenchCase[];
}

export interface BenchCliOptions {
  suite?: string;
  live?: boolean;
  provider?: string;
  model?: string;
  timeout?: string;
  maxCandidates?: string;
  output?: string;
  json?: boolean;
}

interface BenchCaseResult {
  name: string;
  language: string;
  command: string;
  success: boolean;
  skipped?: string;
  initialExitCode?: number;
  iterations?: number;
  engine?: string;
  provider?: ProviderId;
  model?: string;
  durationMs?: number;
  message?: string;
}

interface BenchReport {
  suite: string;
  startedAt: string;
  finishedAt: string;
  live: boolean;
  cases: BenchCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    medianDurationMs: number;
  };
}

const DEFAULT_SUITE = fileURLToPath(new URL("../../bench/suites/starter/suite.json", import.meta.url));
const SKIPPED_ENTRIES = new Set(["node_modules", ".git", ".aegis", "dist", "build", "coverage", "__pycache__", ".venv"]);

function parseInteger(value: string | undefined, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.round(parsed) !== parsed || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseProvider(value: string | undefined): ProviderId | undefined {
  if (!value || value === "auto") return undefined;
  const normalized = value.trim().toLowerCase();
  if (!isProviderId(normalized)) {
    throw new Error("--provider must be one of: gemini, openai, anthropic, azure, bedrock, ollama.");
  }
  return normalized;
}

function suiteFile(input: string | undefined): string {
  const target = input ? resolve(process.cwd(), input) : DEFAULT_SUITE;
  if (!existsSync(target)) throw new Error(`Benchmark suite not found: ${target}`);
  return statSync(target).isDirectory() ? join(target, "suite.json") : target;
}

function readSuite(file: string): { suite: BenchSuite; directory: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Could not read benchmark suite ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Benchmark suite must be a JSON object.");

  const record = parsed as Record<string, unknown>;
  const rawCases = Array.isArray(record.cases) ? record.cases : [];
  const cases: BenchCase[] = [];

  for (const raw of rawCases) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.path !== "string") continue;
    const commands = Array.isArray(item.commands)
      ? item.commands.filter((command): command is string => typeof command === "string" && command.trim().length > 0)
      : typeof item.command === "string" && item.command.trim()
        ? [item.command]
        : [];
    if (commands.length === 0) continue;
    cases.push({
      name: item.name,
      language: typeof item.language === "string" ? item.language : "unknown",
      path: item.path,
      commands,
    });
  }

  if (cases.length === 0) throw new Error("Benchmark suite contains no runnable cases.");
  return {
    suite: {
      name: typeof record.name === "string" ? record.name : basename(dirname(file)),
      version: typeof record.version === "number" ? record.version : 1,
      cases,
    },
    directory: dirname(file),
  };
}

function binaryOf(command: string): string {
  const match = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function commandAvailable(command: string): boolean {
  const binary = binaryOf(command);
  if (!binary) return false;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [binary], {
    encoding: "utf8",
    windowsHide: true,
  });
  return probe.status === 0;
}

function chooseCommand(commands: string[]): string | null {
  for (const command of commands) {
    if (commandAvailable(command)) return command;
  }
  return null;
}

function copyFixture(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    filter: (value) => !SKIPPED_ENTRIES.has(basename(value)),
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
}

function printReport(report: BenchReport): void {
  const nameWidth = Math.max(18, ...report.cases.map((entry) => entry.name.length));
  process.stdout.write(`\n  Aegis repair bench · ${report.suite}\n\n`);
  process.stdout.write(`  ${"case".padEnd(nameWidth)}  result   engine/model                 time\n`);
  process.stdout.write(`  ${"─".repeat(nameWidth)}  ───────  ───────────────────────────  ──────\n`);
  for (const entry of report.cases) {
    const result = entry.skipped ? "skip" : entry.success ? "pass" : "FAIL";
    const engine = entry.skipped ? entry.skipped : `${entry.engine ?? "?"}${entry.model ? ` · ${entry.model}` : ""}`;
    process.stdout.write(
      `  ${entry.name.padEnd(nameWidth)}  ${result.padEnd(7)}  ${engine.slice(0, 27).padEnd(27)}  ${entry.skipped ? "-" : formatDuration(entry.durationMs ?? 0)}\n`,
    );
  }
  const { total, passed, failed, skipped, passRate, medianDurationMs } = report.summary;
  process.stdout.write(
    `\n  ${passed}/${total} verified · ${failed} failed · ${skipped} skipped · ${passRate.toFixed(1)}% pass rate · median ${formatDuration(medianDurationMs)}\n\n`,
  );
}

export async function runBench(options: BenchCliOptions): Promise<number> {
  const timeoutMs = parseInteger(options.timeout, 60, 10, 3600, "--timeout") * 1000;
  const maxCandidates = parseInteger(options.maxCandidates, 48, 4, 200, "--max-candidates");
  const provider = parseProvider(options.provider);
  const suitePath = suiteFile(options.suite);
  const { suite, directory } = readSuite(suitePath);
  const startedAt = new Date();
  const results: BenchCaseResult[] = [];

  for (const item of suite.cases) {
    const source = resolve(directory, item.path);
    if (!existsSync(source)) {
      results.push({
        name: item.name,
        language: item.language,
        command: item.commands[0] ?? "",
        success: false,
        skipped: "fixture missing",
      });
      continue;
    }

    const command = chooseCommand(item.commands);
    if (!command) {
      results.push({
        name: item.name,
        language: item.language,
        command: item.commands[0] ?? "",
        success: false,
        skipped: "runner unavailable",
      });
      continue;
    }

    const temp = mkdtempSync(join(tmpdir(), "aegis-bench-"));
    const project = join(temp, "project");
    try {
      copyFixture(source, project);
      loadEnvironment(project);
      const config = loadConfig(project);

      const initial = await execute(command, project, timeoutMs);
      if (initial.exitCode === 0) {
        results.push({
          name: item.name,
          language: item.language,
          command,
          success: false,
          skipped: "fixture already green",
          initialExitCode: 0,
        });
        continue;
      }
      if (initial.exitCode === 127 || /not recognized|command not found/i.test(initial.stderr)) {
        results.push({
          name: item.name,
          language: item.language,
          command,
          success: false,
          skipped: "runner unavailable",
        });
        continue;
      }

      const runOptions: RunOptions = {
        command,
        cwd: project,
        maxIterations: 3,
        timeoutMs,
        offline: !options.live,
        dryRun: false,
        verbose: false,
        json: true,
        ...(options.model?.trim() ? { model: options.model.trim() } : {}),
        configModel: config.model,
        ...(provider ? { provider } : {}),
        engine: "auto",
        maxCandidates,
        ignore: config.ignore,
      };

      const report = await runSession(runOptions, new Ui({ json: true, verbose: false }));
      const lastAttempt = report.attempts[report.attempts.length - 1];
      results.push({
        name: item.name,
        language: item.language,
        command,
        success: report.success,
        initialExitCode: report.initialExitCode,
        iterations: report.iterations,
        engine: report.engine,
        ...(report.provider ? { provider: report.provider } : {}),
        ...(lastAttempt?.model ? { model: lastAttempt.model } : {}),
        durationMs: report.durationMs,
        message: report.message,
      });
    } catch (error) {
      results.push({
        name: item.name,
        language: item.language,
        command,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }

  const finishedAt = new Date();
  const passed = results.filter((entry) => !entry.skipped && entry.success).length;
  const failed = results.filter((entry) => !entry.skipped && !entry.success).length;
  const skipped = results.filter((entry) => entry.skipped).length;
  const durations = results
    .filter((entry) => !entry.skipped && typeof entry.durationMs === "number")
    .map((entry) => entry.durationMs ?? 0);

  const report: BenchReport = {
    suite: suite.name,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    live: Boolean(options.live),
    cases: results,
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      passRate: passed + failed === 0 ? 0 : (passed / (passed + failed)) * 100,
      medianDurationMs: median(durations),
    },
  };

  const output = options.output
    ? resolve(process.cwd(), options.output)
    : join(process.cwd(), ".aegis", "bench", "latest.json");
  await atomicWriteFile(output, `${JSON.stringify(report, null, 2)}\n`);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printReport(report);
    process.stdout.write(`  report  ${output}\n\n`);
  }

  if (results.length === 0) return 1;
  return failed === 0 ? 0 : 1;
}
