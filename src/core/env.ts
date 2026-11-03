import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import dotenv from "dotenv";

export interface EnvLoadResult {
  files: string[];
  keys: string[];
}

function readEnvFile(file: string): Record<string, string> {
  try {
    return dotenv.parse(readFileSync(file));
  } catch {
    return {};
  }
}

export function loadEnvironment(projectCwd: string): EnvLoadResult {
  const candidates = [
    join(homedir(), ".aegis", ".env"),
    join(process.cwd(), ".env"),
    join(resolve(projectCwd), ".env"),
  ];

  const files: string[] = [];
  const merged: Record<string, string> = {};

  for (const file of candidates) {
    if (files.includes(file) || !existsSync(file)) continue;
    files.push(file);
    Object.assign(merged, readEnvFile(file));
  }

  const keys: string[] = [];
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }

  return { files, keys };
}

export function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim();
}
