import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { ExecResult, TriageResult } from "../core/types.js";
import { redactSecrets, truncate } from "../util/text.js";
import { isTestFile } from "./triage.js";

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".css", ".scss", ".html", ".sql", ".sh",
  ".ps1", ".env", ".cfg", ".ini",
]);

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "pom.xml", "Gemfile"];

const PER_FILE_LIMIT = 14_000;
const TOTAL_LIMIT = 95_000;

export function listProjectTree(root: string, ignore: string[], maxDepth = 4, maxEntries = 350): string[] {
  const results: string[] = [];
  const ignored = new Set(ignore.map((entry) => entry.toLowerCase()));

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || results.length >= maxEntries) return;
    let entries: import("node:fs").Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxEntries) return;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
      if (ignored.has(entry.name.toLowerCase())) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        const size = statSync(absolute, { throwIfNoEntry: false })?.size ?? 0;
        if (size > 1_500_000) continue;
        results.push(relative(root, absolute).replace(/\\/g, "/"));
      }
    }
  };

  walk(root, 0);
  return results;
}

function languageFor(file: string): string {
  const ext = extname(file).toLowerCase();
  switch (ext) {
    case ".ts": return "ts";
    case ".tsx": return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs": return "js";
    case ".jsx": return "jsx";
    case ".py": return "python";
    case ".go": return "go";
    case ".rs": return "rust";
    case ".json": return "json";
    case ".yml":
    case ".yaml": return "yaml";
    case ".toml": return "toml";
    case ".md": return "markdown";
    default: return "text";
  }
}

function readSnippet(file: string): string | null {
  if (!existsSync(file)) return null;
  if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase()) && !file.endsWith(".env.example")) return null;
  try {
    const raw = readFileSync(file, "utf8");
    return redactSecrets(truncate(raw, PER_FILE_LIMIT));
  } catch {
    return null;
  }
}

export interface ContextInput {
  root: string;
  result: ExecResult;
  triage: TriageResult;
  ignore: string[];
}

export function buildContext(input: ContextInput): string {
  const { root, result, triage, ignore } = input;
  const tree = listProjectTree(root, ignore);
  const absoluteByRel = new Map(tree.map((rel) => [join(root, rel), rel]));

  const picked: string[] = [];
  const add = (absolute: string): void => {
    if (picked.includes(absolute)) return;
    if (!absoluteByRel.has(absolute)) return;
    picked.push(absolute);
  };

  for (const suspect of triage.suspects) add(suspect);

  const tests = tree.filter((rel) => isTestFile(rel)).slice(0, 6);
  for (const rel of tests) add(join(root, rel));

  const sourceLike = tree.filter(
    (rel) =>
      /^(src|lib|app|packages|server|client|internal|cmd)\//i.test(rel) &&
      TEXT_EXTENSIONS.has(extname(rel).toLowerCase()) &&
      !isTestFile(rel),
  );
  for (const rel of sourceLike.slice(0, 18)) add(join(root, rel));

  for (const manifest of MANIFESTS) {
    const absolute = join(root, manifest);
    if (existsSync(absolute)) {
      const rel = relative(root, absolute).replace(/\\/g, "/");
      if (tree.includes(rel)) add(absolute);
    }
  }

  const sections: string[] = [];
  sections.push(`PROJECT ROOT: ${root}`);
  sections.push(`COMMAND: ${result.command}`);
  sections.push(`EXIT CODE: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`);
  sections.push(`FRAMEWORK: ${triage.framework}`);
  sections.push(`TRIAGE HEADLINE: ${triage.headline}`);
  if (triage.assertion) {
    sections.push(`ASSERTION: ${JSON.stringify(triage.assertion)}`);
  }
  if (triage.locations.length > 0) {
    sections.push(
      `STACK LOCATIONS:\n${triage.locations
        .map((location) => `- ${relative(root, location.file).replace(/\\/g, "/")}:${location.line}:${location.column}`)
        .join("\n")}`,
    );
  }

  sections.push(`\nFAILURE OUTPUT (tail):\n\`\`\`\n${triage.tail}\n\`\`\``);
  sections.push(`\nPROJECT FILES:\n${tree.slice(0, 200).join("\n")}`);

  const fileSections: string[] = [];
  let total = sections.join("\n\n").length;

  for (const absolute of picked) {
    const rel = absoluteByRel.get(absolute);
    if (!rel) continue;
    const snippet = readSnippet(absolute);
    if (snippet === null) continue;
    const block = `\n### FILE: ${rel}\n\`\`\`${languageFor(rel)}\n${snippet}\n\`\`\``;
    if (total + block.length > TOTAL_LIMIT) break;
    fileSections.push(block);
    total += block.length;
  }

  sections.push("\nRELEVANT FILE CONTENTS:", ...fileSections);
  return redactSecrets(sections.join("\n"));
}
