import { relative } from "node:path";
import { readFileSync } from "node:fs";
import type {
  ActiveEngine,
  AppliedPatch,
  AttemptReport,
  ExecResult,
  FilePatch,
  PatchStat,
  RepairProposal,
  RunOptions,
  SessionReport,
} from "./types.js";
import { TAGLINE, VERSION } from "./version.js";
import { getGeminiApiKey } from "./env.js";
import { buildModelLadder } from "./models.js";
import { execute } from "../services/executor.js";
import { triage } from "../services/triage.js";
import { buildContext } from "../services/context.js";
import { geminiRepair } from "../services/gemini.js";
import { localRepair } from "../services/local-repair.js";
import { Patcher, PatchValidationError, registerCleanup } from "../services/patcher.js";
import { makeSessionId, writeReport } from "../services/reporter.js";
import { Ui } from "../ui/ui.js";
import { diffLines } from "../util/diff.js";
import { formatDuration, plural, tail } from "../util/text.js";

function displayPath(root: string, file: string): string {
  return relative(root, file).split(/[\\/]/).join("/") || file;
}

function engineLabel(engine: ActiveEngine, models: string[]): string {
  return engine === "gemini" ? `Gemini · ${models.join(" → ")}` : "local mutation engine";
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
  const apiKey = getGeminiApiKey();

  let initialExitCode = 1;
  let finalExitCode = 1;
  let success = false;
  let message = "";
  let activeEngine: ActiveEngine | "none" = "none";

  ui.banner(VERSION, TAGLINE);
  const requestedEngine = options.offline || options.engine === "local"
    ? "local"
    : options.engine === "gemini"
      ? "gemini"
      : apiKey
        ? "gemini"
        : "local";
  const modelLadder = buildModelLadder(options.model);

  const summaryRows: Array<[string, string]> = [
    ["project", options.cwd],
    ["command", options.command],
    ["engine", requestedEngine === "gemini" ? `Gemini · ${modelLadder.join(" → ")}` : "local mutation engine"],
    ["loop", `up to ${options.maxIterations} ${plural(options.maxIterations, "attempt")}`],
    ["timeout", `${Math.round(options.timeoutMs / 1000)}s per run`],
  ];
  if (options.dryRun) summaryRows.push(["mode", "dry run (final files stay unchanged)"]);
  ui.kv(summaryRows);

  if (!apiKey && !options.offline && options.engine !== "local") {
    ui.blank();
    ui.warn("No GEMINI_API_KEY found — using the built-in local repair engine.");
    ui.muted("Set GEMINI_API_KEY (or use aegis doctor) to enable AI-powered repairs.");
  }

  ui.blank();
  const runTask = ui.task(`Running ${options.command}`);
  let result = await execute(options.command, options.cwd, options.timeoutMs);
  initialExitCode = result.exitCode;
  ui.fullOutput("stdout", result.stdout);
  ui.fullOutput("stderr", result.stderr);

  if (result.exitCode === 0) {
    runTask.succeed(`Command passed · ${formatDuration(result.durationMs)}`);
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

    ui.heading(`Diagnosis · attempt ${iteration}/${options.maxIterations}`);
    ui.note("framework", diagnosis.framework);
    ui.note("failure", diagnosis.headline);
    if (diagnosis.assertion) {
      if (diagnosis.assertion.expected !== undefined) ui.note("expected", diagnosis.assertion.expected);
      if (diagnosis.assertion.actual !== undefined) ui.note("actual", diagnosis.assertion.actual);
    }
    if (diagnosis.suspects.length > 0) {
      ui.note("suspects", diagnosis.suspects.map((file) => displayPath(options.cwd, file)).join(", "));
    }
    ui.outputTail("failure output", diagnosis.tail, options.verbose ? 200 : 12);

    let engine: ActiveEngine = requestedEngine;
    if (!apiKey && engine === "gemini") {
      engine = "local";
      ui.warn("Gemini is unavailable without an API key. Falling back to the local engine.");
    }

    ui.blank();
    ui.step(`Repairing with ${engineLabel(engine, modelLadder)}`);
    let proposal: RepairProposal | null = null;

    if (engine === "gemini") {
      const context = buildContext({
        root: options.cwd,
        result,
        triage: diagnosis,
        ignore: options.ignore,
      });

      for (const model of modelLadder) {
        const aiTask = ui.task(`Analyzing failure with Gemini · ${model}`);
        try {
          const candidate = await geminiRepair({ apiKey, model, context });
          if (candidate.patches.length === 0) {
            aiTask.warn(`Gemini · ${model} declined to propose a safe patch.`);
            continue;
          }
          proposal = candidate;
          aiTask.succeed(
            `Gemini · ${model} proposed ${candidate.patches.length} ${plural(candidate.patches.length, "patch", "patches")}`,
          );
          break;
        } catch (error) {
          aiTask.fail(`Gemini · ${model} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (proposal === null) {
        ui.warn("Gemini ladder exhausted. Falling back to the local repair engine.");
        engine = "local";
      }
    }

    if (proposal === null && engine === "local") {
      const localTask = ui.task("Searching for a minimal local repair");
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
          localTask.update(`Testing local repair ${current}/${total} · ${label}`);
        },
      });

      if (proposal !== null) {
        localTask.succeed(
          `Local engine found a verified ${plural(proposal.patches.length, "fix", "fixes")} · ${proposal.summary}`,
        );
      } else {
        localTask.fail("No single-edit candidate turned the command green.");
      }
    }

    if (!proposal || proposal.patches.length === 0) {
      message =
        engine === "gemini"
          ? "Gemini did not return a safe patch, and the local engine could not verify one."
          : "No safe local repair could be verified within the candidate budget.";
      ui.blank();
      ui.warn(message);
      break;
    }

    activeEngine = proposal.engine;

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
      ui.muted(patch.reason);
    }

    const unregister = registerCleanup(async () => {
      await patcher.restore(applied);
    });

    const verifyTask = ui.task(`Re-running ${options.command}`);
    result = await execute(options.command, options.cwd, options.timeoutMs);
    unregister();

    if (result.exitCode === 0) {
      verifyTask.succeed(`Command passed · verified in ${formatDuration(result.durationMs)}`);
      success = true;
      finalExitCode = 0;
      activeEngine = proposal.engine;
      message = `Self-healed after ${iteration} ${plural(iteration, "repair", "repairs")}.`;
      attempts.push({
        iteration,
        engine: proposal.engine,
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
    ui.warn("The patch did not turn the build green. Reverting it so the next attempt starts clean.");
    await patcher.restore(applied);
    attempts.push({
      iteration,
      engine: proposal.engine,
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

  if (!message) {
    message = success ? "The command is green." : "Aegis could not repair the failure.";
  }

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
    attempts,
    message,
  };

  const reportPath = await writeReport(options.cwd, report);

  if (success) {
    const added = attempts.flatMap((attempt) => attempt.patches).reduce((sum, patch) => sum + patch.added, 0);
    const removed = attempts.flatMap((attempt) => attempt.patches).reduce((sum, patch) => sum + patch.removed, 0);
    const files = new Set(attempts.flatMap((attempt) => attempt.patches).map((patch) => patch.path));
    ui.verdictSuccess(
      message,
      [
        `Verified with ${options.command} in ${formatDuration(report.durationMs)}.`,
        `${files.size} ${plural(files.size, "file")} changed · +${added} / -${removed} lines · engine: ${activeEngine}`,
      ],
      reportPath,
    );
  } else {
    const output = combinedOutput(result);
    if (output.trim() && attempts.length === 0) {
      ui.outputTail("final output", tail(output, 4000), 16);
    }
    ui.verdictFailure(
      message,
      [
        attempts.length > 0
          ? `${attempts.length} ${plural(attempts.length, "repair attempt")} made, none verified green.`
          : "No patch was applied.",
        `Project left unchanged · exit code ${finalExitCode === 0 ? initialExitCode : finalExitCode}.`,
      ],
      reportPath,
    );
  }

  return report;
}
