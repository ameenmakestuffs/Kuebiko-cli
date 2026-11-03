import { relative } from "node:path";
import { readFileSync } from "node:fs";
import type {
  ActiveEngine,
  AppliedPatch,
  AttemptReport,
  ExecResult,
  FilePatch,
  PatchStat,
  ProviderId,
  RepairProposal,
  RunOptions,
  SessionReport,
} from "./types.js";
import { TAGLINE, VERSION } from "./version.js";
import { providerLabel, resolveProvider } from "./providers.js";
import { execute } from "../services/executor.js";
import { triage } from "../services/triage.js";
import { buildContext } from "../services/context.js";
import { aiRepair } from "../services/ai-repair.js";
import { localRepair } from "../services/local-repair.js";
import { Patcher, PatchValidationError, registerCleanup } from "../services/patcher.js";
import { makeSessionId, writeReport } from "../services/reporter.js";
import { Ui } from "../ui/ui.js";
import { diffLines } from "../util/diff.js";
import { formatDuration, plural, tail } from "../util/text.js";

function displayPath(root: string, file: string): string {
  return relative(root, file).split(/[\\/]/).join("/") || file;
}

function engineLabel(
  engine: ActiveEngine,
  provider: ProviderId | null,
  models: string[],
  verbose = false,
): string {
  if (engine === "ai") {
    if (verbose && provider) {
      return `Aegis AI Engine [${providerLabel(provider)} · ${models.join(" → ")}]`;
    }
    return models.length > 1
      ? "Aegis AI Engine (Multi-Tier Neural Ladder)"
      : "Aegis AI Engine";
  }
  return "Aegis Local Engine (Deterministic Mutation)";
}

function readTextFileSync(root: string, relPath: string): string {
  try {
    return readFileSync(`${root}/${relPath}`, "utf8");
  } catch {
    return "";
  }
}

function combinedOutput(result: ExecResult): string {
  return [result.stdout, result.stderr].filter((part) => part.trim()).join("\n");
}

export async function runSession(options: RunOptions, ui: Ui): Promise<SessionReport> {
  const startedAt = new Date();
  const startedMs = Date.now();
  const sessionId = makeSessionId();
  const patcher = new Patcher(options.cwd, sessionId);
  const attempts: AttemptReport[] = [];

  let initialExitCode = 1;
  let finalExitCode = 1;
  let success = false;
  let message = "";
  let activeEngine: ActiveEngine | "none" = "none";
  let activeProvider: ProviderId | undefined;

  ui.banner(VERSION, TAGLINE);
  const resolution = resolveProvider({
    requested: options.provider,
    engine: options.engine,
    model: options.model,
    configModel: options.configModel,
  });
  const canUseAi =
    !options.offline &&
    options.engine !== "local" &&
    Boolean(resolution.settings) &&
    resolution.models.length > 0;
  const requestedEngine: ActiveEngine = canUseAi ? "ai" : "local";
  const provider = resolution.provider;
  const providerSettings = resolution.settings;
  const modelLadder = resolution.models;

  const summaryRows: Array<[string, string]> = [
    ["project", options.cwd],
    ["command", options.command],
    ["engine", engineLabel(requestedEngine, provider, modelLadder, options.verbose)],
    ["loop", `up to ${options.maxIterations} ${plural(options.maxIterations, "attempt")}`],
    ["timeout", `${Math.round(options.timeoutMs / 1000)}s per run`],
  ];
  if (options.dryRun) summaryRows.push(["mode", "dry run (final files stay unchanged)"]);
  ui.kv(summaryRows);

  if (!canUseAi && !options.offline && options.engine !== "local") {
    ui.blank();
    if (resolution.error) {
      ui.warn(`${resolution.error} Using Aegis built-in local repair engine.`);
    } else {
      ui.warn("No AI provider configured — using Aegis built-in local repair engine.");
    }
    ui.muted("Set a provider key and run `aegis doctor` to enable AI neural repairs.");
  }

  ui.blank();
  const runTask = ui.task(`Running ${options.command}`);
  let result = await execute(options.command, options.cwd, options.timeoutMs);
  initialExitCode = result.exitCode;
  ui.fullOutput("stdout", result.stdout);
  ui.fullOutput("stderr", result.stderr);

  if (result.exitCode === 0) {
    runTask.succeed(`Command passed · ${formatDuration(result.durationMs)} · Build is already green! You didn't even need us (flex) 💪`);
    success = true;
    finalExitCode = 0;
    message = "The command passed on the first run. Nothing to repair.";
  } else {
    runTask.fail(
      `Command failed · exit ${result.exitCode}${result.timedOut ? " (timeout)" : ""} · ${formatDuration(result.durationMs)}`,
    );
  }

  for (let iteration = 1; !success && iteration <= options.maxIterations; iteration += 1) {
    const attemptStarted = Date.now();
    const diagnosis = triage(result, options.cwd, options.ignore);

    // Step 1: Rich Diagnosis Card
    ui.diagnosisCard(diagnosis, iteration, options.maxIterations, options.cwd);

    let engine: ActiveEngine = requestedEngine;
    if (engine === "ai" && (!provider || !providerSettings || modelLadder.length === 0)) {
      engine = "local";
      ui.warn("AI engine currently unavailable. Seamlessly deploying Aegis local mutation engine 🧮");
    }

    // Step 2: Autonomous Healing
    ui.blank();
    ui.stepHeader(
      2,
      3,
      "Autonomous Healing",
      engine === "ai" ? "Synthesizing fix via Aegis Neural Ladder" : "Running deterministic mutation search",
    );
    let proposal: RepairProposal | null = null;

    if (engine === "ai" && provider && providerSettings) {
      const context = buildContext({
        root: options.cwd,
        result,
        triage: diagnosis,
        ignore: options.ignore,
      });
      const label = providerLabel(provider);

      for (const [modelIndex, model] of modelLadder.entries()) {
        const tierName = modelLadder.length > 1 ? `Tier ${modelIndex + 1}` : "Primary Tier";
        const taskDescription = options.verbose
          ? `Synthesizing fix with ${label} · ${model}`
          : `Synthesizing fix via Aegis Neural Engine (${tierName})`;

        const aiTask = ui.task(taskDescription);
        try {
          const candidate = await aiRepair({ provider, settings: providerSettings, model, context });
          if (candidate.patches.length === 0) {
            aiTask.warn(
              options.verbose
                ? `${label} (${model}) declined to propose a safe patch.`
                : `${tierName} declined to propose a patch. Checking next tier...`,
            );
            continue;
          }
          proposal = candidate;
          aiTask.succeed(
            options.verbose
              ? `${label} (${model}) proposed ${candidate.patches.length} ${plural(candidate.patches.length, "patch", "patches")}`
              : `Aegis Neural Engine (${tierName}) synthesized ${candidate.patches.length} verified ${plural(candidate.patches.length, "patch", "patches")}!`,
          );
          break;
        } catch (error) {
          const isFailover = modelIndex < modelLadder.length - 1;
          if (isFailover) {
            aiTask.warn(
              options.verbose
                ? `${label} (${model}) error: ${error instanceof Error ? error.message : String(error)} · Failing over to Tier ${modelIndex + 2}...`
                : `${tierName} took an unexpected coffee break ☕ · Seamlessly switching to backup tier...`,
            );
          } else {
            aiTask.warn(
              options.verbose
                ? `${label} (${model}) error: ${error instanceof Error ? error.message : String(error)}`
                : "AI neural tiers busy · Deploying local deterministic engine 🧮",
            );
          }
        }
      }

      if (proposal === null) {
        ui.warn("AI ladder exhausted. Falling back to Aegis local deterministic engine 🧮");
        engine = "local";
      }
    }

    if (proposal === null && engine === "local") {
      const localTask = ui.task("Analyzing AST & searching minimal deterministic mutation space");
      proposal = await localRepair({
        root: options.cwd,
        suspects: diagnosis.suspects,
        triage: diagnosis,
        ignore: options.ignore,
        maxCandidates: options.maxCandidates,
        verify: async (patch: FilePatch): Promise<boolean> => {
          let green = false;
          await patcher.withTemporaryPatch(patch, async () => {
            const check = await execute(options.command, options.cwd, options.timeoutMs);
            green = check.exitCode === 0;
            return green;
          });
          return green;
        },
        onCandidate: (current, total, label) => {
          localTask.update(`Testing candidate mutation ${current}/${total} · ${label}`);
        },
      });

      if (proposal !== null) {
        localTask.succeed(
          `Aegis local engine verified a deterministic fix! · ${proposal.summary}`,
        );
      } else {
        localTask.fail("No single-edit candidate turned the command green.");
      }
    }

    if (!proposal || proposal.patches.length === 0) {
      message =
        engine === "ai"
          ? "The AI provider did not return a safe patch, and the local engine could not verify one."
          : "No safe local repair could be verified within the candidate budget.";
      ui.blank();
      ui.warn(message);
      break;
    }

    activeEngine = proposal.engine;
    activeProvider = proposal.provider;

    if (options.dryRun) {
      ui.heading("Proposed patch (dry run)");
      const stats: PatchStat[] = [];
      for (const patch of proposal.patches) {
        const original = readTextFileSync(options.cwd, patch.path);
        const diff = diffLines(original, patch.content, patch.path);
        stats.push({ path: patch.path, reason: patch.reason, added: diff.added, removed: diff.removed });
        ui.diff(patch.path, diff.text);
      }
      attempts.push({
        iteration,
        engine: proposal.engine,
        provider: proposal.provider,
        model: proposal.model,
        summary: proposal.summary,
        patches: stats,
        verified: false,
        durationMs: Date.now() - attemptStarted,
      });
      message = "Dry run complete. No files were modified.";
      break;
    }

    const applyTask = ui.task(
      `Applying ${proposal.patches.length} ${plural(proposal.patches.length, "patch", "patches")}`,
    );
    let applied: AppliedPatch[] = [];
    try {
      applied = await patcher.apply(proposal.patches);
      applyTask.succeed(
        `Patched ${proposal.patches.map((patch) => patch.path).join(", ")}`,
      );
    } catch (error) {
      applyTask.fail(error instanceof Error ? error.message : String(error));
      message =
        error instanceof PatchValidationError
          ? `Aegis rejected an unsafe patch: ${error.message}`
          : "Aegis failed while writing the patch. The project was left unchanged.";
      ui.warn(message);
      break;
    }

    const stats: PatchStat[] = proposal.patches.map((patch, index) => {
      const entry = applied[index];
      const diff = diffLines(entry?.original ?? "", patch.content, patch.path);
      return { path: patch.path, reason: patch.reason, added: diff.added, removed: diff.removed };
    });

    for (const patch of proposal.patches) {
      const entry = applied.find((item) => item.relPath.split(/[\\/]/).join("/") === patch.path);
      const diff = diffLines(entry?.original ?? "", patch.content, patch.path);
      ui.diff(patch.path, diff.text);
      ui.muted(`💡 ${patch.reason}`);
    }

    const unregister = registerCleanup(async () => {
      await patcher.restore(applied);
    });

    // Step 3: Verification
    ui.blank();
    ui.stepHeader(3, 3, "Smoke Testing & Verification", "Re-running command to ensure the fix turns build green");
    const verifyTask = ui.task(`Re-testing: ${options.command}`);
    result = await execute(options.command, options.cwd, options.timeoutMs);
    unregister();

    if (result.exitCode === 0) {
      verifyTask.succeed(`Command passed with flying colors! Verified in ${formatDuration(result.durationMs)} ✨`);
      success = true;
      finalExitCode = 0;
      activeEngine = proposal.engine;
      activeProvider = proposal.provider;
      message = `Self-healed after ${iteration} ${plural(iteration, "repair", "repairs")}.`;
      attempts.push({
        iteration,
        engine: proposal.engine,
        provider: proposal.provider,
        model: proposal.model,
        summary: proposal.summary,
        patches: stats,
        verified: true,
        durationMs: Date.now() - attemptStarted,
      });
      break;
    }

    verifyTask.fail(
      `Command still failing · exit ${result.exitCode}${result.timedOut ? " (timeout)" : ""}`,
    );
    ui.warn("Patch failed verification. Reverting safely so the next attempt starts clean ↺");
    await patcher.restore(applied);
    attempts.push({
      iteration,
      engine: proposal.engine,
      provider: proposal.provider,
      model: proposal.model,
      summary: proposal.summary,
      patches: stats,
      verified: false,
      durationMs: Date.now() - attemptStarted,
    });
    message = `Patch reverted: the command still failed with exit code ${result.exitCode}.`;
    if (iteration === options.maxIterations) {
      ui.blank();
      ui.warn(`Reached the ${options.maxIterations}-attempt limit without a green build.`);
    }
  }

  const durationMs = Date.now() - startedMs;
  finalExitCode = success ? 0 : result.exitCode;
  const appliedCount = attempts.filter((item) => item.verified).flatMap((item) => item.patches).length;
  const changedFiles = new Set(
    attempts
      .filter((item) => item.verified)
      .flatMap((item) => item.patches)
      .map((item) => item.path),
  );
  const totalAdded = attempts
    .filter((item) => item.verified)
    .flatMap((item) => item.patches)
    .reduce((sum, item) => sum + item.added, 0);
  const totalRemoved = attempts
    .filter((item) => item.verified)
    .flatMap((item) => item.patches)
    .reduce((sum, item) => sum + item.removed, 0);

  const finishedAt = new Date();
  const report: SessionReport = {
    id: sessionId,
    command: options.command,
    cwd: options.cwd,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - startedMs,
    success,
    iterations: attempts.length,
    initialExitCode,
    finalExitCode,
    engine: activeEngine,
    ...(activeProvider ? { provider: activeProvider } : {}),
    attempts,
    message,
  };

  const reportPath = await writeReport(options.cwd, report);

  const details = [
    `Verified with ${options.command} in ${formatDuration(report.durationMs)}.`,
    `${changedFiles.size} ${plural(changedFiles.size, "file")} changed · +${totalAdded} / -${totalRemoved} lines · engine: ${activeEngine}`,
  ];

  if (success) {
    ui.verdictSuccess(message, details, reportPath);
  } else {
    ui.verdictFailure(message, details, reportPath);
  }

  return report;
}
