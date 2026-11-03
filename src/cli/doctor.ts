import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineMode } from "../core/types.js";
import { providerEnvHint, providerLabel, resolveProvider } from "../core/providers.js";
import { TAGLINE, VERSION } from "../core/version.js";
import { verifyAi } from "../services/ai-repair.js";
import { theme } from "../ui/theme.js";
import { Ui } from "../ui/ui.js";

export interface DoctorOptions {
  live?: boolean;
  provider?: string;
  model?: string;
}

function engineMode(): EngineMode {
  const value = process.env.AEGIS_ENGINE;
  return value === "ai" || value === "gemini" || value === "local" ? value : "auto";
}

export async function runDoctor(cwd: string, options: DoctorOptions = {}): Promise<number> {
  const ui = new Ui({ json: false, verbose: false });
  ui.banner(VERSION, TAGLINE);
  ui.heading("Environment check");

  let healthy = true;

  const major = Number(process.versions.node.split(".")[0] ?? "0");
  if (major >= 20) {
    ui.success(`Node.js ${process.versions.node}`);
  } else {
    healthy = false;
    ui.fail(`Node.js ${process.versions.node} is too old (need >= 20.11).`);
  }

  if (!existsSync(cwd)) {
    healthy = false;
    ui.fail(`Project directory not found: ${cwd}`);
  } else {
    ui.success(`Project directory: ${cwd}`);
  }

  const resolution = resolveProvider({
    requested: options.provider,
    engine: engineMode(),
    model: options.model,
  });

  if (resolution.provider && resolution.settings && resolution.models.length > 0) {
    ui.success(`${providerLabel(resolution.provider)} configured · ${providerEnvHint(resolution.provider)}`);
    ui.info(`Models: ${resolution.models.join(" → ")}`);
  } else if (resolution.provider && resolution.settings) {
    healthy = false;
    ui.fail(resolution.error ?? "The selected provider has no usable model.");
    ui.muted("Set a deployment/model name, then run `aegis doctor` again.");
  } else if (resolution.error) {
    healthy = false;
    ui.fail(resolution.error);
    ui.muted("Aegis will fall back to the local mutation engine.");
  } else {
    ui.warn("No AI provider configured — Aegis will use its local mutation engine.");
    ui.muted("Set GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or run Ollama locally.");
  }

  if (options.live) {
    if (!resolution.provider || !resolution.settings) {
      healthy = false;
      ui.fail("Cannot run a live check without a configured AI provider.");
    } else {
      const label = providerLabel(resolution.provider);
      let liveOk = false;
      for (const model of resolution.models) {
        const task = ui.task(`Calling ${label} · ${model}`);
        try {
          const reply = (await verifyAi(resolution.provider, resolution.settings, model))
            .replace(/\s+/g, " ")
            .trim();
          task.succeed(`${label} · ${model} replied: ${reply || "ok"}`);
          liveOk = true;
          break;
        } catch (error) {
          task.fail(`${label} · ${model} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!liveOk) {
        healthy = false;
        ui.fail(`Every ${label} model in the ladder failed.`);
      }
    }
  }

  if (existsSync(cwd)) {
    const probeDir = join(cwd, ".aegis");
    const probe = join(probeDir, ".write-probe");
    try {
      mkdirSync(probeDir, { recursive: true });
      writeFileSync(probe, "ok", "utf8");
      rmSync(probe, { force: true });
      ui.success("Write access to the project");
    } catch {
      healthy = false;
      ui.fail("Aegis cannot write inside the project directory.");
    }
  }

  const resolved =
    resolution.provider && resolution.settings
      ? `${providerLabel(resolution.provider)} · ${resolution.models.join(" → ")}`
      : "local mutation engine";
  ui.info(`Repair engine: ${theme.accent(resolved)}`);

  ui.blank();
  if (healthy) {
    ui.success('Aegis is ready. Try: aegis run "npm test"');
  } else {
    ui.fail("Fix the items above before running Aegis.");
  }
  ui.blank();

  return healthy ? 0 : 1;
}
