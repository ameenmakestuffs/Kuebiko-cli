export type ProviderId = "gemini" | "groq" | "openai" | "anthropic" | "azure" | "bedrock" | "ollama";

export type EngineMode = "auto" | "ai" | "gemini" | "local";

export type ActiveEngine = "ai" | "local";

export interface RunOptions {
  command: string;
  cwd: string;
  maxIterations: number;
  timeoutMs: number;
  offline: boolean;
  dryRun: boolean;
  verbose: boolean;
  json: boolean;
  model?: string;
  configModel?: string;
  provider?: ProviderId;
  engine: EngineMode;
  maxCandidates: number;
  ignore: string[];
}

export interface ExecResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface AssertionHint {
  message?: string;
  expected?: string;
  actual?: string;
}

export interface TriageResult {
  framework: string;
  headline: string;
  locations: SourceLocation[];
  suspects: string[];
  tail: string;
  assertion?: AssertionHint;
}

export interface FilePatch {
  path: string;
  content: string;
  reason: string;
}

export interface RepairProposal {
  engine: ActiveEngine;
  provider?: ProviderId;
  model?: string;
  summary: string;
  patches: FilePatch[];
}

export interface AppliedPatch {
  relPath: string;
  absolutePath: string;
  original: string | null;
  updated: string;
  backupPath: string | null;
}

export interface PatchStat {
  path: string;
  reason: string;
  added: number;
  removed: number;
}

export interface AttemptReport {
  iteration: number;
  engine: ActiveEngine;
  provider?: ProviderId;
  model?: string;
  summary: string;
  patches: PatchStat[];
  verified: boolean;
  durationMs: number;
}

export interface SessionReport {
  id: string;
  command: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  iterations: number;
  initialExitCode: number;
  finalExitCode: number;
  engine: ActiveEngine | "none";
  provider?: ProviderId;
  attempts: AttemptReport[];
  message: string;
}

export interface KuebikoConfig {
  maxIterations: number;
  timeoutMs: number;
  model: string;
  provider?: string;
  engine: EngineMode;
  maxCandidates: number;
  ignore: string[];
}

export type AegisConfig = KuebikoConfig;

export interface VerifyResult {
  green: boolean;
  result: ExecResult;
}
