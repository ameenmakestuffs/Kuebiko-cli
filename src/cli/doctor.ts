import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGeminiApiKey } from "../core/env.js";
import { buildModelLadder, PRIMARY_MODEL } from "../core/models.js";
import { TAGLINE, VERSION } from "../core/version.js";
import { verifyGemini } from "../services/gemini.js";
import { theme } from "../ui/theme.js";
import { Ui } from "../ui/ui.js";

export interface DoctorOptions {
  live?: boolean;
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

  const key = getGeminiApiKey();
  if (key) {
    ui.success(`Gemini API key detected (${key.slice(0, 4)}…${key.slice(-4)})`);
  } else {
    ui.warn("Gemini API key not set — Aegis will use its local mutation engine.");
    ui.muted("Add GEMINI_API_KEY to .env or ~/.aegis/.env to enable AI repairs.");
  }

  if (options.live) {
    if (!key) {
      healthy = false;
      ui.fail("Cannot run a live Gemini check without an API key.");
    } else {
      const ladder = buildModelLadder(process.env.GEMINI_MODEL ?? PRIMARY_MODEL);
      let liveOk = false;
      for (const model of ladder) {
        const task = ui.task(`Calling Gemini · ${model}`);
        try {
          const reply = (await verifyGemini(key, model)).replace(/\s+/g, " ").trim();
          task.succeed(`Gemini · ${model} replied: ${reply || "ok"}`);
          liveOk = true;
          break;
        } catch (error) {
          task.fail(`Gemini · ${model} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!liveOk) {
        healthy = false;
        ui.fail("Every Gemini model in the ladder failed.");
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

  const engine = process.env.AEGIS_ENGINE ?? "auto";
  const resolved = !key || engine === "local" ? "local mutation engine" : "Gemini";
  ui.info(`Repair engine: ${theme.accent(resolved)}`);

  ui.blank();
  if (healthy) {
    ui.success("Aegis is ready. Try: aegis run \"npm test\"");
  } else {
    ui.fail("Fix the items above before running Aegis.");
  }
  ui.blank();

  return healthy ? 0 : 1;
}
