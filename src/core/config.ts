import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AegisConfig, EngineMode } from "./types.js";
import { PRIMARY_MODEL } from "./models.js";

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".aegis",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
];

const DEFAULT_CONFIG: AegisConfig = {
  maxIterations: 3,
  timeoutMs: 300_000,
  model: PRIMARY_MODEL,
  engine: "auto",
  maxCandidates: 48,
  ignore: DEFAULT_IGNORE,
};

function readJsonConfig(cwd: string): Record<string, unknown> {
  const candidates = [join(cwd, "aegis.config.json"), join(process.cwd(), "aegis.config.json")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // A broken config should never stop Aegis from running.
    }
  }
  return {};
}

function asPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.min(max, Math.max(min, rounded));
}

function asEngine(value: unknown): EngineMode | undefined {
  return value === "auto" || value === "gemini" || value === "local" ? value : undefined;
}

export function loadConfig(cwd: string): AegisConfig {
  const file = readJsonConfig(cwd);
  const envEngine = asEngine(process.env.AEGIS_ENGINE);
  const fileEngine = asEngine(file.engine);

  const ignore = Array.isArray(file.ignore)
    ? [...new Set([...DEFAULT_IGNORE, ...file.ignore.filter((item): item is string => typeof item === "string")])]
    : DEFAULT_IGNORE;

  return {
    maxIterations: asPositiveInt(
      process.env.AEGIS_MAX_ITERATIONS ?? file.maxIterations,
      DEFAULT_CONFIG.maxIterations,
      1,
      10,
    ),
    timeoutMs: asPositiveInt(
      process.env.AEGIS_TIMEOUT_MS ?? file.timeoutMs,
      DEFAULT_CONFIG.timeoutMs,
      10_000,
      3_600_000,
    ),
    model:
      process.env.GEMINI_MODEL ??
      (typeof file.model === "string" && file.model.trim() ? file.model.trim() : DEFAULT_CONFIG.model),
    engine: envEngine ?? fileEngine ?? DEFAULT_CONFIG.engine,
    maxCandidates: asPositiveInt(file.maxCandidates, DEFAULT_CONFIG.maxCandidates, 4, 200),
    ignore,
  };
}

export function resolveProjectCwd(input: string | undefined): string {
  return resolve(process.cwd(), input ?? ".");
}
