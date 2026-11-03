const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 20))}\n… [truncated]`;
}

export function tail(input: string, max: number): string {
  if (input.length <= max) return input;
  return `[… output truncated …]\n${input.slice(input.length - max)}`;
}

export function oneLine(input: string, max = 160): string {
  const collapsed = input.replace(/\s+/g, " ").trim();
  return truncate(collapsed, max);
}

export function indent(input: string, prefix = "  "): string {
  return input
    .split(/\r?\n/)
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join("\n");
}

export function countLines(input: string): number {
  if (input.length === 0) return 0;
  return input.split(/\r?\n/).length;
}

export function redactSecrets(input: string): string {
  return input
    .replace(
      /\b(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{16,}|ghp_[0-9A-Za-z]{20,}|gho_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16})\b/g,
      "[REDACTED_SECRET]",
    )
    .replace(
      /((?:api[_-]?key|secret|token|password|passwd|pwd|authorization)["']?\s*[:=]\s*)(["']?)[^\s"']{6,}\2/gi,
      "$1[REDACTED_SECRET]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED_SECRET]");
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
